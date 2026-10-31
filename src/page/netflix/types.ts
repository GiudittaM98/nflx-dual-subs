/**
 * TIPI DEL MANIFEST DI NETFLIX
 *
 * Il "manifest" è il JSON che il player di Netflix scarica per ogni
 * film/episodio: contiene le tracce audio, video e sottotitoli, con gli
 * indirizzi da cui scaricarle. Netflix non lo documenta, e lo cambia.
 *
 * Esistono due formati, entrambi supportati (vedi manifestFormat.ts):
 *
 *  FORMATO 1 (vecchio, usato da NflxMultiSubs)
 *    result.timedtexttracks[].new_track_id
 *                            .ttDownloadables[profilo].urls[].url
 *
 *  FORMATO 2 (attuale, visto a ottobre 2026)
 *    result.textTracks[].id
 *                       .downloadables[profilo].urls[].url
 *                       .hydrated   ← false = link non ancora inclusi
 *
 * Questi tipi descrivono SOLO i campi che usiamo; sono quasi tutti
 * opzionali perché Netflix potrebbe ometterli.
 */

/** Un indirizzo da cui scaricare un file di sottotitoli. */
export interface DownloadUrl {
  cdn_id?: number;
  cdnId?: number;
  url?: string;
}

/** Un formato (profilo) disponibile per una traccia. */
export interface Downloadable {
  /** Elenco di server (entrambi i formati). */
  urls?: DownloadUrl[];
  /** Formato ancora più vecchio: { idServer: url }. */
  downloadUrls?: Record<string, string>;
  /** Formato 2: true per i sottotitoli a immagini. */
  isImage?: boolean;
}

/** Campi comuni alle tracce dei due formati. */
interface TextTrackCommon {
  /** Codice lingua BCP-47, es. "it", "en", "zh-Hant". null per "Disattivati". */
  language?: string | null;
  /** Nome leggibile nella lingua dell'interfaccia, es. "Inglese". */
  languageDescription?: string;
  /** "subtitles" o "closedcaptions" (sottotitoli per non udenti). */
  rawTrackType?: string;
  /** true per la finta traccia "Disattivati". */
  isNoneTrack?: boolean;
  /** true per i sottotitoli "forzati" (solo dialoghi in lingua straniera). */
  isForcedNarrative?: boolean;
  /** Variante, es. "STRIPPED_SDH". */
  trackVariant?: string;
  /** Ordine suggerito; negativo per le tracce fittizie. */
  rank?: number;
}

/** Traccia nel formato 1. */
export interface TextTrackV1 extends TextTrackCommon {
  new_track_id: string;
  ttDownloadables?: Record<string, Downloadable | undefined>;
}

/** Traccia nel formato 2. */
export interface TextTrackV2 extends TextTrackCommon {
  id: string;
  type?: string;
  downloadables?: Record<string, Downloadable | undefined>;
  /** Formati in cui la traccia esiste (anche se i link non ci sono ancora). */
  encodingProfileNames?: string[];
  /** false = Netflix non ha ancora incluso i link di download. */
  hydrated?: boolean;
}

/** Campi del manifest che usiamo (entrambi i formati). */
export interface RawManifest {
  movieId?: number | string;
  viewableId?: number | string;
  timedtexttracks?: TextTrackV1[];
  textTracks?: TextTrackV2[];
  /** Formato 1: tracce che Netflix attiverebbe di default. */
  recommendedMedia?: { timedTextTrackId?: string };
  /** Lista di combinazioni audio/sottotitoli preferite. */
  defaultTrackOrderList?: { subtitleTrackId?: string; textTrackId?: string }[];
}
