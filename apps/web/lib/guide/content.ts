import type { Lang } from "@/lib/i18n/lang";

/**
 * Inhalt des Hilfe-Bereichs (/guide).
 *
 * Bewusst eine eigene Datei statt eines weiteren Blocks in lib/i18n/dict.ts:
 * das Woerterbuch ist mit ueber 2000 Zeilen schon die groesste Datei im
 * Projekt, und Anleitungstexte sind laenger und aendern sich unabhaengig von
 * UI-Beschriftungen. Struktur statt Freitext, damit die Seite die Abschnitte
 * rendern kann, ohne dass jemand HTML in Uebersetzungsstrings schreibt.
 *
 * Der Zweck: bisher erklaerte die Onboarding-Checkliste WAS zu tun ist ("API-Key
 * hinterlegen"), aber nicht WARUM und WIE -- ein Laie weiss danach immer noch
 * nicht, was Warmup ist oder warum man nicht einfach von der Hauptdomain
 * verschickt. Genau diese Luecke fuellt dieser Text.
 */
export type GuideSection = {
  id: string;
  /** Kurzes Emoji als visueller Anker in der Navigation. */
  icon: string;
  title: string;
  /** Ein Satz, der in der Übersicht und eingeklappt sichtbar ist. */
  summary: string;
  /** Fließtext-Absätze. */
  body: string[];
  /** Konkrete Handlungsschritte, falls es welche gibt. */
  steps?: string[];
  /** Hinweis-Kasten für die eine Sache, die man leicht falsch macht. */
  warning?: string;
  /** Sprungziel in der App. */
  href?: string;
  hrefLabel?: string;
};

