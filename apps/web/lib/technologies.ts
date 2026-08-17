// Technologie-Filter fuer Corporate (Hunter) und Apollo.
//
// Beide Anbieter koennen nach der eingesetzten Technik einer Firma filtern --
// damit lassen sich z.B. gezielt Shopify-Shops finden, statt "ecommerce" als
// Keyword zu raten. Die Slugs sind aber NICHT dieselben:
//
//   Apollo  currently_using_any_of_technology_uids[]  -> "woo_commerce"
//   Hunter  technology.include[]                      -> "woocommerce"
//
// Quellen, beide oeffentlich und ohne Key abrufbar (abgerufen 2026-08-01):
//   Apollo: https://api.apollo.io/v1/auth/supported_technologies_csv  (10.718 Eintraege)
//   Hunter: https://hunter.io/files/technologies.json                 (1.980 Eintraege)
//
// ACHTUNG, teuer gelernt: Apollos CSV enthaelt ANZEIGENAMEN, nicht die UIDs.
// Eine UID laesst sich daraus NICHT zuverlaessig ableiten. Frueher stand hier
// die Regel "klein, Leerzeichen und Punkte zu Unterstrichen" — die stimmt fuer
// "Woo Commerce" -> woo_commerce, aber genau drei Eintraege weichen ab:
//
//   Apollo.io   -> apolloio    (NICHT apollo_io; "apollo" ist Apollo GraphQL,
//                               belegt durch Microsoft/Razorpay statt Agenturen)
//   Outreach.io -> outreach    (NICHT outreach_io oder outreachio)
//   JTL-Shop    -> jtlshop     (NICHT jtl-shop oder jtl_shop)
//
// Das ist keine Kosmetik: ein unbekannter UID wird von Apollo nicht als Fehler
// abgewiesen, sondern liefert stillschweigend NULL Treffer. Die Suche laeuft
// dann sauber durch und endet mit "fertig, 0 Leads" — ohne jeden Hinweis
// darauf, dass der Filter gar nicht existiert. Genau so ist am 2026-08-02 eine
// 300-Lead-Suche auf Apollo.io-Nutzer leer ausgegangen.
//
// Deshalb gilt: JEDER neue Apollo-Slug wird vor dem Einbauen einmal echt gegen
// mixed_people/api_search abgefragt (per_page=1, kostet keine Credits) und muss
// mindestens eine Person zuruecklieferern. Alle 49 Eintraege unten sind so
// geprueft (2026-08-02). Die Werte sind zusaetzlich in technologies.test.ts
// festgenagelt, damit niemand sie "logisch" zurueckkorrigiert.
//
// Die Kataloge decken sich nicht vollstaendig: Gorgias/Yotpo/Trusted Shops
// kennt nur Apollo, ActiveCampaign nur Hunter, und Brevo laeuft bei Hunter noch
// unter dem alten Namen "sendinblue". Fehlt ein Slug, bleibt das Feld leer und
// der Eintrag wird im jeweiligen Modus gar nicht erst angeboten (siehe
// technologiesFor) — sonst waehlte man einen Filter, der stillschweigend
// wirkungslos bliebe.
//
// Bewusst kuratiert statt vollstaendig: die Rohlisten haben zusammen ueber
// 12.000 Eintraege. Hier stehen die Shopsysteme und die Tools, an denen sich
// ein E-Commerce-Lead tatsaechlich erkennen und ansprechen laesst.

export type TechGroup = "shop" | "tools" | "sales";

export type Technology = {
  /** Stabile interne ID. Sie — nicht der Anbieter-Slug — landet im
   *  Formular-State und in gespeicherten Vorlagen, damit eine Vorlage beim
   *  Wechsel zwischen Corporate und Apollo gueltig bleibt. */
  id: string;
  label: string;
  group: TechGroup;
  /** currently_using_any_of_technology_uids[] */
  apollo?: string;
  /** technology.include[] */
  hunter?: string;
};

