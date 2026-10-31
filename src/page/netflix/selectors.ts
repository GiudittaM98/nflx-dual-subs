/**
 * SELETTORI CSS DEL PLAYER DI NETFLIX
 *
 * Tutti i punti in cui dipendiamo dalla struttura HTML di Netflix sono
 * raccolti qui. Quando Netflix aggiorna il sito e qualcosa smette di
 * funzionare (il menu secondario non compare, i sottotitoli finiscono nel
 * posto sbagliato…), di solito basta ispezionare la pagina con DevTools e
 * aggiornare questi selettori.
 */
export const SELECTORS = {
  /** Contenitore principale del player (a schermo intero). */
  playerRoot: '[data-uia="watch-video"], .watch-video',
  /** Barra dei controlli in basso: presente nel DOM quando è visibile. */
  controls: '[data-uia="controls-standard"]',
  /** Menu "Audio e sottotitoli" che si apre cliccando l'icona fumetto. */
  audioSubtitleMenu: '[data-uia="selector-audio-subtitle"]',
  /** Contenitore in cui Netflix disegna i SUOI sottotitoli. */
  nativeSubtitles: ".player-timedtext",
} as const;

/**
 * Trova il <video> del player.
 * Cerca prima dentro il contenitore del player, per non prendere per errore
 * i video delle anteprime nella home.
 */
export function findPlayerVideo(): HTMLVideoElement | null {
  const root = document.querySelector(SELECTORS.playerRoot);
  return (root ?? document).querySelector<HTMLVideoElement>("video");
}

/**
 * Trova l'elemento in cui inserire la nostra sovrapposizione.
 * Deve contenere il video, così resta visibile anche a schermo intero.
 */
export function findPlayerRoot(video: HTMLVideoElement): HTMLElement | null {
  return (
    video.closest<HTMLElement>(SELECTORS.playerRoot) ??
    document.querySelector<HTMLElement>(SELECTORS.playerRoot) ??
    video.parentElement
  );
}

/**
 * Aspetta che compaia il <video> del player.
 *
 * Controlla ogni 200 ms. Si risolve con:
 *  - il video, appena lo trova;
 *  - null, se scade il tempo o se isCancelled() diventa true
 *    (cioè se nel frattempo è iniziata un'altra attivazione).
 * Non va mai in errore.
 */
export function waitForVideo(
  timeoutMs: number,
  isCancelled: () => boolean
): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = (): void => {
      if (isCancelled()) return resolve(null);
      const video = findPlayerVideo();
      if (video) return resolve(video);
      if (Date.now() - startedAt > timeoutMs) return resolve(null);
      window.setTimeout(check, 200);
    };
    check();
  });
}
