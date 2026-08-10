"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { citySuggestionsFor, usStateForCity } from "@/lib/locations";
import ProspeoFilterForm from "./prospeo-filters";
import { hasAnyProspeoFilter, type ProspeoFilters } from "@/lib/prospeo-query";
import { resolveTechnologies, technologiesFor, type TechGroup } from "@/lib/technologies";
import { missingProviders } from "@/lib/search-requirements";
import {
  APOLLO_COUNTRY_NAMES,
  APOLLO_DEFAULT_SENIORITIES,
  APOLLO_EMPLOYEE_RANGES,
  APOLLO_MARKET_SEGMENTS,
  APOLLO_SENIORITIES,
  hasAnyApolloFilter,
  type ApolloFilters,
} from "@/lib/apollo-query";
import { searchRowToPresetConfig, type PresetConfig, type SearchMode } from "@/lib/search-presets";
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

// Eigene, benannte Suchvorlagen.
//
// Seit Migration 0085 in der Datenbank (search_presets). Vorher lagen sie im
// localStorage, mit der Begruendung "es gibt keinen Bedarf, sie zwischen
// Geraeten zu teilen". Das hat sich als falsch erwiesen: ein Kunde legte eine
// Vorlage an und fand sie nicht wieder -- sie hing an seinem Browserprofil und
// war damit an jedem anderen Rechner unsichtbar, ohne dass irgendetwas kaputt
// gewesen waere. Seit 0081 arbeiten ausserdem mehrere Personen in einem
// Workspace, und eine Vorlage, die nur ihr Urheber sieht, hilft einem Team
// nicht.
// SearchMode und das Vorlagenformat stehen seit dem 2026-08-10 in
// lib/search-presets.ts: seitdem entsteht eine Vorlage auch auf der
// Suchdetailseite, und zwei Definitionen desselben Formats waeren genau die
// Abweichung, die man erst bemerkt, wenn eine Vorlage halb geladen wird.

/** Anbietername, wie ihn der Nutzer in den Einstellungen sieht -- 'google_maps'
 *  als roher Provider-Schluessel waere in einer Fehlermeldung unbrauchbar. */
const PROVIDER_LABELS: Record<string, string> = {
  google_maps: "Google Maps",
  apollo: "Apollo",
  prospeo: "Prospeo",
  hunter: "Hunter",
  openai: "OpenAI",
};

/** Die gespeicherte Vorlage: der Inhalt von config plus die beiden Spalten
 *  daneben. id fehlt nur bei Vorlagen, die noch nicht aus der Datenbank kamen. */
type Preset = PresetConfig & { id?: string; name: string };

/** Der alte Ablageort. Wird nur noch EINMAL gelesen, um zu uebernehmen, was
 *  dort noch liegt -- siehe adoptLocalPresets(). */
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

// Mehrere Suchbegriffe/Orte auf einmal: eine einzelne Google-Places-Abfrage
// schoepft sich pro Ort/Nische typischerweise nach ~60-120 Treffern aus --
// mehr rohe Leads gibt's danach nur ueber zusaetzliche, andere Kombinationen
// (Nachbarbezirk, Synonym-Begriff), nicht ueber einen hoeheren Deckel.
// Kommagetrennte Eingabe in beiden Feldern ergibt das Kreuzprodukt; Dedupe
// (place_id pro Workspace) verhindert Dopplungen zwischen den Teilsuchen
// automatisch, siehe worker/pipelines/get_businesses.py.
const MAX_FANOUT = 20;
function parseList(value: string): string[] {
  return Array.from(new Set(value.split(",").map((v) => v.trim()).filter(Boolean)));
}

// Apollo-Modus. Anders als bei Maps/Corporate gibt es hier keine
// Trefferquoten-Rechnung: Apollos People-Search wird per
// contact_email_status=verified gefiltert und liefert damit ausschliesslich
// Personen mit vorliegender E-Mail (siehe worker/pipelines/apollo.py). Die
// gewuenschte Zahl IST also die Zahl der Leads, nicht eine Hoffnung darauf.
// 1000 = 10 Apollo-Seiten a 100 Treffern, muss zu APOLLO_MAX_PER_SEARCH im
// Worker passen; das Tageskontingent (5000/Workspace) prueft der Worker.
const APOLLO_MAX_TARGET = 1000;
// Bewusst klein voreingestellt: bei Apollo entspricht jeder gelieferte Lead
// einem Credit (die Suche selbst ist gratis, das Anreichern nicht). Eine
// versehentlich abgeschickte Standardsuche soll deshalb ein paar Cent kosten
// und nicht ein paar hundert. Wer mehr will, tippt die Zahl bewusst hoch.
const APOLLO_DEFAULT_TARGET = 5;

// APOLLO_COUNTRY_NAMES steht jetzt in lib/apollo-query.ts (oben importiert):
// die Gegenrichtung Name -> Code wird beim Erzeugen einer Vorlage aus einer
// gelaufenen Suche gebraucht, und beide Richtungen muessen zwingend dieselbe
// Zuordnung benutzen.

