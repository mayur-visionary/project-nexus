// functions/funnel-sheet.js
// Funnel Desk v2 — Google Sheets proxy
// POST { head: "jiggyasa" | "tanuj_uk" | "tanuj_us" }
// Returns RAW owner values only — all totals and derived rows computed client-side.
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
    if (!tabName) return jsonResp({ error: `Unknown head: ${head}` }, 400);

    const SHEET_ID   = context.env.FUNNEL_SHEET_ID;
    const SA_EMAIL   = context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY_RAW = context.env.GOOGLE_PRIVATE_KEY;

    if (!SHEET_ID || !SA_EMAIL || !SA_KEY_RAW) {
      return jsonResp({ error: "Missing env vars: FUNNEL_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }

    const token     = await getAccessToken(SA_EMAIL, SA_KEY_RAW);
    const range     = encodeURIComponent(tabName);
    const sheetsURL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const sheetsRes = await fetch(sheetsURL, { headers: { Authorization: `Bearer ${token}` } });

    if (!sheetsRes.ok) {
      const err = await sheetsRes.text();
      return jsonResp({ error: `Sheets API error ${sheetsRes.status}: ${err}` }, 502);
    }

    const sheetsData = await sheetsRes.json();
    const rows       = sheetsData.values || [];
    if (!rows.length) return jsonResp({ error: `No data in tab "${tabName}"` }, 404);

    return jsonResp(parseSheet(rows, head, tabName), 200);

  } catch (e) {
    return jsonResp({ error: e.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
// SHEET PARSER — reads raw owner values only, no Sheet formulas
// ════════════════════════════════════════════════════════════
function parseSheet(rows, head, tabName) {

  // ── Find month anchor row ──
  const ANCHOR_RE = /^[A-Z][a-z]+-\d{4}$/;
  let anchorIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (ANCHOR_RE.test((rows[i][0] || "").trim())) { anchorIdx = i; break; }
  }
  if (anchorIdx === -1) return { error: `No month anchor found in tab "${tabName}"` };

  const anchorRow = rows[anchorIdx];
  const month     = anchorRow[0].trim();

  // ── Owner exclusions ──
  const EXCLUDE    = { tanuj_uk: ["sheldon", "sheldon fernandes", "total"] };
  const excluded   = new Set((EXCLUDE[head] || []).map(n => n.toLowerCase()));
  const isExcluded = n => excluded.has((n || "").toLowerCase().trim());

  // ── Read owner names + col indices from anchor row ──
  // Digital BU: cols 1–5; Inter BU: cols 12–16
  // Skip excluded names AND skip any cell whose value is not a real person name
  // (guard against "Total" label cell bleeding into owner list)
  const digitalOwners = [], digitalOwnerCols = [];
  for (let c = 1; c <= 5; c++) {
    const n = (anchorRow[c] || "").trim();
    if (!n) break;
    if (!isExcluded(n)) { digitalOwners.push(n); digitalOwnerCols.push(c); }
  }
  const interOwners = [], interOwnerCols = [];
  for (let c = 12; c <= 16; c++) {
    const n = (anchorRow[c] || "").trim();
    if (!n) break;
    if (!isExcluded(n)) { interOwners.push(n); interOwnerCols.push(c); }
  }

  // ── Fixed row offsets from anchor (data rows only — no formula rows) ──
  const OFF = {
    target             : 1,
    opening            : 5,   // Pre-Paid Invoices
    predictedLoss      : 6,
    postPaid           : 7,   // Post-Paid Invoices
    existingPipeline   : 9,
    closureFromPipeline: 10,
    pipelineWon        : 11,
    pipelineConversion : 12,  // % — string
    existingOpp        : 14,
    closureFromOpp     : 15,
    oppConversion      : 16,  // % — string
    currentBooking     : 20,
    prevP2PInvoices    : 21,
    p2pFreshPipeline   : 23,
    p2pClosurePipeline : 24,
    p2pPipelineWon     : 25,
    p2pPipelineConv    : 26,  // % — string
    p2pOpportunities   : 28,
    p2pClosureOpp      : 29,
    p2pOppConv         : 30,  // % — string
  };

  const PCT_FIELDS = new Set(['pipelineConversion','oppConversion','p2pPipelineConv','p2pOppConv']);

  // ── Helpers ──
  function num(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return 0;
    const raw = (row[colIdx] || "").toString().replace(/[$,]/g, "").trim();
    if (!raw || raw === "#DIV/0!" || raw === "-") return 0;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }

  function pct(rowIdx, colIdx) {
    const row = rows[rowIdx];
    if (!row) return "";
    const raw = (row[colIdx] || "").toString().trim();
    if (!raw || raw === "#DIV/0!") return "";
    if (raw.includes("%")) return raw;
    const n = parseFloat(raw);
    return isNaN(n) ? "" : (n * 100).toFixed(2) + "%";
  }

  // Extract owner values for a row — returns array aligned to ownerCols
  function extractOwners(ownerCols, rowIdx, isPercent) {
    return ownerCols.map(c => isPercent ? pct(rowIdx, c) : num(rowIdx, c));
  }

  // Build per-owner data object for one BU
  function buildBU(ownerNames, ownerCols) {
    const owners = ownerNames.map((name, i) => {
      const o = { name };
      for (const [key, offset] of Object.entries(OFF)) {
        const isPercent = PCT_FIELDS.has(key);
        o[key] = isPercent
          ? pct(anchorIdx + offset, ownerCols[i])
          : num(anchorIdx + offset, ownerCols[i]);
      }
      return o;
    });
    return owners;
  }

  return {
    month,
    head,
    tabName,
    digital : { owners: buildBU(digitalOwners, digitalOwnerCols) },
    inter   : { owners: buildBU(interOwners,   interOwnerCols)   }
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

  if (!tokenRes.ok) throw new Error(`OAuth ${tokenRes.status}: ${await tokenRes.text()}`);
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
