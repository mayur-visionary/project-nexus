// functions/portfolio.js
// Cloudflare Pages Function — fetches Existing Kitty Customer companies from HubSpot
// with pagination, returning all records with owner_id, name, client_status,
// business_unit, and createdate for classification engine.

export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const { ownerIds } = await context.request.json();
    if (!ownerIds || !ownerIds.length) {
      return new Response(JSON.stringify({ error: "ownerIds required" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const hdrs = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };

    // ── Fetch all Existing Kitty Customer companies for supplied owner IDs ──
    // Paginate until all records retrieved (HubSpot max 200 per page)
    const companies = [];
    let after = null;

    do {
      const body = {
        filterGroups: [{
          filters: [
            {
              propertyName: "kitty_management_system__don_t_delete_",
              operator: "EQ",
              value: "Exisiting Kitty Customer"
            },
            {
              propertyName: "hubspot_owner_id",
              operator: "IN",
              values: ownerIds.map(String)
            }
          ]
        }],
        properties: [
          "name",
          "hubspot_owner_id",
          "client_status",
          "business_unit",
          "kitty_management_system__don_t_delete_",
          "createdate"
        ],
        limit: 200,
        sorts: [{ propertyName: "name", direction: "ASCENDING" }]
      };

      if (after) body.after = after;

      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HubSpot API ${res.status}: ${errText}`);
      }

      const data = await res.json();
      (data.results || []).forEach(r => {
        companies.push({
          id: String(r.id),
          name: r.properties?.name || "",
          owner_id: String(r.properties?.hubspot_owner_id || ""),
          business_unit: r.properties?.business_unit || "",
          createdate: (r.properties?.createdate || "").split("T")[0]
        });
      });

      after = data.paging?.next?.after || null;
    } while (after);

    return new Response(JSON.stringify({ companies, total: companies.length }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