// Vorbelegung mit den ueblichen Entscheider-Titeln im DACH- und US-Raum. Frei
// editierbar -- die Senioritaets-Einschraenkung greift zusaetzlich,
// unabhaengig davon, was hier steht.
const APOLLO_DEFAULT_TITLES =
  "Founder, Owner, CEO, Geschäftsführer, Managing Director, Head of Marketing, Marketing Director, E-Commerce Manager";

// Zum Anklicken statt Abtippen. person_titles ist bei Apollo bewusst Freitext
// (unscharfer Abgleich), ein gesperrtes Dropdown waere hier also falsch -- ein
// Tippfehler kostet aber trotzdem eine halbe Suche, deshalb die Vorschlaege.
const APOLLO_TITLE_SUGGESTIONS = [
  "Founder", "Owner", "CEO", "Geschäftsführer", "Managing Director", "CMO", "COO",
  "Head of Marketing", "Marketing Director", "Marketing Manager",
  "E-Commerce Manager", "Head of E-Commerce", "Head of Growth", "Head of Sales",
];

// APOLLO_SENIORITIES, APOLLO_DEFAULT_SENIORITIES und APOLLO_EMPLOYEE_RANGES
// stehen jetzt in lib/apollo-query.ts (oben importiert): der Trefferzaehler
// braucht dieselben Werte, und eine zweite Kopie hier waere genau die stille
// Abweichung, an der die Suche schon einmal gescheitert ist. Beide muessen
// weiterhin mit worker/pipelines/apollo.py uebereinstimmen -- ein Wert
// ausserhalb der Liste ist bei Apollo eine ungueltige Anfrage.

// Branchen laufen bei Apollo NICHT ueber unsere Industry-Liste: Apollos
// Industry-Filter arbeitet intern mit Mongo-IDs
// (organization_industry_tag_ids), die nicht oeffentlich abrufbar sind. Apollos
// eigene Such-URL nutzt stattdessen qOrganizationKeywordTags -- also einfache
// Strings, genau das Feld, das wir schon fuellen. Diese Vorschlaege sind
// Apollos eigene Schreibweise (klein).
const APOLLO_KEYWORD_SUGGESTIONS = [
  "ecommerce", "supplements", "nutrition", "health & wellness", "cosmetics",
  "retail", "computer software", "information technology & services", "internet",
  "marketing & advertising", "construction", "real estate", "financial services",
];

/**
 * Was im Browser dieses Geraets noch liegt, in die Datenbank heben.
 *
 * Ohne diesen Schritt waere die Umstellung fuer jeden, der schon Vorlagen
 * hatte, ein Datenverlust -- und zwar ein stiller: die Liste waere danach
 * einfach leer. Es laeuft genau einmal je Geraet, weil der Schluessel danach
 * entfernt wird.
 *
 * onConflict: eine gleichnamige Vorlage in der Datenbank gewinnt. Wer auf zwei
 * Rechnern arbeitet, hat dort moeglicherweise die neuere Fassung; die durch
 * eine alte lokale Kopie zu ersetzen waere schlimmer als sie stehen zu lassen.
 *
 * Der localStorage-Eintrag wird erst nach erfolgreichem Schreiben entfernt.
 * Andersherum waere ein Fehlschlag genau der Datenverlust, den die Funktion
 * verhindern soll.
 */
async function adoptLocalPresets(supabase: SupabaseClient, workspaceId: string): Promise<boolean> {
  let local: Preset[] = [];
  try {
    const raw = localStorage.getItem(presetsKey(workspaceId));
    if (!raw) return false;
    local = JSON.parse(raw) as Preset[];
  } catch {
    // Unlesbarer Eintrag: nichts zu retten, aber auch nichts kaputtzumachen.
    localStorage.removeItem(presetsKey(workspaceId));
    return false;
  }
  if (!Array.isArray(local) || local.length === 0) {
    localStorage.removeItem(presetsKey(workspaceId));
    return false;
  }

  // Vorhandene Namen abfragen und lokal filtern, statt upsert mit onConflict:
  // der Eindeutigkeitsindex steht auf lower(trim(name)), also einem Ausdruck,
  // und PostgREST kann in on_conflict nur Spalten benennen. Ein upsert waere
  // hier stumm an einem Detail des Index gescheitert.
  const { data: existing } = await supabase
    .from("search_presets")
    .select("name")
    .eq("workspace_id", workspaceId);
  const taken = new Set((existing ?? []).map((r) => r.name.trim().toLowerCase()));

  const rows = local
    .filter((p) => p?.name?.trim() && !taken.has(p.name.trim().toLowerCase()))
    .map(({ name, ...config }) => ({ workspace_id: workspaceId, name: name.trim(), config }));

  if (rows.length > 0) {
    const { error } = await supabase.from("search_presets").insert(rows);
    if (error) return false;
  }
  localStorage.removeItem(presetsKey(workspaceId));
  return rows.length > 0;
}

const inputCls =
  "mt-1.5 rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink " +
  "placeholder-mute outline-none transition-colors focus:border-sky-500";
