export async function onRequestGet(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    let results = [], after = null;
    do {
      const url = "https://api.hubapi.com/crm/v3/owners?limit=100&archived=false" + (after ? "&after=" + after : "");
      const hs = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!hs.ok) {
        return new Response(JSON.stringify({ error: "HubSpot " + hs.status }), {
          status: hs.status, headers: { "Content-Type": "application/json" }
        });
      }
      const d = await hs.json();
      results = results.concat(d.results || []);
      after = d.paging?.next?.after || null;
    } while (after);

    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "s-maxage=300" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
