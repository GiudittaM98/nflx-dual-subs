/**
 * DAL MANIFEST ALL'ELENCO DI TRACCE
 *
 * Prende le tracce già normalizzate (vedi netflix/manifestFormat.ts),
 * scarta quelle inutili e crea un SubtitleTrack per ognuna delle altre.
 */
import type { ManifestTrack, ParsedManifest } from "../netflix/manifestFormat";
import { SubtitleTrack } from "./SubtitleTrack";

/**
 * Restituisce le tracce utilizzabili: prima quelle scaricabili subito,
 * poi le altre, ciascun gruppo in ordine alfabetico.
 *
 * Si scartano:
 *  - "Disattivati" (isNoneTrack);
 *  - i sottotitoli forzati (solo i dialoghi in lingua straniera);
 *  - le varianti STRIPPED_SDH (doppioni dei CC);
 *  - le tracce che esistono solo a immagini (nessun formato testuale).
 * Si TENGONO invece le tracce senza link ma con un formato testuale:
 * compariranno nel menu come "non disponibile" finché i link non arrivano.
 */
export function buildTracks(manifest: ParsedManifest): SubtitleTrack[] {
  return manifest.tracks
    .filter(isUsable)
    .map(
      (t) =>
        new SubtitleTrack(
          {
            key: t.key,
            lang: t.lang,
            languageDescription: t.languageDescription,
            isClosedCaptions: t.isClosedCaptions,
          },
          t.sources
        )
    )
    .sort((a, b) => Number(b.isAvailable) - Number(a.isAvailable) || a.label.localeCompare(b.label));
}

function isUsable(track: ManifestTrack): boolean {
  return !track.isNoneTrack && !track.isForcedNarrative && !track.isStrippedSdh && track.hasTextFormat;
}
