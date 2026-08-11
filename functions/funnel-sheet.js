// functions/funnel-sheet.js
// Funnel Desk v2 — Google Sheets proxy
// POST { head: "jiggyasa" | "tanuj_uk" | "tanuj_us" }
// Returns full structured JSON for both Digital BU and Inter BU blocks.
// Auth: Google Service Account JWT → OAuth2 access token → Sheets API v4

export async function onRequestPost(context) {
  try {
    const { head } = await context.request.json();

    const TAB_MAP = {
      jiggyasa : "Funnel - Jiggyasa AU",
      tanuj_uk : "Funnel - Tanuj UK",
      tanuj_us : "Funnel - Tanuj US"
    };

    const tabName = TAB_MAP[head];
    if (!tabName) {
      return jsonResp({ error: `Unknown head: ${head}` }, 400);
    }

    const SHEET_ID   = context.env.FUNNEL_SHEET_ID;
    const SA_EMAIL   = context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY_RAW = context.env.GOOGLE_PRIVATE_KEY;

    if (!SHEET_ID || !SA_EMAIL || !SA_KEY_RAW) {
      return jsonResp({
        error: "Missing env vars: FUNNEL_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY"
      }, 500);
    }

    const token = await getAccessToken(SA_EMAIL, SA_KEY_RAW);

    const range     = encodeURIComponent(tabName);
    const sheetsURL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const sheetsRes = await fetch(sheetsURL, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!sheetsRes.ok) {
      const err = await sheetsRes.text();
      return jsonResp({ error: `Sheets API error ${sheetsRes.status}: ${err}` }, 502);
    }

    const sheetsData = await sheetsRes.json();
    const rows       = sheetsData.values || [];

    if (!rows.length) {
      return jsonResp({ error: `No data found in tab "${tabName}"` }, 404);
    }

    const parsed = parseSheet(rows, head, tabName);
    return jsonResp(parsed, 200);

  } catch (e) {
    return jsonResp({ error: e.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
// SHEET PARSER
// ════════════════════════════════════════════════════════════
function parseSheet(rows, head, tabName) {

  // ── Find topmost month anchor row ──
  // Col A matches "MonthName-YYYY" e.g. "August-2026"
  const ANCHOR_RE = /^[A-Z][a-z]+-\d{4}$/;
  let anchorIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (ANCHOR_RE.test((rows[i][0] || "").trim())) { anchorIdx = i; break; }
  }
  if (anchorIdx === -1) return { error: `No month anchor found in tab "${tabName}"` };

  const anchorRow = rows[anchorIdx];
  const month     = anchorRow[0].trim();

  // ── Owner names — read dynamically from anchor row ──
  // Digital BU: cols 1–5; Inter BU: cols 12–16
  // Stop at first empty cell in each range
  const digitalOwners = [];
  for (let c = 1; c <= 5; c++) {
    const n = (anchorRow[c] || "").trim();
    if (n) digitalOwners.push(n); else break;
  }
  const interOwners = [];
  for (let c = 12; c <= 16; c++) {        // Bug 3 fix: was 11–15, col 11 is a label column
    const n = (anchorRow[c] || "").trim();
    if (n) interOwners.push(n); else break;
  }

  // ── Row offset map (verified Apr–Aug 2026) ──
  // All offsets from anchorIdx — fixed rows only
  const OFF = {
    target              : 1,

    // Recurring
    opening             : 5,
    predictedLoss       : 6,
    postPaid            : 7,
    existingPipeline    : 9,
    closureFromPipeline : 10,
    pipelineWon         : 11,
    pipelineConversion  : 12,
    existingOpp         : 14,
    closureFromOpp      : 15,
    oppConversion       : 16,

    // P2P
    currentBooking      : 20,
    prevP2PInvoices     : 21,
    p2pFreshPipeline    : 23,
    p2pClosurePipeline  : 24,
    p2pPipelineWon      : 25,
    p2pPipelineConv     : 26,
    p2pOpportunities    : 28,
    p2pClosureOpp       : 29,
    p2pOppConv          : 30,
  };

  // ── Bug 1 fix: scan for summary rows by label text ──
  // These are formula rows whose position can vary — find by col A content
  const LABEL_TARGETS = {
    recurringTotal : ["expected closing of recurring", "recurring total"],
    p2pTotal       : ["expected p2p closures", "p2p total"],
    grandTotal     : ["total closure from this month", "grand total"],
    gap            : ["gap remaining", "gap"]
  };

  const labelRowIdx = {};
  for (let i = anchorIdx + 1; i < Math.min(anchorIdx + 45, rows.length); i++) {
    const cellA = (rows[i][0] || "").toLowerCase().trim();
    for (const [key, patterns] of Object.entries(LABEL_TARGETS)) {
      if (!labelRowIdx[key] && patterns.some(p => cellA.includes(p))) {
        labelRowIdx[key] = i;
      }
    }
  }

  // ── Helpers ──
  function num(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return 0;
    const raw = (row[colIdx] || "").toString().replace(/[$,]/g, "").trim();
    if (raw === "" || raw === "#DIV/0!" || raw === "-") return 0;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }

  function pct(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return "";
    const raw = (row[colIdx] || "").toString().trim();
    if (raw === "#DIV/0!" || raw === "") return "";
    if (raw.includes("%")) return raw;
    const n = parseFloat(raw);
    if (isNaN(n)) return "";
    return (n * 100).toFixed(2) + "%";
  }

  // Extract a row by absolute row index (for label-scanned rows)
  function extractByIdx(rowIdx, isPercent) {
    const extractor = isPercent ? pct : num;
    const digital = {
      owners: digitalOwners.map((_, i) => extractor(rowIdx, i + 1)),
      total : isPercent ? pct(rowIdx, 6) : num(rowIdx, 6)
    };
    const inter = {
      owners: interOwners.map((_, i) => extractor(rowIdx, i + 12)),  // Bug 3 fix: col 12
      total : isPercent ? pct(rowIdx, 17) : num(rowIdx, 17)           // total col shifts too
    };
    return { digital, inter };
  }

  // Extract a row by offset from anchor
  function extractRow(offset, isPercent) {
    return extractByIdx(anchorIdx + offset, isPercent);
  }

  // ── Build D: offset-based fields ──
  const PCT_FIELDS = new Set([
    'pipelineConversion', 'oppConversion', 'p2pPipelineConv', 'p2pOppConv'
  ]);
  const D = {};
  for (const [key, offset] of Object.entries(OFF)) {
    D[key] = extractRow(offset, PCT_FIELDS.has(key));
  }

  // ── Label-scanned summary rows ──
  for (const key of ['recurringTotal', 'p2pTotal', 'grandTotal', 'gap']) {
    const idx = labelRowIdx[key];
    D[key] = idx !== undefined ? extractByIdx(idx, false) : { digital: { owners: [], total: 0 }, inter: { owners: [], total: 0 } };
  }

  // ── Per-owner output builder ──
  function buildOwners(ownerNames, buKey) {
    return ownerNames.map((name, i) => ({
      name,
      target             : D.target[buKey].owners[i],
      opening            : D.opening[buKey].owners[i],
      predictedLoss      : D.predictedLoss[buKey].owners[i],
      postPaid           : D.postPaid[buKey].owners[i],
      existingPipeline   : D.existingPipeline[buKey].owners[i],
      closureFromPipeline: D.closureFromPipeline[buKey].owners[i],
      pipelineWon        : D.pipelineWon[buKey].owners[i],
      pipelineConversion : D.pipelineConversion[buKey].owners[i],
      existingOpp        : D.existingOpp[buKey].owners[i],
      closureFromOpp     : D.closureFromOpp[buKey].owners[i],
      oppConversion      : D.oppConversion[buKey].owners[i],
      recurringTotal     : D.recurringTotal[buKey].owners[i],
      currentBooking     : D.currentBooking[buKey].owners[i],
      prevP2PInvoices    : D.prevP2PInvoices[buKey].owners[i],
      p2pFreshPipeline   : D.p2pFreshPipeline[buKey].owners[i],
      p2pClosurePipeline : D.p2pClosurePipeline[buKey].owners[i],
      p2pPipelineWon     : D.p2pPipelineWon[buKey].owners[i],
      p2pPipelineConv    : D.p2pPipelineConv[buKey].owners[i],
      p2pOpportunities   : D.p2pOpportunities[buKey].owners[i],
      p2pClosureOpp      : D.p2pClosureOpp[buKey].owners[i],
      p2pOppConv         : D.p2pOppConv[buKey].owners[i],
      p2pTotal           : D.p2pTotal[buKey].owners[i],
      grandTotal         : D.grandTotal[buKey].owners[i],
      gap                : D.gap[buKey].owners[i]
    }));
  }

  function buildTotals(buKey) {
    const t = {};
    for (const key of [
      'target','opening','predictedLoss','postPaid',
      'existingPipeline','closureFromPipeline','pipelineWon','pipelineConversion',
      'existingOpp','closureFromOpp','oppConversion','recurringTotal',
      'currentBooking','prevP2PInvoices',
      'p2pFreshPipeline','p2pClosurePipeline','p2pPipelineWon','p2pPipelineConv',
      'p2pOpportunities','p2pClosureOpp','p2pOppConv',
      'p2pTotal','grandTotal','gap'
    ]) {
      t[key] = D[key][buKey].total;
    }
    return t;
  }

  return {
    month,
    head,
    tabName,
    digital: {
      owners: buildOwners(digitalOwners, 'digital'),
      totals: buildTotals('digital')
    },
    inter: {
      owners: buildOwners(interOwners, 'inter'),
      totals: buildTotals('inter')
    }
  };
}

// ════════════════════════════════════════════════════════════
// GOOGLE SERVICE ACCOUNT JWT → OAUTH2 TOKEN
// ════════════════════════════════════════════════════════════
async function getAccessToken(email, rawKey) {
  const pem = rawKey.replace(/\\n/g, "\n");
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss  : email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud  : "https://oauth2.googleapis.com/token",
    iat  : now,
    exp  : now + 3600
  }));

  const sigInput = `${header}.${payload}`;
  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const jwt = `${sigInput}.${b64urlRaw(sigBytes)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method : "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body   : new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion : jwt
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`OAuth token error ${tokenRes.status}: ${err}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlRaw(buffer) {
  let bin = "";
  for (const b of new Uint8Array(buffer)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
