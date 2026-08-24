export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const { names } = await context.request.json();
    if (!Array.isArray(names) || !names.length) {
      return new Response(JSON.stringify({ owners: {} }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const owners = {};

    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const body = {
        filterGroups: [{ filters: [{ propertyName: "name", operator: "IN", values: chunk }] }],
        properties: ["name", "hubspot_owner_id"],
        limit: 100
      };
      const hs = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      if (!hs.ok) continue;
      const data = await hs.json();
      (data.results || []).forEach(c => {
        const name    = (c.properties?.name || "").trim();
        const ownerId = c.properties?.hubspot_owner_id;
        if (name && ownerId) owners[name] = String(ownerId);
      });
    }

    return new Response(JSON.stringify({ owners }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
