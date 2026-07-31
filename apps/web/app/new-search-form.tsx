"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { citySuggestionsFor, usStateForCity } from "@/lib/locations";
import { useT } from "./language-provider";
import { useToast } from "./toast-provider";

// Vollstaendige Liste von Hunters eigener Industry-Taxonomie fuer den Discover-Call
// (https://hunter.io/files/industries.json, abgerufen am 2026-07-30) -- vorher war das
// eine handverlesene Auswahl von ~27 Branchen, waehrend Hunter selbst ueber 480 kennt.
// Alphabetisch sortiert (Hunters eigene Reihenfolge ist thematisch gruppiert, aber ohne
// echte Kategorien in den Rohdaten -- bei 487 Eintraegen in einem flachen <select> ist
// alphabetisch fuer Sprung-per-Tastatur deutlich brauchbarer).
const INDUSTRIES = [
  "Abrasives and Nonmetallic Minerals Manufacturing", "Accessible Architecture and Design",
  "Accessible Hardware Manufacturing", "Accommodation Services", "Accounting",
  "Administration of Justice", "Administrative and Support Services", "Advertising Services",
  "Agricultural Chemical Manufacturing",
  "Agriculture, Construction, Mining Machinery Manufacturing",
  "Air, Water, and Waste Program Management", "Airlines and Aviation",
  "Alternative Dispute Resolution", "Alternative Fuel Vehicle Manufacturing",
  "Alternative Medicine", "Ambulance Services", "Amusement Parks and Arcades",
  "Animal Feed Manufacturing", "Animation", "Animation and Post-production", "Apparel and Fashion",
  "Apparel Manufacturing", "Appliances, Electrical, and Electronics Manufacturing",
  "Architectural and Structural Metal Manufacturing", "Architecture and Planning", "Armed Forces",
  "Artificial Rubber and Synthetic Fiber Manufacturing", "Artists and Writers", "Arts and Crafts",
  "Audio and Video Equipment Manufacturing", "Automation Machinery Manufacturing", "Automotive",
  "Aviation & Aerospace", "Aviation and Aerospace Component Manufacturing",
  "Baked Goods Manufacturing", "Banking", "Bars, Taverns, and Nightclubs",
  "Bed-and-Breakfasts, Hostels, Homestays", "Beverage Manufacturing",
  "Biomass Electric Power Generation", "Biotechnology", "Biotechnology Research",
  "Blockchain Services", "Blogs", "Boilers, Tanks, and Shipping Container Manufacturing",
  "Book and Periodical Publishing", "Book Publishing", "Breweries",
  "Broadcast Media Production and Distribution", "Building Construction",
  "Building Equipment Contractors", "Building Finishing Contractors", "Building Materials",
  "Building Structure and Exterior Contractors", "Business Consulting and Services",
  "Business Content", "Business Intelligence Platforms", "Business Supplies and Equipment",
  "Cable and Satellite Programming", "Capital Markets", "Caterers", "Chemical Manufacturing",
  "Chemical Raw Materials Manufacturing", "Child Day Care Services", "Chiropractors",
  "Circuses and Magic Shows", "Civic and Social Organizations", "Civil Engineering",
  "Claims Adjusting, Actuarial Services", "Clay and Refractory Products Manufacturing",
  "Climate Data and Analytics", "Climate Technology Product Manufacturing", "Coal Mining",
  "Collection Agencies", "Commercial and Industrial Equipment Rental",
  "Commercial and Industrial Machinery Maintenance",
  "Commercial and Service Industry Machinery Manufacturing", "Commercial Real Estate",
  "Communications Equipment Manufacturing", "Community Development and Urban Planning",
  "Community Services", "Computer and Network Security", "Computer Games", "Computer Hardware",
  "Computer Hardware Manufacturing", "Computer Networking", "Computer Networking Products",
  "Computers and Electronics Manufacturing", "Conservation Programs", "Construction",
  "Construction Hardware Manufacturing", "Consumer Electronics", "Consumer Goods",
  "Consumer Goods Rental", "Consumer Services", "Correctional Institutions", "Cosmetics",
  "Cosmetology and Barber Schools", "Courts of Law", "Credit Intermediation",
  "Cutlery and Handtool Manufacturing", "Dairy", "Dairy Product Manufacturing", "Dance Companies",
  "Data Infrastructure and Analytics", "Data Security Software Products", "Defense & Space",
  "Defense and Space Manufacturing", "Dentists", "Design", "Design Services",
  "Desktop Computing Software Products", "Digital Accessibility Services", "Distilleries",
  "E-Learning", "E-Learning Providers", "Economic Programs", "Education",
  "Education Administration Programs", "Education Management",
  "Electric Lighting Equipment Manufacturing", "Electric Power Generation",
  "Electric Power Transmission, Control, and Distribution", "Electrical Equipment Manufacturing",
  "Electronic and Precision Equipment Maintenance", "Embedded Software Products",
  "Emergency and Relief Services", "Engineering Services",
  "Engines and Power Transmission Equipment Manufacturing", "Entertainment",
  "Entertainment Providers", "Environmental Quality Programs", "Environmental Services",
  "Equipment Rental Services", "Events Services", "Executive Offices", "Executive Search Services",
  "Fabricated Metal Products", "Facilities Services", "Family Planning Centers", "Farming",
  "Farming, Ranching, Forestry", "Fashion Accessories Manufacturing", "Financial Services",
  "Fine Art", "Fine Arts Schools", "Fire Protection", "Fisheries", "Flight Training",
  "Food & Beverages", "Food and Beverage Manufacturing", "Food and Beverage Retail",
  "Food and Beverage Services", "Food Production", "Footwear and Leather Goods Repair",
  "Footwear Manufacturing", "Forestry and Logging", "Fossil Fuel Electric Power Generation",
  "Freight and Package Transportation", "Fruit and Vegetable Preserves Manufacturing",
  "Fuel Cell Manufacturing", "Fundraising", "Funds and Trusts", "Furniture",
  "Furniture and Home Furnishings Manufacturing", "Gambling Facilities and Casinos",
  "Geothermal Electric Power Generation", "Glass Product Manufacturing",
  "Glass, Ceramics and Concrete Manufacturing", "Golf Courses and Country Clubs",
  "Government Administration", "Government Relations", "Government Relations Services",
  "Graphic Design", "Ground Passenger Transportation", "Health and Human Services",
  "Health, Wellness and Fitness", "Higher Education", "Highway, Street, and Bridge Construction",
  "Historical Sites", "Holding Companies", "Home Health Care Services", "Horticulture",
  "Hospitality", "Hospitals", "Hospitals and Health Care", "Hotels and Motels",
  "Household and Institutional Furniture Manufacturing", "Household Appliance Manufacturing",
  "Household Services", "Housing and Community Development", "Housing Programs", "Human Resources",
  "Human Resources Services", "HVAC and Refrigeration Equipment Manufacturing",
  "Hydroelectric Power Generation", "Import and Export", "Individual and Family Services",
  "Industrial Automation", "Industrial Machinery Manufacturing", "Industry Associations",
  "Information Services", "Information Technology and Services", "Insurance",
  "Insurance Agencies and Brokerages", "Insurance and Employee Benefit Funds",
  "Insurance Carriers", "Interior Design", "International Affairs",
  "International Trade and Development", "Internet Marketplace Platforms", "Internet News",
  "Internet Publishing", "Interurban and Rural Bus Services", "Investment Advice",
  "Investment Banking", "Investment Management", "IT Services and IT Consulting",
  "IT System Custom Software Development", "IT System Data Services", "IT System Design Services",
  "IT System Installation and Disposal", "IT System Operations and Maintenance",
  "IT System Testing and Evaluation", "IT System Training and Support", "Janitorial Services",
  "Landscaping Services", "Language Schools", "Laundry and Drycleaning Services",
  "Law Enforcement", "Law Practice", "Leasing Non-residential Real Estate",
  "Leasing Residential Real Estate", "Leather Product Manufacturing", "Legal Services",
  "Legislative Offices", "Leisure, Travel & Tourism", "Libraries",
  "Lime and Gypsum Products Manufacturing", "Loan Brokers", "Luxury Goods and Jewelry",
  "Machinery Manufacturing", "Magnetic and Optical Media Manufacturing", "Manufacturing",
  "Maritime", "Maritime Transportation", "Market Research", "Marketing Services",
  "Mattress and Blinds Manufacturing", "Measuring and Control Instrument Manufacturing",
  "Meat Products Manufacturing", "Mechanical or Industrial Engineering",
  "Media & Telecommunications", "Media Production", "Medical and Diagnostic Laboratories",
  "Medical Devices", "Medical Equipment Manufacturing", "Medical Practices", "Mental Health Care",
  "Metal Ore Mining", "Metal Treatments", "Metal Valve, Ball, and Roller Manufacturing",
  "Metalworking Machinery Manufacturing", "Military and International Affairs", "Mining",
  "Mobile Computing Software Products", "Mobile Food Services", "Mobile Gaming Apps",
  "Motor Vehicle Manufacturing", "Motor Vehicle Parts Manufacturing", "Movies and Sound Recording",
  "Movies, Videos and Sound", "Museums", "Museums, Historical Sites, and Zoos", "Music",
  "Musicians", "Nanotechnology Research", "Natural Gas Distribution", "Natural Gas Extraction",
  "Newspaper Publishing", "Non-profit Organization Management", "Non-profit Organizations",
  "Nonmetallic Mineral Mining", "Nonresidential Building Construction",
  "Nuclear Electric Power Generation", "Nursing Homes and Residential Care Facilities",
  "Office Administration", "Office Furniture and Fixtures Manufacturing",
  "Oil and Coal Product Manufacturing", "Oil and Gas", "Oil Extraction", "Oil, Gas, and Mining",
  "Online and Mail Order Retail", "Online Audio and Video Media", "Online Media",
  "Operations Consulting", "Optometrists", "Outpatient Care Centers",
  "Outsourcing and Offshoring Consulting", "Outsourcing/Offshoring", "Packaging and Containers",
  "Packaging and Containers Manufacturing", "Paint, Coating, and Adhesive Manufacturing",
  "Paper and Forest Product Manufacturing", "Paper and Forest Products", "Pension Funds",
  "Performing Arts", "Performing Arts and Spectator Sports", "Periodical Publishing",
  "Personal and Laundry Services", "Personal Care Product Manufacturing", "Personal Care Services",
  "Pet Services", "Pharmaceutical Manufacturing", "Philanthropic Fundraising Services",
  "Philanthropy", "Photography", "Physical, Occupational and Speech Therapists", "Physicians",
  "Pipeline Transportation", "Plastics and Rubber Product Manufacturing", "Plastics Manufacturing",
  "Political Organizations", "Postal Services", "Primary and Secondary Education",
  "Primary Metal Manufacturing", "Printing Services", "Professional Organizations",
  "Professional Services", "Professional Training and Coaching", "Program Development",
  "Public Assistance Programs", "Public Health", "Public Policy", "Public Policy Offices",
  "Public Relations and Communications Services", "Public Safety", "Racetracks",
  "Radio and Television Broadcasting", "Rail Transportation", "Railroad Equipment Manufacturing",
  "Ranching", "Ranching and Fisheries", "Real Estate", "Real Estate Agents and Brokers",
  "Real Estate and Equipment Rental Services", "Recreational Facilities", "Regenerative Design",
  "Religious Institutions", "Renewable Energy Equipment Manufacturing",
  "Renewable Energy Power Generation", "Renewable Energy Semiconductor Manufacturing",
  "Renewables & Environment", "Repair and Maintenance", "Research", "Research Services",
  "Residential Building Construction", "Restaurants", "Retail", "Retail Apparel and Fashion",
  "Retail Appliances, Electrical, and Electronic Equipment", "Retail Art Dealers",
  "Retail Art Supplies", "Retail Books and Printed News",
  "Retail Building Materials and Garden Equipment", "Retail Florists",
  "Retail Furniture and Home Furnishings", "Retail Gasoline", "Retail Groceries",
  "Retail Health and Personal Care Products", "Retail Luxury Goods and Jewelry",
  "Retail Motor Vehicles", "Retail Musical Instruments", "Retail Office Equipment",
  "Retail Office Supplies and Gifts", "Retail Pharmacies",
  "Retail Recyclable Materials & Used Merchandise", "Reupholstery and Furniture Repair",
  "Robot Manufacturing", "Robotics Engineering", "Rubber Products Manufacturing",
  "Satellite Telecommunications", "Savings Institutions", "School and Employee Bus Services",
  "Seafood Product Manufacturing", "Secretarial Schools", "Securities and Commodity Exchanges",
  "Security and Investigations", "Security Guards and Patrol Services",
  "Security Systems Services", "Semiconductor Manufacturing", "Semiconductors",
  "Services for Renewable Energy", "Services for the Elderly and Disabled",
  "Sheet Music Publishing", "Shipbuilding", "Shuttles and Special Needs Transportation Services",
  "Sightseeing Transportation", "Skiing Facilities", "Smart Meter Manufacturing",
  "Soap and Cleaning Product Manufacturing", "Social Networking Platforms", "Software Development",
  "Solar Electric Power Generation", "Sound Recording", "Space Research and Technology",
  "Specialty Trade Contractors", "Spectator Sports", "Sporting Goods",
  "Sporting Goods Manufacturing", "Sports and Recreation Instruction", "Sports Teams and Clubs",
  "Spring and Wire Product Manufacturing", "Staffing and Recruiting",
  "Steam and Air-Conditioning Supply", "Strategic Management Services", "Subdivision of Land",
  "Sugar and Confectionery Product Manufacturing", "Surveying and Mapping Services",
  "Taxi and Limousine Services", "Technical and Vocational Training",
  "Technology, Information and Internet", "Technology, Information and Media",
  "Telecommunications", "Telecommunications Carriers", "Telephone Call Centers",
  "Temporary Help Services", "Textile Manufacturing", "Theater Companies", "Think Tanks",
  "Tobacco", "Tobacco Manufacturing", "Translation and Localization",
  "Transportation Equipment Manufacturing", "Transportation Programs",
  "Transportation, Logistics, Supply Chain and Storage", "Transportation/Trucking/Railroad",
  "Travel Arrangements", "Truck Transportation", "Trusts and Estates",
  "Turned Products and Fastener Manufacturing", "Urban Transit Services", "Utilities",
  "Utilities Administration", "Utility System Construction", "Vehicle Repair and Maintenance",
  "Venture Capital and Private Equity Principals", "Veterinary", "Veterinary Services",
  "Vocational Rehabilitation Services", "Warehousing", "Warehousing and Storage",
  "Waste Collection", "Waste Treatment and Disposal", "Water Supply and Irrigation Systems",
  "Water, Waste, Steam, and Air Conditioning Services", "Wellness and Fitness Services",
  "Wholesale", "Wholesale Alcoholic Beverages", "Wholesale Apparel and Sewing Supplies",
  "Wholesale Appliances, Electrical, and Electronics", "Wholesale Building Materials",
  "Wholesale Chemical and Allied Products", "Wholesale Computer Equipment",
  "Wholesale Drugs and Sundries", "Wholesale Food and Beverage", "Wholesale Footwear",
  "Wholesale Furniture and Home Furnishings", "Wholesale Hardware, Plumbing, Heating Equipment",
  "Wholesale Import and Export", "Wholesale Luxury Goods and Jewelry", "Wholesale Machinery",
  "Wholesale Metals and Minerals", "Wholesale Motor Vehicles and Parts",
  "Wholesale Paper Products", "Wholesale Petroleum and Petroleum Products",
  "Wholesale Photography Equipment and Supplies", "Wholesale Raw Farm Products",
  "Wholesale Recyclable Materials", "Wind Electric Power Generation", "Wine and Spirits",
  "Wineries", "Wireless Services", "Women's Handbag Manufacturing", "Wood Product Manufacturing",
  "Writing and Editing", "Zoos and Botanical Gardens",
];
const COUNTRY_CODES = ["AT", "DE", "CH", "GB", "US", "NL", "FR", "IT", "ES"];

