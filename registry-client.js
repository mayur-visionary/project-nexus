// =============================================================================
// registry-client.js
// Nexus Registry Boot Helper — include in every module via <script src="/registry-client.js">
// Fetches /registry, populates globals, exposes headFromRegion()
// Must be awaited before attributeDeals() is called
// =============================================================================

// Globals populated by initRegistry() — same names as previous inline objects
// so per-module attribution logic requires zero renaming
let OWNER_REGISTRY    = {};   // full owner map keyed by id string
let OWNER_BU_MAP      = {};   // { id: "MarTech"|"Digital"|"dynamic" }
let OWNER_GEO         = {};   // { id: "AU"|"UK"|"US"|null }  null = use deal property
let OWNER_HEAD_MAP    = {};   // { id: head string | null }   null = use headFromRegion()
let OWNER_NAMES       = {};   // { id: display name }
let NBD_OWNER_IDS     = new Set();
let USER_ROLE_IDS     = new Set();
let EXISTING_EXCLUDE  = new Set();   // NBD ∪ User Role — excluded from existing-client counts
let MARTECH_OWNER_IDS = new Set();
let DIGITAL_OWNER_IDS = new Set();
let NBD_IS_GROWTH     = new Set();   // Karan Doshi & Divya S — Growth Ledger special handling
let GEO_MAP           = {};

