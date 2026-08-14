// functions/funnel-sheet.js
// Funnel Desk v3 — Master Sheet proxy
// POST { head: "jiggyasa" | "tanuj_uk" | "tanuj_us" | "jaydeep" }
//
// Row indices verified against actual live proxy CSVs (August 2026).
//
// Jiggyasa / Tanuj UK / Tanuj US:
//   Digital BU  : header idx 1, data per R{} below
//   Inter BU    : header idx 47, every data row = Digital idx + 46
//   ownerCols / sumCol per CFG
//
// Jaydeep (MarTech):
//   Single block: header idx 0, data per RJ{} below
//   noInter: true — no Inter BU block
//
// Grand Total / GAP computed client-side. Auth: Service Account JWT → OAuth2.

export async function onRequestPost(context) {
  try {
    const { head } = await context.request.json();

    const CFG = {
      jiggyasa : { tab: "Jiggyasa", ownerCols: [1,2,3,4,5], sumCol: 6,  noInter: false },
      tanuj_uk  : { tab: "Tanuj UK", ownerCols: [1,2,3],     sumCol: 4,  noInter: false },
      tanuj_us  : { tab: "Tanuj US", ownerCols: [1,2,3,4,5], sumCol: 6,  noInter: false },
      jaydeep   : { tab: "Jaydeep",  ownerCols: [1,2,3,4,5,6,7,8,9], sumCol: 10, noInter: true },
    };

    const cfg = CFG[head];
    if (!cfg) return resp({ error: `Unknown head: ${head}` }, 400);

    const SHEET_ID = context.env.FUNNEL_MASTER_SHEET_ID;
    const SA_EMAIL = context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY   = context.env.GOOGLE_PRIVATE_KEY;
    if (!SHEET_ID || !SA_EMAIL || !SA_KEY)
      return resp({ error: "Missing env vars" }, 500);

    const token = await getAccessToken(SA_EMAIL, SA_KEY);
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(cfg.tab)}`;
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return resp({ error: `Sheets API ${res.status}: ${await res.text()}` }, 502);

    const { values: rows = [] } = await res.json();
    if (!rows.length) return resp({ error: `No data in tab "${cfg.tab}"` }, 404);

    return resp(parse(rows, head, cfg), 200);

  } catch (e) { return resp({ error: e.message }, 500); }
}

// ── Row index map — Jiggyasa / Tanuj UK / Tanuj US (0-indexed) ──
// Digital block: header idx 1. Inter block: same keys + INTER_OFFSET (46).
// Verified against live proxy CSVs Aug 2026.
const R = {
  target               :  2,
  opening              :  6,   // Pre-Paid Invoices
  predictedLoss        :  7,
  postPaid             :  8,
  existingPipeline     : 10,
  openNewPipeline      : 11,
  openOldPipeline      : 12,
  closureFromPipeline  : 13,
  pipelineWon          : 14,
  pipelineConversion   : 15,   // %
  existingOpp          : 17,
  closureFromOpp       : 18,
  oppConversion        : 19,   // %
  recurringTotal       : 21,
  currentBooking       : 25,
  prevP2PInvoices      : 26,
  p2pFreshPipeline     : 28,
  p2pDeemedPipeline    : 29,
  p2pNotDeemedPipeline : 30,
  p2pClosurePipeline   : 31,
  p2pPipelineWon       : 32,
  p2pPipelineConv      : 33,   // %
  p2pOpportunities     : 35,
  p2pClosureOpp        : 36,
  p2pOppConv           : 37,   // %
  p2pTotal             : 39,
};

// ── Row index map — Jaydeep / MarTech (0-indexed, single block) ──
// Header idx 0 (no "Digital BU" section header row).
const RJ = {
  target               :  1,
  opening              :  5,   // Pre-Paid Invoices
  predictedLoss        :  6,
  postPaid             :  7,
  existingPipeline     :  9,
  openNewPipeline      : 10,
  openOldPipeline      : 11,
  closureFromPipeline  : 12,
  pipelineWon          : 13,
  pipelineConversion   : 14,   // %
  existingOpp          : 16,
  closureFromOpp       : 17,
  oppConversion        : 18,   // %
  recurringTotal       : 20,
  currentBooking       : 24,
  prevP2PInvoices      : 25,
  p2pFreshPipeline     : 27,
  p2pDeemedPipeline    : 28,
  p2pNotDeemedPipeline : 29,
  p2pClosurePipeline   : 30,
  p2pPipelineWon       : 31,
  p2pPipelineConv      : 32,   // %
  p2pOpportunities     : 34,
  p2pClosureOpp        : 35,
  p2pOppConv           : 36,   // %
  p2pTotal             : 38,
};

const PCT = new Set([
  'pipelineConversion','oppConversion','p2pPipelineConv','p2pOppConv'
]);

// Inter BU header at idx 47; data = Digital idx + 46
const INTER_OFFSET = 46;

function parse(rows, head, cfg) {
  const rowMap = cfg.noInter ? RJ : R;

  function buildBlock(headerIdx, offset) {
    const header = rows[headerIdx] ?? [];
    const owners = cfg.ownerCols.map(c => {
      const name = (header[c] ?? "").toString().trim();
      const o = { name };
      for (const [key, baseIdx] of Object.entries(rowMap)) {
        const idx = baseIdx + offset;
        o[key] = PCT.has(key) ? pctVal(rows, idx, c) : numVal(rows, idx, c);
      }
      return o;
    });
    const teamSum = { name: "Team Sum" };
    for (const [key, baseIdx] of Object.entries(rowMap)) {
      const idx = baseIdx + offset;
      teamSum[key] = PCT.has(key) ? pctVal(rows, idx, cfg.sumCol) : numVal(rows, idx, cfg.sumCol);
    }
    return { owners, teamSum };
  }

  const month = new Date().toLocaleString("en-GB", {
    month: "long", year: "numeric", timeZone: "Asia/Kolkata"
  });

  const result = { head, tab: cfg.tab, month, noInter: cfg.noInter };

  if (cfg.noInter) {
    // Jaydeep: single block, header at idx 0, no offset
    result.digital = buildBlock(0, 0);
  } else {
    // Digital header idx 1, Inter header idx 47 (offset 46)
    result.digital = buildBlock(1, 0);
    result.inter   = buildBlock(47, INTER_OFFSET);
  }

  return result;
}

function numVal(rows, idx, col) {
  const raw = (rows[idx]?.[col] ?? "").toString().replace(/[$,]/g, "").trim();
  if (!raw || raw.startsWith("#") || raw === "-") return 0;
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}
function pctVal(rows, idx, col) {
  const raw = (rows[idx]?.[col] ?? "").toString().trim();
  if (!raw || raw.startsWith("#")) return "";
  if (raw.includes("%")) return raw;
  const n = parseFloat(raw);
  return isNaN(n) ? "" : (n * 100).toFixed(2) + "%";
}

async function getAccessToken(email, rawKey) {
  const pem = rawKey.replace(/\\n/g, "\n");
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "").replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8", Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const jwt = `${header}.${payload}.${b64uRaw(sig)}`;
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  if (!tok.ok) throw new Error(`OAuth ${tok.status}: ${await tok.text()}`);
  return (await tok.json()).access_token;
}

function b64u(s)      { return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64uRaw(buf) {
  let b = "";
  for (const x of new Uint8Array(buf)) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function resp(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
