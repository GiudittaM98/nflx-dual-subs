/**
 * OROLOGIO DEL CONTENUTO (+ comandi play/pausa)
 *
 * Risponde alla domanda: "a che secondo del FILM siamo?", che è il valore
 * da confrontare con i tempi dei sottotitoli.
 *
 *   now() = baseTime() + offset
 *
 * baseTime(): il tempo del player interno di Netflix se disponibile
 *             (dovrebbe già escludere la pubblicità), altrimenti
 *             video.currentTime.
 * offset:     correzione in secondi stimata dal Calibrator confrontando i
 *             sottotitoli nativi di Netflix con i nostri. Parte da 0.
 *             Se dopo una pubblicità i sottotitoli risultano in ritardo
 *             di 30 s, il Calibrator imposta offset = -30.
 *
 * La versione vecchia usava solo video.currentTime: con gli account con
 * pubblicità i sottotitoli andavano sempre più in ritardo a ogni
 * interruzione.
 */
import { log } from "../log";
import { findNetflixPlayer, type NetflixPlayer } from "../netflix/playerApi";

/** Ogni quanto riprovare a cercare il player Netflix se non c'è. */
const PLAYER_LOOKUP_INTERVAL_MS = 2000;

export class PlayerClock {
  private player: NetflixPlayer | null = null;
  private lastLookupAt = -Infinity;
  private offset = 0;

  constructor(private readonly video: HTMLVideoElement) {}

  /** Secondo del contenuto da usare per i sottotitoli. */
  now(): number {
    return this.baseTime() + this.offset;
  }

  /** Tempo "grezzo", senza la correzione del Calibrator. */
  baseTime(): number {
    const player = this.getPlayer();
    if (player) {
      try {
        const ms = player.getCurrentTime();
        if (Number.isFinite(ms) && ms >= 0) return ms / 1000;
      } catch {
        this.player = null; // l'API si è rotta: torniamo al <video>
      }
    }
    return this.video.currentTime;
  }

  getOffset(): number {
    return this.offset;
  }

  setOffset(seconds: number): void {
    this.offset = seconds;
  }

  /**
   * Mette in pausa. Preferisce l'API di Netflix (così il player aggiorna
   * correttamente la sua interfaccia); in mancanza usa il <video>.
   */
  pause(): void {
    try {
      const player = this.getPlayer();
      if (player) return player.pause();
    } catch {
      /* fallback sotto */
    }
    this.video.pause();
  }

  /** Riprende la riproduzione (stessa logica di pause). */
  play(): void {
    try {
      const player = this.getPlayer();
      if (player) return player.play();
    } catch {
      /* fallback sotto */
    }
    void this.video.play().catch(() => undefined);
  }

  /**
   * Restituisce il player di Netflix, cercandolo al massimo una volta ogni
   * PLAYER_LOOKUP_INTERVAL_MS (cercarlo a ogni frame sarebbe uno spreco).
   */
  private getPlayer(): NetflixPlayer | null {
    if (this.player) return this.player;
    const now = performance.now();
    if (now - this.lastLookupAt < PLAYER_LOOKUP_INTERVAL_MS) return null;
    this.lastLookupAt = now;
    this.player = findNetflixPlayer();
    if (this.player) log.info("uso il tempo del player Netflix");
    return this.player;
  }
}
