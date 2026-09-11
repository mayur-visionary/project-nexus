// ════════════════════════════════════════════════════════════════
// /functions/snapshot-data.js
// Project Nexus · Mavlers · Session 28
//
// Server-side compute endpoint for BU Scorecard data.
// Called by Apps Script daily publisher — returns computed bkt
// totals as clean JSON. No HTML, no rendering.
//
// AUTH: X-Snapshot-Key header must match SNAPSHOT_DATA_KEY env var.
// Add SNAPSHOT_DATA_KEY to Cloudflare Pages environment variables.
//
// RESPONSE:
//   {
//     grand, digital, interbu, martech,
//     na: { managed, rec, managedAmt, recAmt },
//     monLabel, dateLabel, dealCount
//   }
//
// COMPUTE: identical to snapshot.html — same classifiers, same
// attribution registry, same NA detection. Single source of truth.
// ════════════════════════════════════════════════════════════════

// ── Constants ──
const PIPELINE            = "115832232";
const STAGE               = "205348626";
const EXCLUDED_COMPANIES  = ["InboxArmy","Uplers","Solomax"];
const EXCLUDED_ENG_MODELS = ["Wallet","Special Engagement"];
const MFULL = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MSHRT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Owner registry (mirrors snapshot.html exactly) ──
const MARTECH_OWNER_IDS = new Set([
  "107178262","17738843","34140174",
  "467997340",
  "82911376","82030736",
  "93107638","46153051","86147905","85767516","89530815",
  "916030451",
  "41490632"
]);
const DIGITAL_LEADERS  = new Set(["17739548","79217713","17739173"]);
const MARTECH_LEADERS  = new Set(["107178262","17738843","34140174"]);

const DIGITAL_OWNER_ROW = {
  "131779647":"AU","78831011":"AU","94746500":"AU","176516495":"AU","263464861":"AU",
  "37344296":"UK","31730801":"UK","46156316":"UK","24817892":"UK",
  "38568120":"US","42663191":"US","240935328":"US","19799470":"US","34558123":"US","284770744":"US","557894666":"US",
  "86813698":"NBD","255830830":"NBD","37762663":"NBD"
};
const MARTECH_OWNER_ROW = {
  "467997340":"AU",
  "82911376":"UK","82030736":"UK",
  "93107638":"US","46153051":"US","86147905":"US","85767516":"US","89530815":"US",
  "916030451":"NBD",
  "41490632":"NBD"
};
const GEO_ROW_MAP = {
  "AU":"AU","AU/NZ":"AU","India":"AU",
  "UK":"UK","Netherlands":"UK",
  "US":"US","Other":"US"
};

// ════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════
export async function onRequestGet(context) {
  return handleRequest(context);
}
export async function onRequestPost(context) {
  return handleRequest(context);
}

