/**
 * ACCESSO AL PLAYER INTERNO DI NETFLIX
 *
 * Netflix espone (non ufficialmente) un oggetto globale `netflix` con le
 * API del suo player. A noi interessano tre funzioni:
 *   - getCurrentTime(): posizione nel CONTENUTO in millisecondi;
 *   - play() / pause().
 *
 * Perché non basta video.currentTime: con gli account con pubblicità,
 * currentTime del <video> conta anche gli annunci già visti, mentre i tempi
 * dei sottotitoli sono relativi al solo film. Il tempo del player di
 * Netflix dovrebbe escludere gli annunci. Non essendo un'API documentata,
 * TUTTO qui è racchiuso in try/catch: se Netflix la cambia, si ritorna in
 * automatico a usare il <video> (e la calibrazione di Calibrator.ts
 * corregge lo stesso lo sfasamento).
 */

export interface NetflixPlayer {
  getCurrentTime(): number;
  play(): void;
  pause(): void;
}

/**
 * Restituisce il player della sessione di riproduzione attuale, o null.
 *
 * Netflix può avere più "sessioni" contemporanee (es. l'anteprima nella
 * home e il film). Preferiamo quella il cui id inizia con "watch", che è
 * quella del player a schermo intero.
 */
export function findNetflixPlayer(): NetflixPlayer | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const netflix = (window as any).netflix;
    const videoPlayer = netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    const sessionIds: unknown = videoPlayer?.getAllPlayerSessionIds?.();
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return null;

    const ids = sessionIds.filter((id): id is string => typeof id === "string");
    const sessionId = ids.find((id) => id.startsWith("watch")) ?? ids[ids.length - 1];
    if (!sessionId) return null;

    const player = videoPlayer.getVideoPlayerBySessionId(sessionId);
    if (
      player &&
      typeof player.getCurrentTime === "function" &&
      typeof player.play === "function" &&
      typeof player.pause === "function"
    ) {
      return player as NetflixPlayer;
    }
  } catch {
    /* API non disponibile o cambiata */
  }
  return null;
}