const de: GuideSection[] = [
  {
    id: "overview",
    icon: "🗺️",
    title: "So funktioniert frostbreaker",
    summary: "Von der Firmenliste bis zur beantworteten E-Mail. Der komplette Ablauf in fünf Stufen.",
    body: [
      "frostbreaker nimmt dir die zwei Arbeiten ab, die bei Kaltakquise die meiste Zeit fressen: herausfinden, WEN man ansprechen soll, und für jede Firma etwas Persönliches schreiben. Der Versand selbst läuft über Instantly. Dort liegen die Postfächer und die Zustellbarkeit.",
      "Der Ablauf ist immer derselbe: Du legst eine Suche an (z.B. „Zahnärzte in Wien\"). frostbreaker findet die Firmen, recherchiert pro Firma den Entscheider samt E-Mail-Adresse, schreibt einen personalisierten Aufhänger, und du schiebst das Ergebnis als Kampagne zu Instantly. Antworten kommen in den Posteingang der App zurück.",
      "Jede Stufe läuft im Hintergrund weiter, auch wenn du die Seite verlässt. Auf dem Dashboard siehst du, wie viele Aufgaben gerade laufen.",
    ],
    steps: [
      "API-Keys hinterlegen (einmalig)",
      "Postfächer verbinden und aufwärmen (einmalig, dauert Wochen: früh anfangen!)",
      "Suche starten → Leads entstehen automatisch",
      "Kampagne anlegen und Leads importieren",
      "Antworten im Posteingang bearbeiten, Pipeline pflegen",
    ],
  },
  {
    id: "keys",
    icon: "🔑",
    title: "API-Keys: welcher wofür?",
    summary: "Du bringst deine eigenen Zugänge mit. Das hält die Kosten transparent. Du zahlst direkt beim Anbieter.",
    body: [
      "frostbreaker rechnet keine Lead-Kosten über uns ab. Stattdessen hinterlegst du deine eigenen API-Keys, und die Nutzung läuft über deine Konten bei den jeweiligen Anbietern. Vorteil: du siehst genau, was wofür anfällt, und bist nicht an unsere Aufschläge gebunden.",
      "Nicht jeder Key ist Pflicht. Für den einfachsten Start brauchst du Google Maps (Firmen finden) und OpenAI (Entscheider recherchieren, Texte schreiben). Alles andere ist optional und erweitert nur, was möglich ist.",
    ],
    steps: [
      "Google Maps: findet lokale Firmen. Braucht Geocoding API + Places API (New) in der Google Cloud Console.",
      "OpenAI: recherchiert Entscheider und schreibt die Icebreaker. Key beginnt mit „sk-\".",
      "Hunter.io: findet E-Mail-Adressen zu einer Firmendomain. Verbraucht Credits pro Abfrage.",
      "Apollo.io: Massensuche mit Firma und Entscheider samt verifizierter E-Mail in einem Schritt. Braucht mindestens Apollos Basic-Plan.",
      "NeverBounce: prüft E-Mail-Adressen vor dem Versand. Optional, aber senkt die Bounce-Rate.",
      "Instantly: der eigentliche Versand plus Warmup. Ohne diesen Key kannst du Leads finden, aber nichts verschicken.",
    ],
    warning: "Keys werden verschlüsselt gespeichert und nie wieder im Klartext angezeigt. Notiere sie dir zusätzlich beim Anbieter: beim Verlust musst du einen neuen erzeugen.",
    href: "/settings",
    hrefLabel: "Zu den Einstellungen",
  },
  {
    id: "warmup",
    icon: "🔥",
    title: "E-Mail-Warmup: der Schritt, den alle unterschätzen",
    summary: "Ein neues Postfach, das sofort 200 Mails schickt, landet im Spam. Warmup baut Vertrauen auf und dauert Wochen.",
    body: [
      "Google und Microsoft entscheiden anhand deiner Absender-Reputation, ob eine Mail im Postfach oder im Spam landet. Ein frisches Postfach hat keine Reputation. Schickt es sofort hunderte Mails an Fremde, sieht das genau wie ein Spam-Bot aus, und die Adresse ist verbrannt, oft dauerhaft.",
      "Warmup heißt: das Postfach verschickt anfangs nur wenige Mails pro Tag, die zuverlässig geöffnet und beantwortet werden. Instantly macht das automatisch über ein Netzwerk anderer Postfächer. Über zwei bis vier Wochen steigert es die Menge langsam, bis das Postfach als vertrauenswürdig gilt.",
      "Wichtigste Regel: Verschicke Kaltakquise NIE über deine Hauptdomain. Wenn die Reputation kippt, landen auch deine Rechnungen und Kundenmails im Spam. Nimm eine separate, ähnlich klingende Domain (z.B. „firma-mail.de\" neben „firma.de\") und richte dort eigene Postfächer ein.",
      "Menge pro Postfach niedrig halten: üblich sind 30 bis 50 Mails pro Tag und Postfach. Mehr Volumen erreichst du über mehr Postfächer, nicht über mehr Mails pro Postfach.",
    ],
    steps: [
      "Separate Domain für Kaltakquise kaufen (nicht die Hauptdomain!)",
      "Postfächer dort anlegen und in Instantly verbinden",
      "Warmup einschalten und zwei bis vier Wochen laufen lassen: parallel kannst du schon Leads sammeln",
      "Erst danach die erste echte Kampagne starten, mit niedrigem Tageslimit",
    ],
    warning: "Warmup ist der einzige Schritt, den man nicht abkürzen kann. Fang damit an, bevor du Leads suchst. Die Wartezeit läuft dann parallel.",
    href: "/instantly/mailboxes",
    hrefLabel: "Postfächer verwalten",
  },
  {
    id: "deliverability",
    icon: "🛡️",
    title: "SPF, DKIM, DMARC: die drei DNS-Einträge",
    summary: "Ohne diese drei Einträge gilt deine Domain als nicht vertrauenswürdig, egal wie gut das Warmup lief.",
    body: [
      "Diese drei Einträge sind der technische Nachweis, dass du wirklich berechtigt bist, im Namen deiner Domain zu verschicken. Fehlen sie, sortieren Google und Microsoft härter aus. Bei Kaltakquise ist das der Unterschied zwischen Postfach und Spam-Ordner.",
      "SPF legt fest, welche Server für deine Domain verschicken dürfen. DKIM signiert jede Mail kryptografisch, damit der Empfänger die Echtheit prüfen kann. DMARC sagt dem Empfänger, was passieren soll, wenn SPF oder DKIM fehlschlagen.",
      "Die Einträge legst du bei deinem Domain-Anbieter an (IONOS, Namecheap, Cloudflare …). Instantly und dein Postfach-Anbieter geben dir die genauen Werte vor. Der Zustellbarkeits-Check in der App prüft danach, ob alles korrekt gesetzt ist.",
    ],
    href: "/instantly/deliverability",
    hrefLabel: "Zustellbarkeit prüfen",
  },
  {
    id: "search",
    icon: "🔍",
    title: "Leads finden: drei Suchwege",
    summary: "Lokale Betriebe, Firmendatenbank oder Massensuche. Je nach Zielgruppe der passende Weg.",
    body: [
      "Lokal (Google Maps) ist der günstigste Weg und passt für Handwerk, Gastronomie, Praxen: alles mit einem Standort. Du gibst Nische und Ort ein. Mehrere Nischen oder Orte kannst du mit Komma trennen, dann werden daraus mehrere Suchen auf einmal.",
      "Corporate (Datenbank) sucht über Hunters Firmendatenbank statt über Karten: sinnvoll für Firmen ohne Ladengeschäft, gefiltert nach Branche, Standort und Größe.",
      "Apollo (Massen-Leads) ist der Premium-Weg: Apollo liefert Firma und Entscheider samt verifizierter E-Mail in einem Schritt. Bei den anderen Wegen wird die Adresse nachträglich recherchiert und nur bei etwa jeder fünften Firma gefunden. Bei Apollo ist die angefragte Zahl auch die Zahl der Leads.",
      "Jede Suche kann als Abo laufen (täglich, wöchentlich, alle zwei Wochen) und schiebt dann automatisch neue Leads in dieselbe Liste. Firmen, die du schon hast, werden dabei nicht doppelt aufgenommen.",
    ],
    warning: "Bei „Ziel: Leads mit E-Mail\" gibst du an, wie viele verwertbare Kontakte du willst, nicht wie viele Firmen durchsucht werden. Die App rechnet die nötige Firmenzahl selbst hoch.",
    href: "/",
    hrefLabel: "Suche starten",
  },
  {
    id: "agent",
    icon: "✨",
    title: "Der AI Agent: personalisierte Aufhänger",
    summary: "Ein Satz pro Firma, der zeigt, dass du dich mit ihr beschäftigt hast: automatisch, aber prüfbar.",
    body: [
      "Der Unterschied zwischen einer ignorierten und einer beantworteten Kaltmail ist meist der erste Satz. Der AI Agent schreibt für jede Firma einen solchen Aufhänger („Icebreaker\") auf Basis der recherchierten Firmenbeschreibung oder des Website-Texts.",
      "Du kannst den Anweisungstext vollständig überschreiben und eigene Vorlagen speichern. Wortobergrenze und verbotene Wörter sind separat einstellbar. Damit hältst du Floskeln wie „beeindruckt\" oder „begeistert\" heraus, die sofort nach KI klingen.",
      "Wichtig ist der Live-Test darunter: du wählst eine echte Firma aus deinen Leads und siehst sofort, was herauskommt, ohne dass eine Kampagne läuft. Regelverstöße (zu lang, verbotenes Wort, Gedankenstrich) werden dabei angezeigt und einmal automatisch korrigiert.",
    ],
    href: "/ai-agent",
    hrefLabel: "Zum AI Agent",
  },
  {
    id: "campaign",
    icon: "📤",
    title: "Kampagne erstellen",
    summary: "Sequenz aus mehreren Schritten, Leads aus deinen Suchen, Versand über deine Postfächer.",
    body: [
      "Eine Kampagne besteht aus mehreren E-Mails, die zeitversetzt verschickt werden. Die erste sofort, danach Nachfassmails nach einigen Tagen. Antwortet jemand, stoppt die Sequenz für diesen Kontakt automatisch.",
      "Beim Anlegen wählst du: welche Suchen die Leads liefern (mehrere möglich), welche Postfächer verschicken, wie viele Mails pro Tag, und die Textbausteine. Die Variable für den personalisierten Aufhänger setzt der AI Agent ein.",
      "Pro Firma wird nur eine Person angeschrieben, auch wenn mehrere Kontakte gefunden wurden. Sonst bekommt dieselbe Firma mehrere Mails von dir. Wer angeschrieben wird, entscheidet der Jobtitel; du kannst es pro Firma überschreiben.",
      "Adressen, die als ungültig erkannt wurden, werden vor dem Versand automatisch aussortiert. Das schützt deine Absender-Reputation: eine hohe Bounce-Rate schadet allen Postfächern der Domain, nicht nur dieser Kampagne.",
    ],
    steps: [
      "Textqualität prüfen: der Editor markiert Spam-Wörter, schwere Sätze und Formulierungen, die nach KI klingen",
      "Tageslimit niedrig ansetzen und langsam steigern",
      "Nach dem Start die Bounce-Rate im Blick behalten: über 3% ist ein Warnsignal",
    ],
    href: "/instantly/campaigns/new",
    hrefLabel: "Kampagne anlegen",
  },
  {
    id: "calls",
    icon: "📞",
    title: "Telefon-Akquise und Anrufliste",
    summary: "Nummer, Firmenzusammenfassung und Notizen an einem Ort: telefoniert wird mit dem eigenen Gerät.",
    body: [
      "Viele Leads haben eine Telefonnummer, und ein Anruf kommt oft weiter als die dritte Nachfassmail. Die App wählt bewusst nicht selbst: du telefonierst mit deinem Firmentelefon, die App liefert nur die Vorbereitung und nimmt das Ergebnis auf.",
      "In der Leads-Liste kannst du auf „Nur mit Telefonnummer\" filtern. Im Detail einer Firma siehst du die Zusammenfassung. Damit weißt du vor dem Wählen, mit wem du sprichst.",
      "Über „Anruf loggen\" hältst du Ergebnis und Notiz fest oder planst einen Rückruf mit Datum. Alles Geplante sammelt die Anrufliste: überfällig, heute, später. Dort kannst du direkt abhaken, verschieben oder einen falsch eingetragenen Termin verwerfen.",
    ],
    warning: "Telefonische Kaltakquise ist rechtlich strenger als E-Mail. In Deutschland und Österreich braucht es auch im B2B eine sachliche Begründung („mutmaßliche Einwilligung\"). Kläre das für deinen Markt, bevor du anfängst.",
    href: "/calls",
    hrefLabel: "Zur Anrufliste",
  },
  {
    id: "pipeline",
    icon: "📊",
    title: "Pipeline, Deals und Posteingang",
    summary: "Vom ersten Kontakt bis zum Abschluss: Status, Werte und Verlauf pro Kontakt.",
    body: [
      "Jeder Kontakt hat einen Status: neu, kontaktiert, hat geantwortet, Termin, Kunde, kein Interesse. Antworten aus Instantly setzen den Status automatisch, du kannst ihn jederzeit von Hand ändern oder im Pipeline-Board verschieben.",
      "Für konkrete Verkaufschancen legst du Deals mit Wert und Abschluss-Wahrscheinlichkeit an. Daraus entsteht der Forecast auf dem Dashboard: nach eigenen Zahlen, unabhängig von Instantly.",
      "Der Posteingang zeigt eingehende Antworten. Jeder Kontakt hat außerdem einen Verlauf, in dem E-Mails, Notizen, Anrufe, Statuswechsel und Deals chronologisch zusammenlaufen.",
    ],
    href: "/pipeline",
    hrefLabel: "Zur Pipeline",
  },
  {
    id: "compliance",
    icon: "⚖️",
    title: "Rechtliches in Kurzform",
    summary: "Abmeldelink, Sperrliste und ein realistischer Blick auf Kaltakquise per E-Mail.",
    body: [
      "Jede Kampagnenmail enthält einen Abmeldelink. Ein Klick trägt den Empfänger automatisch in deine Sperrliste ein. Er wird danach in keiner Suche und keiner Kampagne mehr auftauchen.",
      "Die Sperrliste kannst du auch selbst füllen, einzeln oder als Domain. Das ist der richtige Ort für „nie wieder kontaktieren\", während der Papierkorb bei Suchen nur bedeutet „diese Liste brauche ich nicht mehr\".",
      "B2B-Kaltakquise per E-Mail ist in der EU nicht pauschal verboten, aber an Bedingungen geknüpft: sachlicher Bezug zum Geschäft des Empfängers, klare Absenderkennung, funktionierender Abmeldelink. Persönliche Adressen von Privatpersonen sind etwas anderes als eine Firmenadresse.",
    ],
    warning: "Das ist eine Orientierung, keine Rechtsberatung. Für den konkreten Fall und dein Zielland kläre die Lage mit jemandem, der dafür haftet.",
    href: "/blocklist",
    hrefLabel: "Zur Sperrliste",
  },
];

