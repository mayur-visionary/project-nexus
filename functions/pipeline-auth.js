export async function onRequestPost(context) {
  try {
    // pipeline-auth.js — Pipeline Scout password gate
    // Reuses the same env var pattern as auth.js and portfolio-auth.js.
    // Master password: NEXUS_PASSWORD
    // Clone passwords: NEXUS_PASSWORD_JIGGYASA / _JAYDEEP / _TANUJ / _NEVILSON
    const { password, head } = await context.request.json();

    const CLONE_VAR_MAP = {
      jiggyasa  : "NEXUS_PASSWORD_JIGGYASA",
      jaydeep   : "NEXUS_PASSWORD_JAYDEEP",
      tanuj     : "NEXUS_PASSWORD_TANUJ",
      nevilson  : "NEXUS_PASSWORD_NEVILSON"
    };

    const isClone    = !!head && !!CLONE_VAR_MAP[head];
    const envVarName = isClone ? CLONE_VAR_MAP[head] : "NEXUS_PASSWORD";
    const correct    = context.env[envVarName];

    if (!correct) {
      return new Response(
        JSON.stringify({ error: `${envVarName} not configured in environment` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (password === correct) {
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
