// functions/funnel-auth.js
// Funnel Desk auth — two modes:
//   Password: POST { password, tab } — tab is the funnel tab name or null for master
//   Token:    POST { tok, tab }      — carry-through from Revenue Pulse login

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { password, tab, tok } = body;

    // tab → clone key → env var
    // null/undefined tab = master access → NEXUS_PASSWORD
    const TAB_TO_KEY = {
      jiggyasa : "jiggyasa",
      tanuj_uk  : "tanuj",
      tanuj_us  : "tanuj",
      jaydeep   : "jaydeep",   // ← added
    };
    const CLONE_VAR_MAP = {
      jiggyasa : "NEXUS_PASSWORD_JIGGYASA",
      tanuj    : "NEXUS_PASSWORD_TANUJ",
      jaydeep  : "NEXUS_PASSWORD_JAYDEEP",
      digital  : "NEXUS_PASSWORD_DIGITAL",
      interbu  : "NEXUS_PASSWORD_INTERBU",
    };

    const key        = tab ? (TAB_TO_KEY[tab] || null) : null;
    const envVarName = key ? CLONE_VAR_MAP[key] : "NEXUS_PASSWORD";
    const correct    = context.env[envVarName];

    if (!correct)
      return json({ error: `${envVarName} not configured` }, 500);

    // ── Token mode: carry-through from Revenue Pulse ──
    if (tok !== undefined) {
      const valid = key !== null && key === tok;
      return json({ success: valid }, valid ? 200 : 403);
    }

    // ── Password mode ──
    if (password === correct) return json({ success: true }, 200);
    return json({ success: false }, 401);

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
