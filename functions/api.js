export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not set in environment" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json();

    const hs = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const data = await hs.json();

    return new Response(JSON.stringify(data), {
      status: hs.status,
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
