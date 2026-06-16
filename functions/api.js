export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const hs = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer pat-na1-f45d6711-9421-4477-a317-327e5a8c3f12'
      },
      body: JSON.stringify(body)
    });

    const data = await hs.json();

    return new Response(JSON.stringify(data), {
      status: hs.status,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