// Inline fallback — mirrors /functions/registry.js exactly.
// Used only if the fetch fails (network error, cold-start timeout, etc.)
// Keep in sync with registry.js on every registry update.
const REGISTRY_FALLBACK = {
  owners: {
    "107178262": { id:"107178262", name:"Chintan Doshi",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "17738843":  { id:"17738843",  name:"Jaydeep Salla",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "34140174":  { id:"34140174",  name:"Mrugesh Dabhi",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "90736668":  { id:"90736668",  name:"Matt Kelly",        bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "467997340": { id:"467997340", name:"Karan Doshi",       bu:"MarTech", region:"AU",  head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:true,  historical:false },
    "82911376":  { id:"82911376",  name:"Divya S",           bu:"MarTech", region:"UK",  head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:true,  historical:false },
    "41490632":  { id:"41490632",  name:"Mukund Basita",     bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "82030736":  { id:"82030736",  name:"Sakshi Bissa",      bu:"MarTech", region:"UK",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "93107638":  { id:"93107638",  name:"Ayush Dhupar",      bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "46153051":  { id:"46153051",  name:"Ayush Rathi",       bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "86147905":  { id:"86147905",  name:"Preeti Thapliyal",  bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "85767516":  { id:"85767516",  name:"Rupali Sindhu",     bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "89530815":  { id:"89530815",  name:"Vinita Raidu",      bu:"MarTech", region:"US",  head:"Jaydeep",    nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "916030451": { id:"916030451", name:"Kamesh Biniwale",   bu:"MarTech", region:"geo", head:"Jaydeep",    nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "17739548":  { id:"17739548",  name:"Darshan Modi",      bu:"Digital", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "79217713":  { id:"79217713",  name:"Krunal Bakraniya",  bu:"Digital", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "17739173":  { id:"17739173",  name:"Tanuj Gupta",       bu:"Digital", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
    "131779647": { id:"131779647", name:"Jiggyasa Agrawal",  bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "78831011":  { id:"78831011",  name:"Kunal Gohil",       bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "94746500":  { id:"94746500",  name:"Manvi Choumal",     bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "176516495": { id:"176516495", name:"Prachi Porwal",     bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "263464861": { id:"263464861", name:"Saquib Khan",       bu:"Digital", region:"AU",  head:"Jiggyasa",   nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "46156316":  { id:"46156316",  name:"Flintoff Mehta",    bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "37344296":  { id:"37344296",  name:"Kalgi Shah",        bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "31730801":  { id:"31730801",  name:"Vikram Sahi",       bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "24817892":  { id:"24817892",  name:"Sheldon Fernandes", bu:"Digital", region:"UK",  head:"Tanuj - UK", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:true  },
    "38568120":  { id:"38568120",  name:"Baspin Thomas",     bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "42663191":  { id:"42663191",  name:"Dhaval Damania",    bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "240935328": { id:"240935328", name:"Hammad Bhaldar",    bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "19799470":  { id:"19799470",  name:"Jebin Joy",         bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "34558123":  { id:"34558123",  name:"Kaustubh Agrawal",  bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "284770744": { id:"284770744", name:"Sourya Ghosh",      bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "557894666": { id:"557894666", name:"Sudarshan Damani",  bu:"Digital", region:"US",  head:"Tanuj - US", nature:"AM",        isNBD:false, nbdIsGrowth:false, historical:false },
    "86813698":  { id:"86813698",  name:"Aman Acharya",      bu:"Digital", region:"AU",  head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "255830830": { id:"255830830", name:"Devanshu Kumar",    bu:"Digital", region:"UK",  head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "37762663":  { id:"37762663",  name:"Malav Modi",        bu:"Digital", region:"US",  head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "1360061595":{ id:"1360061595",name:"Dhruti Dave",       bu:"Digital", region:"geo", head:"Nevilson",   nature:"NBD",       isNBD:true,  nbdIsGrowth:false, historical:false },
    "82663745":  { id:"82663745",  name:"Prativa Dubey",     bu:"dynamic", region:"geo", head:"geo",        nature:"User Role", isNBD:false, nbdIsGrowth:false, historical:false },
  },
  geoMap: {
    "US":"US", "UK":"UK", "AU":"AU",
    "AU/NZ":"AU", "India":"AU", "Netherlands":"UK", "Other":null
  }
};

// ── Core boot function ────────────────────────────────────────────────────────
// Call once at module boot. Await before attributeDeals().
async function initRegistry() {
  let data;

  try {
    const res = await fetch("/registry");
    if (!res.ok) throw new Error(`/registry responded ${res.status}`);
    data = await res.json();
    console.log(`[Nexus] Registry v${data.meta?.version} loaded — ${data.meta?.active} active owners`);
  } catch (err) {
    console.warn("[Nexus] Registry fetch failed, using inline fallback:", err.message);
    data = REGISTRY_FALLBACK;
  }

  const reg = data.owners;

  // Populate globals
  OWNER_REGISTRY    = reg;
  GEO_MAP           = data.geoMap;

  for (const [id, o] of Object.entries(reg)) {
    OWNER_BU_MAP[id]   = o.bu;
    OWNER_GEO[id]      = o.region === "geo" ? null : o.region;
    OWNER_HEAD_MAP[id] = o.head   === "geo" ? null : o.head;
    OWNER_NAMES[id]    = o.name;
    if (o.isNBD)                    NBD_OWNER_IDS.add(id);
    if (o.nature === "User Role")   USER_ROLE_IDS.add(id);
    if (o.isNBD || o.nature === "User Role") EXISTING_EXCLUDE.add(id);
    if (o.bu === "MarTech")         MARTECH_OWNER_IDS.add(id);
    if (o.bu === "Digital")         DIGITAL_OWNER_IDS.add(id);
    if (o.nbdIsGrowth)              NBD_IS_GROWTH.add(id);
  }
}

// ── headFromRegion ────────────────────────────────────────────────────────────
// Resolves head for owners whose head === "geo" in the registry
// (Leaders: Darshan, Krunal, Tanuj, Prativa)
// Mirrors the logic previously hardcoded per-module
function headFromRegion(region, bu) {
  if (bu === "MarTech") return "Jaydeep";
  if (bu === "Digital" || bu === "dynamic") {
    if (region === "AU") return "Jiggyasa";
    if (region === "UK") return "Tanuj - UK";
    if (region === "US") return "Tanuj - US";
  }
  return null;
}

// ── resolveGeo ────────────────────────────────────────────────────────────────
// Applies GEO_MAP to a raw geo__invoice_app_ deal property value
function resolveGeo(raw) {
  return GEO_MAP[raw] ?? null;
}