export const TECHNOLOGIES: Technology[] = [
  // --- Shopsysteme ---------------------------------------------------------
  { id: "shopify", label: "Shopify", group: "shop", apollo: "shopify", hunter: "shopify" },
  { id: "shopware", label: "Shopware", group: "shop", apollo: "shopware", hunter: "shopware" },
  { id: "woocommerce", label: "WooCommerce", group: "shop", apollo: "woo_commerce", hunter: "woocommerce" },
  { id: "magento", label: "Magento", group: "shop", apollo: "magento", hunter: "magento" },
  { id: "prestashop", label: "PrestaShop", group: "shop", apollo: "prestashop", hunter: "prestashop" },
  { id: "bigcommerce", label: "BigCommerce", group: "shop", apollo: "bigcommerce", hunter: "bigcommerce" },
  { id: "jtl", label: "JTL-Shop", group: "shop", apollo: "jtlshop", hunter: "jtl-shop" },
  { id: "oxid", label: "Oxid eShop", group: "shop", apollo: "oxid_eshop", hunter: "oxid-eshop" },
  { id: "plentymarkets", label: "PlentyMarkets", group: "shop", apollo: "plentymarkets", hunter: "plentymarkets" },
  { id: "ecwid", label: "Ecwid", group: "shop", apollo: "ecwid", hunter: "ecwid" },
  { id: "epages", label: "ePages", group: "shop", apollo: "epages", hunter: "epages" },
  { id: "squarespace", label: "Squarespace Commerce", group: "shop", apollo: "squarespace_ecommerce", hunter: "squarespace" },
  { id: "wix", label: "Wix eCommerce", group: "shop", apollo: "wix_ecommerce", hunter: "wix" },
  { id: "sfcc", label: "Salesforce Commerce Cloud", group: "shop", apollo: "salesforce_commerce_cloud", hunter: "salesforce-commerce-cloud" },
  { id: "lightspeed", label: "Lightspeed eCom", group: "shop", apollo: "lightspeed_ecom", hunter: "lightspeed-ecom" },
  { id: "opencart", label: "OpenCart", group: "shop", apollo: "opencart", hunter: "opencart" },
  { id: "afterbuy", label: "Afterbuy", group: "shop", apollo: "afterbuy", hunter: "afterbuy" },
  // Nur bei Apollo gelistet — im Corporate-Modus deshalb ausgeblendet.
  { id: "shopgate", label: "Shopgate", group: "shop", apollo: "shopgate" },
  { id: "commercetools", label: "commercetools", group: "shop", apollo: "commercetools" },
  { id: "spryker", label: "Spryker", group: "shop", apollo: "spryker_cloud_commerce_os" },

  // --- Tools, CMS, Zahlung -------------------------------------------------
  { id: "klaviyo", label: "Klaviyo", group: "tools", apollo: "klaviyo", hunter: "klaviyo" },
  { id: "mailchimp", label: "Mailchimp", group: "tools", apollo: "mailchimp", hunter: "mailchimp" },
  { id: "hubspot", label: "HubSpot", group: "tools", apollo: "hubspot", hunter: "hubspot" },
  { id: "salesforce", label: "Salesforce", group: "tools", apollo: "salesforce", hunter: "salesforce" },
  { id: "google_analytics", label: "Google Analytics", group: "tools", apollo: "google_analytics", hunter: "google-analytics" },
  { id: "meta_pixel", label: "Meta Pixel", group: "tools", apollo: "facebook_pixel", hunter: "facebook-pixel" },
  { id: "stripe", label: "Stripe", group: "tools", apollo: "stripe", hunter: "stripe" },
  { id: "paypal", label: "PayPal", group: "tools", apollo: "paypal", hunter: "paypal" },
  // Hunter kennt nur den Checkout, nicht Klarna allgemein.
  { id: "klarna", label: "Klarna", group: "tools", apollo: "klarna", hunter: "klarna-checkout" },
  { id: "recharge", label: "Recharge", group: "tools", apollo: "recharge_payments", hunter: "recharge" },
  { id: "zendesk", label: "Zendesk", group: "tools", apollo: "zendesk", hunter: "zendesk" },
  { id: "intercom", label: "Intercom", group: "tools", apollo: "intercom", hunter: "intercom" },
  { id: "trustpilot", label: "Trustpilot", group: "tools", apollo: "trustpilot", hunter: "trustpilot" },
  // Bei Hunter noch unter dem alten Markennamen gefuehrt.
  { id: "brevo", label: "Brevo", group: "tools", apollo: "brevo", hunter: "sendinblue" },
  { id: "activecampaign", label: "ActiveCampaign", group: "tools", hunter: "activecampaign" },
  { id: "gorgias", label: "Gorgias", group: "tools", apollo: "gorgias" },
  { id: "yotpo", label: "Yotpo", group: "tools", apollo: "yotpo" },
  { id: "trustedshops", label: "Trusted Shops", group: "tools", apollo: "trustedshops" },
  { id: "cleverreach", label: "CleverReach", group: "tools", apollo: "cleverreach" },
  { id: "wordpress", label: "WordPress", group: "tools", apollo: "wordpress_org", hunter: "wordpress" },
  { id: "webflow", label: "Webflow", group: "tools", apollo: "webflow", hunter: "webflow" },
  { id: "typo3", label: "TYPO3", group: "tools", apollo: "typo3", hunter: "typo3-cms" },
  { id: "contentful", label: "Contentful", group: "tools", apollo: "contentful", hunter: "contentful" },

  // --- Vertrieb & Lead-Gen -------------------------------------------------
  // Firmen, die selbst Outbound betreiben. Fuer den Verkauf dieser App die
  // interessanteste Zielgruppe ueberhaupt: wer Apollo oder Outreach einsetzt,
  // hat das Problem bereits erkannt und ein Budget dafuer.
  //
  // Was hier NICHT steht und warum:
  //   Hunter.io, Instantly.ai, Smartlead, Clay, Lusha, Cognism — in KEINEM
  //   der beiden Kataloge enthalten (geprueft am 2026-08-02 gegen beide
  //   Rohlisten). Sie liessen sich zwar als Kachel anbieten, wuerden bei der
  //   Suche aber wirkungslos durchlaufen, und der Nutzer haette scheinbar
  //   gefiltert.
  //
  //   Bei Hunter fehlt hier ausserdem "apollo": Hunters Liste kennt nur den
  //   mehrdeutigen Eintrag "apollo", und Apollos eigener Katalog trennt
  //   ausdruecklich "Apollo.io" (CRM) von "Apollo" (Frameworks and Programming
  //   Languages, also Apollo GraphQL). Ein Filter darauf wuerde
  //   Webentwickler-Teams liefern statt Apollo-Nutzer.
  //
  //   Genau diese Trennung bildet Apollo in den UIDs ab, aber anders als
  //   erwartet: "apollo" IST das GraphQL-Framework (Stichprobe: Microsoft,
  //   Razorpay, EXL), das CRM liegt auf "apolloio" (Stichprobe: The Retail
  //   Doctor, Tibicle, APEX Consulting — Agenturen und Beratungen). Der
  //   naheliegende Zwischenweg "apollo_io" existiert bei Apollo NICHT und
  //   lieferte deshalb null Treffer, siehe Kopf dieser Datei.
  { id: "apollo_io", label: "Apollo.io", group: "sales", apollo: "apolloio" },
  { id: "outreach", label: "Outreach.io", group: "sales", apollo: "outreach" },
  { id: "salesloft", label: "SalesLoft", group: "sales", apollo: "salesloft", hunter: "salesloft" },
  { id: "lemlist_tool", label: "lemlist", group: "sales", apollo: "lemlist" },
  { id: "mailshake", label: "Mailshake", group: "sales", apollo: "mailshake" },
  { id: "snovio", label: "Snov.io", group: "sales", apollo: "snovio" },
  { id: "zoominfo", label: "ZoomInfo", group: "sales", apollo: "zoominfo", hunter: "zoominfo" },
];