// Hunters Discover-Schema kennt "state" ausdruecklich NUR fuer country="US"
// (siehe https://hunter.io/api-documentation/v2#discover). Eine US-Stadt ohne
// Bundesstaat lehnt Hunter mit 400 ab -- in Hunters eigener Oberflaeche ist
// jede US-Stadt entsprechend voll qualifiziert ("New York, New York, United
// States"). Deshalb hier eine feste Auswahl statt Freitext: so kann gar kein
// ungueltiger Wert entstehen. Reihenfolge = Postal-Code-Alphabet, wie in
// US-Formularen ueblich.
const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];
const HEADCOUNTS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];

// Punkt 7 aus dem Differenzierungs-Plan: vorgefertigte Kombinationen aus
// Suchbegriff + Pain-Point-Filter (Punkt 3) fuer konkrete Nischen, damit man
// nicht bei jeder neuen Zielgruppe wieder bei null anfaengt. Query-Text bewusst
// nicht uebersetzt (wie INDUSTRIES oben), da das der tatsaechliche Google-Places-
// Suchbegriff ist, unabhaengig von der UI-Sprache.
type Playbook = {
  id: string;
  query: string;
  noWebsite: boolean;
  maxRating: number | "";
};
const PLAYBOOKS: Playbook[] = [
  { id: "restaurants_no_website", query: "Restaurant", noWebsite: true, maxRating: "" },
  { id: "handwerk_no_booking", query: "Handwerksbetrieb", noWebsite: true, maxRating: "" },
  { id: "local_low_rating", query: "Dienstleister", noWebsite: false, maxRating: 3.5 },
  { id: "friseure_no_website", query: "Friseursalon", noWebsite: true, maxRating: "" },
  { id: "zahnaerzte_low_rating", query: "Zahnarzt", noWebsite: false, maxRating: 4 },
];

