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

    const hdrs = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };

    // Step 1: Batch-fetch associations (deal → line_items) using v3 API
    // v3 endpoint: POST /crm/v3/associations/deals/line_items/batch/read
    // Response: { results: [{ from: {id}, to: [{id, type}] }] }
    const assocMap = {};
    const allLineItemIds = new Set();

    for (let i = 0; i < dealIds.length; i += 100) {
      const chunk = dealIds.slice(i, i + 100);
      try {
        const assocRes = await fetch(
          "https://api.hubapi.com/crm/v3/associations/deals/line_items/batch/read",
          {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({
              inputs: chunk.map(id => ({ id: String(id) }))
            })
          }
        );
        if (!assocRes.ok) {
          const errText = await assocRes.text();
          console.error("Assoc batch error:", assocRes.status, errText);
          continue;
        }
        const assocData = await assocRes.json();
        (assocData.results || []).forEach(r => {
          const dealId = String(r.from?.id || "");
          const liIds = (r.to || []).map(t => String(t.id));
          if (dealId && liIds.length) {
            assocMap[dealId] = liIds;
            liIds.forEach(id => allLineItemIds.add(id));
          }
        });
      } catch (e) {
        console.error("Assoc fetch exception:", e.message);
      }
    }

    // Step 2: Batch-fetch line item properties (name + amount)
    const liProps = {};
    const liIdArr = [...allLineItemIds];

    for (let i = 0; i < liIdArr.length; i += 100) {
      const chunk = liIdArr.slice(i, i + 100);
      try {
        const liRes = await fetch(
          "https://api.hubapi.com/crm/v3/objects/line_items/batch/read",
          {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({
              inputs: chunk.map(id => ({ id })),
              properties: ["name", "amount"]
            })
          }
        );
        if (!liRes.ok) {
          const errText = await liRes.text();
          console.error("LI batch error:", liRes.status, errText);
          continue;
        }
        const liData = await liRes.json();
        (liData.results || []).forEach(r => {
          liProps[String(r.id)] = {
            name: r.properties?.name || "",
            amount: parseFloat(r.properties?.amount || 0) || 0
          };
        });
      } catch (e) {
        console.error("LI fetch exception:", e.message);
      }
    }

    // Step 3: Build response
    const items = {};
    Object.entries(assocMap).forEach(([dealId, liIds]) => {
      items[dealId] = liIds
        .map(id => liProps[id])
        .filter(Boolean);
    });

    return new Response(JSON.stringify({
      items,
      _debug: {
        dealsRequested: dealIds.length,
        dealsWithAssoc: Object.keys(assocMap).length,
        totalLineItems: allLineItemIds.size,
        lineItemsResolved: Object.keys(liProps).length
      }
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
