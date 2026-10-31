/**
 * SOVRAPPOSIZIONE DEI SOTTOTITOLI
 *
 * Un <div> inserito nel player di Netflix, con dentro uno Shadow DOM:
 *
 *   <div id="dual-subs-overlay">        ← host, copre tutto il player
 *     #shadow-root
 *       <style>…</style>
 *       <div class="stage">             ← allinea il testo in basso
 *         <div class="box">             ← l'unica parte che riceve il mouse
 *           <div class="line primary">  ← sottotitolo principale
 *           <div class="line secondary">← sottotitolo secondario
 *
 * Perché Shadow DOM: isola il nostro CSS da quello di Netflix in
 * entrambe le direzioni (con React + MUI gli stili venivano iniettati
 * nell'<head> di Netflix).
 *
 * L'Overlay non decide COSA mostrare: riceve i testi da PlaybackSession
 * tramite setText(). Scrive nel DOM solo quando il testo cambia davvero.
 */
import { FONT_SCALES, type Settings } from "../../shared/settings";
import { OVERLAY_CSS } from "./overlayStyles";
import { log } from "../log";

export type HoverListener = (hovering: boolean) => void;

export class Overlay {
  private readonly host: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly primaryLine: HTMLDivElement;
  private readonly secondaryLine: HTMLDivElement;

  private primaryText = "";
  private secondaryText = "";
  private hovering = false;
  private hoverListener: HoverListener | null = null;
  /** Ultima posizione nota del mouse (null = fuori dalla finestra). */
  private pointer: { x: number; y: number } | null = null;

  /** Crea gli elementi (senza inserirli nella pagina: vedi attach). */
  constructor() {
    this.host = document.createElement("div");
    this.host.id = "dual-subs-overlay";
    const shadow = this.host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${OVERLAY_CSS}</style>
      <div class="stage">
        <div class="box empty">
          <div class="line primary"></div>
          <div class="line secondary"></div>
        </div>
      </div>`;

    this.stage = shadow.querySelector(".stage") as HTMLDivElement;
    this.box = shadow.querySelector(".box") as HTMLDivElement;
    this.primaryLine = shadow.querySelector(".primary") as HTMLDivElement;
    this.secondaryLine = shadow.querySelector(".secondary") as HTMLDivElement;
// Posizione del mouse letta a livello di finestra: funziona anche se un
// livello di Netflix sta sopra al nostro testo, e non dipende dai cambi
// di battuta (vedi isPointerOverText).
window.addEventListener(
  "pointermove",
  (e) => { this.pointer = { x: e.clientX, y: e.clientY }; },
  { capture: true, passive: true }
);
document.documentElement.addEventListener("mouseleave", () => { this.pointer = null; });
   
    // I click sul testo (per selezionarlo/copiarlo) non devono arrivare al
    // player, altrimenti Netflix metterebbe in pausa o andrebbe a schermo intero.
    for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup"]) {
      this.box.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /** Imposta chi avvisare quando il mouse entra/esce dal testo. */
  setHoverListener(listener: HoverListener | null): void {
    this.hoverListener = listener;
  }

  /**
   * Inserisce la sovrapposizione nel contenitore del player, se non c'è già.
   * Viene chiamata a ogni frame: se Netflix ridisegna il player e ci
   * rimuove, ci reinseriamo da soli.
   */
  attach(container: HTMLElement): void {
    if (this.host.parentElement !== container) container.appendChild(this.host);
  }

  /** Rimuove la sovrapposizione dalla pagina e svuota i testi. */
  detach(): void {
    this.setText("", "");
    this.host.remove();
  }

  /** Aggiorna i testi (stringa vuota = niente da mostrare). */
  setText(primary: string, secondary: string): void {
    if (primary !== this.primaryText) {
      this.primaryText = primary;
      this.primaryLine.textContent = primary;
    }
    if (secondary !== this.secondaryText) {
      this.secondaryText = secondary;
      this.secondaryLine.textContent = secondary;
    }
    const empty = !primary && !secondary;
    if (empty !== this.box.classList.contains("empty")) {
      this.box.classList.toggle("empty", empty);
      
    }
  }

  /** Alza i sottotitoli quando la barra dei controlli è visibile. */
  setLifted(lifted: boolean): void {
    this.stage.classList.toggle("lifted", lifted);
  }

  /**
 * true se il mouse è sopra il testo (con un margine di `marginPx` pixel).
 * Viene chiamata a ogni frame da PlaybackSession: confronta l'ultima
 * posizione del mouse con il riquadro attuale del testo.
 */
isPointerOverText(marginPx = 16): boolean {
  if (!this.pointer || !this.host.isConnected || this.box.classList.contains("empty")) return false;
  const r = this.box.getBoundingClientRect();
  const { x, y } = this.pointer;
  return x >= r.left - marginPx && x <= r.right + marginPx && y >= r.top - marginPx && y <= r.bottom + marginPx;
}

/** Rende nitido il testo sfocato mentre il mouse ci è sopra. */
setRevealed(revealed: boolean): void {
  this.box.classList.toggle("revealed", revealed);
}

  /** Applica dimensione del testo e sfocatura. */
  applySettings(settings: Settings): void {
    this.host.style.setProperty("--scale", String(FONT_SCALES[settings.fontSize]));
    const blurPrimary = settings.hide === "primary" || settings.hide === "both";
    const blurSecondary = settings.hide === "secondary" || settings.hide === "both";
    this.primaryLine.classList.toggle("blurred", blurPrimary);
    this.secondaryLine.classList.toggle("blurred", blurSecondary);
  }

  private setHovering(hovering: boolean): void {
    if (hovering === this.hovering) return;
    this.hovering = hovering;
    log.debug("mouse sul testo:", hovering);
    this.hoverListener?.(hovering);
  }
}
