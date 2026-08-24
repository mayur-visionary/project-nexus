export async function onRequestPost(context) {
  try {
    // nbd-auth.js — NBD Client Growth password gate
    // Master password: NEXUS_PASSWORD
    // Optional dedicated password: NEXUS_PASSWORD_NBD
    const { password, head } = await context.request.json();

    const CLONE_VAR_MAP = {
      nbd: "NEXUS_PASSWORD_NBD"
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
