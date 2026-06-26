export async function onRequestPost(context) {
  try {
    const token = context.env.HUBSPOT_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const { dealIds } = await context.request.json();
    if (!dealIds || !dealIds.length) {
      return new Response(JSON.stringify({ items: {} }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };

    // Step 1: Batch-fetch associations (deal → line_items) in chunks of 100
    const assocMap = {}; // dealId → [lineItemId, ...]
    const allLineItemIds = new Set();

    for (let i = 0; i < dealIds.length; i += 100) {
      const chunk = dealIds.slice(i, i + 100);
      const assocRes = await fetch(
        "https://api.hubapi.com/crm/v4/associations/deals/line_items/batch/read",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            inputs: chunk.map(id => ({ id: String(id) }))
          })
        }
      );
      if (!assocRes.ok) {
        console.error("Assoc batch error:", assocRes.status);
        continue;
      }
      const assocData = await assocRes.json();
      (assocData.results || []).forEach(r => {
        const dealId = String(r.from?.id || "");
        const liIds = (r.to || []).map(t => String(t.toObjectId));
        if (dealId && liIds.length) {
          assocMap[dealId] = liIds;
          liIds.forEach(id => allLineItemIds.add(id));
        }
      });
    }

    // Step 2: Batch-fetch line item properties (name + amount) in chunks of 100
    const liProps = {}; // lineItemId → {name, amount}
    const liIdArr = [...allLineItemIds];

    for (let i = 0; i < liIdArr.length; i += 100) {
      const chunk = liIdArr.slice(i, i + 100);
      const liRes = await fetch(
        "https://api.hubapi.com/crm/v3/objects/line_items/batch/read",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            inputs: chunk.map(id => ({ id })),
            properties: ["name", "amount"]
          })
        }
      );
      if (!liRes.ok) {
        console.error("LI batch error:", liRes.status);
        continue;
      }
      const liData = await liRes.json();
      (liData.results || []).forEach(r => {
        liProps[String(r.id)] = {
          name: r.properties?.name || "",
          amount: parseFloat(r.properties?.amount || 0) || 0
        };
      });
    }

    // Step 3: Build response — dealId → [{name, amount}]
    const items = {};
    Object.entries(assocMap).forEach(([dealId, liIds]) => {
      items[dealId] = liIds
        .map(id => liProps[id])
        .filter(Boolean);
    });

    return new Response(JSON.stringify({ items }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