// Eigene, benannte Suchvorlagen. Bewusst im localStorage statt in der
// Datenbank: es gibt keinen Bedarf, sie zwischen Geraeten zu teilen, und so
// bleibt die Aenderung ohne Migration und ohne zusaetzliche RLS-Regeln.
type Preset = {
  name: string;
  mode: "maps" | "corporate";
  query: string;
  location: string;
  radius: number;
  targetEmails: number;
  // Presets von vor der Ziel-E-Mail-Umstellung hatten stattdessen die rohe
  // Firmenzahl gespeichert -- applyPlaybook faellt beim Lesen darauf zurueck.
  maxResults?: number;
  noWebsite: boolean;
  maxRating: number | "";
  industry: string;
  city: string;
  // Optional, weil Vorlagen aus einer aelteren Version das Feld noch nicht
  // haben -- die liegen im localStorage und werden nicht migriert.
  state?: string;
  country: string;
  headcount: string;
  keywords: string;
};

const presetsKey = (workspaceId: string) => `fb_search_presets_${workspaceId}`;

// Gemessene Trefferquote fuer E-Mail-Funde ueber die KI-Websuche liegt laut
// worker/pipelines/get_businesses.py bei ca. 22%. Hier konservativ mit 20%
// gerechnet (eher zu viele als zu wenige Firmen durchsuchen), gedeckelt bei
// MAX_RAW_RESULTS -- dem Limit pro Suche.
const EMAIL_HIT_RATE = 0.2;
const MAX_RAW_RESULTS = 100;
function estimateRawResults(targetEmails: number): number {
  return Math.min(MAX_RAW_RESULTS, Math.ceil(targetEmails / EMAIL_HIT_RATE));
}

