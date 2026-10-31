/**
 * COLONNA "SOTTOTITOLO SECONDARIO" NEL MENU DI NETFLIX
 *
 * Aggiunge una terza colonna al menu "Audio e sottotitoli" di Netflix:
 *
 *   Audio        Sottotitoli     Secondo sottotitolo
 *   Italiano     Disattivati     Disattivato
 *   Inglese      Italiano      ✓ Inglese
 *   …            …               …
 *
 * Per sembrare nativa, copia le classi CSS dagli elementi equivalenti del
 * menu di Netflix (h3, ul, li, …). È un trucco ereditato dal progetto
 * originale: se Netflix cambia struttura, la colonna funziona comunque ma
 * potrebbe avere un aspetto diverso.
 *
 * Un solo listener di click su tutta la colonna ("event delegation"): ogni
 * <li> ha un data-index che indica la traccia (-1 = disattivato).
 */
import { SECONDARY_MENU_CLASS } from "../netflix/nativeMenuWatcher";
import type { SubtitleTrack } from "../subtitles/SubtitleTrack";

export interface SecondaryMenuState {
  tracks: readonly SubtitleTrack[];
  selected: SubtitleTrack | null;
}

const CHECK_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M3.707 12.293l-1.414 1.414L8 19.414 21.707 5.707l-1.414-1.414L8 16.586z"/></svg>`;

/** Elementi da cui copiare le classi: [selettore nel menu nativo, selettore nel nostro]. */
const CLASS_SOURCES: readonly [string, string][] = [
  ["div > h3", "h3"],
  ["div > ul", "ul"],
  ["div > ul > li", "li"],
  ["div > ul > li svg", "li svg"],
  ["div > ul > li > div > div", "li > div > div"],
];

export class SecondaryMenu {
  readonly element: HTMLDivElement;
  private tracks: readonly SubtitleTrack[] = [];

  /** `onSelect` riceve la traccia scelta, o null per "Disattivato". */
  constructor(private readonly onSelect: (track: SubtitleTrack | null) => void) {
    this.element = document.createElement("div");
    this.element.className = SECONDARY_MENU_CLASS;
    this.element.addEventListener("click", this.handleClick);
  }

  /**
   * Inserisce la colonna nel menu nativo (se non c'è già).
   * Il menu diventa più largo: lo ancoriamo a destra perché non esca
   * dallo schermo (anche questo arriva dalla versione vecchia).
   */
  mount(nativeMenu: HTMLElement): void {
    if (this.element.parentElement === nativeMenu) return;
    nativeMenu.appendChild(this.element);
    const panel = nativeMenu.parentElement?.parentElement;
    if (panel) {
      panel.style.left = "";
      panel.style.right = "20px";
    }
  }

  /** Rimuove la colonna dalla pagina. */
  unmount(): void {
    this.element.remove();
  }

  /** true se la colonna è attualmente nel menu aperto. */
  get isMounted(): boolean {
    return this.element.isConnected;
  }

  /** Ridisegna l'elenco con lo stato attuale. */
  render(state: SecondaryMenuState): void {
    this.tracks = state.tracks;

    const title = document.createElement("h3");
    title.textContent = "Secondo sottotitolo";

    const list = document.createElement("ul");
    list.appendChild(this.createItem(-1, "Disattivato", state.selected === null));
    state.tracks.forEach((track, index) => {
      let label = track.label;
      if (!track.isAvailable) label += " (non disponibile)";
      if (track === state.selected && track.state === "loading") label += " (caricamento…)";
      if (track === state.selected && track.state === "error") label += " (errore)";
      list.appendChild(this.createItem(index, label, track === state.selected));
    });

    this.element.replaceChildren(title, list);
    this.copyNativeClasses();
  }

  /**
   * Crea una voce: <li data-index><div>[✓]<div>etichetta</div></div></li>
   * L'etichetta va in textContent (mai in innerHTML), così un nome di
   * lingua strano non può iniettare HTML.
   */
  private createItem(index: number, label: string, selected: boolean): HTMLLIElement {
    const item = document.createElement("li");
    item.dataset.index = String(index);
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(selected));
    item.tabIndex = 0;

    const wrapper = document.createElement("div");
    if (selected) wrapper.insertAdjacentHTML("afterbegin", CHECK_ICON);
    const text = document.createElement("div");
    text.textContent = label;
    wrapper.appendChild(text);
    item.appendChild(wrapper);
    return item;
  }

  /** Copia le classi CSS dalla colonna "Sottotitoli" nativa alla nostra. */
  private copyNativeClasses(): void {
    const nativeMenu = this.element.parentElement;
    const nativeColumn = nativeMenu?.children[1];
    if (!nativeMenu || !nativeColumn) return;

    nativeColumn.classList.forEach((c) => this.element.classList.add(c));
    for (const [nativeSelector, ownSelector] of CLASS_SOURCES) {
      const source = nativeMenu.querySelector(nativeSelector);
      if (!source) continue;
      this.element.querySelectorAll(ownSelector).forEach((target) => {
        source.classList.forEach((c) => target.classList.add(c));
      });
    }
  }

  /** Click su una voce: trova l'indice e avvisa chi ci usa. */
  private handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest<HTMLLIElement>("li[data-index]");
    if (!item) return;
    event.stopPropagation(); // il click è nostro: non deve arrivare al menu nativo

    const index = Number(item.dataset.index);
    this.onSelect(index >= 0 ? this.tracks[index] ?? null : null);
  };
}
