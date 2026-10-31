/**
 * NAVIGAZIONE: capire su che pagina siamo e accorgerci quando cambia
 *
 * Netflix è una "single page app": passando dalla home (/browse) al player
 * (/watch/123) la pagina NON si ricarica, cambia solo l'URL tramite
 * history.pushState. Nessun evento del browser segnala pushState, quindi lo
 * "avvolgiamo": sostituiamo la funzione originale con una nostra che chiama
 * quella vera e poi ci avvisa.
 *
 * Era questa la causa del vecchio bug "devo ricaricare la pagina": il
 * manifest arrivava quando l'URL era ancora /browse, l'estensione lo
 * scartava, e al cambio di URL nessuno la richiamava.
 */
import { log } from "../log";

/**
 * Legge l'id del video dall'URL: "/watch/81234567?trackId=…" → 81234567.
 * Restituisce null se non siamo nel player.
 */
export function getWatchIdFromUrl(): number | null {
  const match = /^\/watch\/(\d+)/.exec(window.location.pathname);
  return match ? Number(match[1]) : null;
}

/**
 * Chiama `onChange` ogni volta che cambia l'URL della pagina:
 *  - pushState / replaceState (navigazione interna di Netflix);
 *  - popstate (tasti avanti/indietro del browser).
 *
 * Le chiamate con lo stesso URL di prima vengono ignorate.
 */
export function watchUrlChanges(onChange: () => void): void {
  let lastHref = window.location.href;

  const notifyIfChanged = (): void => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    log.debug("URL cambiato:", lastHref);
    try {
      onChange();
    } catch (error) {
      log.error("errore nel gestore del cambio URL", error);
    }
  };

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      notifyIfChanged();
      return result;
    };
  }

  window.addEventListener("popstate", notifyIfChanged);
}
