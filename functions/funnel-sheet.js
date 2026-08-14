// functions/funnel-sheet.js
// Funnel Desk v3 — Master Sheet proxy (updated for new template structure)
// POST { head: "jiggyasa" | "tanuj_uk" | "tanuj_us" | "jaydeep" }
//
// Reads from a single Master Google Sheet (IMPORTRANGE-aggregated).
// Structure verified against new proxy templates (44 rows Digital, 46 rows Inter):
//   Digital BU block : header at idx 0, data rows per R{} map below
//   Inter BU block   : header at idx 46, every data row = Digital idx + 46
//   Jiggyasa         : owner cols 1-5, Team Sum col 6
//   Tanuj UK         : owner cols 1-3, Team Sum col 4 (Sheldon excluded)
//   Tanuj US         : owner cols 1-5, Team Sum col 6
//   Jaydeep (MarTech): owner cols 1-9, Team Sum col 10, NO Inter BU block
//
// Grand Total / GAP are computed client-side by funnel.html — NOT read from Sheet.
// Auth: Google Service Account JWT → OAuth2 access token → Sheets API v4

export async function onRequestPost(context) {
  try {
    const { head } = await context.request.json();

    // Tab name + column config per head
    // noInter: true = single block (MarTech), no Inter BU section
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
      return resp({ error: "Missing env: FUNNEL_MASTER_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);

    const token = await getAccessToken(SA_EMAIL, SA_KEY);
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(cfg.tab)}`;
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return resp({ error: `Sheets API ${res.status}: ${await res.text()}` }, 502);

    const { values: rows = [] } = await res.json();
    if (!rows.length) return resp({ error: `No data in tab "${cfg.tab}"` }, 404);

    return resp(parse(rows, head, cfg), 200);

  } catch (e) { return resp({ error: e.message }, 500); }
}

// ── Row index map (0-indexed, matching new 44-row template) ──
// Digital block: rows 0-43.
// Inter block  : header at idx 46, each data row = Digital idx + 46.
//
// New rows added vs v2:
//   openNewPipeline    : 10
//   openOldPipeline    : 11
//   p2pDeemedPipeline  : 28
//   p2pNotDeemedPipeline: 29
//
// All rows from closureFromPipeline onward shifted accordingly.
const R = {
  target               :  1,
  opening              :  5,   // Pre-Paid Invoices
  predictedLoss        :  6,
  postPaid             :  7,   // Post-Paid Invoices
  existingPipeline     :  9,
  openNewPipeline      : 10,
  openOldPipeline      : 11,
  closureFromPipeline  : 12,
  pipelineWon          : 13,
  pipelineConversion   : 14,   // % string
  existingOpp          : 16,
  closureFromOpp       : 17,
  oppConversion        : 18,   // % string
  recurringTotal       : 20,
  currentBooking       : 24,
  prevP2PInvoices      : 25,
  p2pFreshPipeline     : 27,
  p2pDeemedPipeline    : 28,
  p2pNotDeemedPipeline : 29,
  p2pClosurePipeline   : 30,
  p2pPipelineWon       : 31,
  p2pPipelineConv      : 32,   // % string
  p2pOpportunities     : 34,
  p2pClosureOpp        : 35,
  p2pOppConv           : 36,   // % string
  p2pTotal             : 38,
};

const PCT = new Set([
  'pipelineConversion','oppConversion','p2pPipelineConv','p2pOppConv'
]);

// Inter BU header at idx 46 (Digital block is 44 rows + 2 spacer rows)
const INTER_OFFSET = 46;

function parse(rows, head, cfg) {
  const digHeader   = rows[0] ?? [];
  const interHeader = cfg.noInter ? [] : (rows[46] ?? []);

  function buildBlock(header, baseOffset) {
    const owners = cfg.ownerCols.map(c => {
      const name = (header[c] ?? "").toString().trim();
      const o = { name };
      for (const [key, digIdx] of Object.entries(R)) {
        const rowIdx = digIdx + baseOffset;
        o[key] = PCT.has(key) ? pctVal(rows, rowIdx, c) : numVal(rows, rowIdx, c);
      }
      return o;
    });
    const teamSum = { name: "Team Sum" };
    for (const [key, digIdx] of Object.entries(R)) {
      const rowIdx = digIdx + baseOffset;
      teamSum[key] = PCT.has(key) ? pctVal(rows, rowIdx, cfg.sumCol) : numVal(rows, rowIdx, cfg.sumCol);
    }
    return { owners, teamSum };
  }

  const month = new Date().toLocaleString("en-GB", {
    month: "long", year: "numeric", timeZone: "Asia/Kolkata"
  });

  const result = { head, tab: cfg.tab, month, noInter: cfg.noInter };
  result.digital = buildBlock(digHeader, 0);
  if (!cfg.noInter) result.inter = buildBlock(interHeader, INTER_OFFSET);

  return result;
}

// ── Value helpers ──
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

// ── Google Service Account JWT → OAuth2 token ──
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
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt
    })
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
