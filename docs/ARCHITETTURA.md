# Architettura

Dyadrr è una **libreria TypeScript con una riga di comando** (studio §14). La
logica sta nella libreria; il contratto è la riga di comando con il report
JSON. In Wayfinderr (fase 2) Dyadrr gira in un container separato, con
un'immagine propria (`Dockerfile`): Wayfinderr gli passa i lavori con file job
su una cartella condivisa, e il runner nel container lancia la riga di comando
(studio §14, decisione 7; [CONTAINER.md](CONTAINER.md)).

- **Compilazione:** CommonJS, senza `await` al livello principale, così il
  backend di Wayfinderr (che compila in CommonJS) può anche importare la
  libreria.
- **Dipendenze:** nessuna a runtime. ffmpeg (≥ 6.1), ffprobe e mkvtoolnix
  (≥ v57) si lanciano come programmi esterni; nella costruzione ffmpeg serve
  solo per la coda delle tracce FLAC.
- **Node:** 22.
- **Eseguibili** (`bin` in `package.json`): `dyadrr` è `dist/bin.js`,
  `dyadrr-runner` è `dist/runner-bin.js`, `dyadrr-pairs` è
  `dist/pairs-bin.js`.

## Moduli

Il test `test/docs.test.ts` controlla che questa tabella elenchi tutti i file
`.ts` e `.json` di `src/`, e solo quelli.

