/**
 * SESSIONE DI RIPRODUZIONE
 *
 * Esiste una sessione per ogni film/episodio in riproduzione. Viene creata
 * dal Controller quando ci sono sia il manifest sia il <video>, e distrutta
 * quando si esce dal player, si cambia episodio o il <video> viene
 * sostituito.
 *
 * Contiene:
 *  - le tracce disponibili e le due scelte (principale e secondaria);
 *  - l'orologio (PlayerClock) e la calibrazione (Calibrator);
 *  - il ciclo di disegno, eseguito a ogni frame con requestAnimationFrame.
 *
 * A ogni frame (metodo frame):
 *  1. controlla che il <video> sia ancora nella pagina, altrimenti
 *     avvisa il Controller (onVideoLost) e si ferma;
 *  2. si assicura che la sovrapposizione sia nel player;
 *  3. ogni 250 ms controlla se la barra dei controlli è visibile;
 *  4. se il principale non è ancora noto, prova a riconoscerlo
 *     (PrimaryDetector); poi lascia lavorare il Calibrator;
 *  5. calcola il tempo del contenuto e le battute visibili delle due
 *     tracce, e le passa all'Overlay;
 *  6. gestisce la pausa a fine battuta col mouse sopra.
 */
import { log } from "../log";
import type { ParsedManifest } from "../netflix/manifestFormat";
import { findPlayerRoot, SELECTORS } from "../netflix/selectors";
import type { SettingsClient } from "../settingsClient";
import { findTrackByLang } from "../subtitles/trackMatching";
import type { SubtitleTrack } from "../subtitles/SubtitleTrack";
import type { Cue } from "../subtitles/ttml";
import type { Overlay } from "../ui/Overlay";
import { Calibrator } from "./Calibrator";
import { PlayerClock } from "./PlayerClock";
import { PrimaryDetector } from "./PrimaryDetector";

/** Anticipo (in secondi) con cui fermare il video prima della fine della battuta. */
const PAUSE_BEFORE_END_S = 0.15;
const CONTROLS_CHECK_INTERVAL_MS = 250;

export interface SessionCallbacks {
  /** Le tracce scelte o il loro stato di caricamento sono cambiati. */
  onSelectionChange(): void;
  /** Il <video> non è più quello della sessione. */
  onVideoLost(): void;
}

export interface SessionOptions {
  movieId: number;
  video: HTMLVideoElement;
  tracks: SubtitleTrack[];
  overlay: Overlay;
  settings: SettingsClient;
  callbacks: SessionCallbacks;
}

export class PlaybackSession {
  readonly movieId: number;
  readonly video: HTMLVideoElement;
  readonly tracks: readonly SubtitleTrack[];

  primary: SubtitleTrack | null = null;
  secondary: SubtitleTrack | null = null;

  private readonly overlay: Overlay;
  private readonly settings: SettingsClient;
  private readonly callbacks: SessionCallbacks;
  private readonly clock: PlayerClock;
  private readonly calibrator: Calibrator;
  private readonly primaryDetector: PrimaryDetector;

  private running = false;
  private frameRequest = 0;
  private lastControlsCheckAt = 0;

  /** true se l'utente ha scelto a mano il principale (anche "Disattivati"). */
  private primaryChosenByUser = false;
  /** true se l'utente ha scelto a mano il secondario in questa sessione. */
  private secondaryChosenByUser = false;

  // Stato della pausa a fine battuta
  private hovering = false;
  private pausedByUs = false;
  private lastPausedCueKey: string | null = null;

  constructor(options: SessionOptions) {
    this.movieId = options.movieId;
    this.video = options.video;
    this.tracks = options.tracks;
    this.overlay = options.overlay;
    this.settings = options.settings;
    this.callbacks = options.callbacks;
    this.clock = new PlayerClock(options.video);
    this.calibrator = new Calibrator(this.clock);
    this.primaryDetector = new PrimaryDetector(options.tracks);
  }

