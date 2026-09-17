// ════════════════════════════════════════════════════════════════
// /functions/snapshot-data.js
// Project Nexus · Mavlers · Session 28 (updated to match snapshot.html Session 27)
//
// CHANGES vs previous version:
//   1. naStatus() — added liStartDate + month validation (DD/MM/YYYY format)
//      LI start_date must fall in the current booking month to qualify as NA.
//   2. fetchLineItems() — added "start_date" to LI property fetch.
//   3. classifyLineItem() — return value aligned to {bu:...} object shape,
//      consistent with snapshot.html.
//   4. LI map building — reads li.bu from cls?.bu (object shape).
// ════════════════════════════════════════════════════════════════

const PIPELINE            = "115832232";
const STAGE               = "205348626";
const EXCLUDED_COMPANIES  = ["InboxArmy","Uplers","Solomax"];
const EXCLUDED_ENG_MODELS = ["Wallet","Special Engagement"];
const MFULL = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MSHRT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const MARTECH_OWNER_IDS = new Set([
  "107178262","17738843","34140174",
  "467997340",
  "82911376","82030736",
  "93107638","46153051","86147905","85767516","89530815",
  "916030451",
  "41490632"
]);
const DIGITAL_LEADERS = new Set(["17739548","79217713","17739173"]);
const MARTECH_LEADERS = new Set(["107178262","17738843","34140174"]);

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
    const expectedKey = context.env.SNAPSHOT_DATA_KEY;
    if (!expectedKey) return jsonError("SNAPSHOT_DATA_KEY not configured.", 500);
    const incomingKey = context.request.headers.get("X-Snapshot-Key") || "";
    if (incomingKey !== expectedKey) return jsonError("Unauthorised.", 401);

    const token = context.env.HUBSPOT_TOKEN;
    if (!token) return jsonError("HUBSPOT_TOKEN not configured.", 500);

    // Date anchor: yesterday IST (trigger fires at 00:00 IST)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST    = new Date(Date.now() + istOffset);
    const yesterday = new Date(nowIST);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const pad       = n => String(n).padStart(2, "0");
    const yStr      = `${yesterday.getUTCFullYear()}-${pad(yesterday.getUTCMonth()+1)}-${pad(yesterday.getUTCDate())}`;
    const monthStr  = `${MFULL[yesterday.getUTCMonth()]}-${yesterday.getUTCFullYear()}`;
    const monLabel  = `${MSHRT[yesterday.getUTCMonth()]} ${yesterday.getUTCFullYear()}`;
    const dateLabel = `${yesterday.getUTCDate()} ${MSHRT[yesterday.getUTCMonth()]} ${yesterday.getUTCFullYear()}`;

    const deals = await fetchDeals(token, monthStr);
    const liMap = await fetchLineItems(token, deals);
    const bkt   = computeSnapshot(deals, liMap, yStr);

    const digital = buTotal(bkt.digital);
    const interbu = buTotal(bkt.interbu);
    const martech = buTotal(bkt.martech);
    const grand   = digital + interbu + martech;
    const na      = naTotals(bkt);

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
// HUBSPOT FETCH
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
  const fetched = [], seen = new Set();
  let after = null;

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
  const hdrs  = {"Content-Type":"application/json","Authorization":`Bearer ${token}`};
  const liMap = {};
  const CHUNK = 100;

  for (let i = 0; i < deals.length; i += CHUNK) {
    const dealIds = deals.slice(i, i + CHUNK).map(d => d.id);

    const assocMap = {}, allLiIds = new Set();
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

    const liProps = {};
    const liIdArr = [...allLiIds];
    for (let j = 0; j < liIdArr.length; j += 100) {
      try {
        const liRes = await fetch(
          "https://api.hubapi.com/crm/v3/objects/line_items/batch/read",
          {method:"POST", headers:hdrs, body:JSON.stringify({
            inputs:     liIdArr.slice(j, j+100).map(id=>({id})),
            // ── start_date added: required for naStatus() month validation ──
            properties: ["name","amount","description","start_date"]
          })}
        );
        if (liRes.ok) {
          const liData = await liRes.json();
          (liData.results || []).forEach(r => {
            const amt = parseFloat(r.properties?.amount || 0) || 0;
            if (amt <= 0) return;
            const cls = classifyLineItem((r.properties?.name || "").trim());
            liProps[String(r.id)] = {
              name:        (r.properties?.name || "").trim(),
              description: (r.properties?.description || "").trim(),
              start_date:  (r.properties?.start_date || "").trim(),
              amount:      amt,
              bu:          cls?.bu || null   // object shape: {bu:"MarTech"} → .bu
            };
          });
        }
      } catch(e) { console.error("LI batch error:", e.message); }
    }

    Object.entries(assocMap).forEach(([did, liIds]) => {
      liMap[did] = liIds.map(id => liProps[id]).filter(Boolean);
    });
  }

  return liMap;
}

// ════════════════════════════════════════════════
// CLASSIFIERS — verbatim from snapshot.html
// ════════════════════════════════════════════════
function classifyLineItem(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  // Return shape matches snapshot.html: {bu: "..."}
  if (n.includes("campaign -") || n.includes("campaign manager") ||
      n.includes("campaign operation specialist") || n.includes("sfmc") ||
      n.includes("salesforce marketing cloud"))                          return {bu:"MarTech"};
  if (n.includes("design - asset") || n.includes("design - digital"))   return {bu:"Digital"};
  if (n.includes("design - "))                                           return {bu:"MarTech"};
  if (n.includes("development - email") || n.includes("email coding"))  return {bu:"MarTech"};
  if (n.includes("email design and coding"))                             return {bu:"MarTech"};
  if (n.includes("development - web") || n.includes("development - lp/hub") ||
      n.includes("development - mobile app") || n.includes("ai & automation - web") ||
      n.includes("dot-net development") || n.includes("operational service - data entry") ||
      n.includes("landing page coding"))                                 return {bu:"Digital"};
  if (n.includes("search -") || n.includes("consultancy fees"))         return {bu:"Digital"};
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

// ── naStatus: verbatim from new snapshot.html ──
// start_date format from Invoice App: "DD/MM/YYYY HH:MM:SS"
// Must match current booking month (derived from todayStr YYYY-MM-DD).
function naStatus(liName, liDescription, liStartDate, todayStr) {
  if (!liName || !liDescription) return null;
  const n = liName.toLowerCase();
  if (!/Status\s*:\s*New/i.test(liDescription)) return null;
  if (!liStartDate) return null;
  const parts = liStartDate.split(/[\/\s:]/); // ["DD","MM","YYYY",...]
  if (parts.length < 3) return null;
  const sdYear  = parseInt(parts[2], 10);
  const sdMonth = parseInt(parts[1], 10); // 1-based
  const [tsYear, tsMonth] = todayStr.split("-").map(Number);
  if (sdYear !== tsYear || sdMonth !== tsMonth) return null;
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
// COMPUTE — verbatim from snapshot.html
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
    if (!dealAmt || dealAmt === 0) return;

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
      if (!li.amount || li.amount === 0) return;

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
      // ── naStatus now requires start_date + todayStr for month gate ──
      const naType = naStatus(li.name, li.description, li.start_date, todayStr);
      if (!naType) return;
      const naRow = bkt[bk].na[rowKey];
      if (!naRow) return;
      if (naType === "Managed") { naRow.managed++;  naRow.managedAmt += amt; }
      else                      { naRow.rec++;       naRow.recAmt    += amt; }
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