| File | Cosa contiene | Studio |
|---|---|---|
| `src/index.ts` | Punto d'ingresso della libreria: riesporta i moduli | §14 |
| `src/codes.ts` | Codici di rifiuto, errore e avviso; codici di uscita; `DyadrrError` | §11–12 |
| `src/languages.ts` | Normalizzazione dei codici di lingua, riconoscimento dell'italiano, `--original-language`, scelta della lingua di misura | §3.1, §3.3 |
| `src/choices.ts` | Scelte dell'utente: opzione, variabile d'ambiente, in sospeso; `CHOICE_REQUIRED` | §10.1 |
| `src/calibration.json` | Valori di taratura versionati ([TARATURA.md](TARATURA.md)) | §9.2 |
| `src/calibration.ts` | Limiti fissi dei parametri di taratura; lettura e validazione del file (`BAD_ARGUMENTS`) | §9.1–9.2 |
| `src/tools.ts` | Programmi esterni: lancio (anche con più uscite su pipe separate, o riga per riga), sempre interrompibile con un `AbortSignal`, versioni per il report, `TOOL_MISSING` e `TOOL_TOO_OLD` (mkvmerge almeno v57, ffmpeg almeno 6.1) | §13 |
| `src/matroska.ts` | Lettura della coda di un MKV senza programmi esterni: cluster, blocchi, fine di ogni traccia, a finestre da 8 a 256 MiB | §4.8 |
| `src/inputs.ts` | Ingressi: tracce da mkvmerge -J, framerate, HDR e tag statistici da ffprobe, impronta, integrità; `INPUT_UNREADABLE` e `INPUT_BUSY`. Danno alla decisione i fatti di ogni file (`FileFacts`) e al report i dati di §11.2, punto 2. Commenti e audiodescrizioni, traccia italiana principale | §3.1–3.2, §4.2, §4.8, §8, §10, §11.2 |
| `src/audio.ts` | Lettura delle finestre audio con ffmpeg: timestamp non ribasati, pre-roll di 2 s senza il taglio di ffmpeg dopo `-ss`, taglio sui timestamp decodificati, inizio reale da `ashowinfo`, buchi oltre 2 ms riempiti; segnale a 8 kHz con passa-basso a 3 kHz, centrale, L+R (`analysisMix`) o (L − R)/2, senza DRC; più tracce nella stessa lettura; energia in dBFS e byte letti. Una finestra con meno del 90% dei campioni attesi è `INPUT_UNREADABLE` | §4.2–4.3, §4.8, §11.2 |
| `src/correlation.ts` | Correlazione su campioni, funzioni pure: FFT, ricerca a blocchi con GCC-PHAT nella banda di analisi, rifinitura NCC con parabola, somiglianza con interpolazione sinc, unicità sull'NCC fuori dalla zona di esclusione; stiramento per la diagnosi di velocità | §4.2, §4.4 |
| `src/measure.ts` | Misura: coppie di tracce (`candidatePairs`), ancore con diagnosi di velocità, confini del materiale in comune, punti di conferma con spostamento sul contenuto e punti aggiunti, ricerche oltre i confini, controllo di trasferimento, anche sul file finale (`measureTransfer`); avanzamento per fase (`MeasureProgress`) e annullamento; dà alla decisione `AnchorMeasure`, `CheckpointMeasure`, `EdgeProbe` e `TransferProbe` (`decisionMeasures`). `analyzePair` unisce controlli strutturali, misura, decisione e, per una coppia idonea, il piano | §4.2–4.7, §9.2, §11.2 |
| `src/plan.ts` | Piano di inizio e fine: casi all'inizio e alla fine, intro e code diverse, punti di taglio, intervallo dell'italiano; scelte necessarie con l'effetto di ogni valore; tracce audio italiane prese con il ruolo stimato, PGS presi e forced (`classifySubtitles`); avvisi del piano. `planMerge` è una funzione pura; `planPair` vi aggiunge il livello dell'italiano nei punti di taglio iniziale (`ABRUPT_START`) | §5, §7, §8, §10.1, §11.2 |
| `src/build.ts` | Costruzione: dal piano ai comandi (`planBuild`, funzione pura), con i fatti letti nei punti di taglio (`readCutFacts`: punti di sincronizzazione TrueHD, sottotitoli a schermo); intermedio con due passate di `--sync` per il taglio iniziale, `--split` o ffmpeg per FLAC alla fine; unione finale con ordine, flag e compressione espliciti; esito di mkvmerge, spazio libero, cartella di lavoro, avanzi, rinomina con un link fisico (`commitBuild`), anche al posto di un file finale che c'era già, con il consenso dell'utente (`existingOutput`, `BuildRequest.replace`); `SUBTITLES_DROPPED_AT_CUT`, `MKVMERGE_WARNING`, `MERGE_FAILED`, `NO_SPACE`, `OUTPUT_EXISTS`, `OUTPUT_NOT_WRITABLE` | §6, §7, §13 |
| `src/verify.ts` | Verifiche dopo il merge, tra `buildMerge` e `commitBuild` (`verifyBuild`): il file finale letto come un ingresso e confrontato con il riferimento e con `Build.tracks` (tracce, titolo e capitoli; video con dati del codec, metadati HDR e Dolby Vision, fotogrammi e timestamp; pacchetti delle tracce del riferimento; inizio e fine dell'italiano entro un pacchetto del codec; durata); controllo di trasferimento sul file finale (`OUTPUT_TRANSFER_OFFSET`, `OUTPUT_TRANSFER_UNVERIFIED`). Una verifica bloccante fallita elimina la cartella di lavoro: `VERIFY_FAILED` (`VerifyFailedError`, con l'esito di ogni verifica) | §4.7, §9.5 |
| `src/report.ts` | Il report (§11.3): forma (`Report`, `REPORT_FIELDS`), versione del formato (`REPORT_FORMAT`), fasi dell'avanzamento (`PROGRESS_PHASES`), scrittura con un nome temporaneo e rinomina, nome predefinito; lettura del report di `--expect` e confronto di impronte, ruoli, S e piano | §10–11 |
| `src/cli.ts` | Riga di comando (`runCli`): argomenti, ordine di analyze e merge (`analyzePair`, scelte, `buildMerge`, `verifyBuild`, `commitBuild`), scelte chieste in un terminale, `--expect` (`INPUT_CHANGED`), ingressi dopo il merge (`--inputs`, `INPUT_NOT_DELETED`), `--progress json`, annullamento (`CANCELLED`), report sempre scritto e codice di uscita da `exitCodeFor`. Non tocca il processo: tutto arriva da `CliEnvironment` | §9.4, §10–11 |
| `src/bin.ts` | Il processo `dyadrr`: segnali di stop (SIGINT, SIGTERM, SIGHUP) su un `AbortController`, secondo segnale, domande in un terminale con readline, codice di uscita | §10 |
| `src/runner.ts` | Runner dei file job (`runRunner`): cartelle nel container e intervalli (`RUNNER`), lettura del job (`parseJob`, `BAD_ARGUMENTS`), percorsi relativi a `/data`, argomenti della riga di comando (`jobArguments`), un lavoro alla volta da `.job` a `.exit`, `.cancel` con un solo SIGTERM, report scritto dal runner (`writeOutcomeReport`) quando Dyadrr non lo scrive, lavori interrotti all'avvio (`INTERRUPTED`), `dyadrr.alive` | §14.1 |
| `src/runner-bin.ts` | Il processo `dyadrr-runner`, comando di default dell'immagine: `--data`, segnali di stop, secondo segnale | §14.1 |
| `src/pairs.ts` | Le coppie reali della fase 1 (`runPairs`): lettura dell'elenco (`parsePairList`, `BAD_ARGUMENTS`), argomenti di `analyze` (`pairArguments`), report riusabili (`reusable`), una coppia alla volta nel suo processo, con il report scritto qui se Dyadrr non lo scrive; riassunto di una coppia (`summarizePair`: verdetto, S, punti, margini dei picchi rispetto alle soglie) e della serie (`summarizeSeries`: criterio di uscita della fase 1, margini delle soglie), `summary.json` e `summary.md` ([COPPIE.md](COPPIE.md)) | §15 |
| `src/pairs-bin.ts` | Il processo `dyadrr-pairs`: argomenti, segnali di stop, secondo segnale | §15 |
| `src/decision.ts` | Decisione: funzione pura dalle misure e dalla taratura a decisione, controlli, motivi, avvisi, S definitivo, deriva, forma della contraddizione e copertura; `checkStructure` per i soli controlli strutturali, prima di misurare | §4.4–4.7, §9.3–9.4, §9.6 |

