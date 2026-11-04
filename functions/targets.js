// functions/targets.js
// Achievement Desk — Monthly Targets proxy
// GET /targets?month=october-2026
// Returns { "Owner Full Name": targetAmount, ... }
//
// Sheet ID : 1izx69_aKBF0rRgrXzDwXedPGqR8sCtt4BHLpX8_r2fA
// Tab      : Target VS achievement||FY 26-27
// Auth     : GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
//            (same env vars as funnel-sheet.js — no new secrets needed)
//
// Column layout (0-indexed):
//   0: BU label   1: Team Head   2: Salesperson
//   3: Apr target  6: May target  9: Jun target ...
//   formula: target col = 3 + (monthIdx × 3), April = idx 0

const SHEET_ID  = "1izx69_aKBF0rRgrXzDwXedPGqR8sCtt4BHLpX8_r2fA";
const TAB       = "Target VS achievement||FY 26-27";
const FY_MONTHS = ["april","may","june","july","august","september",
                   "october","november","december","january","february","march"];

// Sheet salesperson name (lowercase) → registry canonical full name
// null = skip (dynamic User Role, historical, or not in registry)
const NAME_MAP = {
  // ── Digital US ────────────────────────────────────────────────────────────
  "kaustubh agrawal" : "Kaustubh Agrawal",
  "sourya ghosh"     : "Sourya Ghosh",
  "baspin thomas"    : "Baspin Thomas",
  "jebin"            : "Jebin Joy",
  "dhaval damania"   : "Dhaval Damania",
  "sudarshan"        : "Sudarshan Damani",
  "hammad bhaldar"   : "Hammad Bhaldar",
  // ── Digital UK ────────────────────────────────────────────────────────────
  "kalgi shah"       : "Kalgi Shah",
  "vikram sahi"      : "Vikram Sahi",
  "flintoff mehta"   : "Flintoff Mehta",
  // ── Digital AU (Jiggyasa) ────────────────────────────────────────────────
  "prachi porwal"    : "Prachi Porwal",
  "saquib khan"      : "Saquib Khan",
  "jiggyasa agrawal" : "Jiggyasa Agrawal",
  "manvi choumal"    : "Manvi Choumal",
  "kunal gohil"      : "Kunal Gohil",
  // ── Digital NBD ───────────────────────────────────────────────────────────
  "malav modi"       : "Malav Modi",
  "dhruti dave"      : "Dhruti Dave",
  "devanshu"         : "Devanshu Kumar",
  "aman"             : "Aman Acharya",
  // ── MarTech AM ────────────────────────────────────────────────────────────
  "preeti thapliyal" : "Preeti Thapliyal",
  "rupali sindhu"    : "Rupali Sindhu",
  "vinita raidu"     : "Vinita Raidu",
  "ayush rathi"      : "Ayush Rathi",
  "ayush dhupar"     : "Ayush Dhupar",
  "sakshi bissa"     : "Sakshi Bissa",
  "divya s"          : "Divya S",
  // ── MarTech NBD ───────────────────────────────────────────────────────────
  "kamesh biniwale"  : "Kamesh Biniwale",
  // ── Fixed group assignments for Achievement Desk (per MD, Nov 2026) ─────────
  "tanuj gupta"      : "Tanuj Gupta",    // Tanuj US
  "karan doshi"      : "Karan Doshi",    // Jaydeep AU
  "mukund basita"    : "Mukund Basita",  // Jaydeep NBD
  "chintan doshi"    : "Chintan Doshi",  // Jaydeep UK
  "jaydeep"          : "Jaydeep Salla",  // Jaydeep UK (still short name in sheet)
  // ── Skip (historical / not in registry) ───────────────────────────────────
  "sheldon"          : null,
  "darshan modi"     : null,
  "matt kelly"       : null,
  "matt"             : null,
  "nevilson christian": null,
  "shradha shah"     : null,
  "gaurav"           : null,
  "ajeet dhale"      : null,
};

function targetColIdx(monthStr) {
  const name = (monthStr || "").split("-")[0].toLowerCase();
  const idx  = FY_MONTHS.indexOf(name);
  return idx < 0 ? -1 : 3 + idx * 3;
}

function parseTargets(rows, colIdx) {
  const out = {};
  for (const row of rows) {
    const person = (row[2] || "").trim();
    if (!person) continue;
    const pLow = person.toLowerCase();
    if (pLow === "salesperson" || pLow.startsWith("total") || pLow === "nbd") continue;
    const canonical = NAME_MAP[pLow];
    if (!canonical) continue;
    const val = parseFloat(row[colIdx]) || 0;
    if (val > 0) out[canonical] = (out[canonical] || 0) + val;
  }
  return out;
}

export async function onRequestGet(context) {
  try {
    const url   = new URL(context.request.url);
    const month = url.searchParams.get("month") || "";
    const col   = targetColIdx(month);
    if (col < 0) return resp({ error: `Unknown month: ${month}` }, 400);

    const SA_EMAIL = context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY   = context.env.GOOGLE_PRIVATE_KEY;
    if (!SA_EMAIL || !SA_KEY)
      return resp({ error: "Missing env: GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);

    const token  = await getAccessToken(SA_EMAIL, SA_KEY);
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB)}`;
    const res    = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return resp({ error: `Sheets API ${res.status}: ${await res.text()}` }, 502);

    const { values: rows = [] } = await res.json();
    return resp(parseTargets(rows, col), 200);

  } catch (e) {
    return resp({ error: e.message }, 500);
  }
}

function resp(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type"  : "application/json",
      "Cache-Control" : "no-store"  // never cache — stale empty responses were breaking targets
    }
  });
}

// ── Google Sheets JWT auth — verbatim from portfolio-snapshot.js ──────────────
async function getAccessToken(email, rawKey) {
  const pem = rawKey.replace(/\\n/g, "\n");
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "").replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/,     "").replace(/-----END PRIVATE KEY-----/,     "")
    .replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(b64), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const now     = Math.floor(Date.now() / 1000);
  const header  = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    iss  : email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud  : "https://oauth2.googleapis.com/token",
    exp  : now + 3600,
    iat  : now
  }));
  const sigInput = `${header}.${payload}`;
  const sig = btoa(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
      new TextEncoder().encode(sigInput))
  ))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${sigInput}.${sig}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method : "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body   : `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const { access_token } = await tokenRes.json();
  return access_token;
}
