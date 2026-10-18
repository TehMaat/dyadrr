# Architettura

Dyadrr è una **libreria TypeScript con una riga di comando** (studio §14). La
logica sta nella libreria; il contratto è la riga di comando con il report
JSON. In Wayfinderr (fase 2) Dyadrr girerà in un container separato, con
un'immagine propria: Wayfinderr gli passerà i lavori con file job su una
cartella condivisa, e un runner nel container lancerà la riga di comando
(studio §14, decisione 7).

- **Compilazione:** CommonJS, senza `await` al livello principale, così il
  backend di Wayfinderr (che compila in CommonJS) può anche importare la
  libreria.
- **Dipendenze:** nessuna a runtime. ffmpeg (≥ 6.1), ffprobe e mkvtoolnix
  (≥ v57) si lanciano come programmi esterni; nella costruzione ffmpeg serve
  solo per la coda delle tracce FLAC.
- **Node:** 22.

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
| `src/tools.ts` | Programmi esterni: lancio (anche con più uscite su pipe separate, o riga per riga e interrompibile), versioni per il report, `TOOL_MISSING` e `TOOL_TOO_OLD` (mkvmerge almeno v57, ffmpeg almeno 6.1) | §13 |
| `src/matroska.ts` | Lettura della coda di un MKV senza programmi esterni: cluster, blocchi, fine di ogni traccia, a finestre da 8 a 256 MiB | §4.8 |
| `src/inputs.ts` | Ingressi: tracce da mkvmerge -J, framerate, HDR e tag statistici da ffprobe, impronta, integrità; `INPUT_UNREADABLE` e `INPUT_BUSY`. Danno alla decisione i fatti di ogni file (`FileFacts`) e al report i dati di §11.2, punto 2. Commenti e audiodescrizioni, traccia italiana principale | §3.1–3.2, §4.2, §4.8, §8, §10, §11.2 |
| `src/audio.ts` | Lettura delle finestre audio con ffmpeg: timestamp non ribasati, pre-roll di 2 s senza il taglio di ffmpeg dopo `-ss`, taglio sui timestamp decodificati, inizio reale da `ashowinfo`, buchi oltre 2 ms riempiti; segnale a 8 kHz con passa-basso a 3 kHz, centrale, L+R (`analysisMix`) o (L − R)/2, senza DRC; più tracce nella stessa lettura; energia in dBFS e byte letti. Una finestra con meno del 90% dei campioni attesi è `INPUT_UNREADABLE` | §4.2–4.3, §4.8, §11.2 |
| `src/correlation.ts` | Correlazione su campioni, funzioni pure: FFT, ricerca a blocchi con GCC-PHAT nella banda di analisi, rifinitura NCC con parabola, somiglianza con interpolazione sinc, unicità sull'NCC fuori dalla zona di esclusione; stiramento per la diagnosi di velocità | §4.2, §4.4 |
| `src/measure.ts` | Misura: coppie di tracce (`candidatePairs`), ancore con diagnosi di velocità, confini del materiale in comune, punti di conferma con spostamento sul contenuto e punti aggiunti, ricerche oltre i confini, controllo di trasferimento, anche sul file finale (`measureTransfer`); dà alla decisione `AnchorMeasure`, `CheckpointMeasure`, `EdgeProbe` e `TransferProbe` (`decisionMeasures`). `analyzePair` unisce controlli strutturali, misura, decisione e, per una coppia idonea, il piano | §4.2–4.7, §9.2, §11.2 |
| `src/plan.ts` | Piano di inizio e fine: casi all'inizio e alla fine, intro e code diverse, punti di taglio, intervallo dell'italiano; scelte necessarie con l'effetto di ogni valore; tracce audio italiane prese con il ruolo stimato, PGS presi e forced (`classifySubtitles`); avvisi del piano. `planMerge` è una funzione pura; `planPair` vi aggiunge il livello dell'italiano nei punti di taglio iniziale (`ABRUPT_START`) | §5, §7, §8, §10.1, §11.2 |
| `src/build.ts` | Costruzione: dal piano ai comandi (`planBuild`, funzione pura), con i fatti letti nei punti di taglio (`readCutFacts`: punti di sincronizzazione TrueHD, sottotitoli a schermo); intermedio con due passate di `--sync` per il taglio iniziale, `--split` o ffmpeg per FLAC alla fine; unione finale con ordine, flag e compressione espliciti; esito di mkvmerge, spazio libero, cartella di lavoro, avanzi, rinomina con un link fisico (`commitBuild`); `SUBTITLES_DROPPED_AT_CUT`, `MKVMERGE_WARNING`, `MERGE_FAILED`, `NO_SPACE`, `OUTPUT_EXISTS`, `OUTPUT_NOT_WRITABLE` | §6, §7, §13 |
| `src/verify.ts` | Verifiche dopo il merge, tra `buildMerge` e `commitBuild` (`verifyBuild`): il file finale letto come un ingresso e confrontato con il riferimento e con `Build.tracks` (tracce, titolo e capitoli; video con dati del codec, metadati HDR e Dolby Vision, fotogrammi e timestamp; pacchetti delle tracce del riferimento; inizio e fine dell'italiano entro un pacchetto del codec; durata); controllo di trasferimento sul file finale (`OUTPUT_TRANSFER_OFFSET`, `OUTPUT_TRANSFER_UNVERIFIED`). Una verifica bloccante fallita elimina la cartella di lavoro: `VERIFY_FAILED` (`VerifyFailedError`, con l'esito di ogni verifica) | §4.7, §9.5 |
| `src/decision.ts` | Decisione: funzione pura dalle misure e dalla taratura a decisione, controlli, motivi, avvisi, S definitivo, deriva, forma della contraddizione e copertura; `checkStructure` per i soli controlli strutturali, prima di misurare | §4.4–4.7, §9.3–9.4, §9.6 |

## Moduli previsti

In ordine di sviluppo indicativo (fase 1, studio §15):

1. **Report** e **riga di comando** (§10–11). Il report unisce gli ingressi, la
   misura (`Measurement`: coppie provate, posizioni richieste e reali, byte
   letti), la decisione, il piano, la costruzione (comandi, tracce finali,
   sottotitoli persi) e le verifiche (`Verification`: esito di ogni verifica,
   inizio e fine dell'italiano, durata, trasferimento), con gli avvisi di
   decisione, piano, costruzione e verifiche in un solo elenco. Il merge è
   `buildMerge`, poi `verifyBuild` (la traccia di misura è
   `Measurement.pair.referenceTrackId`), poi `commitBuild`. L'annullamento
   (`CANCELLED`) arriva come l'errore di un `AbortSignal`.
2. **Container** per Wayfinderr (fase 2, decisione 7): immagine
   multi-architettura e runner dei file job (studio §14).

## Test

- `node:test`, file in `test/*.test.ts`, compilati in `build/` ed eseguiti con
  `npm test`.
- `test/docs.test.ts` tiene la documentazione allineata al codice
  (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)).
- `test/inputs.test.ts`, `test/audio.test.ts`, `test/measure.test.ts`,
  `test/build.test.ts`, `test/verify.test.ts` e `test/tools.test.ts` usano
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
