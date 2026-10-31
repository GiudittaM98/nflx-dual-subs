/**
 * INTERCETTAZIONE DEL MANIFEST
 *
 * Il player di Netflix scarica il manifest (vedi types.ts) con una
 * richiesta XHR a un indirizzo del tipo
 *     https://www.netflix.com/playapi/cadmium/manifest/1?…
 * e la risposta è JSON.
 *
 * Intercettiamo la RICHIESTA, non la decodifica:
 *  - XMLHttpRequest: "avvolgiamo" open() per ricordarci l'URL e send() per
 *    aggiungere un listener "load" alle richieste del manifest; quando la
 *    risposta arriva la leggiamo noi, qualunque sia il suo responseType;
 *  - fetch: stesso controllo sull'URL, leggendo una copia (clone) della
 *    risposta, così Netflix riceve l'originale intatto.
 *
 * Perché non basta JSON.parse (come nella versione 1): il player può
 * salvarsi un riferimento a JSON.parse quando si carica, o lasciare che sia
 * il browser a decodificare (responseType "json"); in entrambi i casi il
 * nostro JSON.parse non viene mai chiamato. L'hook su JSON.parse resta solo
 * come rete di sicurezza.
 *
 * Netflix fa anche una seconda richiesta, /msl/…/licensedmanifest, cifrata
 * con il suo protocollo di sicurezza (MSL): non è leggibile e la ignoriamo.
 *
 * Il formato del manifest è cambiato nel tempo: la lettura è in
 * manifestFormat.ts, che li supporta entrambi.
 *
 * Il codice deve girare PRIMA che Netflix faccia la richiesta: per questo
 * lo script della pagina è dichiarato con "run_at": "document_start" e
 * "world": "MAIN".
 *
 * Se Netflix cambia l'indirizzo del manifest, va aggiornato MANIFEST_URL.
 * Se cambia la struttura, compare in console l'avviso "risposta del
 * manifest senza tracce riconoscibili" con i nomi dei campi trovati.
 */
import { log } from "../log";
import { looksLikeManifest, parseManifest, type ParsedManifest } from "./manifestFormat";
import type { RawManifest } from "./types";

/** Indirizzi delle richieste del manifest (non cifrate). */
const MANIFEST_URL = /\/playapi\/cadmium\/(licensed)?manifest/i;
/** Richieste cifrate MSL: illeggibili, da ignorare. */
const ENCRYPTED_URL = /\/msl\//i;

function isReadableManifestUrl(url: string): boolean {
  return MANIFEST_URL.test(url) && !ENCRYPTED_URL.test(url);
}