async function handleRequest(context) {
  try {
    // ── Auth ──
    const expectedKey = context.env.SNAPSHOT_DATA_KEY;
    if (!expectedKey) {
      return jsonError("SNAPSHOT_DATA_KEY not configured in Cloudflare environment.", 500);
    }
    const incomingKey = context.request.headers.get("X-Snapshot-Key") || "";
    if (incomingKey !== expectedKey) {
      return jsonError("Unauthorised.", 401);
    }

    const token = context.env.HUBSPOT_TOKEN;
    if (!token) return jsonError("HUBSPOT_TOKEN not configured.", 500);

    // ── Date anchor: yesterday in IST ──
    // Apps Script runs at 08:00 IST. We anchor to yesterday to match
    // the "EOD yesterday" framing of the daily scorecard.
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST    = new Date(Date.now() + istOffset);
    const yesterday = new Date(nowIST);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const pad       = n => String(n).padStart(2, "0");
    const yStr      = `${yesterday.getUTCFullYear()}-${pad(yesterday.getUTCMonth()+1)}-${pad(yesterday.getUTCDate())}`;
    const monthStr  = `${MFULL[yesterday.getUTCMonth()]}-${yesterday.getUTCFullYear()}`;
    const monLabel  = `${MSHRT[yesterday.getUTCMonth()]} ${yesterday.getUTCFullYear()}`;
    const dateLabel = `${yesterday.getUTCDate()} ${MSHRT[yesterday.getUTCMonth()]} ${yesterday.getUTCFullYear()}`;

    // ── Fetch ──
    const deals = await fetchDeals(token, monthStr);
    const liMap = await fetchLineItems(token, deals);

    // ── Compute ──
    const bkt = computeSnapshot(deals, liMap, yStr);

    // ── Aggregate ──
    const digital  = buTotal(bkt.digital);
    const interbu  = buTotal(bkt.interbu);
    const martech  = buTotal(bkt.martech);
    const grand    = digital + interbu + martech;
    const na       = naTotals(bkt);

    return new Response(JSON.stringify({
      grand, digital, interbu, martech, na,
      monLabel, dateLabel,
      dealCount: deals.length
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("[snapshot-data]", e);
    return jsonError(e.message, 500);
  }
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { "Content-Type": "application/json" }
  });
}

// ════════════════════════════════════════════════
// HUBSPOT FETCH (reuses same patterns as api.js + lineItems.js)
// ════════════════════════════════════════════════
async function fetchDeals(token, monthStr) {
  const props = [
    "dealname","amount_in_home_currency","hubspot_owner_id",
    "invoice_booking_date_formatted__invoice_app_",
    "invoice_booking_month__invoice_app_",
    "engagement_model__invoice_app_",
    "company_name__invoice_app_","zoho_display_name__invoice_app_",
    "zoho_billing_id__invoice_app_","contact_name__invoice_app_",
    "geo__invoice_app_"
  ];
  const filters = [
    {propertyName:"pipeline",                            operator:"EQ",     value:PIPELINE},
    {propertyName:"dealstage",                           operator:"EQ",     value:STAGE},
    {propertyName:"invoice_booking_month__invoice_app_", operator:"EQ",     value:monthStr},
    {propertyName:"engagement_model__invoice_app_",      operator:"NOT_IN", values:EXCLUDED_ENG_MODELS},
    {propertyName:"company_name__invoice_app_",          operator:"NOT_IN", values:EXCLUDED_COMPANIES}
  ];

  const hdrs = {"Content-Type":"application/json","Authorization":`Bearer ${token}`};
  const fetched = [];
  const seen    = new Set();
  let after     = null;

  do {
    const body = {filterGroups:[{filters}], properties:props, limit:200};
    if (after) body.after = after;

    const res  = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search",
      {method:"POST", headers:hdrs, body:JSON.stringify(body)});
    if (!res.ok) throw new Error(`Deal search ${res.status}: ${await res.text()}`);
    const data = await res.json();

    (data.results || []).forEach(r => {
      const p          = r.properties || {};
      const billing_id = (p.zoho_billing_id__invoice_app_ || p.contact_name__invoice_app_ || "").trim();
      const cn         = (p.company_name__invoice_app_ || "").trim();
      const company    = (cn && cn !== "(blank)") ? cn
        : (p.zoho_display_name__invoice_app_ || p.contact_name__invoice_app_ || "").trim();
      if (!billing_id && !company) return;
      if (company === "(blank)") return;
      const amount = parseFloat(p.amount_in_home_currency || 0) || 0;
      if (!amount) return;

      const dedupKey = `${p.dealname||""}|${amount}|${p.invoice_booking_month__invoice_app_||""}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);

      fetched.push({
        id:           String(r.id),
        owner_id:     String(p.hubspot_owner_id || ""),
        billing_id:   billing_id || company,
        company,
        eng_model:    (p.engagement_model__invoice_app_ || "").trim(),
        dealname:     (p.dealname || "").trim(),
        invoice_date: (p.invoice_booking_date_formatted__invoice_app_ || "").split("T")[0],
        geo:          (p.geo__invoice_app_ || "").trim(),
        amount
      });
    });

    after = data.paging?.next?.after || null;
  } while (after);

  return fetched;
}

async function fetchLineItems(token, deals) {
  const hdrs   = {"Content-Type":"application/json","Authorization":`Bearer ${token}`};
  const liMap  = {};
  const CHUNK  = 100;

  for (let i = 0; i < deals.length; i += CHUNK) {
    const chunk   = deals.slice(i, i + CHUNK);
    const dealIds = chunk.map(d => d.id);

    // Associations
    const assocMap     = {};
    const allLiIds     = new Set();
    try {
      const assocRes = await fetch(
        "https://api.hubapi.com/crm/v3/associations/deals/line_items/batch/read",
        {method:"POST", headers:hdrs, body:JSON.stringify({inputs:dealIds.map(id=>({id:String(id)}))})}
      );
      if (assocRes.ok) {
        const assocData = await assocRes.json();
        (assocData.results || []).forEach(r => {
          const did   = String(r.from?.id || "");
          const liIds = (r.to || []).map(t => String(t.id));
          if (did && liIds.length) { assocMap[did] = liIds; liIds.forEach(id => allLiIds.add(id)); }
        });
      }
    } catch(e) { console.error("Assoc error:", e.message); }

    // Batch-read LI properties
    const liProps  = {};
    const liIdArr  = [...allLiIds];
    for (let j = 0; j < liIdArr.length; j += 100) {
      try {
        const liRes = await fetch(
          "https://api.hubapi.com/crm/v3/objects/line_items/batch/read",
          {method:"POST", headers:hdrs, body:JSON.stringify({
            inputs:     liIdArr.slice(j, j+100).map(id=>({id})),
            properties: ["name","amount","description"]
          })}
        );
        if (liRes.ok) {
          const liData = await liRes.json();
          (liData.results || []).forEach(r => {
            const amt = parseFloat(r.properties?.amount || 0) || 0;
            if (amt <= 0) return;
            liProps[String(r.id)] = {
              name:        (r.properties?.name || "").trim(),
              description: (r.properties?.description || "").trim(),
              amount:      amt,
              bu:          classifyLineItem((r.properties?.name || "").trim())
            };
          });
        }
      } catch(e) { console.error("LI batch error:", e.message); }
    }

    // Attach LIs to deals
    Object.entries(assocMap).forEach(([did, liIds]) => {
      liMap[did] = liIds.map(id => liProps[id]).filter(Boolean);
    });
  }

  return liMap;
}

// ════════════════════════════════════════════════
// CLASSIFIERS (verbatim from snapshot.html)
// ════════════════════════════════════════════════
function classifyLineItem(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("campaign -") || n.includes("campaign manager") ||
      n.includes("campaign operation specialist") || n.includes("sfmc") ||
      n.includes("salesforce marketing cloud"))                          return "MarTech";
  if (n.includes("design - asset") || n.includes("design - digital"))   return "Digital";
  if (n.includes("design - "))                                           return "MarTech";
  if (n.includes("development - email") || n.includes("email coding"))  return "MarTech";
  if (n.includes("email design and coding"))                             return "MarTech";
  if (n.includes("development - web") || n.includes("development - lp/hub") ||
      n.includes("development - mobile app") || n.includes("ai & automation - web") ||
      n.includes("dot-net development") || n.includes("operational service - data entry") ||
      n.includes("landing page coding"))                                 return "Digital";
  if (n.includes("search -") || n.includes("consultancy fees"))         return "Digital";
  return null;
}

function snapEngType(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.startsWith("dedicated fte") || n.startsWith("dedicated pte"))   return "Recurring";
  if (n.startsWith("recurring services") || n.startsWith("recurring"))  return "Recurring";
  if (n.startsWith("p2p") || n.startsWith("time and material") ||
      n.startsWith("t&m") || n.includes("email coding"))                return "P2P";
  return null;
}

function engGroup(val) {
  if (!val) return null;
  if (["Dedicated FTE","Dedicated PTE","Multiple","Recurring Services","Recurring"].includes(val)) return "Recurring";
  if (["P2P","Time and Material","T&M","Time"].includes(val)) return "P2P";
  return null;
}

function naStatus(liName, liDescription) {
  if (!liName || !liDescription) return null;
  const n = liName.toLowerCase();
  if (!/Status\s*:\s*New/i.test(liDescription)) return null;
  if (n.startsWith("dedicated fte") || n.startsWith("dedicated pte")) return "Managed";
  if (n.startsWith("recurring services") || n.startsWith("recurring"))  return "Recurring";
  return null;
}

function getDealRowKey(oid, isMarTech, dealGeo) {
  if (isMarTech) {
    if (MARTECH_LEADERS.has(oid)) return GEO_ROW_MAP[dealGeo] || "US";
    return MARTECH_OWNER_ROW[oid] || "NBD";
  } else {
    if (DIGITAL_LEADERS.has(oid)) return GEO_ROW_MAP[dealGeo] || "US";
    return DIGITAL_OWNER_ROW[oid] || "NBD";
  }
}

// ════════════════════════════════════════════════
// COMPUTE (verbatim from snapshot.html)
// ════════════════════════════════════════════════
function emptyBU() {
  const rows = () => ({AU:{rec:0,p2p:0},UK:{rec:0,p2p:0},US:{rec:0,p2p:0},NBD:{rec:0,p2p:0}});
  const na   = () => ({AU:{managed:0,rec:0,managedAmt:0,recAmt:0},
                       UK:{managed:0,rec:0,managedAmt:0,recAmt:0},
                       US:{managed:0,rec:0,managedAmt:0,recAmt:0},
                       NBD:{managed:0,rec:0,managedAmt:0,recAmt:0}});
  return {booking: rows(), na: na()};
}

function computeSnapshot(deals, liMap, todayStr) {
  const bkt = {digital: emptyBU(), interbu: emptyBU(), martech: emptyBU()};

  deals.forEach(deal => {
    const oid       = String(deal.owner_id || "");
    const isMarTech = MARTECH_OWNER_IDS.has(oid);
    const rowKey    = getDealRowKey(oid, isMarTech, deal.geo);
    const lis       = liMap[deal.id] || [];
    const dealAmt   = deal.amount;
    if (!dealAmt) return;

    const isOnPrefix = deal.dealname.toUpperCase().startsWith("ON");

    if (!lis.length) {
      let et;
      if (isOnPrefix) { et = "P2P"; }
      else { et = engGroup(deal.eng_model); if (!et) return; }
      const bk   = isMarTech ? "martech" : "digital";
      const bRow = bkt[bk].booking[rowKey];
      if (!bRow) return;
      if (et === "P2P") bRow.p2p += dealAmt; else bRow.rec += dealAmt;
      return;
    }

    const liTotal = lis.reduce((s, li) => s + (li.amount || 0), 0);
    if (!liTotal) return;
    const scale = dealAmt / liTotal;

    lis.forEach(li => {
      if (!li.amount) return;

      let et;
      if (isOnPrefix) { et = "P2P"; }
      else if (deal.eng_model === "Multiple") { et = snapEngType(li.name); if (!et) return; }
      else { et = snapEngType(li.name); if (!et) { et = engGroup(deal.eng_model); if (!et) return; } }

      const amt = li.amount * scale;
      const bk  = isMarTech ? "martech" : (li.bu === "MarTech" ? "interbu" : "digital");
      const bRow = bkt[bk].booking[rowKey];
      if (!bRow) return;
      if (et === "P2P") bRow.p2p += amt; else bRow.rec += amt;

      if (isOnPrefix) return;
      const naType = naStatus(li.name, li.description);
      if (!naType) return;
      const naRow = bkt[bk].na[rowKey];
      if (!naRow) return;
      if (naType === "Managed") { naRow.managed++;    naRow.managedAmt += amt; }
      else                      { naRow.rec++;         naRow.recAmt    += amt; }
    });
  });

  return bkt;
}

// ════════════════════════════════════════════════
// AGGREGATION
// ════════════════════════════════════════════════
function buTotal(buData) {
  return ["AU","UK","US","NBD"].reduce((s, rk) => {
    const r = buData.booking[rk];
    return s + r.rec + r.p2p;
  }, 0);
}

function naTotals(bkt) {
  let managed = 0, rec = 0, managedAmt = 0, recAmt = 0;
  ["digital","interbu","martech"].forEach(bu => {
    ["AU","UK","US","NBD"].forEach(rk => {
      const r = bkt[bu].na[rk];
      managed    += r.managed;
      rec        += r.rec;
      managedAmt += r.managedAmt;
      recAmt     += r.recAmt;
    });
  });
  return {managed, rec, managedAmt, recAmt};
}