const labelCls = "flex flex-col text-sm font-medium text-soft";

const chipCls = (active: boolean) =>
  "rounded-lg border px-2 py-0.5 text-[11px] transition-colors " +
  (active
    ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
    : "border-edge2 text-faint hover:border-edge3 hover:text-ink");

/* Bewusst auf Modulebene und NICHT innerhalb von NewSearchForm definiert: eine
   im Rumpf der Elternkomponente deklarierte Funktion ist bei jedem Render ein
   neuer Komponententyp. React haengt den Teilbaum dann jedes Mal ab und neu an
   -- das <details> klappte dadurch sofort wieder zu, und die 42 Knoepfe wuerden
   bei jedem Tastendruck in einem beliebigen Feld neu aufgebaut.

   Eingeklappt wie die Pain-Point-Filter: so viele Auswahlknoepfe wuerden die
   Maske sonst erschlagen. Angeboten wird nur, was der jeweilige Anbieter kennt
   (technologiesFor) -- ein waehlbarer, aber wirkungsloser Filter waere
   schlimmer als gar keiner. */
function TechnologyPicker({
  provider,
  selected,
  onToggleTech,
  open,
  onOpenChange,
}: {
  provider: "apollo" | "hunter";
  selected: string[];
  onToggleTech: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT();
  const available = technologiesFor(provider);
  // "sales" steht bewusst zuletzt: es ist die schmalste Gruppe und die
  // speziellste Zielgruppe (Firmen, die selbst Outbound betreiben). Leere
  // Gruppen werden unten uebersprungen -- bei Hunter sind von den
  // Vertriebs-Tools nur zwei ueberhaupt bekannt.
  const groups: { key: TechGroup; label: string }[] = [
    { key: "shop", label: t.newSearchForm.techGroupShop },
    { key: "tools", label: t.newSearchForm.techGroupTools },
    { key: "sales", label: t.newSearchForm.techGroupSales },
  ];
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-lg border border-edge/60 bg-surface/60"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-faint transition-colors hover:text-soft">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
          <path
            d="M9 18l-5-6 5-6m6 12l5-6-5-6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t.newSearchForm.techHeading}
        {selected.length > 0 && (
          <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">
            {selected.length}
          </span>
        )}
      </summary>
      <div className="space-y-3 border-t border-edge/60 px-3.5 py-3">
        {groups.map((group) => {
          const items = available.filter((tech) => tech.group === group.key);
          // Eine Ueberschrift ohne Kacheln darunter waere eine leere
          // Versprechung -- bei Hunter kennt der Katalog z.B. die meisten
          // Vertriebs-Tools gar nicht.
          if (items.length === 0) return null;
          return (
          <div key={group.key}>
            <span className="text-xs font-medium text-faint">{group.label}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {items
                .map((tech) => {
                  const active = selected.includes(tech.id);
                  return (
                    <button
                      key={tech.id}
                      type="button"
                      onClick={() => onToggleTech(tech.id)}
                      className={chipCls(active)}
                    >
                      {active ? "✓ " : "+ "}
                      {tech.label}
                    </button>
                  );
                })}
            </div>
          </div>
          );
        })}
        <p className="text-xs text-mute">
          {provider === "apollo" ? t.newSearchForm.techHintApollo : t.newSearchForm.techHintHunter}
        </p>
      </div>
    </details>
  );
}

