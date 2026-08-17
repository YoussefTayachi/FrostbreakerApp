import type { Lang } from "../types";

// Formulierungen, die LLMs auffaellig haeufig produzieren. Das ist explizit
// eine Stil-Liste, kein Beweis: ein Mensch darf "nahtlos" schreiben, und ein
// Modell kann jede dieser Wendungen vermeiden. Der Nutzen liegt darin, dass
// genau diese Floskeln in Kaltakquise ohnehin schlecht funktionieren: sie
// klingen nach Broschuere statt nach einer Mail von einem Menschen.

const DE = [
  "in der heutigen schnelllebigen welt",
  "in der heutigen digitalen welt",
  "in einer welt, in der",
  "in der sich ständig wandelnden",
  "es ist wichtig zu beachten",
  "es sei darauf hingewiesen",
  "zusammenfassend lässt sich sagen",
  "abschließend lässt sich sagen",
  "ich hoffe, diese e-mail erreicht sie gut",
  "ich hoffe, es geht ihnen gut",
  "tauchen sie ein",
  "das volle potenzial",
  "das potenzial ausschöpfen",
  "die kraft von",
  "maßgeschneiderte lösungen",
  "ganzheitlicher ansatz",
  "nahtlos",
  "nahtlose integration",
  "bahnbrechend",
  "wegweisend",
  "revolutionieren",
  "auf die nächste stufe heben",
  "einen entscheidenden unterschied",
  "in der heutigen wettbewerbsintensiven",
  "es ist erwähnenswert",
  "sich als unverzichtbar erwiesen",
  "eine schlüsselrolle spielen",
  "im digitalen zeitalter",
  "unerlässlich",
  "von größter bedeutung",
  // Speziell fuer KI-generierte Kaltakquise-Mails (nicht nur allgemeines
  // Konzern-Deutsch): typische Eroeffnungs- und Struktur-Floskeln, wenn ein
  // Modell explizit um eine Cold-Email gebeten wird. Bewusst als laengere,
  // mehrteilige Wendungen statt einzelner Woerter: "kurz gesagt" oder "bin
  // auf" allein kommen auch in ganz normal von Menschen geschriebenen Mails
  // vor und wuerden zu oft falsch anschlagen.
  "das ist genau der grund, warum wir",
  "wenn sie wie die meisten",
  "der größte engpass",
  "unsere kunden sehen typischerweise",
] as const;

const EN = [
  "in today's fast-paced world",
  "in today's digital world",
  "in today's competitive landscape",
  "in the ever-evolving",
  "in the realm of",
  "it's important to note",
  "it is important to note",
  "it's worth noting",
  "i hope this email finds you well",
  "i hope this message finds you well",
  "delve into",
  "dive deep into",
  "unlock the power",
  "unlock the full potential",
  "harness the power",
  "tailored solutions",
  "holistic approach",
  "seamless",
  "seamless integration",
  "game-changer",
  "game changer",
  "revolutionize",
  "take it to the next level",
  "elevate your",
  "cutting-edge",
  "state-of-the-art",
  "a testament to",
  "plays a crucial role",
  "in conclusion",
  "furthermore",
  "moreover",
  "navigating the complexities",
  "robust and scalable",
  "paradigm shift",
  // Speziell fuer KI-generierte Kaltakquise-Mails: typische Eroeffnungs- und
  // Struktur-Floskeln, wenn ein Modell explizit um eine Cold-Email gebeten
  // wird. Laengere Wendungen, damit generische Kurzphrasen wie "in short"
  // nicht jede zweite echte Mail treffen.
  "if you're like most",
  "that's exactly why we built",
  "in short, our",
  "here's what our",
  "biggest bottleneck",
  "without sacrificing",
] as const;

export const AI_PHRASES: Record<Lang, readonly string[]> = { de: DE, en: EN };