function loadPresets(workspaceId: string): Preset[] {
  try {
    const raw = localStorage.getItem(presetsKey(workspaceId));
    return raw ? (JSON.parse(raw) as Preset[]) : [];
  } catch {
    return [];
  }
}

const inputCls =
  "mt-1.5 rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink " +
  "placeholder-mute outline-none transition-colors focus:border-sky-500";
const labelCls = "flex flex-col text-sm font-medium text-soft";

export default function NewSearchForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const [mode, setMode] = useState<"maps" | "corporate">("maps");
  const [listName, setListName] = useState("");
  const [schedule, setSchedule] = useState("none");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [targetEmails, setTargetEmails] = useState(10);
  const [radius, setRadius] = useState(2000);
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [usState, setUsState] = useState("");
  const [country, setCountry] = useState("AT");
  const [headcount, setHeadcount] = useState("");
  const [keywords, setKeywords] = useState("");
  const [painPointNoWebsite, setPainPointNoWebsite] = useState(false);
  const [painPointMaxRating, setPainPointMaxRating] = useState<number | "">("");
  const [selectedPlaybook, setSelectedPlaybook] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => setPresets(loadPresets(workspaceId)), [workspaceId]);

  const activeFilterCount = (painPointNoWebsite ? 1 : 0) + (painPointMaxRating !== "" ? 1 : 0);
  const isUs = country === "US";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const SCHEDULE_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 };
    const days = SCHEDULE_DAYS[schedule];
    const nextRun = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    const base = {
      name: listName.trim() || null,
      schedule,
      next_run_at: nextRun,
    };
    const painPointFilters: Record<string, unknown> = {};
    if (painPointNoWebsite) painPointFilters.pain_point_no_website = true;
    if (painPointMaxRating !== "") painPointFilters.pain_point_max_rating = painPointMaxRating;

    const rawResults = estimateRawResults(targetEmails);
    const row: Record<string, unknown> =
      mode === "maps"
        ? {
            ...base,
            workspace_id: workspaceId, source: "maps", query, location,
            max_results: rawResults, target_email_count: targetEmails, radius_m: radius,
            ...(Object.keys(painPointFilters).length > 0 ? { filters: painPointFilters } : {}),
          }
        : {
            ...base,
            workspace_id: workspaceId, source: "corporate",
            query: [industry, keywords].filter(Boolean).join(" · ") || "Corporate-Suche",
            // state nur bei US ueberhaupt gesetzt, siehe US_STATES oben.
            location: [city, isUs ? usState : "", country].filter(Boolean).join(", "),
            max_results: rawResults, target_email_count: targetEmails,
            filters: {
              industry: industry || null,
              city: city || null,
              state: (isUs && usState) || null,
              country,
              headcount: headcount || null,
              keywords: keywords || null,
            },
          };
    const { error } = await createClient().from("searches").insert(row);
    setLoading(false);
    if (error) {
      // RLS blockiert den Insert bei abgelaufener Testphase/fehlendem Abo
      // (searches_owner_insert, Migration 0024) -- freundliche Meldung statt
      // des rohen Postgres-Fehlertexts.
      if (error.code === "42501") {
        push(t.newSearchForm.billingBlocked, "error");
      } else {
        push(error.message, "error");
      }
      return;
    }
    setQuery(""); setLocation(""); setKeywords(""); setCity(""); setUsState(""); setListName("");
    router.refresh();
  }

  function applyPlaybook(id: string) {
    setSelectedPlaybook(id);
    if (id.startsWith("own:")) {
      const preset = presets.find((p) => p.name === id.slice(4));
      if (!preset) return;
      setMode(preset.mode);
      setQuery(preset.query);
      setLocation(preset.location);
      setRadius(preset.radius);
      setTargetEmails(preset.targetEmails ?? preset.maxResults ?? 10);
      setPainPointNoWebsite(preset.noWebsite);
      setPainPointMaxRating(preset.maxRating);
      setIndustry(preset.industry);
      setCity(preset.city);
      setUsState(preset.state ?? "");
      setCountry(preset.country);
      setHeadcount(preset.headcount);
      setKeywords(preset.keywords);
      if (preset.noWebsite || preset.maxRating !== "") setAdvancedOpen(true);
      return;
    }
    const pb = PLAYBOOKS.find((p) => p.id === id);
    if (!pb) return;
    setMode("maps");
    setQuery(pb.query);
    setPainPointNoWebsite(pb.noWebsite);
    setPainPointMaxRating(pb.maxRating);
    // Sichtbar machen, was das Playbook still mitgesetzt hat.
    if (pb.noWebsite || pb.maxRating !== "") setAdvancedOpen(true);
  }

  function savePreset() {
    const name = prompt(t.newSearchForm.presetNamePrompt)?.trim();
    if (!name) return;
    const preset: Preset = {
      name, mode, query, location, radius, targetEmails,
      noWebsite: painPointNoWebsite, maxRating: painPointMaxRating,
      industry, city, state: usState, country, headcount, keywords,
    };
    const next = [...presets.filter((p) => p.name !== name), preset];
    localStorage.setItem(presetsKey(workspaceId), JSON.stringify(next));
    setPresets(next);
    setSelectedPlaybook("own:" + name);
    push(t.newSearchForm.presetSaved, "success");
  }

  function deleteSelectedPreset() {
    const name = selectedPlaybook.slice(4);
    const next = presets.filter((p) => p.name !== name);
    localStorage.setItem(presetsKey(workspaceId), JSON.stringify(next));
    setPresets(next);
    setSelectedPlaybook("");
    push(t.newSearchForm.presetDeleted, "success");
  }

  const tabCls = (active: boolean) =>
    "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors " +
    (active ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "text-faint hover:text-ink");

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls + " max-w-xs flex-1"}>
          {t.newSearchForm.playbookLabel}
          <select
            value={selectedPlaybook}
            onChange={(e) => applyPlaybook(e.target.value)}
            className={inputCls}
          >
            <option value="">{t.newSearchForm.playbookNone}</option>
            {presets.length > 0 && (
              <optgroup label={t.newSearchForm.presetGroupOwn}>
                {presets.map((p) => (
                  <option key={p.name} value={"own:" + p.name}>{p.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label={t.newSearchForm.presetGroupBuiltin}>
              {PLAYBOOKS.map((pb) => (
                <option key={pb.id} value={pb.id}>{t.newSearchForm.playbookLabels[pb.id] ?? pb.id}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <button
          type="button"
          onClick={savePreset}
          className="rounded-lg border border-edge2 px-3.5 py-2.5 text-sm text-soft transition-colors hover:border-edge3 hover:text-ink"
        >
          {t.newSearchForm.presetSave}
        </button>
        {selectedPlaybook.startsWith("own:") && (
          <button
            type="button"
            onClick={deleteSelectedPreset}
            className="rounded-lg border border-edge2 px-3.5 py-2.5 text-sm text-faint transition-colors hover:border-red-500/50 hover:text-red-600"
          >
            {t.newSearchForm.presetDelete}
          </button>
        )}
      </div>

      <div className="flex gap-1 rounded-lg border border-edge/60 bg-panel p-1 w-fit">
        <button type="button" className={tabCls(mode === "maps")} onClick={() => setMode("maps")}>
          {t.newSearchForm.tabMaps}
        </button>
        <button type="button" className={tabCls(mode === "corporate")} onClick={() => setMode("corporate")}>
          {t.newSearchForm.tabCorporate}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls + " min-w-52 flex-1"}>
          {t.newSearchForm.listName}
          <input placeholder={t.newSearchForm.listNamePlaceholder} value={listName}
            onChange={(e) => setListName(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          {t.newSearchForm.subscription}
          <select value={schedule} onChange={(e) => setSchedule(e.target.value)} className={inputCls + " w-44"}>
            <option value="none">{t.newSearchForm.subscriptionOnce}</option>
            <option value="daily">{t.newSearchForm.subscriptionDaily}</option>
            <option value="weekly">{t.newSearchForm.subscriptionWeekly}</option>
            <option value="biweekly">{t.newSearchForm.subscriptionBiweekly}</option>
          </select>
        </label>
      </div>
      {mode === "maps" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelCls + " lg:col-span-2"}>
            {t.newSearchForm.niche}
            <input required placeholder={t.newSearchForm.nichePlaceholder} value={query}
              onChange={(e) => setQuery(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls + " lg:col-span-2"}>
            {t.newSearchForm.location}
            <input required placeholder={t.newSearchForm.locationPlaceholder} value={location}
              onChange={(e) => setLocation(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.targetEmailCount}
            <input type="number" min={1} max={20} value={targetEmails}
              onChange={(e) => setTargetEmails(Number(e.target.value))} className={inputCls} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.radius}
            <input type="number" min={100} max={50000} step={100} value={radius}
              onChange={(e) => setRadius(Number(e.target.value))} className={inputCls} />
          </label>
          <p className="text-xs text-mute sm:col-span-2 lg:col-span-4">
            {t.newSearchForm.targetEmailCountHint(estimateRawResults(targetEmails))}
          </p>
        </div>
      ) : null}

      {/* Die Pain-Point-Filter standen bisher dauerhaft aufgeklappt zwischen
          Suchfeldern und Absenden-Knopf und machten die Maske dicht. Sie sind
          jetzt eingeklappt und oeffnen sich automatisch, sobald ein Filter
          gesetzt ist -- etwa durch ein Playbook. */}
      {mode === "maps" && (
        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-lg border border-edge/60 bg-surface/60"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-faint transition-colors hover:text-soft">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3m13.4-6.4-1.6 1.6M9.2 14.8l-1.6 1.6m10.8 0-1.6-1.6M9.2 9.2 7.6 7.6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            {t.newSearchForm.painPointHeading}
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">
                {activeFilterCount}
              </span>
            )}
          </summary>
          <div className="space-y-3 border-t border-edge/60 px-3.5 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-soft">
              <input
                type="checkbox"
                checked={painPointNoWebsite}
                onChange={(e) => setPainPointNoWebsite(e.target.checked)}
                className="h-4 w-4 rounded accent-sky-500"
              />
              {t.newSearchForm.painPointNoWebsite}
            </label>
            <label className="flex items-center gap-2 text-sm text-soft">
              <input
                type="checkbox"
                checked={painPointMaxRating !== ""}
                onChange={(e) => setPainPointMaxRating(e.target.checked ? 4 : "")}
                className="h-4 w-4 rounded accent-sky-500"
              />
              {t.newSearchForm.painPointMaxRating}
              {painPointMaxRating !== "" && (
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={0.5}
                  value={painPointMaxRating}
                  onChange={(e) => setPainPointMaxRating(Number(e.target.value))}
                  className={inputCls + " mt-0 w-20 py-1.5"}
                />
              )}
            </label>
          </div>
        </details>
      )}

      {mode === "maps" && <SubmitButton loading={loading} />}

      {mode === "corporate" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls + " min-w-44 flex-1"}>
            {t.newSearchForm.industry}
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputCls}>
              <option value="">{t.newSearchForm.allIndustries}</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
          <label className={labelCls}>
            {t.newSearchForm.city}
            {/* Vorschlagsliste statt <select>: Hunter veroeffentlicht keine
                Staedte-Liste (siehe lib/locations.ts), ein gesperrtes Dropdown
                wuerde also Gueltigkeit nur vortaeuschen und zugleich Staedte
                ausschliessen, die Hunter durchaus kennt. */}
            <input
              list="corporate-city-options"
              placeholder={t.newSearchForm.cityPlaceholder}
              value={city}
              onChange={(e) => {
                const next = e.target.value;
                setCity(next);
                // Der eigentliche Fehlerschutz: Hunter lehnt eine US-Stadt
                // ohne Bundesstaat ab, und genau diese Zuordnung tippt man
                // sich von Hand falsch. Bei bekannter Stadt automatisch
                // setzen -- unbekannte Stadt laesst die Auswahl unangetastet.
                if (country === "US") {
                  const match = usStateForCity(next);
                  if (match) setUsState(match);
                }
              }}
              className={inputCls + " w-40"}
            />
            <datalist id="corporate-city-options">
              {citySuggestionsFor(country).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className={labelCls}>
            {t.newSearchForm.country}
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                // Bundesstaat gehoert zu den USA -- beim Landwechsel zuruecksetzen,
                // damit nie ein unsichtbarer Wert mitgeschickt wird.
                if (e.target.value !== "US") setUsState("");
              }}
              className={inputCls + " w-36"}
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{t.newSearchForm.countryLabels[code] ?? code}</option>
              ))}
            </select>
          </label>
          {isUs && (
            <label className={labelCls}>
              {t.newSearchForm.usState}
              <select value={usState} onChange={(e) => setUsState(e.target.value)} className={inputCls + " w-44"}>
                <option value="">{t.newSearchForm.allUsStates}</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className={labelCls}>
            {t.newSearchForm.headcount}
            <select value={headcount} onChange={(e) => setHeadcount(e.target.value)} className={inputCls + " w-32"}>
              <option value="">{t.newSearchForm.allHeadcounts}</option>
              {HEADCOUNTS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className={labelCls + " flex-1"}>
            {t.newSearchForm.keywords}
            <input placeholder={t.newSearchForm.keywordsPlaceholder} value={keywords}
              onChange={(e) => setKeywords(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.targetEmailCount}
            <input type="number" min={1} max={20} value={targetEmails}
              onChange={(e) => setTargetEmails(Number(e.target.value))} className={inputCls + " w-24"} />
          </label>
          <SubmitButton loading={loading} />
        </div>
      ) : null}
      {mode === "corporate" && (
        <p className="text-xs text-mute">
          {t.newSearchForm.corporateHint} {t.newSearchForm.targetEmailCountHint(estimateRawResults(targetEmails))}
        </p>
      )}
    </form>
  );

  function SubmitButton({ loading }: { loading: boolean }) {
    return (
      <button
        disabled={loading}
        className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-surface shadow-sm transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? t.newSearchForm.starting : t.newSearchForm.start}
      </button>
    );
  }
}