export default function NewSearchForm({
  workspaceId,
  apiKeyProviders = [],
}: {
  workspaceId: string;
  /** Hinterlegte Provider dieses Workspaces, fuer die Vorpruefung. Kommt vom
   *  Dashboard, das die Liste ohnehin schon fuer die Onboarding-Checkliste
   *  laedt -- keine zweite Abfrage. */
  apiKeyProviders?: string[];
}) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const [mode, setMode] = useState<SearchMode>("maps");
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
  const [personTitles, setPersonTitles] = useState(APOLLO_DEFAULT_TITLES);
  const [apolloCountries, setApolloCountries] = useState<string[]>(["AT", "DE"]);
  const [apolloTarget, setApolloTarget] = useState(APOLLO_DEFAULT_TARGET);
  const [apolloSeniorities, setApolloSeniorities] = useState<string[]>(APOLLO_DEFAULT_SENIORITIES);
  // Interne IDs aus lib/technologies.ts, erst beim Absenden in die Slugs des
  // jeweiligen Anbieters uebersetzt.
  const [technologies, setTechnologies] = useState<string[]>([]);
  // Apollos "Market Segments". Leer als Vorgabe: anders als bei den
  // Senioritaeten gibt es hier keine sinnvolle Vorauswahl -- jedes Segment
  // schneidet hart, und wer nichts anhakt, will alle.
  const [marketSegments, setMarketSegments] = useState<string[]>([]);
  /**
   * Prospeos Filter liegen als EIN Objekt, nicht als ein Dutzend Einzel-
   * Zustaende wie bei Apollo: es sind mehr als doppelt so viele Felder, und
   * genau dieses Objekt wandert unveraendert in searches.filters. So ist
   * ausgeschlossen, dass der Trefferzaehler etwas anderes zaehlt als die
   * Suche spaeter sucht.
   */
  const [prospeoFilters, setProspeoFilters] = useState<ProspeoFilters>({});
  const [apolloCount, setApolloCount] = useState<
    { state: "idle" | "loading" } | { state: "ok"; total: number } | { state: "error"; reason: string }
  >({ state: "idle" });
  const [techOpen, setTechOpen] = useState(false);
  const [painPointNoWebsite, setPainPointNoWebsite] = useState(false);
  const [painPointMaxRating, setPainPointMaxRating] = useState<number | "">("");
  const [selectedPlaybook, setSelectedPlaybook] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);

  /**
   * Vorlagen laden. Vorher einmal einsammeln, was auf diesem Geraet noch im
   * localStorage liegt -- sonst waere die Umstellung fuer jeden mit
   * bestehenden Vorlagen ein stiller Datenverlust.
   */
  const loadPresets = useCallback(async () => {
    if (!workspaceId) return;
    const supabase = createClient();
    await adoptLocalPresets(supabase, workspaceId);
    const { data } = await supabase
      .from("search_presets")
      .select("id, name, config")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    setPresets(
      (data ?? []).map((row) => ({
        ...(row.config as Omit<Preset, "name" | "id">),
        id: row.id,
        name: row.name,
      }))
    );
  }, [workspaceId]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  // Genau das Objekt, das beim Absenden in searches.filters landet. Der
  // Trefferzaehler schickt dieses Objekt -- so zaehlt er zwangslaeufig
  // dieselbe Anfrage, die der Worker spaeter stellt. Wuerde die Vorschau ihre
  // Filter selbst zusammenbauen, koennten beide auseinanderlaufen und die
  // angezeigte Zahl waere eine Zusage, die die Suche nicht einloest.
  const apolloFilters: ApolloFilters = useMemo(() => {
    const apolloTech = resolveTechnologies(technologies, "apollo");
    return {
      person_titles: personTitles.trim() || null,
      apollo_locations: apolloCountries.map((c) => APOLLO_COUNTRY_NAMES[c]).filter(Boolean),
      apollo_seniorities: apolloSeniorities,
      headcount: headcount || null,
      keywords: keywords || null,
      // Nur setzen, wenn etwas gewaehlt ist: ein leeres Array wuerde die
      // Filter-Gleichheitspruefung in matching_prior_search_ids gegen aeltere
      // Suchen unnoetig scheitern lassen.
      ...(apolloTech.length > 0 ? { technologies: apolloTech } : {}),
      ...(marketSegments.length > 0 ? { market_segments: marketSegments } : {}),
    };
  }, [personTitles, apolloCountries, apolloSeniorities, headcount, keywords, technologies, marketSegments]);

  // Trefferzahl vor dem Absenden. Der Aufruf kostet keine Credits (nur das
  // Anreichern kostet, und das passiert hier nicht), darf also bei jeder
  // Aenderung laufen. Entprellt, damit Tippen im Keyword-Feld nicht pro
  // Anschlag eine Anfrage ausloest und in Apollos Rate Limit laeuft.
  useEffect(() => {
    if (mode !== "apollo" || !hasAnyApolloFilter(apolloFilters)) {
      setApolloCount({ state: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setApolloCount({ state: "loading" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/apollo/count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(apolloFilters),
          signal: ctrl.signal,
        });
        const body = await res.json();
        setApolloCount(
          body?.ok
            ? { state: "ok", total: body.total as number }
            : { state: "error", reason: String(body?.reason ?? "failed") }
        );
      } catch {
        // Ein Abbruch durch die naechste Eingabe ist kein Fehler -- sonst
        // blitzte beim Tippen dauernd eine Fehlermeldung auf.
        if (!ctrl.signal.aborted) setApolloCount({ state: "error", reason: "unreachable" });
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [mode, apolloFilters]);

  function toggleTechnology(id: string) {
    setTechnologies((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  const activeFilterCount = (painPointNoWebsite ? 1 : 0) + (painPointMaxRating !== "" ? 1 : 0);
  const isUs = country === "US";
  const queryList = parseList(query);
  const locationList = parseList(location);
  const fanoutCount = mode === "maps" ? Math.max(1, queryList.length * locationList.length) : 1;

  // Vorpruefung: welche Keys fehlen fuer genau diesen Suchweg? Wird sowohl
  // oben im Formular angezeigt (damit man es sieht, BEVOR man alles ausfuellt)
  // als auch beim Absenden geprueft. Ohne das reihte die App Jobs ein, die
  // nie funktionieren konnten -- in den Logs standen dreiundzwanzig solche
  // Fehlschlaege ueber acht Tage.
  const missingKeys = missingProviders(mode, apiKeyProviders);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (missingKeys.length > 0) {
      push(t.newSearchForm.missingKeysError(missingKeys.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")), "error");
      return;
    }
    const painPointFilters: Record<string, unknown> = {};
    if (painPointNoWebsite) painPointFilters.pain_point_no_website = true;
    if (painPointMaxRating !== "") painPointFilters.pain_point_max_rating = painPointMaxRating;
    const rawResults = estimateRawResults(targetEmails);

    let rows: Record<string, unknown>[];
    if (mode === "maps") {
      if (fanoutCount > MAX_FANOUT) {
        push(t.newSearchForm.fanoutTooMany(MAX_FANOUT), "error");
        return;
      }
      if (fanoutCount > 1 && !confirm(t.newSearchForm.fanoutConfirm(fanoutCount, rawResults))) {
        return;
      }
      rows = queryList.flatMap((q) =>
        locationList.map((loc) => ({
          name: listName.trim() || null,
          schedule,
          workspace_id: workspaceId, source: "maps", query: q, location: loc,
          max_results: rawResults, target_email_count: targetEmails, radius_m: radius,
          ...(Object.keys(painPointFilters).length > 0 ? { filters: painPointFilters } : {}),
        }))
      );
    } else if (mode === "apollo") {
      const titleList = parseList(personTitles);
      if (!hasAnyApolloFilter(apolloFilters)) {
        push(t.newSearchForm.apolloNeedsFilter, "error");
        return;
      }
      rows = [
        {
          name: listName.trim() || null,
          schedule,
          workspace_id: workspaceId, source: "apollo",
          query: [keywords, titleList[0]].filter(Boolean).join(" · ") || "Apollo-Suche",
          location: (apolloFilters.apollo_locations ?? []).join(", "),
          // Kein Trefferquoten-Aufschlag: bei Apollo ist die angefragte Zahl
          // die Zahl der Leads mit E-Mail (contact_email_status=verified).
          max_results: apolloTarget, target_email_count: apolloTarget,
          // Dasselbe Objekt, das der Trefferzaehler gezaehlt hat -- die
          // angezeigte Zahl gilt damit fuer genau diese Suche.
          filters: apolloFilters,
        },
      ];
    } else if (mode === "prospeo") {
      if (!hasAnyProspeoFilter(prospeoFilters)) {
        push(t.prospeo.needsFilter, "error");
        return;
      }
      rows = [
        {
          name: listName.trim() || null,
          schedule,
          workspace_id: workspaceId, source: "prospeo",
          // Ein sprechender Titel aus dem, was den Filter ausmacht. Bewusst
          // die Stellenausschreibung zuerst: wenn sie gesetzt ist, ist sie der
          // Grund fuer die Suche.
          query:
            [
              prospeoFilters.hiring_for,
              (prospeoFilters.technologies ?? []).join("/"),
              prospeoFilters.keywords,
              prospeoFilters.person_titles,
            ]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 120) || "Prospeo-Suche",
          location: (prospeoFilters.company_locations ?? []).join(", "),
          // Kein Trefferquoten-Aufschlag: wie bei Apollo ist die angefragte
          // Zahl die Zahl der Leads MIT verifizierter Adresse -- die Pipeline
          // reichert nur mit only_verified_email an.
          max_results: apolloTarget, target_email_count: apolloTarget,
          // Genau das Objekt, das der Trefferzaehler gezaehlt hat.
          filters: prospeoFilters,
        },
      ];
    } else {
      const hunterTech = resolveTechnologies(technologies, "hunter");
      rows = [
        {
          name: listName.trim() || null,
          schedule,
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
            // Siehe Apollo-Zweig: leeres Array wuerde den Discover-Offset-
            // Abgleich gegen aeltere Suchen brechen.
            ...(hunterTech.length > 0 ? { technologies: hunterTech } : {}),
          },
        },
      ];
    }
    const SCHEDULE_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 };
    const days = SCHEDULE_DAYS[schedule];
    const nextRun = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    rows = rows.map((r) => ({ ...r, next_run_at: nextRun }));

    setLoading(true);
    const { error } = await createClient().from("searches").insert(rows);
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

  /**
   * Ein gespeichertes Konfigurat ins Formular uebernehmen.
   *
   * Herausgezogen aus applyPlaybook, weil es seit dem 2026-08-10 einen zweiten
   * Weg hierher gibt: "Suche wiederholen" auf der Suchdetailseite belegt das
   * Formular aus einer bereits gelaufenen Suche vor (siehe useEffect unten).
   * Beide Wege muessen dieselben Felder setzen -- ein vergessener Setter waere
   * ein Filter, den der Nutzer zu sehen glaubt und der nicht gilt.
   */
  const applyPresetConfig = useCallback((preset: PresetConfig) => {
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
    setPersonTitles(preset.personTitles ?? APOLLO_DEFAULT_TITLES);
    setApolloCountries(preset.apolloCountries ?? ["AT", "DE"]);
    setApolloSeniorities(preset.apolloSeniorities ?? APOLLO_DEFAULT_SENIORITIES);
    setHeadcount(preset.headcount);
    setKeywords(preset.keywords);
    const techIds = preset.technologies ?? [];
    setTechnologies(techIds);
    setMarketSegments(preset.marketSegments ?? []);
    // Leeres Objekt statt gar nichts: eine Vorlage von vor dem 2026-08-10 hat
    // kein prospeoFilters, und die Filter der zuvor angesehenen Vorlage
    // stehenzulassen waere schlimmer als ein leeres Formular -- der Nutzer
    // wuerde mit Filtern suchen, die er in dieser Vorlage nie gesehen hat.
    setProspeoFilters(preset.prospeoFilters ?? {});
    // Sichtbar machen, was die Vorlage still mitgesetzt hat -- beide Bloecke
    // sind sonst zugeklappt.
    if (preset.noWebsite || preset.maxRating !== "") setAdvancedOpen(true);
    if (techIds.length > 0) setTechOpen(true);
  }, []);

  /**
   * "Suche wiederholen": /?wiederholen=<such-id>
   *
   * Die Suchdetailseite schickt hierher, wenn jemand eine gelaufene Suche noch
   * einmal starten will. Die Filter kommen aus der Suche selbst, nicht aus
   * einer Vorlage -- man muss also nichts gespeichert haben, um zu wiederholen.
   *
   * Der Riegel ueber useRef ist der Punkt, an dem es sonst teuer wird: der
   * Effekt haengt an Werten, die sich bei jedem Rendern neu ergeben koennen,
   * und ohne ihn liefe die Abfrage in einer Schleife. Einmal je ID genuegt.
   */
  const wiederholenId = useSearchParams().get("wiederholen");
  const wiederholtFuer = useRef<string | null>(null);
  useEffect(() => {
    if (!wiederholenId || !workspaceId || wiederholtFuer.current === wiederholenId) return;
    wiederholtFuer.current = wiederholenId;
    void (async () => {
      const { data } = await createClient()
        .from("searches")
        .select("source, query, location, radius_m, max_results, target_email_count, filters")
        .eq("id", wiederholenId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!data) return;
      applyPresetConfig(searchRowToPresetConfig(data));
      setSelectedPlaybook("");
      // Ohne diese Zeile fuellt sich ein Formular weiter unten auf der Seite,
      // und der Nutzer landet nach dem Klick auf einem Dashboard, das
      // unveraendert aussieht.
      document.getElementById("neue-suche")?.scrollIntoView({ behavior: "smooth", block: "start" });
    })();
  }, [wiederholenId, workspaceId, applyPresetConfig]);

  function applyPlaybook(id: string) {
    setSelectedPlaybook(id);
    if (id.startsWith("own:")) {
      const preset = presets.find((p) => p.name === id.slice(4));
      if (!preset) return;
      applyPresetConfig(preset);
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

  async function savePreset() {
    const name = prompt(t.newSearchForm.presetNamePrompt)?.trim();
    if (!name) return;
    const config: PresetConfig = {
      mode, query, location, radius, targetEmails,
      noWebsite: painPointNoWebsite, maxRating: painPointMaxRating,
      industry, city, state: usState, country, headcount, keywords,
      personTitles, apolloCountries, apolloSeniorities, technologies, marketSegments,
      // Bis zum 2026-08-10 fehlte diese Zeile. Eine Prospeo-Vorlage speicherte
      // damit den Modus und sonst nichts -- beim Laden stand das Formular im
      // richtigen Reiter mit leeren Filtern da, ohne jeden Hinweis darauf, dass
      // etwas fehlt. Prospeo hat die meisten Filter von allen vier Wegen; es
      // war ausgerechnet der Weg, bei dem sich das Merken am meisten lohnt.
      prospeoFilters,
    };
    const supabase = createClient();
    // Gleicher Name = ueberschreiben, wie bisher. Der Abgleich passiert hier
    // und nicht per ilike in der Abfrage: ein Name wie "50% mehr" enthaelt
    // Platzhalterzeichen und wuerde dort die falsche Zeile treffen.
    const existing = presets.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());

    const { error } = existing?.id
      ? await supabase
          .from("search_presets")
          .update({ config, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase.from("search_presets").insert({ workspace_id: workspaceId, name, config });

    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    await loadPresets();
    setSelectedPlaybook("own:" + name);
    push(t.newSearchForm.presetSaved, "success");
  }

  async function deleteSelectedPreset() {
    const name = selectedPlaybook.slice(4);
    const target = presets.find((p) => p.name === name);
    if (!target?.id) return;
    const { error } = await createClient()
      .from("search_presets")
      .delete()
      .eq("id", target.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    await loadPresets();
    setSelectedPlaybook("");
    push(t.newSearchForm.presetDeleted, "success");
  }

  const tabCls = (active: boolean) =>
    "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors " +
    (active ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "text-faint hover:text-ink");

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Ganz oben, noch vor der ersten Eingabe: wer den noetigen Schluessel
          nicht hinterlegt hat, soll das erfahren, bevor er ein Formular
          ausfuellt -- und nicht erst, wenn die Suche stumm im Nichts landet.
          Der Hinweis wechselt mit dem Suchweg, weil jeder Weg andere
          Anbieter braucht (siehe lib/search-requirements.ts). */}
      {missingKeys.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {t.newSearchForm.missingKeysTitle(
              missingKeys.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-soft">
            {t.newSearchForm.missingKeysBody}{" "}
            <Link href="/settings" className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
              {t.newSearchForm.missingKeysCta}
            </Link>
          </p>
        </div>
      )}
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
        <button type="button" className={tabCls(mode === "apollo")} onClick={() => setMode("apollo")}>
          {t.newSearchForm.tabApollo}
        </button>
        <button type="button" className={tabCls(mode === "prospeo")} onClick={() => setMode("prospeo")}>
          {t.prospeo.modeLabel}
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
            {fanoutCount > 1
              ? t.newSearchForm.fanoutHint(fanoutCount, estimateRawResults(targetEmails))
              : t.newSearchForm.targetEmailCountHint(estimateRawResults(targetEmails))}
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
        <TechnologyPicker
          provider="hunter"
          selected={technologies}
          onToggleTech={toggleTechnology}
          open={techOpen}
          onOpenChange={setTechOpen}
        />
      )}
      {mode === "corporate" && (
        <p className="text-xs text-mute">
          {t.newSearchForm.corporateHint} {t.newSearchForm.targetEmailCountHint(estimateRawResults(targetEmails))}
        </p>
      )}

      {mode === "prospeo" && (
        <>
          <p className="max-w-3xl text-sm leading-relaxed text-faint">{t.prospeo.modeHint}</p>
          <ProspeoFilterForm value={prospeoFilters} onChange={setProspeoFilters} />

          {/* Zielmenge und Absenden.
              apolloTarget wird bewusst mitbenutzt und nicht verdoppelt: es ist
              in beiden Personen-Wegen dieselbe Groesse -- "so viele Leads MIT
              verifizierter Adresse" -- und ein zweiter Zustand daneben waere
              nur eine Stelle mehr, an der ein Standardwert auseinanderlaeuft.
              Die Beschriftung nennt Prospeo, damit im Formular niemand ueber
              den Apollo-Namen stolpert. */}
          <div className="flex flex-wrap items-end gap-3">
            <label className={labelCls}>
              {t.newSearchForm.apolloTarget}
              <input
                type="number"
                min={1}
                max={APOLLO_MAX_TARGET}
                step={1}
                value={apolloTarget}
                onChange={(e) => setApolloTarget(Number(e.target.value))}
                className={inputCls + " w-28"}
              />
            </label>
            <SubmitButton loading={loading} />
          </div>
        </>
      )}

      {mode === "apollo" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className={labelCls + " min-w-64 flex-1"}>
              {t.newSearchForm.apolloKeywords}
              <input
                placeholder={t.newSearchForm.apolloKeywordsPlaceholder}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              {t.newSearchForm.headcount}
              {/* Apollos eigene Stufen, nicht unsere aus dem Corporate-Modus --
                  siehe APOLLO_EMPLOYEE_RANGES. */}
              <select value={headcount} onChange={(e) => setHeadcount(e.target.value)} className={inputCls + " w-32"}>
                <option value="">{t.newSearchForm.allHeadcounts}</option>
                {APOLLO_EMPLOYEE_RANGES.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label className={labelCls}>
              {t.newSearchForm.apolloTarget}
              <input
                type="number"
                min={1}
                max={APOLLO_MAX_TARGET}
                // step=50 hat einen echten Absende-Bug erzeugt: das Browser-
                // Constraint "stepMismatch" lehnt jeden getippten Wert ab, der
                // nicht exakt auf 1, 51, 101, ... faellt -- eine ganz normale
                // kleine Testsuche mit z.B. 10 liess sich dadurch gar nicht
                // erst abschicken (stiller Fehltritt: kein Request, keine
                // Fehlermeldung im Formular, nur der native Browser-Tooltip).
                step={1}
                value={apolloTarget}
                onChange={(e) => setApolloTarget(Number(e.target.value))}
                className={inputCls + " w-28"}
              />
            </label>
            <SubmitButton loading={loading} />
          </div>

          {/* Marktsegmente stehen direkt unter den Stichwoertern, weil sie bei
              Apollo im selben Block "Industry & Keywords" liegen -- wer die
              Suche dort nachbaut, findet sie an derselben Stelle wieder. */}
          <div>
            <span className="text-sm font-medium text-soft">{t.newSearchForm.apolloSegments}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {APOLLO_MARKET_SEGMENTS.map((segment) => {
                const active = marketSegments.includes(segment);
                return (
                  <button
                    key={segment}
                    type="button"
                    onClick={() =>
                      setMarketSegments((prev) =>
                        prev.includes(segment) ? prev.filter((v) => v !== segment) : [...prev, segment]
                      )
                    }
                    className={
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors " +
                      (active
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                        : "border-edge2 text-faint hover:border-edge3 hover:text-ink")
                    }
                  >
                    {t.newSearchForm.apolloSegmentLabels[segment] ?? segment}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-mute">{t.newSearchForm.apolloSegmentsHint}</p>
          </div>

          <label className={labelCls + " w-full"}>
            {t.newSearchForm.apolloTitles}
            <input
              placeholder={t.newSearchForm.apolloTitlesPlaceholder}
              value={personTitles}
              onChange={(e) => setPersonTitles(e.target.value)}
              className={inputCls}
            />
          </label>
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {APOLLO_KEYWORD_SUGGESTIONS.map((kw) => {
              const active = parseList(keywords).some((v) => v.toLowerCase() === kw);
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() =>
                    setKeywords((prev) => {
                      const list = parseList(prev);
                      const next = active
                        ? list.filter((v) => v.toLowerCase() !== kw)
                        : [...list, kw];
                      return next.join(", ");
                    })
                  }
                  className={
                    "rounded-lg border px-2 py-0.5 text-[11px] transition-colors " +
                    (active
                      ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                      : "border-edge2 text-faint hover:border-edge3 hover:text-ink")
                  }
                >
                  {active ? "✓ " : "+ "}
                  {kw}
                </button>
              );
            })}
          </div>

          {/* Anklicken statt abtippen: Apollo gleicht Titel unscharf ab, ein
              gesperrtes Dropdown waere hier also falsch -- ein Tippfehler
              kostet aber trotzdem eine ganze Suche. */}
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {APOLLO_TITLE_SUGGESTIONS.map((title) => {
              const active = parseList(personTitles).some(
                (v) => v.toLowerCase() === title.toLowerCase()
              );
              return (
                <button
                  key={title}
                  type="button"
                  onClick={() =>
                    setPersonTitles((prev) => {
                      const list = parseList(prev);
                      const next = active
                        ? list.filter((v) => v.toLowerCase() !== title.toLowerCase())
                        : [...list, title];
                      return next.join(", ");
                    })
                  }
                  className={
                    "rounded-lg border px-2 py-0.5 text-[11px] transition-colors " +
                    (active
                      ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                      : "border-edge2 text-faint hover:border-edge3 hover:text-ink")
                  }
                >
                  {active ? "✓ " : "+ "}
                  {title}
                </button>
              );
            })}
          </div>

          <div>
            <span className="text-sm font-medium text-soft">{t.newSearchForm.apolloSeniorities}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {APOLLO_SENIORITIES.map((level) => {
                const active = apolloSeniorities.includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() =>
                      setApolloSeniorities((prev) =>
                        prev.includes(level) ? prev.filter((v) => v !== level) : [...prev, level]
                      )
                    }
                    className={
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors " +
                      (active
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                        : "border-edge2 text-faint hover:border-edge3 hover:text-ink")
                    }
                  >
                    {t.newSearchForm.apolloSeniorityLabels[level] ?? level}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-mute">{t.newSearchForm.apolloSenioritiesHint}</p>
          </div>

          <div>
            <span className="text-sm font-medium text-soft">{t.newSearchForm.apolloCountries}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COUNTRY_CODES.map((code) => {
                const active = apolloCountries.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setApolloCountries((prev) =>
                        prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
                      )
                    }
                    className={
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors " +
                      (active
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                        : "border-edge2 text-faint hover:border-edge3 hover:text-ink")
                    }
                  >
                    {t.newSearchForm.countryLabels[code] ?? code}
                  </button>
                );
              })}
            </div>
          </div>

          <TechnologyPicker
            provider="apollo"
            selected={technologies}
            onToggleTech={toggleTechnology}
            open={techOpen}
            onOpenChange={setTechOpen}
          />

          {/* Trefferzahl vor dem Absenden. Bewusst hier unten, direkt vor dem
              Absende-Knopf: das ist der Moment, in dem die Zahl noch etwas
              aendern kann. Null Treffer werden als Warnung gezeigt, nicht als
              beilaeufiger Hinweis -- eine leer laufende Suche war bisher erst
              hinterher zu erkennen. */}
          {apolloCount.state !== "idle" && (
            <div
              className={
                "rounded-lg border px-3 py-2 text-xs leading-relaxed " +
                (apolloCount.state === "ok" && apolloCount.total === 0
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                  : "border-edge/60 bg-panel text-soft")
              }
              aria-live="polite"
            >
              {apolloCount.state === "loading" && (
                <span className="text-mute">{t.newSearchForm.apolloCountLoading}</span>
              )}
              {apolloCount.state === "ok" && (
                <>
                  <span className={apolloCount.total === 0 ? "font-medium" : "font-medium text-strong"}>
                    {t.newSearchForm.apolloCountResult(apolloCount.total, apolloTarget)}
                  </span>{" "}
                  <span className="text-mute">{t.newSearchForm.apolloCountFree}</span>
                </>
              )}
              {apolloCount.state === "error" && (
                <span className="text-mute">
                  {apolloCount.reason === "no_key"
                    ? t.newSearchForm.apolloCountNoKey
                    : apolloCount.reason === "plan"
                      ? t.newSearchForm.apolloCountPlan
                      : t.newSearchForm.apolloCountFailed}
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-mute">{t.newSearchForm.apolloHint(APOLLO_MAX_TARGET)}</p>
        </>
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
