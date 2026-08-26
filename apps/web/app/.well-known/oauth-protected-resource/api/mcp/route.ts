/**
 * Dasselbe Dokument, zweiter Pfad.
 *
 * RFC 9728 §3.1 schreibt vor, wo ein Client die Metadaten einer Ressource mit
 * einem PFAD sucht: der Pfad wird an /.well-known/oauth-protected-resource
 * ANGEHAENGT. Fuer https://app.frostbreaker.app/api/mcp ist das also
 * /.well-known/oauth-protected-resource/api/mcp -- nicht der nackte Pfad.
 *
 * Welchen der beiden ein Client tatsaechlich nimmt, ist Fassungssache: die
 * aelteren fragen den nackten, die neueren den mit Pfad, und einige probieren
 * beide. Zwei Zeilen Weiterleitung sind billiger als die Sorte Fehler, die
 * nur bei jedem zweiten Client auftritt und beim Nachstellen verschwindet.
 */
export { GET, OPTIONS, runtime, dynamic } from "../../route";