## Immagine

- `Dockerfile`, a tre stadi: `build` compila il TypeScript sulla piattaforma
  della build; `runtime` è l'immagine pubblicata (Alpine 3.22 con Node 22,
  ffmpeg 6.1.2, mkvtoolnix 92.0 e tini, `dist/` e `package.json`);
  `test` aggiunge a `runtime` npm, i sorgenti e i test, per lanciare la suite
  sull'immagine (studio §14.2). Nel `PATH` ci sono `dyadrr`, `dyadrr-runner`
  e `dyadrr-pairs`.
- `.github/workflows/image.yml` (workflow **Image**): costruzione per amd64 e
  arm64, suite sull'immagine, versioni, un job con il runner, un elenco di
  coppie con `dyadrr-pairs`, pubblicazione su GHCR da `main`
  ([CONTAINER.md](CONTAINER.md#immagine)).

## Moduli previsti

Nessuno: il container (studio §14, decisione 7) è fatto dalla 0.12.0.

## Test

- `node:test`, file in `test/*.test.ts`, compilati in `build/` ed eseguiti con
  `npm test`.
- `test/docs.test.ts` tiene la documentazione allineata al codice
  (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)).
- `test/inputs.test.ts`, `test/audio.test.ts`, `test/measure.test.ts`,
  `test/build.test.ts`, `test/verify.test.ts`, `test/cli.test.ts` e `test/tools.test.ts` usano
  ffmpeg, ffprobe e mkvtoolnix veri: generano piccoli MKV in una cartella temporanea
  (`test/helpers/mkv.ts`) e la cancellano alla fine. La CI li installa.
- `test/audio.test.ts` misura dove cade ogni finestra confrontandola con una
  lettura di riferimento (`test/helpers/correlate.ts`): spostamenti noti con
  `mkvmerge --sync`, finestre dopo i fotogrammi chiave, AC3, E-AC3, FLAC,
  TrueHD e DTS (studio §15, 1d).
- `test/correlation.test.ts` prova la correlazione su segnali sintetici, senza
  file: ritardi con il decimale, contenuto ripetitivo, silenzio, stiramento.
- `test/measure.test.ts` misura coppie di MKV di 120 s generati al volo
  (studio §15, 1a e 1b): spostamenti con `--sync`, code e tagli con `--split`
  su intermedi senza video, intro diverse, silenzi, remix, velocità diverse,
  contenuto ripetitivo. Usa una taratura con finestre e intervallo di ricerca
  più corti, perché i file durano due minuti. Sugli stessi file prova anche il
  piano: tagli, intro diversa, coda in più, livello nel punto di taglio.
- `test/plan.test.ts` prova il piano su ingressi sintetici, senza file: casi
  di inizio e fine, scelte e loro effetto, tracce prese, forced, avvisi.
- `test/build.test.ts` costruisce file veri da MKV di 30 s con audio italiano
  AC3, TrueHD e FLAC e PGS scritti a mano (`test/helpers/pgs.ts`, formato
  .sup): S positivo e negativo, tagli all'inizio del film e sui confini, coda
  con `--split` e con ffmpeg, e controlla sul file prodotto ordine, flag,
  compressione, capitoli e tagli. Gli esiti di mkvmerge (codici 1 e 2, disco
  pieno) si provano con un mkvmerge finto, lo spazio che manca con uno spazio
  libero simulato (`freeSpace`). Sulle stesse costruzioni lancia anche le
  verifiche dopo il merge, che controllano le tolleranze di AC3, TrueHD e FLAC
  ai tagli.
- `test/verify.test.ts` verifica file costruiti da MKV di 30 s di rumore rosa
  in 5.1, con l'italiano che condivide i canali non centrali dell'inglese:
  riferimento HEVC HDR10, anche senza tag statistici; trasferimento a zero
  sul file finale e con uno S sbagliato di 40 ms; `VERIFY_FAILED` con errori
  iniettati (`Build.tracks` alterato, file cambiato con mkvpropedit o
  troncato).
- `test/cli.test.ts` lancia la riga di comando (`runCli`) su MKV di 60 s di
  rumore rosa in 5.1, con due tracce italiane, e legge i report scritti:
  `analyze` con le scelte in sospeso e l'avanzamento, `merge --expect` fino al
  file consegnato, scelte da variabile d'ambiente e chieste in un terminale
  finto, `INPUT_CHANGED` con report alterati e un ingresso copiato,
  `CANCELLED` con un `AbortSignal`, argomenti sbagliati, `--inputs` su copie
  degli ingressi. L'ultimo test lancia
  il processo vero (`build/src/bin.js`) e lo ferma con SIGTERM.
- `test/runner.test.ts` prova il runner su una cartella con la forma di
  `/data`: file job letti e tradotti in argomenti, il Dyadrr vero su MKV di
  60 s (job sbagliati, un valore sbagliato, `.cancel` durante l'analisi e
  prima di cominciare, id riusati, `dyadrr.alive`), un Dyadrr finto per i
  crash, i processi uccisi, i `.run` rimasti all'avvio e lo stop del runner;
  infine il processo `dyadrr-runner`.
- `test/pairs.test.ts` prova le coppie reali: l'elenco e i suoi errori, i
  report riusabili, il riassunto di una coppia sul report vero di un'analisi
  idonea (MKV di 60 s di rumore rosa) e su sue varianti (rifiuti per salti,
  errori, picchi deboli), il riassunto della serie e il criterio di uscita;
  la serie con un Dyadrr finto (riuso, `--only`, `--again`, crash, processo
  ucciso, annullamento con un solo SIGTERM); infine il processo
  `dyadrr-pairs` con il Dyadrr vero.
- Il workflow **Image** ripete tutta la suite dentro l'immagine (sopra).
