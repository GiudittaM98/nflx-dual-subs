/**
 * RICONOSCIMENTO DEL SOTTOTITOLO PRINCIPALE
 *
 * Problema: per sapere quale sottotitolo è attivo in Netflix avevamo due
 * fonti, entrambe incerte:
 *  - il manifest (recommendedMedia), che nel formato attuale potrebbe non
 *    dirlo più;
 *  - i click sul menu nativo, che però non ci sono se l'utente non apre il
 *    menu (Netflix ricorda l'ultima lingua usata).
 *
 * Soluzione: guardiamo cosa mostra Netflix. Quando compare una battuta nei
 * sottotitoli nativi, cerchiamo quale delle nostre tracce contiene quel
 * testo. Le tracce sono piccole (pochi KB), quindi alla prima battuta
 * scarichiamo tutte quelle disponibili.
 *
 * Viene usato da PlaybackSession solo finché il principale non è noto e
 * l'utente non l'ha scelto a mano (anche "Disattivati" conta come scelta).
 */
import { SELECTORS } from "../netflix/selectors";
import { MIN_MATCH_LENGTH, normalizeForMatch } from "../subtitles/normalizeText";
import type { SubtitleTrack } from "../subtitles/SubtitleTrack";

const POLL_INTERVAL_MS = 300;

export class PrimaryDetector {
  private lastPollAt = 0;
  private lastText = "";
  private downloadsStarted = false;

  constructor(private readonly tracks: readonly SubtitleTrack[]) {}

  /**
   * Da chiamare a ogni frame (lavora al massimo ogni POLL_INTERVAL_MS).
   * Restituisce la traccia riconosciuta, oppure null se non è ancora
   * possibile dirlo.
   */
  poll(): SubtitleTrack | null {
    const now = performance.now();
    if (now - this.lastPollAt < POLL_INTERVAL_MS) return null;
    this.lastPollAt = now;

    const text = document.querySelector(SELECTORS.nativeSubtitles)?.textContent ?? "";
    const normalized = normalizeForMatch(text);
    if (normalized.length < MIN_MATCH_LENGTH) return null;

    if (!this.downloadsStarted) {
      this.downloadsStarted = true;
      for (const track of this.tracks) {
        if (track.isAvailable && track.state === "idle") track.load().catch(() => undefined);
      }
    }

    // Stesso testo già analizzato con tutte le tracce pronte: inutile ripetere
    const stillLoading = this.tracks.some((t) => t.state === "loading");
    if (text === this.lastText && !stillLoading) return null;
    if (!stillLoading) this.lastText = text;

    const matches = this.tracks.filter((t) => t.hasText(normalized));
    if (matches.length === 0) return null;
    // Se la frase è identica nei sottotitoli normali e nei CC, preferiamo i normali
    return matches.find((t) => !t.isClosedCaptions) ?? matches[0];
  }
}
