# Netflix Dual Subs

Estensione per Chrome che mostra **due sottotitoli contemporaneamente** su
Netflix, per studiare le lingue. Nata come rielaborazione di
[NflxMultiSubs](https://github.com/dannvix/NflxMultiSubs), codice e struttura sono stati modificati in gran parte.

Funzioni:

- sottotitolo principale (quello scelto nel menu di Netflix) e secondario
  (scelto in una colonna aggiunta allo stesso menu);
- il secondario viene ricordato e riattivato da solo a ogni episodio;
- testo selezionabile, con dimensione regolabile;
- sfocatura di uno o entrambi i sottotitoli, che si rivelano col mouse;
- pausa automatica a fine battuta quando il mouse è sopra il testo;
- sincronizzazione corretta anche con gli account con pubblicità.

## Installazione e build

Serve Node.js (versione 18 o successiva).

```bash
npm install        # una volta sola
npm run build      # crea la cartella dist/
```

Per caricarla in Chrome:

1. apri `chrome://extensions`;
2. attiva "Modalità sviluppatore" in alto a destra;
3. "Carica estensione non pacchettizzata" → scegli la cartella `dist`.

Dopo ogni modifica al codice: `npm run build`, poi il pulsante ↻
dell'estensione in `chrome://extensions`, poi **ricarica la scheda di
Netflix** (gli script già caricati nella scheda non si aggiornano da soli).

Altri comandi:

| Comando             | A cosa serve                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run watch`     | ricompila a ogni salvataggio dei file `.ts` (con source map per il debug) |
| `npm run typecheck` | controlla gli errori di tipo TypeScript senza compilare                   |

Il codice TypeScript è compilato da **esbuild** (configurato in `build.mjs`);
`tsconfig.json` serve solo al controllo dei tipi e all'editor.

## Struttura delle cartelle

```
static/                      file copiati così come sono in dist/
  manifest.json              dichiarazione dell'estensione per Chrome
  popup.html, popup.css      finestrella delle impostazioni
  assets/                    icone (da copiare a mano, vedi sopra)

src/
  shared/                    codice usato da tutti e tre i bundle
    settings.ts              tipo Settings, valori di default, validazione
    messages.ts              formato dei messaggi pagina ⇄ content script

  content/
    bridge.ts                content script: ponte verso chrome.storage

  popup/
    popup.ts                 logica del popup

  page/                      tutto ciò che gira dentro la pagina di Netflix
    main.ts                  punto di ingresso
    log.ts                   log in console con prefisso [DualSubs]
    settingsClient.ts        copia locale delle impostazioni

    netflix/                 tutto ciò che dipende da come è fatto Netflix
      types.ts               tipi del manifest (vecchio e nuovo formato)
      manifestFormat.ts      lettura del manifest in entrambi i formati
      selectors.ts           selettori CSS del player
      manifestInterceptor.ts intercettazione del manifest
      navigation.ts          lettura dell'URL e cambi di pagina
      playerApi.ts           accesso al player interno di Netflix
      nativeMenuWatcher.ts   osserva il menu "Audio e sottotitoli"

    subtitles/               sottotitoli, indipendenti da Netflix
      ttml.ts                lettura dei file XML dei sottotitoli
      normalizeText.ts       normalizzazione del testo per i confronti
      SubtitleTrack.ts       una traccia: download e ricerca battute
      trackFactory.ts        dal manifest all'elenco di tracce
      trackMatching.ts       abbinamento voci di menu ⇄ tracce

    core/                    logica principale
      Controller.ts          decide quando avviare/fermare una sessione
      PlaybackSession.ts     un film in riproduzione: ciclo di disegno
      PlayerClock.ts         "a che secondo del film siamo?"
      Calibrator.ts          correzione automatica del tempo
      PrimaryDetector.ts     riconosce il sottotitolo attivo in Netflix

    ui/                      ciò che si vede sopra il video
      Overlay.ts             i due sottotitoli (in uno Shadow DOM)
      overlayStyles.ts       il CSS dell'Overlay
      SecondaryMenu.ts       colonna aggiunta al menu di Netflix
      NativeSubtitleHider.ts nasconde i sottotitoli originali
```

Ogni file inizia con un commento che ne spiega lo scopo, e ogni funzione ha
un commento sulla sua logica. Questa pagina descrive come i pezzi lavorano
insieme.

## I tre "mondi" dell'estensione

Un'estensione Chrome esegue codice in contesti separati, che non condividono
variabili:

```
┌──────────────────────────── scheda di Netflix ────────────────────────────┐
│                                                                           │
│  MAIN world (src/page)                 mondo isolato (src/content)        │
│  ─ vede le variabili di Netflix        ─ vede chrome.storage              │
│  ─ intercetta il manifest              ─ NON vede le variabili di Netflix │
│  ─ disegna i sottotitoli                                                  │
│  ─ NON vede chrome.storage                                                │
│              │                                   │                        │
│              └──────── window.postMessage ───────┘                        │
└───────────────────────────────────────────────────┬───────────────────────┘
                                                    │ chrome.storage
                                          ┌─────────┴─────────┐
                                          │  popup (src/popup)│
                                          └───────────────────┘
```

Lo script della pagina deve stare nel MAIN world perché deve intercettare
le richieste XHR del player di Netflix e leggere l'oggetto globale `netflix`. Ma da lì non
può salvare le impostazioni, quindi passa dal content script.

Entrambi gli script sono dichiarati in `manifest.json` con
`"run_at": "document_start"`, cioè partono prima di qualsiasi script di
Netflix. La versione vecchia iniettava lo script della pagina con un tag
`<script>` solo all'evento `load`, cioè tardi.

## Come funziona: i flussi principali

### 1. Avvio della pagina (`page/main.ts`)

Appena si apre qualsiasi pagina di netflix.com:

1. viene creato il `SettingsClient`, che chiede le impostazioni al content script;
2. viene creato il `Controller`;
3. viene installata l'intercettazione del manifest (`manifestInterceptor.ts`):
   ogni richiesta XHR o fetch verso `/playapi/cadmium/manifest` viene
   osservata e la sua risposta letta da noi, senza modificarla;
4. viene installato il controllo dei cambi di URL (`navigation.ts`);
5. quando il DOM è pronto, il Controller controlla se siamo già nel player.

### 2. Dalla home al film

Netflix non ricarica la pagina quando apri un film: cambia l'URL da
`/browse` a `/watch/<id>`. Inoltre scarica il manifest _quando vuole_: a
volte prima del cambio di URL (anteprime, pre-caricamento), a volte dopo.

Il Controller (`core/Controller.ts`) gestisce entrambi i casi perché
reagisce a tutti e due gli eventi con la stessa funzione, `tryActivate()`:

```
manifest intercettato ─┐
                       ├─▶ tryActivate()
URL cambiato ──────────┘        │
                                ├─ URL non è /watch/<id>?  → chiude la sessione
                                ├─ sessione già attiva per <id>? → niente
                                ├─ aspetta il <video>
                                ├─ manifest di <id> non ancora arrivato? → aspetta
                                │     (quando arriva, tryActivate riparte)
                                └─ crea una PlaybackSession
```

Era questo il bug "devo ricaricare la pagina": la versione vecchia ascoltava
solo l'arrivo del manifest e lo scartava se l'URL non era ancora `/watch`.

### Il formato del manifest

Netflix ha cambiato il formato del manifest. `manifestFormat.ts` legge
entrambi e li trasforma in una struttura nostra (`ParsedManifest`), così il
resto del codice non dipende dai nomi dei campi di Netflix.

| Formato 1 (vecchio) | Formato 2 (attuale)                          |
| ------------------- | -------------------------------------------- |
| `timedtexttracks`   | `textTracks`                                 |
| `new_track_id`      | `id`                                         |
| `ttDownloadables`   | `downloadables`                              |
| sempre tutti i link | link solo per le tracce con `hydrated: true` |

Nel formato 2 Netflix include i link di download solo per alcune lingue
(probabilmente quelle legate al profilo). Le altre compaiono nel menu come
"(non disponibile)". Se Netflix manda un altro manifest dello stesso film
con quei link, `Controller.handleManifest` li unisce (`mergeManifests`) e la
sessione li riceve (`PlaybackSession.mergeManifest`).

L'id del contenuto, se manca nel manifest, viene letto dal parametro
`mainContentViewableId` dell'URL della richiesta. Se non corrisponde
all'id nell'URL della pagina, il Controller usa il manifest arrivato più
di recente da quando sei entrata nel player.

### 3. La sessione di riproduzione (`core/PlaybackSession.ts`)

Quando parte, la sessione:

1. costruisce l'elenco delle tracce dal manifest (`trackFactory.ts`);
2. attiva come principale la traccia raccomandata da Netflix, se il
   manifest la indica; altrimenti la riconosce `PrimaryDetector`, che
   confronta il testo dei sottotitoli mostrati da Netflix con le tracce;
3. attiva come secondaria la lingua ricordata nelle impostazioni, se c'è;
4. avvia il ciclo di disegno.

Il ciclo gira a ogni frame dello schermo (`requestAnimationFrame`) e fa:

1. controlla che il `<video>` sia ancora nella pagina (se no, avvisa il
   Controller, che crea una nuova sessione);
2. reinserisce l'Overlay nel player se Netflix l'ha rimosso;
3. ogni 250 ms controlla se la barra dei controlli è visibile, per alzare
   i sottotitoli;
4. fa lavorare il Calibrator (vedi punto 6);
5. chiede a `PlayerClock` il secondo del film, cerca le battute visibili
   nelle due tracce (`SubtitleTrack.cuesAt`) e le passa all'Overlay;
6. se il mouse è sul testo e la battuta sta per finire, mette in pausa.

L'Overlay scrive nel DOM solo quando il testo cambia, quindi il ciclo è
leggero anche se gira 60 volte al secondo.

### 4. Scelta dei sottotitoli

**Principale:** si sceglie nel menu nativo di Netflix. `NativeMenuWatcher`
ascolta i click sulla colonna "Sottotitoli" e passa il testo della voce a
`matchTrackByNativeLabel`, che trova la traccia corrispondente ("Disattivati"
non corrisponde a nessuna traccia e spegne il principale).

**Secondario:** quando il menu di Netflix si apre, `SecondaryMenu` ci
aggiunge una terza colonna. Scegliendo una lingua, la sessione la attiva e la
salva in `settings.secondaryLang`; dal prossimo episodio verrà riattivata da
sola. Dal popup si può disattivare questa memoria.

Ogni traccia viene scaricata solo la prima volta che la scegli
(`SubtitleTrack.load`), provando in ordine i formati disponibili e i server.

### 5. Impostazioni

```
popup ──scrive──▶ chrome.storage ──onChanged──▶ content/bridge.ts
                                                     │ postMessage
                                                     ▼
                                       page/settingsClient.ts
                                                     │ subscribe
                                                     ▼
                                       Overlay.applySettings (dimensione, sfocatura)
```

Il percorso inverso (la pagina salva `secondaryLang`) passa da
`settingsClient.update` → messaggio `update-settings` → `bridge.ts` scrive
nello storage → `onChanged` → la pagina riceve la conferma.

### 6. Pubblicità e sincronizzazione

Con gli account con pubblicità, `video.currentTime` include la durata degli
annunci già visti, mentre i tempi dei sottotitoli contano solo il film. Ad
ogni interruzione, i sottotitoli andavano un po' più in ritardo.

Le difese ora sono due, una sopra l'altra.

**`PlayerClock`** usa, se disponibile, il tempo del player interno di
Netflix (`playerApi.ts`), che dovrebbe escludere la pubblicità. È un'API non
documentata: se non c'è o si rompe, si torna in automatico a
`video.currentTime`.

**`Calibrator`** corregge il resto. Netflix continua a scrivere i suoi
sottotitoli nella pagina (noi li rendiamo solo invisibili), e quelli sono
sempre sincronizzati. Quando compare una battuta nuova, il Calibrator la
cerca nella nostra traccia principale: se la trova, sa che in quel momento
il film è all'inizio di quella battuta e calcola la correzione da applicare
al tempo. Per evitare errori ignora le frasi troppo corte e applica una
correzione solo se due misure consecutive concordano.

Per vedere cosa succede, guarda in console i messaggi
`uso il tempo del player Netflix` e `calibrazione: correzione del tempo …`.

## Debug

Apri DevTools sulla scheda di Netflix (F12) → Console, e scrivi `DualSubs`
nella casella del filtro: vedrai solo i messaggi dell'estensione.

Per i messaggi dettagliati, nella console scrivi:

```js
localStorage.setItem("dualsubs:debug", "1");
```

e ricarica la pagina. Per spegnerli: `localStorage.removeItem("dualsubs:debug")`.

Messaggi utili da cercare:

| Messaggio                                                        | Significato                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `estensione avviata`                                             | lo script della pagina è partito                                                   |
| `[debug] richiesta del manifest (XHR): …`                        | Netflix ha chiesto il manifest e noi l'abbiamo vista                               |
| `manifest intercettato: … (formato 2, N tracce, M con link)`     | manifest letto correttamente                                                       |
| `sessione avviata per …: N lingue, M scaricabili subito`         | sessione partita                                                                   |
| `principale riconosciuto dai sottotitoli di Netflix: …`          | il principale è stato individuato dal testo                                        |
| `l'id nell'URL (…) non corrisponde: uso il manifest più recente` | è entrata in funzione la ricerca di riserva                                        |
| `link ricevuti per "…"`                                          | una lingua "non disponibile" è diventata scaricabile                               |
| `risposta del manifest senza tracce riconoscibili`               | Netflix ha cambiato la struttura del manifest: il messaggio elenca i campi trovati |
| `nel player di …, in attesa del suo manifest`                    | siamo nel player ma il manifest di quel film non è (ancora) arrivato               |
| `sottotitoli "…" pronti`                                         | download riuscito                                                                  |
| `nessun <video> trovato`                                         | il selettore del player non funziona più                                           |

Se compare "estensione avviata" ma mai "richiesta del manifest", Netflix ha
probabilmente cambiato l'indirizzo del manifest: nella scheda Rete di DevTools
filtra per `manifest`, guarda l'URL della richiesta e aggiorna `MANIFEST_URL`
in `manifestInterceptor.ts`.

Nota: Netflix (o estensioni come React DevTools) può sostituire le funzioni
della console. `log.ts` se ne salva una copia all'avvio, quindi i messaggi
dell'estensione restano visibili; i `console.log` scritti a mano nella
console invece potrebbero non comparire: in quel caso usa `console.warn`.

## Quando Netflix cambia qualcosa

Tutti i punti che dipendono da Netflix sono nella cartella `page/netflix/`:

- **i sottotitoli non compaiono o sono nel posto sbagliato**, oppure il menu
  secondario non appare: ispeziona il player con DevTools e aggiorna i
  selettori in `selectors.ts`;
- **"sessione avviata" non compare mai**: controlla in `manifestInterceptor.ts`
  l'indirizzo (`MANIFEST_URL`) e il riconoscimento del manifest
  (`looksLikeManifest`), e in `types.ts` i nomi dei campi (`movieId`,
  `timedtexttracks`, `ttDownloadables`…);
- **la pausa o il tempo del player non funzionano**: controlla i percorsi in
  `playerApi.ts`. Se si rompe, l'estensione usa comunque il `<video>` e la
  calibrazione.

## Limiti noti

- Nel formato attuale del manifest, alcune lingue arrivano senza link e
  compaiono come "(non disponibile)". Da verificare se Netflix le fornisce
  in seguito (per esempio selezionandole una volta come sottotitolo
  principale nel menu di Netflix).
- I sottotitoli **a immagini** (formato `nflx-cmisc`, usato per alcune
  lingue asiatiche) non sono supportati: quelle lingue non compaiono
  nell'elenco.
- Durante la pubblicità stessa possono comparire battute del film.
- La calibrazione funziona solo se il sottotitolo principale è attivo
  (non "Disattivati").
- La barra dei controlli viene riconosciuta dalla presenza di un elemento
  nel DOM: se Netflix lo lascia sempre presente, i sottotitoli restano
  sempre un po' più in alto.
