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
  // Digital BU: cols 1–5; Inter BU: cols 11–15
  // Stop at first empty cell in each range
  const digitalOwners = [];
  for (let c = 1; c <= 5; c++) {
    const n = (anchorRow[c] || "").trim();
    if (n) digitalOwners.push(n); else break;
  }
  const interOwners = [];
  for (let c = 11; c <= 15; c++) {
    const n = (anchorRow[c] || "").trim();
    if (n) interOwners.push(n); else break;
  }

  // ── Row offset map (verified Apr–Aug 2026) ──
  // All offsets are from anchorIdx
  const OFF = {
    // ── Header/target ──
    target              : 1,
    forecast            : 2,   // Forecast (sureshot+chase) — may be blank

    // ── Recurring ──
    opening             : 5,   // Pre-Paid Invoices = Opening (Without post paid)
    predictedLoss       : 6,   // Predicted Loss
    postPaid            : 7,   // Post-Paid Invoices = Expected Post Paid Invoices

    existingPipeline    : 9,   // Open Pipeline
    closureFromPipeline : 10,  // Expected Closures (pipeline)
    pipelineWon         : 11,  // Pipeline Won
    pipelineConversion  : 12,  // Anticipated Conversion % (pipeline)

    existingOpp         : 14,  // Open Opportunities
    closureFromOpp      : 15,  // Expected Closures (opp)
    oppConversion       : 16,  // Anticipated Conversion % (opp)

    recurringTotal      : 18,  // Recurring Total (Expected Closing of Recurring — yellow)

    // ── P2P ──
    currentBooking      : 20,  // Current Booking
    prevP2PInvoices     : 21,  // Previous P2P Invoices 50%/25%/EOM

    p2pFreshPipeline    : 23,  // P2P Fresh Pipeline (apart from 50% & EOM)
    p2pClosurePipeline  : 24,  // Expected Closures (P2P pipeline)
    p2pPipelineWon      : 25,  // Pipeline Won (P2P)
    p2pPipelineConv     : 26,  // Anticipated Conversion % (P2P pipeline)

    p2pOpportunities    : 28,  // Open Opportunities (P2P)
    p2pClosureOpp       : 29,  // Expected Closures (P2P opp)
    p2pOppConv          : 30,  // Anticipated Conversion % (P2P opp)

    p2pTotal            : 32,  // P2P Total (Expected P2P closures — yellow)

    // ── Summary ──
    grandTotal          : 34,  // Grand Total (Total Closure from this month Pipeline — blue)
    gap                 : 35,  // GAP Remaining from this month Forecast
    gapPct              : 36,  // Value Gap %
    dailyRunRate        : 37   // Daily pipeline run rate
  };

  // ── Helpers ──
  // Parse numeric value — strip commas, currency symbols, handle blanks
  function num(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return 0;
    const raw = (row[colIdx] || "").toString().replace(/[$,]/g, "").trim();
    if (raw === "" || raw === "#DIV/0!" || raw === "-") return 0;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }

  // Parse percentage string — return as string e.g. "53.33%" or "" for #DIV/0!
  function pct(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return "";
    const raw = (row[colIdx] || "").toString().trim();
    if (raw === "#DIV/0!" || raw === "") return "";
    // If already has %, return as-is; if decimal (e.g. 0.5333) convert
    if (raw.includes("%")) return raw;
    const n = parseFloat(raw);
    if (isNaN(n)) return "";
    return (n * 100).toFixed(2) + "%";
  }

  // Extract a full row of values for a given offset
  // Digital BU: owners at cols 1..N, total at col 6
  // Inter BU:   owners at cols 11..(11+N-1), total at col 16
  // isPercent: use pct() instead of num()
  function extractRow(offset, isPercent) {
    const rowIdx = anchorIdx + offset;
    const extractor = isPercent ? pct : num;

    const digital = {
      owners: digitalOwners.map((_, i) => extractor(rowIdx, i + 1)),
      total : isPercent ? pct(rowIdx, 6) : num(rowIdx, 6)
    };
    const inter = {
      owners: interOwners.map((_, i) => extractor(rowIdx, i + 11)),
      total : isPercent ? pct(rowIdx, 16) : num(rowIdx, 16)
    };
    return { digital, inter };
  }

  // Build complete data object
  const D = {};
  const PCT_FIELDS = new Set([
    'pipelineConversion', 'oppConversion', 'p2pPipelineConv', 'p2pOppConv', 'gapPct'
  ]);
  for (const [key, offset] of Object.entries(OFF)) {
    D[key] = extractRow(offset, PCT_FIELDS.has(key));
  }

  // ── Per-owner output builder ──
  function buildOwners(ownerNames, buKey) {
    return ownerNames.map((name, i) => ({
      name,
      target             : D.target[buKey].owners[i],
      forecast           : D.forecast[buKey].owners[i],
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
      gap                : D.gap[buKey].owners[i],
      gapPct             : D.gapPct[buKey].owners[i],
      dailyRunRate       : D.dailyRunRate[buKey].owners[i]
    }));
  }

  function buildTotals(buKey) {
    const t = {};
    for (const key of Object.keys(OFF)) {
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
