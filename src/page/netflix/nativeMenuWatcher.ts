/**
 * OSSERVATORE DEL MENU "AUDIO E SOTTOTITOLI" DI NETFLIX
 *
 * Netflix crea il menu nel DOM solo quando lo apri, e lo distrugge quando
 * lo chiudi. Per accorgercene usiamo un MutationObserver sul body.
 *
 * Quando il menu compare:
 *  - avvisiamo chi ci usa (onMenuOpened), che ci aggiunge la colonna del
 *    sottotitolo secondario;
 *  - ascoltiamo i click sulla colonna "Sottotitoli" nativa, per sapere
 *    quale lingua ha scelto l'utente come sottotitolo PRINCIPALE
 *    (onPrimaryLabelClicked riceve il testo della voce cliccata).
 *
 * Differenze rispetto alla versione vecchia:
 *  - l'observer guarda solo childList (prima anche attributes e
 *    characterData, cioè migliaia di callback inutili durante la
 *    riproduzione);
 *  - è attivo solo mentre c'è un video in riproduzione (start/stop);
 *  - un solo listener per menu (prima se ne aggiungeva uno nuovo per ogni
 *    voce a ogni apertura).
 */
import { SELECTORS } from "./selectors";

/** Classe CSS della nostra colonna, per riconoscerla e ignorarla. */
export const SECONDARY_MENU_CLASS = "dual-subs-menu";

export interface NativeMenuHandlers {
  onMenuOpened(menu: HTMLElement): void;
  onPrimaryLabelClicked(label: string): void;
}

export class NativeMenuWatcher {
  private observer: MutationObserver | null = null;
  /** Menu a cui abbiamo già collegato il listener dei click. */
  private readonly menusWithListener = new WeakSet<HTMLElement>();

  constructor(private readonly handlers: NativeMenuHandlers) {}

  /** Inizia a osservare il DOM (chiamare solo quando document.body esiste). */
  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(this.handleMutations);
    this.observer.observe(document.body, { childList: true, subtree: true });
    // Il menu potrebbe essere già aperto
    const menu = document.querySelector<HTMLElement>(SELECTORS.audioSubtitleMenu);
    if (menu) this.handleMenu(menu);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Per ogni nodo aggiunto al DOM controlla se è il menu, se lo contiene
   * o se ci sta dentro (Netflix a volte ridisegna solo una parte del menu).
   * I nodi aggiunti DENTRO la nostra colonna vengono ignorati, altrimenti
   * ogni nostro aggiornamento farebbe ripartire l'observer all'infinito.
   */
  private handleMutations = (mutations: MutationRecord[]): void => {
    let found: HTMLElement | null = null;
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.closest(`.${SECONDARY_MENU_CLASS}`)) continue;
        found =
          node.closest<HTMLElement>(SELECTORS.audioSubtitleMenu) ??
          node.querySelector<HTMLElement>(SELECTORS.audioSubtitleMenu) ??
          found;
      }
    }
    if (found) this.handleMenu(found);
  };

  private handleMenu(menu: HTMLElement): void {
    if (!this.menusWithListener.has(menu)) {
      this.menusWithListener.add(menu);
      // capture: true → riceviamo il click prima che Netflix ridisegni il menu
      menu.addEventListener("click", (event) => this.handleMenuClick(menu, event), true);
    }
    this.handlers.onMenuOpened(menu);
  }

  /**
   * Il menu nativo ha due colonne come figli diretti:
   *   [0] Audio   [1] Sottotitoli   (+ [2] la nostra, aggiunta da noi)
   * Ci interessano solo i click su una voce (<li>) della colonna [1].
   */
  private handleMenuClick(menu: HTMLElement, event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest("li");
    if (!item || !menu.contains(item)) return;

    const column = Array.from(menu.children).find((child) => child.contains(item));
    if (!column || column.classList.contains(SECONDARY_MENU_CLASS)) return;
    if (Array.from(menu.children).indexOf(column) !== 1) return;

    this.handlers.onPrimaryLabelClicked(item.textContent?.trim() ?? "");
  }
}
