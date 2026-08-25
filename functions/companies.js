// functions/companies.js
// Cloudflare Pages Function — resolves HubSpot company owners by name.
//
// Pass 1: exact name filter (batches of 5 via OR filterGroups)
// Pass 2: fuzzy query search for any names that returned no exact match
//         (handles deal name ≠ HubSpot record name, e.g. "YLP Legal" → "YLP Management Services")
// Result is keyed by the ORIGINAL deal name so client-side lookup works without renaming.

export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json();
    const names = (body.names || []).filter(Boolean);
    if (!names.length) {
      return new Response(JSON.stringify({ owners: {} }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const hdrs = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };
    const owners = {}; // originalDealName → hubspot_owner_id

    // ── Pass 1: exact name filter, 5 names per request (OR via filterGroups) ──
    const unmatched = [];
    const BATCH = 5;

    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      const reqBody = {
        filterGroups: batch.map(name => ({
          filters: [{ propertyName: "name", operator: "EQ", value: name }]
        })),
        properties: ["name", "hubspot_owner_id"],
        limit: BATCH * 2
      };

      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST", headers: hdrs, body: JSON.stringify(reqBody)
      });
      if (!res.ok) { batch.forEach(n => unmatched.push(n)); continue; }

      const data = await res.json();
      const matched = new Set();
      (data.results || []).forEach(r => {
        const hsName  = r.properties?.name;
        const ownerId = String(r.properties?.hubspot_owner_id || "");
        if (hsName && ownerId) matched.add(hsName);
        // Map back to whichever batch name matches this record
        const batchMatch = batch.find(n => n === hsName);
        if (batchMatch && ownerId) owners[batchMatch] = ownerId;
      });
      batch.forEach(n => { if (!matched.has(n)) unmatched.push(n); });
    }

    // ── Pass 2: fuzzy query search for unmatched names ──
    for (const name of unmatched) {
      const reqBody = {
        query: name,
        properties: ["name", "hubspot_owner_id"],
        limit: 3
      };
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST", headers: hdrs, body: JSON.stringify(reqBody)
      });
      if (!res.ok) continue;

      const data = await res.json();
      const result = (data.results || []).find(r => r.properties?.hubspot_owner_id);
      if (result) {
        const ownerId = String(result.properties.hubspot_owner_id);
        if (ownerId) owners[name] = ownerId; // keyed by original deal name
      }
    }

    return new Response(JSON.stringify({ owners }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
