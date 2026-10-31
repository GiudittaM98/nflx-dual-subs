/**
 * NASCONDE I SOTTOTITOLI ORIGINALI DI NETFLIX
 *
 * Il sottotitolo principale lo disegniamo noi (così si può selezionare,
 * sfocare, mettere in pausa col mouse), quindi quello di Netflix va
 * nascosto per non vederlo doppio.
 *
 * Usiamo visibility: hidden e non display: none, così Netflix continua a
 * scriverci il testo: il Calibrator lo legge per sincronizzare il tempo.
 *
 * La versione vecchia inseriva lo stile solo se .player-timedtext esisteva
 * già in quel momento; altrimenti i sottotitoli nativi restavano visibili.
 * Qui lo stile va sempre nell'<head>, ed è attivo solo durante la
 * riproduzione.
 */
import { SELECTORS } from "../netflix/selectors";

const STYLE_ID = "dual-subs-hide-native";

export class NativeSubtitleHider {
  enable(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${SELECTORS.nativeSubtitles} { visibility: hidden !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }

  disable(): void {
    document.getElementById(STYLE_ID)?.remove();
  }
}