/** Legge l'id del contenuto dall'URL della richiesta (mainContentViewableId=…). */
function movieIdFromUrl(url: string | null): number | null {
  if (!url) return null;
  try {
    const value = Number(new URL(url, window.location.href).searchParams.get("mainContentViewableId"));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Copia dell'originale, salvata prima che chiunque possa sostituirlo. */
const originalParse = JSON.parse;

type ManifestHandler = (manifest: ParsedManifest) => void;
type DataHandler = (data: unknown, source: string, url: string | null) => void;
type TextHandler = (text: string, source: string, url: string) => void;

/**
 * Cerca il manifest dentro una risposta già decodificata.
 * Di solito sta nel campo "result"; per robustezza scendiamo fino a 3
 * livelli negli oggetti (non negli array, che nel manifest sono enormi).
 */
function findManifest(value: unknown, depth = 0): RawManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (looksLikeManifest(value)) return value;
  if (depth >= 3) return null;
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findManifest(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Elenco dei campi di primo e secondo livello, per i messaggi di diagnosi. */
function describeShape(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value;
  return Object.entries(value as Record<string, unknown>)
    .map(([key, child]) =>
      child && typeof child === "object" && !Array.isArray(child)
        ? `${key}{${Object.keys(child).slice(0, 15).join(",")}}`
        : key
    )
    .join(", ");
}

/**
 * Installa l'intercettazione. `onManifest` viene chiamata per ogni
 * manifest trovato, già convertito in ParsedManifest (anche quelli delle anteprime nella home: sarà il
 * Controller a decidere quale usare). Lo stesso manifest può arrivare
 * due volte (XHR + JSON.parse): il Controller lo gestisce senza problemi.
 */
export function installManifestInterceptor(onManifest: ManifestHandler): void {
  /**
   * Punto unico in cui arrivano i dati decodificati.
   * `url` è l'indirizzo della richiesta del manifest (null se i dati
   * arrivano da JSON.parse): serve a ricavare l'id del contenuto e, se
   * non riconosciamo la struttura, a mostrare un avviso.
   */
  const handleData = (data: unknown, source: string, url: string | null): void => {
    try {
      const raw = findManifest(data);
      const manifest = raw ? parseManifest(raw, movieIdFromUrl(url)) : null;
      if (raw && !manifest) {
        log.warn("manifest trovato ma senza id del contenuto", source);
      } else if (manifest) {
        log.debug(`manifest (formato ${manifest.format}) trovato tramite ${source}`);
        queueMicrotask(() => {
          try {
            onManifest(manifest);
          } catch (error) {
            log.error("errore nella gestione del manifest", error);
          }
        });
      } else if (url) {
        log.warn(`risposta del manifest senza tracce riconoscibili (${source}). Campi:`, describeShape(data));
      }
    } catch {
      /* mai propagare errori a Netflix */
    }
  };

  const handleText = (text: string, source: string, url: string): void => {
    try {
      handleData(originalParse(text), source, url);
    } catch (error) {
      log.warn(`risposta del manifest non è JSON (${source})`, error);
    }
  };

  installXhrHook(handleData, handleText);
  installFetchHook(handleText);
  installJsonParseHook(handleData);
  log.debug("intercettazione del manifest installata");
}

/**
 * XMLHttpRequest: open() salva l'URL, send() aggiunge il listener "load"
 * solo per le richieste del manifest.
 */
function installXhrHook(
  handleData: DataHandler,
  handleText: TextHandler
): void {
  const urls = new WeakMap<XMLHttpRequest, string>();
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    try {
      urls.set(this, String(args[1]));
    } catch {
      /* ignorato */
    }
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = urls.get(this) ?? "";
    if (isReadableManifestUrl(url)) {
      log.debug("richiesta del manifest (XHR):", url.split("?")[0]);
      this.addEventListener("load", () => readXhrResponse(this, url, handleData, handleText));
    }
    return originalSend.call(this, body);
  };
}

/** Legge la risposta di un XHR qualunque sia il suo responseType. */
function readXhrResponse(
  xhr: XMLHttpRequest,
  url: string,
  handleData: DataHandler,
  handleText: TextHandler
): void {
  try {
    const source = `XHR/${xhr.responseType || "text"}`;
    switch (xhr.responseType) {
      case "":
      case "text":
        return handleText(xhr.responseText, source, url);
      case "json":
        return handleData(xhr.response, source, url);
      case "arraybuffer":
        return handleText(new TextDecoder().decode(xhr.response as ArrayBuffer), source, url);
      case "blob":
        void (xhr.response as Blob).text().then((text) => handleText(text, source, url));
        return;
      default:
        log.warn("manifest con responseType non gestito:", xhr.responseType);
    }
  } catch (error) {
    log.warn("impossibile leggere la risposta del manifest", error);
  }
}

/** fetch: legge una copia della risposta se l'URL è quello del manifest. */
function installFetchHook(handleText: TextHandler): void {
  const originalFetch = window.fetch;
  window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const response = await originalFetch.call(this ?? window, input, init);
    try {
      const url =
        response.url ||
        (typeof input === "string" ? input : input instanceof Request ? input.url : String(input));
      if (isReadableManifestUrl(url)) {
        log.debug("richiesta del manifest (fetch):", url.split("?")[0]);
        void response
          .clone()
          .text()
          .then((text) => handleText(text, "fetch", url))
          .catch(() => undefined);
      }
    } catch {
      /* ignorato */
    }
    return response;
  } as typeof window.fetch;
}

/** Rete di sicurezza: il vecchio metodo, nel caso Netflix torni a usarlo. */
function installJsonParseHook(
  handleData: DataHandler
): void {
  JSON.parse = function (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const result = originalParse.call(JSON, text, reviver as Parameters<typeof JSON.parse>[1]);
    if (typeof text === "string" && text.length > 10_000) handleData(result, "JSON.parse", null);
    return result;
  };
}
