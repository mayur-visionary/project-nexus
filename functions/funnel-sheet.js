// functions/funnel-sheet.js
// Funnel Desk v2 — Google Sheets proxy
// POST { head: "jiggyasa" | "tanuj_uk" | "tanuj_us" }
// Returns structured JSON parsed from the head's Sheet tab.
// Auth: Google Service Account JWT → OAuth2 token → Sheets API v4

export async function onRequestPost(context) {
  try {
    const { head } = await context.request.json();

    // ── Tab name map ──
    const TAB_MAP = {
      jiggyasa : "Funnel - Jiggyasa AU",
      tanuj_uk : "Funnel - Tanuj UK",
      tanuj_us : "Funnel - Tanuj US"
    };

    const tabName = TAB_MAP[head];
    if (!tabName) {
      return jsonResp({ error: `Unknown head: ${head}` }, 400);
    }

    // ── Env vars ──
    const SHEET_ID   = context.env.FUNNEL_SHEET_ID;
    const SA_EMAIL   = context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY_RAW = context.env.GOOGLE_PRIVATE_KEY;

    if (!SHEET_ID || !SA_EMAIL || !SA_KEY_RAW) {
      return jsonResp({ error: "Missing env vars: FUNNEL_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }

    // ── 1. Sign JWT ──
    const token = await getAccessToken(SA_EMAIL, SA_KEY_RAW);

    // ── 2. Fetch sheet tab ──
    const range    = encodeURIComponent(`${tabName}`);
    const sheetsURL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const sheetsRes = await fetch(sheetsURL, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!sheetsRes.ok) {
      const err = await sheetsRes.text();
      return jsonResp({ error: `Sheets API error ${sheetsRes.status}: ${err}` }, 502);
    }

    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];

    if (!rows.length) {
      return jsonResp({ error: `No data found in tab "${tabName}"` }, 404);
    }

    // ── 3. Parse ──
    const parsed = parseSheet(rows, head, tabName);
    return jsonResp(parsed, 200);

  } catch (e) {
    return jsonResp({ error: e.message }, 500);
  }
}

// ════════════════════════════════════════════════════
// SHEET PARSER
// ════════════════════════════════════════════════════
function parseSheet(rows, head, tabName) {
  // Find topmost anchor row — col A matches "MonthName-YYYY"  e.g. "August-2026"
  const ANCHOR_RE = /^[A-Z][a-z]+-\d{4}$/;
  let anchorIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const cell = (rows[i][0] || "").trim();
    if (ANCHOR_RE.test(cell)) {
      anchorIdx = i;
      break;
    }
  }

  if (anchorIdx === -1) {
    return { error: `No month anchor found in tab "${tabName}"` };
  }

  const anchorRow = rows[anchorIdx];
  const month     = (anchorRow[0] || "").trim();   // e.g. "August-2026"

  // Owner names — cols 1–5 from anchor row (read dynamically)
  const ownerNames = [1, 2, 3, 4, 5].map(c => (anchorRow[c] || "").trim()).filter(Boolean);

  // ── Row offsets (verified across Apr–Aug 2026) ──
  const OFFSETS = {
    // Recurring
    target            : 1,
    opening           : 5,
    predictedLoss     : 6,
    postPaid          : 7,
    existingPipeline  : 9,
    closureFromPipeline: 10,
    pipelineWon       : 11,
    existingOpp       : 14,
    closureFromOpp    : 15,
    // P2P
    prevP2PInvoices   : 21,
    p2pFreshPipeline  : 23,
    p2pClosurePipeline: 24,
    p2pPipelineWon    : 25,
    p2pOpportunities  : 28,
    p2pClosureOpp     : 29
  };

  // Helper — safely get numeric value from a row at a column index
  function getNum(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return 0;
    const raw = (row[colIdx] || "").toString().replace(/,/g, "").trim();
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }

  // Helper — extract values for all owners + total for a given offset
  // Digital BU: cols 1–5 (owners), col 6 (total)
  // Inter BU:   cols 11–15 (owners), col 16 (total)
  function extractRow(offset) {
    const rowIdx = anchorIdx + offset;
    const digital = {
      owners: ownerNames.map((_, i) => getNum(rowIdx, i + 1)),
      total : getNum(rowIdx, 6)
    };
    const interBU = {
      owners: ownerNames.map((_, i) => getNum(rowIdx, i + 11)),
      total : getNum(rowIdx, 16)
    };
    return { digital, interBU };
  }

  // Build data object for each field
  const data = {};
  for (const [key, offset] of Object.entries(OFFSETS)) {
    data[key] = extractRow(offset);
  }

  // ── Per-owner structured output ──
  const owners = ownerNames.map((name, i) => ({
    name,
    recurring: {
      target            : data.target.digital.owners[i],
      opening           : data.opening.digital.owners[i],
      predictedLoss     : data.predictedLoss.digital.owners[i],
      postPaid          : data.postPaid.digital.owners[i],
      existingPipeline  : data.existingPipeline.digital.owners[i],
      closureFromPipeline: data.closureFromPipeline.digital.owners[i],
      pipelineWon       : data.pipelineWon.digital.owners[i],
      existingOpp       : data.existingOpp.digital.owners[i],
      closureFromOpp    : data.closureFromOpp.digital.owners[i]
    },
    p2p: {
      prevP2PInvoices   : data.prevP2PInvoices.digital.owners[i],
      p2pFreshPipeline  : data.p2pFreshPipeline.digital.owners[i],
      p2pClosurePipeline: data.p2pClosurePipeline.digital.owners[i],
      p2pPipelineWon    : data.p2pPipelineWon.digital.owners[i],
      p2pOpportunities  : data.p2pOpportunities.digital.owners[i],
      p2pClosureOpp     : data.p2pClosureOpp.digital.owners[i]
    }
  }));

  // ── Totals (col 6 / col 16) ──
  const totals = {
    recurring: {
      target            : data.target.digital.total,
      opening           : data.opening.digital.total,
      predictedLoss     : data.predictedLoss.digital.total,
      postPaid          : data.postPaid.digital.total,
      existingPipeline  : data.existingPipeline.digital.total,
      closureFromPipeline: data.closureFromPipeline.digital.total,
      pipelineWon       : data.pipelineWon.digital.total,
      existingOpp       : data.existingOpp.digital.total,
      closureFromOpp    : data.closureFromOpp.digital.total
    },
    p2p: {
      prevP2PInvoices   : data.prevP2PInvoices.digital.total,
      p2pFreshPipeline  : data.p2pFreshPipeline.digital.total,
      p2pClosurePipeline: data.p2pClosurePipeline.digital.total,
      p2pPipelineWon    : data.p2pPipelineWon.digital.total,
      p2pOpportunities  : data.p2pOpportunities.digital.total,
      p2pClosureOpp     : data.p2pClosureOpp.digital.total
    }
  };

  // ── Inter BU totals ──
  const interBU = {
    recurring: {
      target            : data.target.interBU.total,
      opening           : data.opening.interBU.total,
      predictedLoss     : data.predictedLoss.interBU.total,
      postPaid          : data.postPaid.interBU.total,
      existingPipeline  : data.existingPipeline.interBU.total,
      closureFromPipeline: data.closureFromPipeline.interBU.total,
      pipelineWon       : data.pipelineWon.interBU.total,
      existingOpp       : data.existingOpp.interBU.total,
      closureFromOpp    : data.closureFromOpp.interBU.total
    },
    p2p: {
      prevP2PInvoices   : data.prevP2PInvoices.interBU.total,
      p2pFreshPipeline  : data.p2pFreshPipeline.interBU.total,
      p2pClosurePipeline: data.p2pClosurePipeline.interBU.total,
      p2pPipelineWon    : data.p2pPipelineWon.interBU.total,
      p2pOpportunities  : data.p2pOpportunities.interBU.total,
      p2pClosureOpp     : data.p2pClosureOpp.interBU.total
    }
  };

  return { month, head, tabName, owners, totals, interBU };
}

// ════════════════════════════════════════════════════
// GOOGLE SERVICE ACCOUNT JWT → OAUTH2 TOKEN
// ════════════════════════════════════════════════════
async function getAccessToken(email, rawKey) {
  // Cloudflare Workers / Pages Functions use the Web Crypto API
  // private_key in JSON has literal \n — convert to real newlines
  const pem = rawKey.replace(/\\n/g, "\n");

  // Strip PEM headers and decode base64
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Build JWT
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss  : email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud  : "https://oauth2.googleapis.com/token",
    iat  : now,
    exp  : now + 3600
  }));

  const sigInput  = `${header}.${payload}`;
  const sigBytes  = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const sig = b64urlRaw(sigBytes);
  const jwt = `${sigInput}.${sig}`;

  // Exchange JWT for access token
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

// ── Base64url helpers ──
function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlRaw(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── JSON response helper ──
function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type" : "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
