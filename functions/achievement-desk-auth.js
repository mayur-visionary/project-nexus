// functions/achievement-desk-auth.js
// Achievement Desk — password gate
// Pattern: identical to portfolio-auth.js
// Reuses existing clone env vars — no new Cloudflare secrets required.
// Master + Nevilson → NEXUS_PASSWORD
// Jiggyasa          → NEXUS_PASSWORD_JIGGYASA
// Jaydeep           → NEXUS_PASSWORD_JAYDEEP
// Tanuj             → NEXUS_PASSWORD_TANUJ

export async function onRequestPost(context) {
  try {
    const { password, head } = await context.request.json();

    const CLONE_VAR_MAP = {
      jiggyasa : "NEXUS_PASSWORD_JIGGYASA",
      jaydeep  : "NEXUS_PASSWORD_JAYDEEP",
      tanuj    : "NEXUS_PASSWORD_TANUJ"
      // nevilson: not mapped — falls through to NEXUS_PASSWORD (master)
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
