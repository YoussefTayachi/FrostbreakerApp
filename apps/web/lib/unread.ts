/**
 * Bruecke zwischen Inbox-Seite und Nav-Badge: markiert die Inbox Antworten als
 * gelesen, soll das Badge sofort mitziehen und nicht erst beim naechsten Poll.
 *
 * Bewusst ein Window-Event statt Supabase Realtime -- Realtime braucht aktivierte
 * Replication fuer public.messages, das Badge muss aber auch ohne funktionieren.
 */
export const UNREAD_CHANGED_EVENT = "frostbreaker:unread-changed";

export function notifyUnreadChanged(): void {
  window.dispatchEvent(new Event(UNREAD_CHANGED_EVENT));
}
