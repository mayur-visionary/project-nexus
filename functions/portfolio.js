// functions/portfolio.js
// Cloudflare Pages Function — fetches Existing Kitty Customer companies from HubSpot
// Fix: hubspot_owner_id on Companies does NOT support IN operator.
// Solution: fetch all Exisiting Kitty Customer companies, then filter by ownerIds client-side.
// This is safe — total universe is ~2,030 records, well within memory limits.

export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json();
    const ownerIds = new Set((body.ownerIds || []).map(String));

    const hdrs = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };

    // ── Fetch ALL Existing Kitty Customer companies (no owner filter in API) ──
    // HubSpot Companies API does not support IN operator on hubspot_owner_id.
    // We fetch the full kitty universe and filter by ownerIds server-side.
    const companies = [];
    let after = null;

    do {
      const reqBody = {
        filterGroups: [{
          filters: [{
            propertyName: "kitty_management_system__don_t_delete_",
            operator: "EQ",
            value: "Exisiting Kitty Customer"
          }]
        }],
        properties: [
          "name",
          "hubspot_owner_id",
          "business_unit",
          "createdate",
          "recent_deal_close_date"
        ],
        limit: 200
        // No sorts — HubSpot search silently drops the final page when sort + large result set combine.
        // Client-side classification does not depend on order.
      };

      if (after) reqBody.after = after;

      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(reqBody)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HubSpot API ${res.status}: ${errText}`);
      }

      const data = await res.json();

      (data.results || []).forEach(r => {
        const ownerId = String(r.properties?.hubspot_owner_id || "");
        // Filter by registry owners server-side
        if (ownerIds.size > 0 && !ownerIds.has(ownerId)) return;
        companies.push({
          id: String(r.id),
          name: r.properties?.name || "",
          owner_id: ownerId,
          business_unit: r.properties?.business_unit || "",
          createdate: (r.properties?.createdate || "").split("T")[0],
          recent_deal_close_date: (r.properties?.recent_deal_close_date || "").split("T")[0]
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
