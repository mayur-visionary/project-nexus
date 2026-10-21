// functions/portfolio-snapshot.js
// Portfolio Health — Sept 30, 2026 baseline snapshot proxy
// GET — returns { companies: [{ id, status, bu, region, head, inter_bu }] }
//
// Sheet : Project Nexus — Portfolio Snapshots
// ID    : 1oNuwfzQbN25dVJ5BpUEJAY-mKzYWB1FM3MOsfVhDKj0
// Tab   : Sep. 2026
// Cols  : snapshot_date | company_id | company_name | hubspot_owner_id | owner_name |
//         recent_deal_close_date | days_since_deal | status | bu | region | head |
//         inter_bu | createdate
//
// Auth  : GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
//         (same env vars as funnel-sheet.js — no new secrets needed)
// Route : /portfolio-snapshot (GET)

const SHEET_ID = "1oNuwfzQbN25dVJ5BpUEJAY-mKzYWB1FM3MOsfVhDKj0";
const TAB      = "Sep. 2026";

export async function onRequestGet(context) {
  try {
    const SA_EMAIL = context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY   = context.env.GOOGLE_PRIVATE_KEY;
    if (!SA_EMAIL || !SA_KEY) return resp({ error: "Missing env vars: GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);

    const token = await getAccessToken(SA_EMAIL, SA_KEY);
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB)}`;
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return resp({ error: `Sheets API ${res.status}: ${await res.text()}` }, 502);

    const { values: rows = [] } = await res.json();
    // Row 0 = header; data starts at row 1
    if (rows.length < 2) return resp({ companies: [] }, 200);

    // ── Column map (0-indexed, from doPortfolioSnapshot.gs) ──
    // 0 snapshot_date | 1 company_id | 2 company_name | 3 hubspot_owner_id | 4 owner_name |
    // 5 recent_deal_close_date | 6 days_since_deal | 7 status | 8 bu | 9 region |
    // 10 head | 11 inter_bu | 12 createdate
    const companies = rows.slice(1).map(r => {
      const id = String(r[1] || "").trim();
      if (!id) return null;
      return {
        id,
        status  : (r[7]  || "").trim(),                               // "Active" | "Silent" | "Inactive" | "Organic Lost" | "Never Active"
        bu      : (r[8]  || "").trim(),
        region  : (r[9]  || "").trim(),
        head    : (r[10] || "").trim(),
        inter_bu: (r[11] || "").toString().toLowerCase() === "true"
      };
    }).filter(Boolean);

    return resp({ companies, snapshot_date: "2026-09-30", tab: TAB }, 200);

  } catch (e) {
    return resp({ error: e.message }, 500);
  }
}

// ── Google Sheets JWT auth — mirrors funnel-sheet.js exactly ──
async function getAccessToken(email, rawKey) {
  const pem = rawKey.replace(/\\n/g, "\n");
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "").replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/,     "").replace(/-----END PRIVATE KEY-----/,     "")
    .replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({
    iss  : email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud  : "https://oauth2.googleapis.com/token",
    iat  : now,
    exp  : now + 3600
  }));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const jwt = `${header}.${payload}.${b64uRaw(sig)}`;
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method : "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body   : new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  if (!tok.ok) throw new Error(`OAuth ${tok.status}: ${await tok.text()}`);
  return (await tok.json()).access_token;
}

function b64u(s)      { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64uRaw(buf) {
  let b = "";
  for (const x of new Uint8Array(buf)) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function resp(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
