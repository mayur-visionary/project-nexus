export async function onRequestPost(context) {
  try {
    const { password, head } = await context.request.json();

    // ── Determine which password env var to check ──
    // head param sent by the client at login time:
    //   ""           → master dashboard → NEXUS_PASSWORD
    //   "jiggyasa"   → clone            → NEXUS_PASSWORD_JIGGYASA
    //   "jaydeep"    → clone            → NEXUS_PASSWORD_JAYDEEP
    //   "tanuj"      → clone            → NEXUS_PASSWORD_TANUJ
    const CLONE_VAR_MAP = {
      jiggyasa: "NEXUS_PASSWORD_JIGGYASA",
      jaydeep:  "NEXUS_PASSWORD_JAYDEEP",
      tanuj:    "NEXUS_PASSWORD_TANUJ"
    };

    const isClone  = !!head && !!CLONE_VAR_MAP[head];
    const envVarName = isClone ? CLONE_VAR_MAP[head] : "NEXUS_PASSWORD";
    const correct  = context.env[envVarName];

    if (!correct) {
      return new Response(JSON.stringify({ error: `${envVarName} not configured in environment` }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    if (password === correct) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
