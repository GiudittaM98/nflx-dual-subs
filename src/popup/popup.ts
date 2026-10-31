/**
 * POPUP DELLE IMPOSTAZIONI
 *
 * Si apre cliccando l'icona dell'estensione. Funziona così:
 *  1. legge le impostazioni da chrome.storage e le mostra (render);
 *  2. a ogni click salva la modifica in chrome.storage;
 *  3. ascolta chrome.storage.onChanged e ridisegna.
 *
 * Non manda messaggi alla scheda di Netflix: il content script ascolta già
 * onChanged e inoltra le impostazioni alla pagina (vedi content/bridge.ts).
 * Con la versione vecchia il popup doveva trovare la scheda attiva e
 * mandarle un messaggio, e non funzionava se la scheda attiva non era
 * Netflix.
 */
import {
  FONT_SCALES,
  STORAGE_KEY,
  normalizeSettings,
  type FontSizeLevel,
  type HideMode,
  type Settings,
} from "../shared/settings";

let current: Settings = normalizeSettings(undefined);

const fontButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#font-sizes button"));
const hideButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#hide-modes button"));
const pauseCheckbox = document.getElementById("pause-on-hover") as HTMLInputElement;
const previewPrimary = document.getElementById("preview-primary") as HTMLElement;
const previewSecondary = document.getElementById("preview-secondary") as HTMLElement;
const secondaryNote = document.getElementById("secondary-note") as HTMLElement;

/** Aggiorna tutti i controlli e l'anteprima in base a `current`. */
function render(): void {
  for (const button of fontButtons) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.size) === current.fontSize));
  }
  for (const button of hideButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.hide === current.hide));
  }
  pauseCheckbox.checked = current.pauseOnHover;

  document.documentElement.style.setProperty("--scale", String(FONT_SCALES[current.fontSize]));
  previewPrimary.classList.toggle("blurred", current.hide === "primary" || current.hide === "both");
  previewSecondary.classList.toggle("blurred", current.hide === "secondary" || current.hide === "both");

  renderSecondaryNote();
}

/** Spiega quale lingua secondaria verrà riattivata, con un pulsante per dimenticarla. */
function renderSecondaryNote(): void {
  secondaryNote.replaceChildren();
  if (!current.secondaryLang) {
    secondaryNote.textContent =
      "Scegli il secondo sottotitolo dal menu Audio e sottotitoli di Netflix: verrà riattivato a ogni episodio.";
    return;
  }
  const name = languageName(current.secondaryLang);
  secondaryNote.append(`Secondo sottotitolo automatico: ${name}.`);
  const forget = document.createElement("button");
  forget.type = "button";
  forget.textContent = "Disattiva";
  forget.addEventListener("click", () => save({ secondaryLang: null }));
  secondaryNote.append(forget);
}

/** "en" → "inglese" (nella lingua del browser); se non riesce, il codice. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Salva una modifica; render avverrà tramite onChanged. */
function save(patch: Partial<Settings>): void {
  current = normalizeSettings({ ...current, ...patch });
  render(); // risposta immediata, senza aspettare lo storage
  void chrome.storage.local.set({ [STORAGE_KEY]: current });
}

for (const button of fontButtons) {
  button.addEventListener("click", () => save({ fontSize: Number(button.dataset.size) as FontSizeLevel }));
}
for (const button of hideButtons) {
  button.addEventListener("click", () => save({ hide: button.dataset.hide as HideMode }));
}
pauseCheckbox.addEventListener("change", () => save({ pauseOnHover: pauseCheckbox.checked }));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(STORAGE_KEY in changes)) return;
  current = normalizeSettings(changes[STORAGE_KEY].newValue);
  render();
});

void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  current = normalizeSettings(stored[STORAGE_KEY]);
  render();
});

render();
