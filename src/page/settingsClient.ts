/**
 * CLIENT DELLE IMPOSTAZIONI (lato pagina)
 *
 * La pagina non può leggere chrome.storage, quindi tiene una copia locale
 * delle impostazioni, aggiornata dai messaggi del content script
 * (vedi src/content/bridge.ts e src/shared/messages.ts).
 *
 * Uso:
 *   const settings = new SettingsClient();
 *   settings.subscribe(s => ...);         // chiamata subito e a ogni cambio
 *   settings.current.fontSize;            // lettura istantanea
 *   settings.update({ secondaryLang: "en" }); // salva una modifica
 */
import {
  MESSAGE_NAMESPACE,
  isContentToPage,
  type PageToContentMessage,
} from "../shared/messages";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "../shared/settings";
import { log } from "./log";

export type SettingsListener = (settings: Settings) => void;

/** Corpo di un messaggio pagina→content, senza i campi fissi ns/to. */
type OutgoingBody =
  | { type: "request-settings" }
  | { type: "update-settings"; patch: Partial<Settings> };

export class SettingsClient {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();

  /**
   * Si mette in ascolto dei messaggi e chiede subito le impostazioni.
   * Finché non arriva la risposta, valgono i DEFAULT_SETTINGS.
   */
  constructor() {
    window.addEventListener("message", this.handleMessage);
    this.post({ type: "request-settings" });
  }

  /** Impostazioni attuali (copia locale). */
  get current(): Settings {
    return this.settings;
  }

  /**
   * Registra una funzione da chiamare a ogni cambio di impostazioni.
   * Viene chiamata anche subito, con i valori attuali.
   * Restituisce una funzione per annullare l'iscrizione.
   */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => this.listeners.delete(listener);
  }

  /**
   * Modifica alcune impostazioni.
   * Le applica subito in locale (così l'interfaccia reagisce senza
   * attese) e chiede al content script di salvarle. Il content poi
   * rimanderà le impostazioni complete, che sovrascriveranno quelle locali
   * con gli stessi valori.
   */
  update(patch: Partial<Settings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.emit();
    this.post({ type: "update-settings", patch });
  }

  /** Riceve le impostazioni dal content script. */
  private handleMessage = (event: MessageEvent): void => {
    if (event.source !== window) return;
    if (!isContentToPage(event.data)) return;
    this.settings = normalizeSettings(event.data.settings);
    log.debug("impostazioni ricevute", this.settings);
    this.emit();
  };

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.settings);
      } catch (error) {
        log.error("errore in un listener delle impostazioni", error);
      }
    }
  }

  private post(body: OutgoingBody): void {
    const message = { ns: MESSAGE_NAMESPACE, to: "content", ...body } as PageToContentMessage;
    window.postMessage(message, window.location.origin);
  }
}
