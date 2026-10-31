/**
 * CONTROLLER: il "regista" dell'estensione
 *
 * Riceve gli eventi dall'esterno e decide quando creare o distruggere la
 * PlaybackSession:
 *
 *   manifest intercettato ──▶ handleManifest ──┐
 *   URL cambiato          ──▶ handleUrlChange ─┼──▶ tryActivate()
 *   <video> sostituito    ──▶ (onVideoLost)  ──┘
 *
 * tryActivate() segue questi passi:
 *   1. legge l'id dall'URL: se non siamo su /watch/<id> → chiude la sessione;
 *   2. se c'è già una sessione per quell'id → non fa nulla;
 *   3. aspetta il <video> (fino a 30 s);
 *   4. cerca il manifest di quell'id tra quelli intercettati;
 *      se non c'è ancora → si ferma: quando arriverà, handleManifest
 *      richiamerà tryActivate;
 *   5. crea la sessione.
 *
 * Funziona qualunque sia l'ordine degli eventi (manifest prima o dopo il
 * cambio di URL). Nella versione vecchia funzionava solo se il manifest
 * arrivava DOPO il cambio di URL, da qui il bisogno di ricaricare.
 *
 * Il "token" di attivazione: tryActivate è asincrona (aspetta il video).
 * Se nel frattempo arriva un'altra chiamata, la prima deve rinunciare.
 * Ogni chiamata incrementa activationToken e, dopo l'attesa, controlla
 * che il token sia ancora il suo.
 *
 * Il Controller possiede anche i pezzi che sopravvivono tra una sessione
 * e l'altra: Overlay, menu secondario, osservatore del menu nativo.
 */
import { log } from "../log";
import { NativeMenuWatcher } from "../netflix/nativeMenuWatcher";
import { getWatchIdFromUrl } from "../netflix/navigation";
import { waitForVideo } from "../netflix/selectors";
import { mergeManifests, type ParsedManifest } from "../netflix/manifestFormat";
import type { SettingsClient } from "../settingsClient";
import { buildTracks } from "../subtitles/trackFactory";
import { matchTrackByNativeLabel } from "../subtitles/trackMatching";
import { NativeSubtitleHider } from "../ui/NativeSubtitleHider";
import { Overlay } from "../ui/Overlay";
import { SecondaryMenu } from "../ui/SecondaryMenu";
import { PlaybackSession } from "./PlaybackSession";

const VIDEO_WAIT_TIMEOUT_MS = 30_000;
/** Manifest da tenere in memoria (Netflix ne scarica molti per le anteprime). */
const MAX_STORED_MANIFESTS = 30;
/**
 * Per la ricerca di riserva: un manifest arrivato fino a questi ms PRIMA
 * dell'ingresso nel player è comunque considerato (Netflix lo pre-carica
 * quando passi il mouse su un titolo o premi Riproduci).
 */
const PREFETCH_TOLERANCE_MS = 15_000;

export class Controller {
  private readonly manifests = new Map<number, ParsedManifest>();
  /** Quando è arrivato ogni manifest (per la ricerca di riserva). */
  private readonly receivedAt = new Map<number, number>();
  /** Id nell'URL del player e momento in cui ci siamo entrati. */
  private currentWatchId: number | null = null;
  private watchEnteredAt = 0;
  /** Id nell'URL quando è stata creata la sessione attuale. */
  private sessionWatchId: number | null = null;
  private session: PlaybackSession | null = null;
  private activationToken = 0;

  private readonly overlay = new Overlay();
  private readonly nativeHider = new NativeSubtitleHider();
  private readonly secondaryMenu: SecondaryMenu;
  private readonly menuWatcher: NativeMenuWatcher;

  constructor(private readonly settings: SettingsClient) {
    this.secondaryMenu = new SecondaryMenu((track) => this.session?.selectSecondary(track, true));

    this.menuWatcher = new NativeMenuWatcher({
      onMenuOpened: (menu) => {
        if (!this.session) return;
        this.secondaryMenu.mount(menu);
        this.refreshMenu();
      },
      onPrimaryLabelClicked: (label) => {
        if (!this.session) return;
        this.session.selectPrimary(matchTrackByNativeLabel(this.session.tracks, label), true);
      },
    });

    settings.subscribe((s) => {
      this.overlay.applySettings(s);
      this.session?.applyPreferredSecondary(s.secondaryLang);
    });
  }