export type TechProvider = "apollo" | "hunter";

/** Nur die Technologien, die der jeweilige Anbieter ueberhaupt kennt. Ein
 *  Eintrag, den man auswaehlen kann, muss auch wirken — sonst liefe die Suche
 *  scheinbar gefiltert, tatsaechlich aber ungefiltert. */
export function technologiesFor(provider: TechProvider): Technology[] {
  return TECHNOLOGIES.filter((tech) => Boolean(tech[provider]));
}

/** Interne IDs in die Slugs des Anbieters uebersetzen. Unbekannte IDs und
 *  solche ohne Slug fallen weg — Vorlagen aus dem jeweils anderen Modus
 *  koennen IDs enthalten, die hier nicht gelten. */
export function resolveTechnologies(ids: string[], provider: TechProvider): string[] {
  const bySlug = new Set<string>();
  for (const id of ids) {
    const slug = TECHNOLOGIES.find((tech) => tech.id === id)?.[provider];
    if (slug) bySlug.add(slug);
  }
  return [...bySlug];
}

/**
 * Die Gegenrichtung: Anbieter-Slugs zurueck in interne IDs.
 *
 * Gebraucht, seit sich aus einer gelaufenen Suche eine Vorlage machen laesst
 * (lib/search-presets.ts): in searches.filters stehen die Slugs des Anbieters,
 * das Formular arbeitet aber mit den internen IDs.
 *
 * Slugs, zu denen es keinen Eintrag gibt, fallen weg. Das ist kein Verlust,
 * der hier entsteht — er ist schon beim Speichern der Suche passiert, denn
 * resolveTechnologies laesst genau dieselben Faelle fallen.
 */
export function technologyIdsFromSlugs(slugs: string[], provider: TechProvider): string[] {
  const ids = new Set<string>();
  for (const slug of slugs) {
    const tech = TECHNOLOGIES.find((t) => t[provider] === slug);
    if (tech) ids.add(tech.id);
  }
  return [...ids];
}