const en: GuideSection[] = [
  {
    id: "overview",
    icon: "🗺️",
    title: "How frostbreaker works",
    summary: "From a list of companies to a replied-to email: the whole flow in five stages.",
    body: [
      "frostbreaker takes over the two jobs that eat the most time in cold outreach: working out WHO to contact, and writing something specific for each company. Sending itself runs through Instantly, which holds the mailboxes and the deliverability.",
      "The flow is always the same: you create a search (e.g. \"dentists in Vienna\"). frostbreaker finds the companies, researches the decision maker and their email for each, writes a personalised opening line, and you push the result to Instantly as a campaign. Replies come back into the app's inbox.",
      "Every stage keeps running in the background even if you leave the page. The dashboard shows how many jobs are currently working.",
    ],
    steps: [
      "Save your API keys (one-off)",
      "Connect mailboxes and warm them up (one-off, takes weeks: start early!)",
      "Start a search → leads appear automatically",
      "Create a campaign and import the leads",
      "Handle replies in the inbox, keep the pipeline current",
    ],
  },
  {
    id: "keys",
    icon: "🔑",
    title: "API keys: which one does what?",
    summary: "You bring your own accounts. That keeps costs transparent. You pay the providers directly.",
    body: [
      "frostbreaker does not bill lead costs through us. Instead you save your own API keys, and usage runs through your accounts with each provider. The upside: you see exactly what costs what, and you are not tied to our markup.",
      "Not every key is mandatory. For the simplest start you need Google Maps (find companies) and OpenAI (research decision makers, write copy). Everything else is optional and only widens what is possible.",
    ],
    steps: [
      "Google Maps: finds local companies. Needs Geocoding API + Places API (New) in the Google Cloud Console.",
      "OpenAI: researches decision makers and writes the icebreakers. Key starts with \"sk-\".",
      "Hunter.io: finds email addresses for a company domain. Consumes credits per lookup.",
      "Apollo.io: bulk search returning company and decision maker with a verified email in one step. Needs at least Apollo's Basic plan.",
      "NeverBounce: checks email addresses before sending. Optional, but lowers your bounce rate.",
      "Instantly: the actual sending plus warmup. Without this key you can find leads but send nothing.",
    ],
    warning: "Keys are stored encrypted and never shown in clear text again. Keep your own copy at the provider: if you lose it you have to generate a new one.",
    href: "/settings",
    hrefLabel: "Go to settings",
  },
  {
    id: "warmup",
    icon: "🔥",
    title: "Email warmup: the step everyone underestimates",
    summary: "A new mailbox that immediately sends 200 emails lands in spam. Warmup builds trust and takes weeks.",
    body: [
      "Google and Microsoft decide from your sender reputation whether a message reaches the inbox or spam. A fresh mailbox has no reputation. If it immediately sends hundreds of emails to strangers, that looks exactly like a spam bot, and the address is burned, often permanently.",
      "Warmup means: the mailbox starts by sending only a few emails a day, which get reliably opened and answered. Instantly does this automatically across a network of other mailboxes. Over two to four weeks it raises the volume slowly until the mailbox counts as trustworthy.",
      "The most important rule: never run cold outreach from your main domain. If the reputation tips, your invoices and customer emails land in spam too. Use a separate, similar-sounding domain (e.g. \"company-mail.com\" alongside \"company.com\") and set up dedicated mailboxes there.",
      "Keep the volume per mailbox low: 30 to 50 emails per day per mailbox is normal. You scale by adding mailboxes, not by sending more from one.",
    ],
    steps: [
      "Buy a separate domain for cold outreach (not your main domain!)",
      "Create mailboxes there and connect them in Instantly",
      "Turn on warmup and let it run two to four weeks. You can already collect leads in parallel",
      "Only then start the first real campaign, with a low daily limit",
    ],
    warning: "Warmup is the one step you cannot shorten. Start it before you search for leads. Then the waiting time runs in parallel.",
    href: "/instantly/mailboxes",
    hrefLabel: "Manage mailboxes",
  },
  {
    id: "deliverability",
    icon: "🛡️",
    title: "SPF, DKIM, DMARC: the three DNS records",
    summary: "Without these three records your domain counts as untrustworthy, no matter how well warmup went.",
    body: [
      "These three records are the technical proof that you are actually allowed to send on behalf of your domain. Without them Google and Microsoft filter more aggressively. In cold outreach that is the difference between inbox and spam folder.",
      "SPF defines which servers may send for your domain. DKIM signs every message cryptographically so the recipient can verify it. DMARC tells the recipient what to do when SPF or DKIM fail.",
      "You create the records at your domain provider (IONOS, Namecheap, Cloudflare …). Instantly and your mailbox provider give you the exact values. The deliverability check in the app then verifies everything is set correctly.",
    ],
    href: "/instantly/deliverability",
    hrefLabel: "Check deliverability",
  },
  {
    id: "search",
    icon: "🔍",
    title: "Finding leads: three search modes",
    summary: "Local businesses, a company database, or bulk search: the right route for your audience.",
    body: [
      "Local (Google Maps) is the cheapest route and fits trades, hospitality, practices: anything with a physical location. You enter niche and location. Separate several niches or locations with commas and they become several searches at once.",
      "Corporate (database) searches Hunter's company database instead of maps: useful for companies without a storefront, filtered by industry, location and size.",
      "Apollo (bulk leads) is the premium route: Apollo returns the company and the decision maker with a verified email in one step. On the other routes the address is researched afterwards and only found for roughly one in five companies. With Apollo the number you ask for is the number of leads.",
      "Any search can run as a subscription (daily, weekly, biweekly) and then adds new leads to the same list automatically. Companies you already have are not added twice.",
    ],
    warning: "\"Target: leads with email\" is how many usable contacts you want, not how many companies get searched. The app works out the required company count itself.",
    href: "/",
    hrefLabel: "Start a search",
  },
  {
    id: "agent",
    icon: "✨",
    title: "The AI agent: personalised openers",
    summary: "One sentence per company that shows you actually looked at them: automatic, but verifiable.",
    body: [
      "The difference between an ignored and an answered cold email is usually the first sentence. The AI agent writes such an opener (\"icebreaker\") for each company, based on the researched company summary or the website text.",
      "You can overwrite the instructions completely and save your own templates. The word limit and banned words are separate settings. That is how you keep out filler like \"impressed\" or \"excited\" that instantly reads as AI.",
      "The live test below it matters: you pick a real company from your leads and immediately see the result, without a campaign running. Rule violations (too long, banned word, dash) are shown and corrected once automatically.",
    ],
    href: "/ai-agent",
    hrefLabel: "Go to the AI agent",
  },
  {
    id: "campaign",
    icon: "📤",
    title: "Creating a campaign",
    summary: "A multi-step sequence, leads from your searches, sent through your mailboxes.",
    body: [
      "A campaign is several emails sent with delays: the first immediately, then follow-ups after a few days. If someone replies, the sequence stops for that contact automatically.",
      "When creating it you choose: which searches supply the leads (several possible), which mailboxes send, how many emails per day, and the copy. The variable for the personalised opener is filled by the AI agent.",
      "Only one person per company is contacted, even when several contacts were found. Otherwise the same company gets multiple emails from you. Job title decides who; you can override it per company.",
      "Addresses detected as invalid are filtered out before sending. That protects your sender reputation: a high bounce rate damages every mailbox on the domain, not just this campaign.",
    ],
    steps: [
      "Check copy quality: the editor flags spam words, heavy sentences and phrasing that reads as AI",
      "Set the daily limit low and raise it slowly",
      "After launch keep an eye on the bounce rate: above 3% is a warning sign",
    ],
    href: "/instantly/campaigns/new",
    hrefLabel: "Create a campaign",
  },
  {
    id: "calls",
    icon: "📞",
    title: "Phone outreach and the call list",
    summary: "Number, company summary and notes in one place. You dial with your own phone.",
    body: [
      "Many leads have a phone number, and a call often gets further than a third follow-up email. The app deliberately does not dial: you call with your own office phone, the app only provides the preparation and records the outcome.",
      "In the leads list you can filter to \"only with phone\". In a company's detail view you see the summary. So you know who you are talking to before you dial.",
      "Via \"log call\" you record the outcome and a note, or plan a callback with a date. Everything planned collects in the call list: overdue, today, later. From there you can tick it off, move it, or discard a task entered by mistake.",
    ],
    warning: "Cold calling is legally stricter than email. In Germany and Austria even B2B calls need a factual justification (\"presumed consent\"). Clarify this for your market before you start.",
    href: "/calls",
    hrefLabel: "Go to the call list",
  },
  {
    id: "pipeline",
    icon: "📊",
    title: "Pipeline, deals and inbox",
    summary: "From first contact to close: status, values and history per contact.",
    body: [
      "Every contact has a status: new, contacted, replied, meeting, customer, not interested. Replies from Instantly set it automatically; you can change it by hand any time or drag it on the pipeline board.",
      "For concrete opportunities you create deals with a value and a close probability. That produces the forecast on the dashboard: from your own numbers, independent of Instantly.",
      "The inbox shows incoming replies. Each contact also has a history where emails, notes, calls, status changes and deals come together chronologically.",
    ],
    href: "/pipeline",
    hrefLabel: "Go to the pipeline",
  },
  {
    id: "compliance",
    icon: "⚖️",
    title: "Legal basics, briefly",
    summary: "Opt-out link, blocklist, and a realistic view of cold email.",
    body: [
      "Every campaign email contains an opt-out link. One click adds the recipient to your blocklist automatically. They will no longer appear in any search or campaign.",
      "You can also fill the blocklist yourself, per address or per domain. That is the right place for \"never contact again\", while the trash on a search only means \"I don't need this list anymore\".",
      "B2B cold email is not blanket-illegal in the EU, but it comes with conditions: a factual connection to the recipient's business, clear sender identification, and a working opt-out link. Personal addresses of private individuals are a different matter from a company address.",
    ],
    warning: "This is orientation, not legal advice. For your specific case and target country, check with someone who carries liability for it.",
    href: "/blocklist",
    hrefLabel: "Go to the blocklist",
  },
];

export const GUIDE: Record<Lang, GuideSection[]> = { de, en };
