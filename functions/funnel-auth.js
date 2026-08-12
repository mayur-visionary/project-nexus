// functions/funnel-auth.js
// Funnel Desk password + token gate
// Password mode: POST { password, tab } → validates against env var
// Token mode:    POST { tok, tab }      → validates tok owns tab (no password needed)

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { password, tab, tok } = body;

    // Map Funnel tab → clone key → env var
    const TAB_TO_KEY = {
      jiggyasa : "jiggyasa",
      tanuj_uk  : "tanuj",
      tanuj_us  : "tanuj",
    };
    const CLONE_VAR_MAP = {
      jiggyasa : "NEXUS_PASSWORD_JIGGYASA",
      tanuj    : "NEXUS_PASSWORD_TANUJ",
      jaydeep  : "NEXUS_PASSWORD_JAYDEEP",
      digital  : "NEXUS_PASSWORD_DIGITAL",
      interbu  : "NEXUS_PASSWORD_INTERBU",
    };

    const key        = TAB_TO_KEY[tab] || null;
    const envVarName = key ? CLONE_VAR_MAP[key] : "NEXUS_PASSWORD";
    const correct    = context.env[envVarName];

    if (!correct)
      return json({ error: `${envVarName} not configured` }, 500);

    // ── Token mode: carry-through from Revenue Pulse ──
    // tok = the clone key stored by index.html (e.g. "tanuj", "jiggyasa")
    // Valid if tok matches the owner of the requested tab
    if (tok !== undefined) {
      const valid = (key !== null && key === tok);
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
