// =============================================================================
// /functions/registry.js
// Nexus Central Owner Registry — Single Source of Truth
// Version: 2.0  |  Updated: 2026-10-27
// 39 owners: 38 active + 1 historical (Sheldon Fernandes)
//
// Attribution model (three-tier):
//   Tier 1 — This registry (primary for all owners)
//   Tier 2 — Deal properties: business_unit_invoice_app, user_role_invoice_app
//             (consulted only for owners where nature === "User Role", FY-current only)
//   Tier 3 — Prativa Dubey catch-all fallback
//
// To update the registry: edit this file, redeploy, purge Cloudflare cache for /registry
// Cache TTL: 24 hours (max-age=86400)
// =============================================================================

export async function onRequest() {

  // ── Owner entries ───────────────────────────────────────────────────────────
  // Fields:
  //   id          — HubSpot owner ID (string, matches HubSpot API)
  //   name        — Display name
  //   bu          — "MarTech" | "Digital" | "dynamic"
  //                 "dynamic" = resolved per deal via business_unit_invoice_app
  //   region      — "AU" | "UK" | "US" | "geo"
  //                 "geo" = resolved per deal via geo__invoice_app_ + GEO_MAP
  //   head        — "Jaydeep" | "Jiggyasa" | "Tanuj - UK" | "Tanuj - US" |
  //                 "Nevilson" | "geo"
  //                 "geo" = resolved per deal via headFromRegion(region, bu)
  //   nature      — "AM" | "NBD" | "User Role"
  //                 "User Role" = dual-role; Tier 2 deal property consulted
  //   isNBD       — true for all NBD owners (drives existingExclude)
  //   nbdIsGrowth — true for Karan Doshi & Divya S (Growth Ledger special handling)
  //   historical  — true = Sheldon Fernandes; present in Recurring Radar only
  // ───────────────────────────────────────────────────────────────────────────

  const owners = {

    // ── MARTECH ── 14 owners ─────────────────────────────────────────────────

    // User Role (BU & nature resolved per deal via Tier 2 properties)
    "107178262": { id:"107178262", name:"Chintan Doshi",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "17738843":  { id:"17738843",  name:"Jaydeep Salla",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    // Jaydeep Salla = Jaydeep Soni (jay@mavlers.com) — confirmed same person
    "34140174":  { id:"34140174",  name:"Mrugesh Dabhi",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "90736668":  { id:"90736668",  name:"Matt Kelly",        bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    // matt@mavlers.com — added Oct 2026
    "467997340": { id:"467997340", name:"Karan Doshi",       bu:"MarTech", region:"AU",  head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:true,  historical:false },
    "82911376":  { id:"82911376",  name:"Divya S",           bu:"MarTech", region:"UK",  head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:true,  historical:false },
    "41490632":  { id:"41490632",  name:"Mukund Basita",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    // Mukund reclassified from Reactivation → User Role (Oct 2026)

    // AM
    "82030736":  { id:"82030736",  name:"Sakshi Bissa",      bu:"MarTech", region:"UK",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "93107638":  { id:"93107638",  name:"Ayush Dhupar",      bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "46153051":  { id:"46153051",  name:"Ayush Rathi",       bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "86147905":  { id:"86147905",  name:"Preeti Thapliyal",  bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "85767516":  { id:"85767516",  name:"Rupali Sindhu",     bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "89530815":  { id:"89530815",  name:"Vinita Raidu",      bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },

    // NBD
    "916030451": { id:"916030451", name:"Kamesh Biniwale",   bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    // Kamesh: geo corrected from UK → geo (Invoice App) Oct 2026

    // ── DIGITAL ── 24 owners (23 active + 1 historical) ──────────────────────

    // User Role (Leaders — head & region resolved per deal)
    "17739548":  { id:"17739548",  name:"Darshan Modi",      bu:"Digital", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "79217713":  { id:"79217713",  name:"Krunal Bakraniya",  bu:"Digital", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "17739173":  { id:"17739173",  name:"Tanuj Gupta",       bu:"Digital", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },

    // AM — AU  (Head: Jiggyasa)
    "131779647": { id:"131779647", name:"Jiggyasa Agrawal",  bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "78831011":  { id:"78831011",  name:"Kunal Gohil",       bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "94746500":  { id:"94746500",  name:"Manvi Choumal",     bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "176516495": { id:"176516495", name:"Prachi Porwal",     bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "263464861": { id:"263464861", name:"Saquib Khan",       bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },

    // AM — UK  (Head: Tanuj - UK)
    "46156316":  { id:"46156316",  name:"Flintoff Mehta",    bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "37344296":  { id:"37344296",  name:"Kalgi Shah",        bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "31730801":  { id:"31730801",  name:"Vikram Sahi",       bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "24817892":  { id:"24817892",  name:"Sheldon Fernandes", bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:true  },
    // Sheldon: HISTORICAL ONLY — Recurring Radar only; excluded from all live attribution

    // AM — US  (Head: Tanuj - US)
    "38568120":  { id:"38568120",  name:"Baspin Thomas",     bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "42663191":  { id:"42663191",  name:"Dhaval Damania",    bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "240935328": { id:"240935328", name:"Hammad Bhaldar",    bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "19799470":  { id:"19799470",  name:"Jebin Joy",         bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "34558123":  { id:"34558123",  name:"Kaustubh Agrawal",  bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "284770744": { id:"284770744", name:"Sourya Ghosh",      bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "557894666": { id:"557894666", name:"Sudarshan Damani",  bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },

    // NBD — Nevilson's Team
    "86813698":  { id:"86813698",  name:"Aman Acharya",      bu:"Digital", region:"AU",  head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "255830830": { id:"255830830", name:"Devanshu Kumar",    bu:"Digital", region:"UK",  head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "37762663":  { id:"37762663",  name:"Malav Modi",        bu:"Digital", region:"US",  head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "1360061595":{ id:"1360061595",name:"Dhruti Dave",       bu:"Digital", region:"geo", head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    // Dhruti: region geo (unlike rest of Nevilson team who are fixed-region) — added Oct 2026

    // ── DYNAMIC BU ── 1 owner ─────────────────────────────────────────────────

    "82663745":  { id:"82663745",  name:"Prativa Dubey",     bu:"dynamic", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    // Prativa: BU from business_unit_invoice_app per deal; catch-all fallback for unresolved attribution
  };

  // ── Convenience arrays (derived — do not edit manually) ───────────────────
  const ids            = Object.keys(owners);
  const active         = ids.filter(id =>  !owners[id].historical);
  const nbd            = ids.filter(id =>   owners[id].isNBD);
  const userRole       = ids.filter(id =>   owners[id].nature === "User Role");
  const existingExclude= [...new Set([...nbd, ...userRole])];
  const martech        = ids.filter(id =>   owners[id].bu === "MarTech");
  const digital        = ids.filter(id =>   owners[id].bu === "Digital");
  const nbdIsGrowth    = ids.filter(id =>   owners[id].nbdIsGrowth);

  // ── GEO_MAP ───────────────────────────────────────────────────────────────
  // Maps raw geo__invoice_app_ deal property values → canonical region bucket
  const geoMap = {
    "US":          "US",
    "UK":          "UK",
    "AU":          "AU",
    "AU/NZ":       "AU",   // treated as AU
    "India":       "AU",   // Jiggyasa head scope
    "Netherlands": "UK",   // treated as EMEA/UK
    "Other":       null    // excluded from region-level breakdowns
  };

  // ── Response ──────────────────────────────────────────────────────────────
  const payload = {
    owners,
    // convenience arrays of owner ID strings
    active,
    nbd,
    userRole,
    existingExclude,
    martech,
    digital,
    nbdIsGrowth,
    geoMap,
    meta: {
      total:     ids.length,
      active:    active.length,
      historical:ids.length - active.length,
      updatedAt: "2026-10-27",
      version:   "2.0"
    }
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=86400",
    }
  });
}
