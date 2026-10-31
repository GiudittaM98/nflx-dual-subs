/**
 * ABBINAMENTO TRA VOCI DEI MENU E TRACCE
 */
import type { SubtitleTrack } from "./SubtitleTrack";

/** Riconosce "[CC]" o "(CC)" in un'etichetta. */
const CC_PATTERN = /[[(]\s*cc\s*[\])]/i;

/**
 * Trova la traccia corrispondente a una voce del menu nativo di Netflix
 * (es. "Inglese", "Inglese [CC]").
 *
 * Confronta il nome della lingua senza la parte CC e ignorando
 * maiuscole/minuscole; tra le tracce con lo stesso nome preferisce quella
 * con lo stesso tipo (CC o normale).
 * Restituisce null se nessuna corrisponde: succede con "Disattivati",
 * che quindi spegne il sottotitolo principale.
 */
export function matchTrackByNativeLabel(
  tracks: readonly SubtitleTrack[],
  nativeLabel: string
): SubtitleTrack | null {
  const wantsCc = CC_PATTERN.test(nativeLabel);
  const name = nativeLabel.replace(CC_PATTERN, "").trim().toLowerCase();
  if (!name) return null;

  const sameName = tracks.filter((t) => t.languageDescription.trim().toLowerCase() === name);
  return sameName.find((t) => t.isClosedCaptions === wantsCc) ?? sameName[0] ?? null;
}

/**
 * Sceglie la traccia per una lingua preferita (codice BCP-47), preferendo
 * i sottotitoli normali ai CC. null se la lingua non è disponibile.
 */
export function findTrackByLang(tracks: readonly SubtitleTrack[], lang: string): SubtitleTrack | null {
  const sameLang = tracks.filter((t) => t.lang === lang);
  return sameLang.find((t) => !t.isClosedCaptions) ?? sameLang[0] ?? null;
}
