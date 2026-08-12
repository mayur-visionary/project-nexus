// functions/funnel-auth.js
// Funnel Desk password gate
// POST { password, tab }
// Tab → password env var mapping (tab names differ from head clone keys)
// Also used by funnel.html token validation: POST { tok, tab } → validates ownership

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { password, tab, tok } = body;

    // Map Funnel tab name → clone key → env var
    // tanuj_uk + tanuj_us both belong to NEXUS_PASSWORD_TANUJ
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

    // ── Token validation mode (carry-through from Revenue Pulse) ──
    // tok is the clone key sent from index.html (e.g. "tanuj", "jiggyasa")
    // Validate: does this tok own this tab?
    if (tok !== undefined) {
      const tokOwnsTab = TAB_TO_KEY[tab] === tok ||
                         (!key && tok === "") ||        // master tok → master tab
                         (tok === "master" && !key);
      return json({ success: tokOwnsTab }, tokOwnsTab ? 200 : 403);
    }

    // ── Password validation mode ──
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
