/**
 * IMPOSTAZIONI DELL'ESTENSIONE
 *
 * Questo file è condiviso da tutti e tre i bundle (pagina, content script,
 * popup). Contiene solo tipi, costanti e funzioni pure: niente accesso a
 * chrome.* né al DOM, così può girare ovunque.
 *
 * Dove vivono le impostazioni: in chrome.storage.local, sotto la chiave
 * STORAGE_KEY. Solo il popup e il content script possono leggerle/scriverle
 * direttamente; la pagina le riceve tramite messaggi (vedi messages.ts).
 */

/** Quale sottotitolo sfocare (si rivela passandoci sopra col mouse). */
export type HideMode = "none" | "primary" | "secondary" | "both";

/** Livello di dimensione del testo: indice dentro FONT_SCALES. */
export type FontSizeLevel = 0 | 1 | 2 | 3 | 4;

export interface Settings {
  /** Dimensione del testo (0 = piccolo … 4 = grande). */
  fontSize: FontSizeLevel;
  /** Sottotitolo/i da sfocare. */
  hide: HideMode;
  /** Se true: col mouse sopra i sottotitoli, il video si ferma a fine battuta. */
  pauseOnHover: boolean;
  /**
   * Codice lingua (BCP-47, es. "en", "ja") dell'ultimo sottotitolo secondario
   * scelto. Serve a riattivarlo da solo al prossimo episodio/film.
   * null = nessuna preferenza.
   */
  secondaryLang: string | null;
}

export const STORAGE_KEY = "settings";

/** Moltiplicatore della dimensione del testo per ogni livello. */
export const FONT_SCALES: Readonly<Record<FontSizeLevel, number>> = {
  0: 0.7,
  1: 0.85,
  2: 1,
  3: 1.25,
  4: 1.5,
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  fontSize: 2,
  hide: "none",
  pauseOnHover: true,
  secondaryLang: null,
});

const HIDE_MODES: readonly HideMode[] = ["none", "primary", "secondary", "both"];

/**
 * Trasforma un valore qualsiasi (letto dallo storage o arrivato da un
 * messaggio) in un oggetto Settings valido.
 *
 * Logica: per ogni campo, se il valore ricevuto è del tipo giusto lo tiene,
 * altrimenti usa il default. Così:
 *  - le impostazioni salvate dalla versione vecchia dell'estensione
 *    (che aveva solo fontSize e hide) vengono riprese senza errori;
 *  - un valore corrotto (es. hide = 3 per via del vecchio bug in
 *    content.ts) torna al default invece di rompere tutto.
 */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const fontSize =
    typeof s.fontSize === "number" && Number.isInteger(s.fontSize) && s.fontSize >= 0 && s.fontSize <= 4
      ? (s.fontSize as FontSizeLevel)
      : DEFAULT_SETTINGS.fontSize;

  const hide = HIDE_MODES.includes(s.hide as HideMode) ? (s.hide as HideMode) : DEFAULT_SETTINGS.hide;

  const pauseOnHover =
    typeof s.pauseOnHover === "boolean" ? s.pauseOnHover : DEFAULT_SETTINGS.pauseOnHover;

  const secondaryLang =
    typeof s.secondaryLang === "string" && s.secondaryLang.length > 0 ? s.secondaryLang : null;

  return { fontSize, hide, pauseOnHover, secondaryLang };
}
