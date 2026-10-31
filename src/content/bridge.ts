/**
 * CONTENT SCRIPT (mondo isolato) — il "ponte" verso chrome.storage
 *
 * È l'unico pezzo, oltre al popup, che usa le API chrome.*. Fa tre cose:
 *
 *  1. All'avvio legge le impostazioni e le manda alla pagina.
 *  2. Ascolta i messaggi della pagina:
 *       - "request-settings" → risponde con le impostazioni attuali;
 *       - "update-settings"  → le aggiorna nello storage.
 *  3. Ascolta chrome.storage.onChanged: ogni volta che le impostazioni
 *     cambiano (dal popup o da "update-settings") le rimanda alla pagina.
 *
 * Flusso tipico quando cambi la dimensione del testo dal popup:
 *   popup scrive nello storage → onChanged qui → postMessage alla pagina
 *   → SettingsClient della pagina → Overlay aggiorna la dimensione.
 *
 * Nota sull'avvio: pagina e content script partono entrambi a
 * document_start ma l'ordine non è garantito. Per questo facciamo DUE cose:
 * il content manda le impostazioni appena le ha, E la pagina le chiede
 * appena è pronta. Qualunque parta per primo, almeno uno dei due messaggi
 * arriva a destinazione.
 */
import { MESSAGE_NAMESPACE, isPageToContent, type ContentToPageMessage } from "../shared/messages";
import { STORAGE_KEY, normalizeSettings, type Settings } from "../shared/settings";

/** Legge le impostazioni dallo storage (con i default per i campi mancanti). */
async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeSettings(stored[STORAGE_KEY]);
}

/**
 * Applica una modifica parziale alle impostazioni salvate.
 * Non serve avvisare la pagina qui: lo farà il listener di onChanged.
 */
async function writeSettings(patch: Partial<Settings>): Promise<void> {
  const current = await readSettings();
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeSettings({ ...current, ...patch }) });
}

/** Manda le impostazioni complete alla pagina. */
function sendSettingsToPage(settings: Settings): void {
  const message: ContentToPageMessage = { ns: MESSAGE_NAMESPACE, to: "page", type: "settings", settings };
  window.postMessage(message, window.location.origin);
}

/**
 * Errori tipici qui: "Extension context invalidated", quando ricarichi
 * l'estensione da chrome://extensions senza ricaricare la scheda.
 * Non sono gravi: basta ricaricare la pagina di Netflix.
 */
function reportError(error: unknown): void {
  console.warn("[DualSubs/content]", error);
}

window.addEventListener("message", (event: MessageEvent) => {
  // Accettiamo solo messaggi mandati dalla stessa finestra (non da iframe)
  if (event.source !== window) return;
  const message = event.data;
  if (!isPageToContent(message)) return;

  if (message.type === "request-settings") {
    readSettings().then(sendSettingsToPage).catch(reportError);
  } else if (message.type === "update-settings") {
    writeSettings(message.patch).catch(reportError);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(STORAGE_KEY in changes)) return;
  sendSettingsToPage(normalizeSettings(changes[STORAGE_KEY].newValue));
});

readSettings().then(sendSettingsToPage).catch(reportError);
