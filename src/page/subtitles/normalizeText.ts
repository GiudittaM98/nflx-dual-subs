/**
 * Riduce un testo alla forma usata per confrontare i sottotitoli:
 * minuscole, senza spazi, a capo, punteggiatura e simboli.
 *
 * Serve perché Netflix, nel suo HTML, unisce le righe senza spazi
 * ("Prima rigaseconda riga"), mentre nel file sono separate da "\n".
 */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Testi più corti di così sono troppo comuni per riconoscere una battuta. */
export const MIN_MATCH_LENGTH = 8;
