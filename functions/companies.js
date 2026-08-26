// functions/companies.js
// Cloudflare Pages Function — resolves Growth Owner for NBD deals via HubSpot Associations.
//
// Input:  { dealIds: string[] }
// Output: { owners: { "<dealId>": "<hubspot_owner_id>" } }
//
// Step 1: Batch resolve deal → company via /crm/v4/associations/deals/companies/batch/read
// Step 2: Batch fetch company owners via /crm/v3/objects/companies/batch/read
// No name matching — the association graph is the authoritative link.

export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json();
    const dealIds = (body.dealIds || []).filter(Boolean);
    if (!dealIds.length) {
      return new Response(JSON.stringify({ owners: {} }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const hdrs = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };

    // ── Step 1: deal IDs → company IDs via Associations API ──
    const dealToCompany = {}; // dealId → companyId
    const ASSOC_BATCH = 100;

    for (let i = 0; i < dealIds.length; i += ASSOC_BATCH) {
      const batch = dealIds.slice(i, i + ASSOC_BATCH);
      const res = await fetch("https://api.hubapi.com/crm/v4/associations/deals/companies/batch/read", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ inputs: batch.map(id => ({ id })) })
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.results || []).forEach(r => {
        const dealId    = String(r.from?.id || "");
        const companyId = String(r.to?.[0]?.toObjectId || "");
        if (dealId && companyId) dealToCompany[dealId] = companyId;
      });
    }

    // ── Step 2: company IDs → owners via batch read ──
    const companyOwners = {}; // companyId → ownerId
    const companyIds = [...new Set(Object.values(dealToCompany))];
    const COMPANY_BATCH = 100;

    for (let i = 0; i < companyIds.length; i += COMPANY_BATCH) {
      const batch = companyIds.slice(i, i + COMPANY_BATCH);
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/batch/read", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ inputs: batch.map(id => ({ id })), properties: ["hubspot_owner_id"] })
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.results || []).forEach(r => {
        const companyId = String(r.id || "");
        const ownerId   = String(r.properties?.hubspot_owner_id || "");
        if (companyId && ownerId) companyOwners[companyId] = ownerId;
      });
    }

    // ── Build dealId → ownerId result ──
    const owners = {};
    Object.entries(dealToCompany).forEach(([dealId, companyId]) => {
      const ownerId = companyOwners[companyId];
      if (ownerId) owners[dealId] = ownerId;
    });

    return new Response(JSON.stringify({ owners }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
