/**
 * PROTOCOLLO DI COMUNICAZIONE PAGINA ⇄ CONTENT SCRIPT
 *
 * Perché serve: lo script della pagina (src/page) gira nel "MAIN world",
 * cioè dentro la pagina di Netflix, dove può intercettare il manifest e
 * leggere il player, ma NON ha accesso a chrome.storage. Il content script
 * (src/content) gira in un mondo isolato: ha chrome.storage ma non vede le
 * variabili di Netflix. I due mondi condividono però la stessa finestra,
 * quindi parlano tramite window.postMessage.
 *
 * Ogni messaggio ha:
 *  - ns:   un "namespace" fisso, per ignorare i messaggi di Netflix o di
 *          altre estensioni che passano per la stessa finestra;
 *  - to:   il destinatario ("content" o "page"), così ognuno ignora i
 *          messaggi che ha mandato lui stesso;
 *  - type: il tipo di messaggio.
 *
 * Messaggi:
 *  pagina → content  "request-settings"  "mandami le impostazioni attuali"
 *  pagina → content  "update-settings"   "salva queste modifiche" (patch)
 *  content → pagina  "settings"          "ecco le impostazioni (complete)"
 */
import type { Settings } from "./settings";

export const MESSAGE_NAMESPACE = "netflix-dual-subs";

export type PageToContentMessage =
  | { ns: typeof MESSAGE_NAMESPACE; to: "content"; type: "request-settings" }
  | { ns: typeof MESSAGE_NAMESPACE; to: "content"; type: "update-settings"; patch: Partial<Settings> };

export type ContentToPageMessage = {
  ns: typeof MESSAGE_NAMESPACE;
  to: "page";
  type: "settings";
  settings: Settings;
};

/** Controlla che un dato ricevuto via postMessage sia un nostro messaggio. */
function isOurMessage(data: unknown): data is { ns: string; to: string; type: string } {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.ns === MESSAGE_NAMESPACE && typeof d.to === "string" && typeof d.type === "string";
}

/** true se il messaggio è diretto al content script. */
export function isPageToContent(data: unknown): data is PageToContentMessage {
  return isOurMessage(data) && data.to === "content";
}

/** true se il messaggio è diretto alla pagina. */
export function isContentToPage(data: unknown): data is ContentToPageMessage {
  return isOurMessage(data) && data.to === "page";
}
