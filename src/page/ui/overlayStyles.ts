/**
 * CSS DELLA SOVRAPPOSIZIONE DEI SOTTOTITOLI
 *
 * Viene inserito dentro uno Shadow DOM (vedi Overlay.ts): questi stili non
 * toccano Netflix e gli stili di Netflix non toccano i nostri.
 *
 * Punti chiave:
 *  - :host ha pointer-events: none → la sovrapposizione è "trasparente"
 *    ai click, quindi "Salta intro", "Prossimo episodio" e i controlli
 *    restano cliccabili. Solo il riquadro del testo (.box) riceve il mouse.
 *    Era la causa del vecchio bug dei pulsanti non cliccabili.
 *  - .stage è un "container" CSS: le unità cqh (1cqh = 1% dell'altezza
 *    del player) fanno scalare il testo con il player, senza listener
 *    sul resize della finestra.
 *  - --scale arriva dalle impostazioni (Overlay.applySettings).
 */
export const OVERLAY_CSS = /* css */ `
:host {
  all: initial;
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
}

.stage {
  position: absolute;
  inset: 0;
  container-type: size;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: 7cqh;
  box-sizing: border-box;
  transition: padding-bottom 0.2s ease;
}

/* Barra dei controlli visibile: alziamo i sottotitoli per non coprirla */
.stage.lifted {
  padding-bottom: 17cqh;
}

.box {
  pointer-events: auto;
  max-width: 80%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6cqh;
  font-family: "Netflix Sans", "Helvetica Neue", "Segoe UI", Arial, sans-serif;
  line-height: 1.25;
  text-align: center;
  white-space: pre-line;
  cursor: text;
  user-select: text;
}

.box.empty {
  display: none;
}

.line {
  color: #fff;
  padding: 0.1em 0.45em;
  border-radius: 0.2em;
  background: rgba(0, 0, 0, 0.45);
  text-shadow: 0 0 0.15em #000, 0 0.05em 0.1em #000;
  transition: opacity 0.15s ease, filter 0.15s ease;
}

.line:empty {
  display: none;
}

.primary {
  font-size: calc(4.2cqh * var(--scale, 1));
  font-weight: 700;
}

.secondary {
  font-size: calc(3.3cqh * var(--scale, 1));
  color: #ffe08a;
}

/* Modalità "sfocato": si legge passandoci sopra col mouse */
.line.blurred {
  opacity: 0.35;
  filter: blur(0.25em);
}

.line.blurred:hover {
  opacity: 1;
  filter: none;
}

.box.revealed .line.blurred {
  opacity: 1;
  filter: none;
}

@media (prefers-reduced-motion: reduce) {
  .stage, .line { transition: none; }
}
`;
