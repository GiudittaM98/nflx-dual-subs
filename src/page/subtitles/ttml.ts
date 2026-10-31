/**
 * LETTURA DEI FILE DI SOTTOTITOLI (formato TTML / DFXP / IMSC)
 *
 * Netflix fornisce i sottotitoli testuali come XML in formato TTML. Una
 * battuta ha questa forma:
 *
 *   <p begin="123450000t" end="156780000t">Prima riga<br/>seconda riga</p>
 *
 * I tempi possono essere scritti in modi diversi:
 *   "123450000t"     tick: si divide per ttp:tickRate (attributo di <tt>)
 *   "12.345s"        secondi (anche h, m, ms, f = frame)
 *   "00:00:12.345"   orologio hh:mm:ss.frazione
 *   "00:00:12:08"    orologio con frame finali (si divide per frameRate)
 *
 * La versione vecchia dava per scontato il formato a tick con tickRate
 * 10.000.000 (parseInt / 10000000). Se un profilo usava un altro formato, i
 * tempi risultavano sbagliati.
 */

/** Una battuta: dal secondo `begin` al secondo `end` si mostra `text`. */
export interface Cue {
  /** Posizione nell'elenco ordinato (serve a riconoscere la battuta). */
  id: number;
  begin: number;
  end: number;
  /** Testo, con "\n" tra le righe. */
  text: string;
}

interface TimingParams {
  tickRate: number;
  frameRate: number;
}

const TTML_PARAMETER_NS = "http://www.w3.org/ns/ttml#parameter";
const DEFAULT_TICK_RATE = 10_000_000; // valore usato da Netflix
const DEFAULT_FRAME_RATE = 30;

/**
 * Trasforma il testo XML in un elenco di battute ordinate per inizio.
 * Le battute senza tempi validi o senza testo vengono scartate.
 * Lancia un errore se l'XML non è leggibile.
 */
export function parseTtml(xmlText: string): Cue[] {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("il file di sottotitoli non è un XML valido");
  }

  const root = doc.documentElement;
  const params: TimingParams = {
    tickRate: readNumericParameter(root, "tickRate") ?? DEFAULT_TICK_RATE,
    frameRate: readNumericParameter(root, "frameRate") ?? DEFAULT_FRAME_RATE,
  };

  const cues: Omit<Cue, "id">[] = [];
  for (const paragraph of Array.from(doc.getElementsByTagNameNS("*", "p"))) {
    const begin = parseTime(paragraph.getAttribute("begin"), params);
    let end = parseTime(paragraph.getAttribute("end"), params);
    if (Number.isNaN(end)) {
      const duration = parseTime(paragraph.getAttribute("dur"), params);
      if (!Number.isNaN(duration)) end = begin + duration;
    }
    if (Number.isNaN(begin) || Number.isNaN(end) || end <= begin) continue;

    const text = extractText(paragraph);
    if (text) cues.push({ begin, end, text });
  }

  cues.sort((a, b) => a.begin - b.begin);
  return cues.map((cue, index) => ({ id: index, ...cue }));
}

/**
 * Converte un'espressione di tempo TTML in secondi.
 * Restituisce NaN se il formato non è riconosciuto.
 */
export function parseTime(value: string | null, params: TimingParams): number {
  if (!value) return NaN;
  const v = value.trim();

  const offset = /^(\d+(?:\.\d+)?)(ms|h|m|s|f|t)$/.exec(v);
  if (offset) {
    const n = Number(offset[1]);
    switch (offset[2]) {
      case "h":
        return n * 3600;
      case "m":
        return n * 60;
      case "s":
        return n;
      case "ms":
        return n / 1000;
      case "f":
        return n / params.frameRate;
      case "t":
        return n / params.tickRate;
    }
  }

  const clock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(v);
  if (clock) {
    const frames = clock[4] ? Number(clock[4]) / params.frameRate : 0;
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + frames;
  }

  return NaN;
}

/**
 * Legge un parametro numerico (es. ttp:tickRate) dall'elemento <tt>.
 * Prova sia con il namespace corretto sia con il nome con prefisso.
 */
function readNumericParameter(element: Element, localName: string): number | null {
  const raw =
    element.getAttributeNS(TTML_PARAMETER_NS, localName) || element.getAttribute(`ttp:${localName}`);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Estrae il testo di un <p>, scendendo dentro gli <span> annidati.
 * <br/> diventa un a capo; gli spazi ripetuti e gli a capo dell'XML
 * vengono compattati in uno spazio solo.
 */
function extractText(paragraph: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.nodeValue ?? "").replace(/\s+/g, " ");
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as Element).localName === "br") out += "\n";
        else walk(child);
      }
    }
  };
  walk(paragraph);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