  /**
   * Avvia la sessione.
   * `recommendedTrackKey` è la traccia che Netflix attiverebbe di default,
   * se il manifest la indica: diventa il principale. Altrimenti il
   * principale verrà riconosciuto da PrimaryDetector.
   */
  start(recommendedTrackKey: string | null): void {
    const available = this.tracks.filter((t) => t.isAvailable).length;
    log.info(
      `sessione avviata per ${this.movieId}: ${this.tracks.length} lingue, ${available} scaricabili subito`
    );

    const recommended = this.tracks.find((t) => t.key === recommendedTrackKey) ?? null;
    if (recommended) this.selectPrimary(recommended, false);
    this.applyPreferredSecondary(this.settings.current.secondaryLang);

    
    this.video.addEventListener("play", this.handlePlay);

    this.running = true;
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  /** Ferma il ciclo e scollega i listener. Non tocca l'Overlay (lo fa il Controller). */
  end(): void {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    
    this.video.removeEventListener("play", this.handlePlay);
    log.info(`sessione terminata per ${this.movieId}`);
  }

  /**
   * Cambia il sottotitolo principale (null = disattivato).
   * `byUser` è true quando arriva da un click nel menu di Netflix: da quel
   * momento il riconoscimento automatico si ferma.
   */
  selectPrimary(track: SubtitleTrack | null, byUser: boolean): void {
    if (byUser) this.primaryChosenByUser = true;
    if (track === this.primary) return;
    this.primary = track;
    this.calibrator.reset();
    log.info("principale:", track?.label ?? "disattivato");
    if (track) this.loadTrack(track);
    this.callbacks.onSelectionChange();
  }

  /**
   * Cambia il sottotitolo secondario.
   * Se `byUser` è true, la lingua viene ricordata nelle impostazioni per
   * riattivarla da sola al prossimo episodio.
   */
  selectSecondary(track: SubtitleTrack | null, byUser: boolean): void {
    if (byUser) {
      this.secondaryChosenByUser = true;
      this.settings.update({ secondaryLang: track?.lang ?? null });
    }
    if (track === this.secondary) return;
    this.secondary = track;
    log.info("secondario:", track?.label ?? "disattivato");
    if (track) this.loadTrack(track);
    this.callbacks.onSelectionChange();
  }

  /**
   * Attiva il secondario nella lingua preferita, ma solo se l'utente non
   * ne ha già scelto uno in questa sessione. Viene chiamata all'avvio e
   * quando arrivano le impostazioni (che potrebbero arrivare dopo l'avvio).
   */
  applyPreferredSecondary(lang: string | null): void {
    if (this.secondaryChosenByUser || this.secondary || !lang) return;
    const track = findTrackByLang(this.tracks, lang);
    if (track) this.selectSecondary(track, false);
  }

  /**
   * Un nuovo manifest dello stesso film è arrivato: le tracce che non
   * avevano link li ricevono. Se una di queste è già scelta (principale o
   * secondaria), parte subito il download.
   */
  mergeManifest(manifest: ParsedManifest): void {
    let changed = false;
    for (const info of manifest.tracks) {
      const track = this.tracks.find((t) => t.key === info.key);
      if (!track || !track.addSources(info.sources)) continue;
      changed = true;
      log.info(`link ricevuti per "${track.label}"`);
      if (track === this.primary || track === this.secondary) this.loadTrack(track);
    }
    if (changed) this.callbacks.onSelectionChange();
  }

  /** Avvia il download e avvisa quando finisce (per aggiornare il menu). */
  private loadTrack(track: SubtitleTrack): void {
    if (!track.isAvailable) {
      log.warn(`"${track.label}": Netflix non ha ancora fornito i link di questa lingua`);
      return;
    }
    track
      .load()
      .catch((error) => log.error(error))
      .finally(() => this.callbacks.onSelectionChange());
  }

  /** Un giro del ciclo: esegue frame() e prenota il successivo. */
  private tick = (): void => {
    if (!this.running) return;
    try {
      this.frame();
    } catch (error) {
      log.error("errore nel ciclo di disegno", error);
    }
    if (this.running) this.frameRequest = requestAnimationFrame(this.tick);
  };

  private frame(): void {
    // 1. Il video è ancora nella pagina? Se Netflix l'ha rimosso (cambio
    //    episodio, ricostruzione del player) la sessione non vale più.
    //    Non basta che compaia un altro <video>: nella schermata di fine
    //    episodio Netflix può mostrare un'anteprima accanto al nostro.
    if (!this.video.isConnected) {
      log.info("il <video> è stato rimosso dalla pagina");
      this.callbacks.onVideoLost();
      return;
    }

    // 2. Sovrapposizione al suo posto
    const root = findPlayerRoot(this.video);
    if (root) this.overlay.attach(root);

    // 3. Barra dei controlli visibile?
    const now = performance.now();
    if (now - this.lastControlsCheckAt > CONTROLS_CHECK_INTERVAL_MS) {
      this.lastControlsCheckAt = now;
      this.overlay.setLifted(document.querySelector(SELECTORS.controls) !== null);
    }

    // 4. Riconoscimento del principale (se serve) e calibrazione
    if (!this.primary && !this.primaryChosenByUser) {
      const detected = this.primaryDetector.poll();
      if (detected) {
        log.info(`principale riconosciuto dai sottotitoli di Netflix: ${detected.label}`);
        this.selectPrimary(detected, false);
      }
    }
    this.calibrator.poll(this.primary);

    // 5. Testi da mostrare
    const t = this.clock.now();
    const primaryCues = this.visibleCues(this.primary, t);
    const secondaryCues = this.visibleCues(this.secondary, t);
    this.overlay.setText(joinCues(primaryCues), joinCues(secondaryCues));

    // Il mouse è sopra il testo? Controllo geometrico a ogni frame, dopo
// aver aggiornato il testo, così il riquadro è già quello della battuta attuale.
const hovering = this.overlay.isPointerOverText();
if (hovering !== this.hovering) this.handleHoverChange(hovering);
    // 6. Pausa a fine battuta (si usa il principale, o il secondario se manca)
    if (primaryCues.length > 0 && this.primary) {
      this.checkPauseOnHover(t, primaryCues, this.primary.key);
    } else if (secondaryCues.length > 0 && this.secondary) {
      this.checkPauseOnHover(t, secondaryCues, this.secondary.key);
    }
  }

  private visibleCues(track: SubtitleTrack | null, t: number): Cue[] {
    return track && track.state === "ready" ? track.cuesAt(t) : [];
  }

  /**
   * Se il mouse è sul testo e la battuta sta per finire, mette in pausa.
   * Ogni battuta ferma il video una volta sola (lastPausedCueKey), così
   * se riprendi la riproduzione con il mouse ancora sopra non si blocca
   * di nuovo sulla stessa battuta.
   */
  private checkPauseOnHover(t: number, cues: Cue[], trackKey: string): void {
    if (!this.settings.current.pauseOnHover || !this.hovering || this.video.paused) return;
    const cue = cues[cues.length - 1];
    const cueKey = `${trackKey}#${cue.id}`;
    if (cue.end - t > PAUSE_BEFORE_END_S || cueKey === this.lastPausedCueKey) return;

    this.lastPausedCueKey = cueKey;
    this.pausedByUs = true;
    log.debug("pausa a fine battuta:", cue.text);   // ← aggiunta
    this.clock.pause();
  }

  /**
   * Il mouse esce dal testo: se la pausa l'avevamo messa noi, riprendiamo.
   * Se l'aveva messa l'utente (o Netflix), non facciamo nulla.
   * La versione vecchia chiamava video.play() a ogni cambio di battuta e
   * finiva per "litigare" con le pause di Netflix (fine episodio, pubblicità…).
   */
  private handleHoverChange = (hovering: boolean): void => {
    this.hovering = hovering;
    this.overlay.setRevealed(hovering);
log.debug("mouse sul testo:", hovering);
    if (!hovering && this.pausedByUs) {
      this.pausedByUs = false;
      if (this.video.paused) this.clock.play();
    }
  };

  /** Se il video riparte (per qualsiasi motivo), la nostra pausa è finita. */
  private handlePlay = (): void => {
    this.pausedByUs = false;
  };
}

function joinCues(cues: Cue[]): string {
  return cues.map((cue) => cue.text).join("\n");
}
