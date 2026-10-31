/**
 * LOG IN CONSOLE
 *
 * Tutti i messaggi hanno il prefisso [DualSubs], così in DevTools puoi
 * filtrarli scrivendo "DualSubs" nella casella di ricerca della console.
 *
 * Le funzioni della console vengono COPIATE all'avvio (lo script parte
 * prima di Netflix): se Netflix o un'altra estensione le sostituiscono in
 * seguito, i nostri messaggi continuano ad apparire.
 *
 * I messaggi "debug" (molto dettagliati) sono spenti di default.
 * Per accenderli, nella console di Netflix scrivi:
 *     localStorage.setItem("dualsubs:debug", "1")
 * e ricarica la pagina. Per spegnerli: localStorage.removeItem("dualsubs:debug").
 * Vengono stampati con console.info, quindi si vedono anche senza attivare
 * il livello "Dettagliato" della console.
 */
const PREFIX = "%c[DualSubs]";
const STYLE = "color:#e5a00d;font-weight:bold";

const original = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function isDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem("dualsubs:debug") === "1";
  } catch {
    return false;
  }
}

const DEBUG = isDebugEnabled();

export const log = {
  debug: (...args: unknown[]): void => {
    if (DEBUG) original.info(PREFIX, STYLE, "[debug]", ...args);
  },
  info: (...args: unknown[]): void => original.info(PREFIX, STYLE, ...args),
  warn: (...args: unknown[]): void => original.warn(PREFIX, STYLE, ...args),
  error: (...args: unknown[]): void => original.error(PREFIX, STYLE, ...args),
};