  /**
   * Un manifest è stato intercettato: lo salviamo (unendolo a un eventuale
   * manifest precedente dello stesso film) e proviamo ad attivarlo.
   * Se è del film in riproduzione, la sessione riceve i nuovi link.
   */
  handleManifest(incoming: ParsedManifest): void {
    const id = incoming.movieId;
    const previous = this.manifests.get(id);
    const manifest = previous ? mergeManifests(previous, incoming) : incoming;

    this.manifests.delete(id); // reinserendolo diventa il più recente
    this.manifests.set(id, manifest);
    this.receivedAt.set(id, Date.now());
    while (this.manifests.size > MAX_STORED_MANIFESTS) {
      const oldest = this.manifests.keys().next().value;
      if (oldest === undefined) break;
      this.manifests.delete(oldest);
      this.receivedAt.delete(oldest);
    }

    const withLinks = manifest.tracks.filter((t) => t.sources.length > 0).length;
    log.info(
      `manifest intercettato: ${id} (formato ${manifest.format}, ${manifest.tracks.length} tracce, ${withLinks} con link)`
    );

    if (this.session?.movieId === id) this.session.mergeManifest(manifest);
    void this.tryActivate();
  }

  /** L'URL è cambiato (o la pagina è appena stata caricata). */
  handleUrlChange(): void {
    void this.tryActivate();
  }

  private async tryActivate(): Promise<void> {
    const urlId = getWatchIdFromUrl();
    if (urlId === null) {
      this.currentWatchId = null;
      this.endSession();
      return;
    }
    if (urlId !== this.currentWatchId) {
      this.currentWatchId = urlId;
      this.watchEnteredAt = Date.now();
    }
    // Sessione già attiva per questa pagina del player: niente da fare.
    // (Il confronto con sessionWatchId evita che un manifest pre-caricato,
    // per esempio dell'episodio successivo, faccia ripartire la sessione.)
    if (this.session && (this.session.movieId === urlId || this.sessionWatchId === urlId)) return;

    const token = ++this.activationToken;
    const video = await waitForVideo(VIDEO_WAIT_TIMEOUT_MS, () => token !== this.activationToken);
    if (token !== this.activationToken) return;
    if (!video) {
      log.warn("nessun <video> trovato: ricarica la pagina se i sottotitoli non compaiono");
      return;
    }

    const manifest = this.findManifest(urlId, video);
    if (!manifest) {
      log.info(`nel player di ${urlId}, in attesa del suo manifest`);
      return;
    }

    if (this.session?.movieId === manifest.movieId && this.session.video === video) return;
    this.startSession(manifest, video);
  }

  /**
   * Cerca il manifest del video in riproduzione, in tre modi:
   *  1. per id nell'URL (/watch/<id>): il caso normale;
   *  2. per id dell'elemento che contiene il <video>, che Netflix a volte
   *     chiama con l'id del contenuto (trucco del progetto originale);
   *  3. di riserva: il manifest arrivato più di recente da quando siamo
   *     entrati nel player. Serve quando l'id nell'URL è diverso da quello
   *     del manifest (es. URL con l'id della serie, manifest con quello
   *     dell'episodio).
   */
  private findManifest(urlId: number, video: HTMLVideoElement): ParsedManifest | null {
    const byUrl = this.manifests.get(urlId);
    if (byUrl) return byUrl;

    const domId = video.parentElement?.id ?? "";
    if (domId) {
      for (const [id, manifest] of this.manifests) {
        if (domId.includes(String(id))) return manifest;
      }
    }

    let latest: ParsedManifest | null = null;
    let latestAt = this.watchEnteredAt - PREFETCH_TOLERANCE_MS;
    for (const [id, manifest] of this.manifests) {
      const at = this.receivedAt.get(id) ?? 0;
      if (at >= latestAt) {
        latest = manifest;
        latestAt = at;
      }
    }
    if (latest) {
      log.info(`l'id nell'URL (${urlId}) non corrisponde: uso il manifest più recente (${latest.movieId})`);
    }
    return latest;
  }

  private startSession(manifest: ParsedManifest, video: HTMLVideoElement): void {
    this.endSession();

    const session = new PlaybackSession({
      movieId: manifest.movieId,
      video,
      tracks: buildTracks(manifest),
      overlay: this.overlay,
      settings: this.settings,
      callbacks: {
        onSelectionChange: () => this.refreshMenu(),
        onVideoLost: () => {
          this.endSession();
          void this.tryActivate();
        },
      },
    });

    this.session = session;
    this.sessionWatchId = this.currentWatchId;
    this.nativeHider.enable();
    this.menuWatcher.start();
    session.start(manifest.recommendedTextTrackKey);
  }

  /** Chiude la sessione attuale (se c'è) e ripulisce la pagina. */
  private endSession(): void {
    if (!this.session) return;
    this.session.end();
    this.session = null;
    this.sessionWatchId = null;
    this.overlay.detach();
    this.secondaryMenu.unmount();
    this.nativeHider.disable();
    this.menuWatcher.stop();
  }

  /** Ridisegna il menu secondario, se in questo momento è aperto. */
  private refreshMenu(): void {
    if (!this.session || !this.secondaryMenu.isMounted) return;
    this.secondaryMenu.render({ tracks: this.session.tracks, selected: this.session.secondary });
  }
}
