/**
 * LETTURA DEL MANIFEST (entrambi i formati)
 *
 * Trasforma il manifest grezzo di Netflix, in qualsiasi formato arrivi (vedi
 * types.ts), in una struttura nostra e stabile: ParsedManifest. Il resto
 * dell'estensione usa solo ParsedManifest, così quando Netflix cambia
 * formato va aggiornato soltanto questo file.
 */
import type { Downloadable, RawManifest, TextTrackV1, TextTrackV2 } from "./types";

/**
 * Formati testuali che sappiamo leggere, in ordine di preferenza.
 * Manca di proposito "nflx-cmisc": sono sottotitoli a IMMAGINI.
 */
export const TEXT_PROFILES = ["imsc1.1", "dfxp-ls-sdh", "simplesdh"] as const;

/** Un formato scaricabile e i suoi indirizzi. */
export interface TrackSource {
  profile: string;
  urls: string[];
}

/** Una traccia sottotitoli, normalizzata. */
export interface ManifestTrack {
  key: string;
  lang: string;
  languageDescription: string;
  isClosedCaptions: boolean;
  isNoneTrack: boolean;
  isForcedNarrative: boolean;
  isStrippedSdh: boolean;
  /**
   * true se la traccia esiste in un formato testuale, anche se i link non
   * sono ancora inclusi (hydrated: false nel formato 2).
   */
  hasTextFormat: boolean;
  /** Link di download, in ordine di preferenza. Vuoto se non ancora inclusi. */
  sources: TrackSource[];
}

export interface ParsedManifest {
  movieId: number;
  format: 1 | 2;
  tracks: ManifestTrack[];
  /** Traccia che Netflix attiverebbe di default, se il manifest lo dice. */
  recommendedTextTrackKey: string | null;
}

/** true se l'oggetto ha l'aspetto di un manifest (formato 1 o 2). */
export function looksLikeManifest(value: unknown): value is RawManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as RawManifest;
  if (Array.isArray(v.timedtexttracks)) return true;
  return (
    Array.isArray(v.textTracks) &&
    v.textTracks.some((t) => t && typeof t === "object" && ("downloadables" in t || t.type === "timedtext"))
  );
}

/**
 * Converte un manifest grezzo in ParsedManifest.
 * `fallbackMovieId` si usa se il manifest non contiene l'id (si ricava
 * dall'URL della richiesta, parametro mainContentViewableId).
 * Restituisce null se manca un id valido.
 */
export function parseManifest(raw: RawManifest, fallbackMovieId: number | null): ParsedManifest | null {
  const movieId = toNumber(raw.movieId) ?? toNumber(raw.viewableId) ?? fallbackMovieId;
  if (movieId === null) return null;

  if (Array.isArray(raw.timedtexttracks)) {
    return {
      movieId,
      format: 1,
      tracks: raw.timedtexttracks.map(fromV1),
      recommendedTextTrackKey: raw.recommendedMedia?.timedTextTrackId ?? recommendedFromOrderList(raw),
    };
  }

  return {
    movieId,
    format: 2,
    tracks: (raw.textTracks ?? []).filter((t) => t && typeof t.id === "string").map(fromV2),
    recommendedTextTrackKey: raw.recommendedMedia?.timedTextTrackId ?? recommendedFromOrderList(raw),
  };
}

function fromV1(track: TextTrackV1): ManifestTrack {
  const sources = extractSources(track.ttDownloadables);
  return {
    ...commonFields(track, track.new_track_id),
    hasTextFormat: sources.length > 0,
    sources,
  };
}

function fromV2(track: TextTrackV2): ManifestTrack {
  const sources = extractSources(track.downloadables);
  const declaresText = (track.encodingProfileNames ?? []).some((p) =>
    (TEXT_PROFILES as readonly string[]).includes(p)
  );
  return {
    ...commonFields(track, track.id),
    // Se non è "hydrated" i link mancano, ma la traccia esiste se dichiara un formato testuale
    hasTextFormat: sources.length > 0 || (track.hydrated === false && declaresText),
    sources,
  };
}

function commonFields(track: TextTrackV1 | TextTrackV2, key: string) {
  return {
    key,
    lang: track.language || "und",
    languageDescription: track.languageDescription || track.language || "?",
    isClosedCaptions: track.rawTrackType === "closedcaptions",
    isNoneTrack: isNoneTrack(track, key),
    isForcedNarrative: !!track.isForcedNarrative,
    isStrippedSdh: track.trackVariant?.toLowerCase().includes("stripped_sdh") ?? false,
  };
}

/** Estrae i link testuali in ordine di preferenza, saltando i formati a immagini. */
function extractSources(downloadables: Record<string, Downloadable | undefined> | undefined): TrackSource[] {
  const sources: TrackSource[] = [];
  if (!downloadables) return sources;
  for (const profile of TEXT_PROFILES) {
    const d = downloadables[profile];
    if (!d || d.isImage) continue;
    const urls = extractUrls(d);
    if (urls.length > 0) sources.push({ profile, urls });
  }
  return sources;
}

function extractUrls(d: Downloadable): string[] {
  const isUrl = (u: unknown): u is string => typeof u === "string" && u.length > 0;
  if (Array.isArray(d.urls)) return d.urls.map((u) => u?.url).filter(isUrl);
  if (d.downloadUrls && typeof d.downloadUrls === "object") return Object.values(d.downloadUrls).filter(isUrl);
  return [];
}

/**
 * Riconosce la traccia fittizia "Disattivati":
 *  1. isNoneTrack = true;
 *  2. il quinto campo dell'id vale "1" (es. "T:2:1;1;NONE;0;1;0;0;");
 *  3. rank negativo.
 */
function isNoneTrack(track: TextTrackV1 | TextTrackV2, key: string): boolean {
  if (track.isNoneTrack) return true;
  if (key.split(";")[4] === "1") return true;
  return track.rank !== undefined && track.rank < 0;
}

function recommendedFromOrderList(raw: RawManifest): string | null {
  const first = raw.defaultTrackOrderList?.[0];
  return first?.subtitleTrackId ?? first?.textTrackId ?? null;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Unisce due manifest dello stesso film: le tracce senza link nel nuovo
 * prendono i link del vecchio. Serve perché Netflix può mandare più
 * manifest per lo stesso film con lingue "hydrated" diverse.
 */
export function mergeManifests(previous: ParsedManifest, next: ParsedManifest): ParsedManifest {
  const previousSources = new Map(previous.tracks.map((t) => [t.key, t.sources]));
  return {
    ...next,
    recommendedTextTrackKey: next.recommendedTextTrackKey ?? previous.recommendedTextTrackKey,
    tracks: next.tracks.map((t) =>
      t.sources.length > 0 ? t : { ...t, sources: previousSources.get(t.key) ?? [] }
    ),
  };
}
