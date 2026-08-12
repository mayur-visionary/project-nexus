// functions/funnel-sheet.js
// Funnel Desk v2 — Master Sheet proxy (rewritten Aug 2026)
// POST { head: "jiggyasa" | "tanuj_uk" | "tanuj_us" }
//
// Reads from a single Master Google Sheet (IMPORTRANGE-aggregated).
// Structure verified against live CSVs — ALL THREE TABS are structurally identical:
//   Digital BU block : header at idx 1, data rows per R{} map below
//   Inter BU block   : header at idx 43, every row = Digital idx + 42
//   Jiggyasa / TanujUS : owner cols 1-5, Team Sum col 6
//   Tanuj UK          : owner cols 1-3  (Sheldon already excluded in master), Team Sum col 4
//
// Returns raw owner values + team sums.
// Grand Total / GAP / GAP% are computed client-side by funnel.html — NOT read from Sheet.
// Auth: Google Service Account JWT → OAuth2 access token → Sheets API v4

export async function onRequestPost(context) {
  try {
    const { head } = await context.request.json();

    // Tab name + column config per head (owner col indices, team-sum col index)
    const CFG = {
      jiggyasa : { tab: "Jiggyasa", ownerCols: [1,2,3,4,5], sumCol: 6 },
      tanuj_uk  : { tab: "Tanuj UK", ownerCols: [1,2,3],     sumCol: 4 },
      tanuj_us  : { tab: "Tanuj US", ownerCols: [1,2,3,4,5], sumCol: 6 },
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

// ── Row index map (0-indexed). Verified identical across all 3 tabs. ──
// Digital block: rows 0-40.  Inter block: same keys, each idx += 42.
const R = {
  target             :  2,
  opening            :  6,   // Pre-Paid Invoices
  predictedLoss      :  7,
  postPaid           :  8,   // Post-Paid Invoices
  existingPipeline   : 10,
  closureFromPipeline: 11,
  pipelineWon        : 12,
  pipelineConversion : 13,   // % string
  existingOpp        : 15,
  closureFromOpp     : 16,
  oppConversion      : 17,   // % string
  recurringTotal     : 19,
  currentBooking     : 23,
  prevP2PInvoices    : 24,
  p2pFreshPipeline   : 26,
  p2pClosurePipeline : 27,
  p2pPipelineWon     : 28,
  p2pPipelineConv    : 29,   // % string
  p2pOpportunities   : 31,
  p2pClosureOpp      : 32,
  p2pOppConv         : 33,   // % string
  p2pTotal           : 35,
};

const PCT = new Set(['pipelineConversion','oppConversion','p2pPipelineConv','p2pOppConv']);
const INTER_OFFSET = 42; // Inter BU header at idx 43; data = Digital idx + 42

function parse(rows, head, cfg) {
  // Owner names come from the Digital header row (idx 1); cols per CFG
  const digHeader   = rows[1] ?? [];
  const interHeader = rows[43] ?? [];

  // Build per-owner + team-sum for one block
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

  return {
    head,
    tab    : cfg.tab,
    digital: buildBlock(digHeader,   0),
    inter  : buildBlock(interHeader, INTER_OFFSET),
  };
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
  const payload = b64u(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig     = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  const jwt     = `${header}.${payload}.${b64uRaw(sig)}`;
  const tok     = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  if (!tok.ok) throw new Error(`OAuth ${tok.status}: ${await tok.text()}`);
  return (await tok.json()).access_token;
}

function b64u(s)      { return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64uRaw(buf) { let b=""; for(const x of new Uint8Array(buf)) b+=String.fromCharCode(x); return btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function resp(data, status) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }); }
