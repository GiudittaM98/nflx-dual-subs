/**
 * CALIBRAZIONE AUTOMATICA DEL TEMPO
 *
 * Idea: Netflix continua a disegnare i suoi sottotitoli (noi li rendiamo
 * solo invisibili), e quelli sono SEMPRE sincronizzati, pubblicità o no.
 * La nostra traccia principale è la stessa lingua, quindi contiene le
 * stesse battute.
 *
 * Quando nei sottotitoli nativi compare una battuta nuova:
 *  1. ne leggiamo il testo;
 *  2. cerchiamo le battute con lo stesso testo nella nostra traccia;
 *  3. sappiamo che in questo istante il film è a `battuta.begin`, quindi
 *     la correzione giusta è  offset = battuta.begin - baseTime().
 *
 * Accorgimenti contro gli abbinamenti sbagliati:
 *  - il confronto ignora maiuscole, spazi e punteggiatura (Netflix unisce
 *    le righe senza spazi nel textContent);
 *  - si ignorano i testi troppo corti ("Sì.", "Ok") che compaiono molte
 *    volte nel film;
 *  - se la stessa frase compare più volte, si sceglie quella che richiede
 *    la correzione più vicina a quella attuale;
 *  - una nuova correzione si applica solo se DUE misure consecutive sono
 *    d'accordo, e solo se differisce di almeno APPLY_THRESHOLD_S.
 *
 * Se il sottotitolo principale è "Disattivati", non c'è niente da
 * confrontare e la correzione resta quella che era.
 */
import { log } from "../log";
import { SELECTORS } from "../netflix/selectors";
import type { SubtitleTrack } from "../subtitles/SubtitleTrack";
import { MIN_MATCH_LENGTH, normalizeForMatch } from "../subtitles/normalizeText";
import type { Cue } from "../subtitles/ttml";
import type { PlayerClock } from "./PlayerClock";

const POLL_INTERVAL_MS = 100;
const APPLY_THRESHOLD_S = 0.4;
const AGREEMENT_TOLERANCE_S = 0.5;

export class Calibrator {
  /** Indice testo normalizzato → battute, per la traccia indicizzata. */
  private index = new Map<string, Cue[]>();
  private indexedTrack: SubtitleTrack | null = null;
  private lastNativeText = "";
  private lastPollAt = 0;
  /** Prima misura in attesa di conferma. */
  private pendingOffset: number | null = null;

  constructor(private readonly clock: PlayerClock) {}

  /** Da chiamare quando cambia la traccia principale. */
  reset(): void {
    this.index.clear();
    this.indexedTrack = null;
    this.lastNativeText = "";
    this.pendingOffset = null;
  }

  /**
   * Da chiamare a ogni frame: lavora al massimo ogni POLL_INTERVAL_MS.
   * `primary` è la nostra traccia principale (deve essere "ready").
   */
  poll(primary: SubtitleTrack | null): void {
    const now = performance.now();
    if (now - this.lastPollAt < POLL_INTERVAL_MS) return;
    this.lastPollAt = now;
    if (!primary || primary.state !== "ready") return;

    const nativeText = document.querySelector(SELECTORS.nativeSubtitles)?.textContent ?? "";
    if (nativeText === this.lastNativeText) return;
    this.lastNativeText = nativeText;

    const normalized = normalizeForMatch(nativeText);
    if (normalized.length < MIN_MATCH_LENGTH) return;

    this.ensureIndex(primary);
    const candidates = this.index.get(normalized);
    if (!candidates) return;

    const base = this.clock.baseTime();
    const current = this.clock.getOffset();
    let best: number | null = null;
    for (const cue of candidates) {
      const implied = cue.begin - base;
      if (best === null || Math.abs(implied - current) < Math.abs(best - current)) best = implied;
    }
    if (best === null) return;

    if (Math.abs(best - current) < APPLY_THRESHOLD_S) {
      this.pendingOffset = null; // siamo già sincronizzati
      return;
    }

    if (this.pendingOffset !== null && Math.abs(this.pendingOffset - best) < AGREEMENT_TOLERANCE_S) {
      this.clock.setOffset(best);
      this.pendingOffset = null;
      log.info(`calibrazione: correzione del tempo ${best.toFixed(2)} s`);
    } else {
      this.pendingOffset = best;
      log.debug(`calibrazione: misura ${best.toFixed(2)} s in attesa di conferma`);
    }
  }

  /** Costruisce l'indice dei testi della traccia (una volta per traccia). */
  private ensureIndex(track: SubtitleTrack): void {
    if (this.indexedTrack === track) return;
    this.index.clear();
    for (const cue of track.allCues) {
      const key = normalizeForMatch(cue.text);
      if (key.length < MIN_MATCH_LENGTH) continue;
      const list = this.index.get(key);
      if (list) list.push(cue);
      else this.index.set(key, [cue]);
    }
    this.indexedTrack = track;
  }
}
