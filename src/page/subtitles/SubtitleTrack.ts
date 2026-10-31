/**
 * UNA TRACCIA DI SOTTOTITOLI (una lingua)
 *
 * Ciclo di vita:
 *
 *   "idle" ──load()──▶ "loading" ──▶ "ready"   (battute disponibili)
 *                                └─▶ "error"   (nessun download riuscito;
 *                                               load() si può riprovare)
 *
 * Una traccia può esistere SENZA link di download: nel formato attuale del
 * manifest Netflix include i link solo per alcune lingue ("hydrated").
 * In quel caso isAvailable è false, load() fallisce senza cambiare stato,
 * e i link possono arrivare dopo con addSources() (da un nuovo manifest).
 *
 * Il file viene scaricato solo la prima volta che la traccia viene scelta
 * (non tutte le lingue all'apertura del film). Chiamate ripetute a load()
 * restituiscono la stessa Promise, quindi il file non viene mai scaricato
 * due volte in parallelo.
 *
 * Download: si provano in ordine i formati (profili) e, per ognuno, i
 * server, fermandosi al primo che funziona. La versione vecchia usava
 * Promise.race su un array di undefined: la Promise si risolveva subito
 * (la traccia risultava "pronta" prima del download) e il file veniva
 * scaricato da tutti i server contemporaneamente.
 */
import { log } from "../log";
import type { TrackSource } from "../netflix/manifestFormat";
import { MIN_MATCH_LENGTH, normalizeForMatch } from "./normalizeText";
import { parseTtml, type Cue } from "./ttml";

export type TrackState = "idle" | "loading" | "ready" | "error";

export type { TrackSource };

export interface TrackInfo {
  /** new_track_id del manifest: identifica la traccia in modo univoco. */
  key: string;
  /** Codice lingua BCP-47. */
  lang: string;
  /** Nome della lingua come lo mostra Netflix, es. "Inglese". */
  languageDescription: string;
  /** true per i sottotitoli per non udenti (CC). */
  isClosedCaptions: boolean;
}

export class SubtitleTrack {
  readonly key: string;
  readonly lang: string;
  readonly languageDescription: string;
  readonly isClosedCaptions: boolean;
  /** Etichetta per i menu, es. "Inglese (CC)". */
  readonly label: string;

  state: TrackState = "idle";

  private cues: Cue[] = [];
  /** Durata della battuta più lunga: serve a cuesAt() per fermarsi presto. */
  private maxCueDuration = 0;
  private loadPromise: Promise<void> | null = null;
  /** Testi normalizzati delle battute (creato al primo uso di hasText). */
  private textIndex: Set<string> | null = null;
  private sources: TrackSource[];

  constructor(info: TrackInfo, sources: TrackSource[]) {
    this.sources = sources;
    this.key = info.key;
    this.lang = info.lang;
    this.languageDescription = info.languageDescription;
    this.isClosedCaptions = info.isClosedCaptions;
    this.label = info.languageDescription + (info.isClosedCaptions ? " (CC)" : "");
  }

  /** Tutte le battute, in ordine di inizio (vuoto finché non è "ready"). */
  get allCues(): readonly Cue[] {
    return this.cues;
  }

  /** true se abbiamo i link per scaricarla. */
  get isAvailable(): boolean {
    return this.sources.length > 0;
  }

  /**
   * Aggiunge i link di download arrivati con un manifest successivo.
   * Ha effetto solo se la traccia non ne aveva.
   */
  addSources(sources: TrackSource[]): boolean {
    if (this.isAvailable || sources.length === 0) return false;
    this.sources = sources;
    return true;
  }

  /** Scarica e legge il file (una volta sola). */
  load(): Promise<void> {
    if (!this.isAvailable) {
      return Promise.reject(new Error(`"${this.label}": link non ancora forniti da Netflix`));
    }
    if (!this.loadPromise) this.loadPromise = this.download();
    return this.loadPromise;
  }

  /**
   * true se la traccia contiene una battuta con questo testo (già
   * normalizzato con normalizeForMatch). Serve a riconoscere quale lingua
   * sta mostrando Netflix (vedi PrimaryDetector).
   */
  hasText(normalized: string): boolean {
    if (this.state !== "ready") return false;
    if (!this.textIndex) {
      this.textIndex = new Set(
        this.cues.map((c) => normalizeForMatch(c.text)).filter((t) => t.length >= MIN_MATCH_LENGTH)
      );
    }
    return this.textIndex.has(normalized);
  }

  /**
   * Battute visibili all'istante `seconds` (di solito 0 o 1, a volte 2
   * quando due battute si sovrappongono).
   *
   * Algoritmo: le battute sono ordinate per inizio, quindi con una ricerca
   * binaria troviamo la prima che inizia DOPO `seconds`; poi torniamo
   * indietro raccogliendo quelle non ancora finite. Ci fermiamo quando
   * l'inizio è più lontano della battuta più lunga: nessuna di quelle
   * precedenti può essere ancora visibile. Costo: pochi confronti per frame
   * anche con migliaia di battute (la vecchia versione le scorreva tutte
   * con filter a ogni frame).
   */
  cuesAt(seconds: number): Cue[] {
    const cues = this.cues;
    let low = 0;
    let high = cues.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cues[mid].begin <= seconds) low = mid + 1;
      else high = mid;
    }

    const visible: Cue[] = [];
    for (let i = low - 1; i >= 0; i--) {
      const cue = cues[i];
      if (seconds - cue.begin > this.maxCueDuration) break;
      if (cue.end >= seconds) visible.push(cue);
    }
    return visible.reverse();
  }

  private async download(): Promise<void> {
    this.state = "loading";
    log.info(`download sottotitoli "${this.label}"…`);

    for (const source of this.sources) {
      for (const url of source.urls) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const cues = parseTtml(await response.text());
          if (cues.length === 0) throw new Error("nessuna battuta nel file");

          this.cues = cues;
          this.textIndex = null;
          this.maxCueDuration = cues.reduce((max, c) => Math.max(max, c.end - c.begin), 0);
          this.state = "ready";
          log.info(`sottotitoli "${this.label}" pronti (${cues.length} battute, formato ${source.profile})`);
          return;
        } catch (error) {
          log.debug(`tentativo fallito per "${this.label}" (${source.profile})`, error);
        }
      }
    }

    this.state = "error";
    this.loadPromise = null; // permette di riprovare scegliendo di nuovo la traccia
    throw new Error(`impossibile scaricare i sottotitoli "${this.label}"`);
  }
}
