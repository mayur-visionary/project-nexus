export async function onRequestPost(context) {
  try {
    const { password } = await context.request.json();
    const correct = context.env.NEXUS_PASSWORD;

    if (!correct) {
      return new Response(JSON.stringify({ error: "NEXUS_PASSWORD not configured in environment" }), {
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
