import type { Lang } from "../types";

// Formulierungen, die LLMs auffaellig haeufig produzieren. Das ist explizit
// eine Stil-Liste, kein Beweis: ein Mensch darf "nahtlos" schreiben, und ein
// Modell kann jede dieser Wendungen vermeiden. Der Nutzen liegt darin, dass
// genau diese Floskeln in Kaltakquise ohnehin schlecht funktionieren -- sie
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
] as const;

export const AI_PHRASES: Record<Lang, readonly string[]> = { de: DE, en: EN };
