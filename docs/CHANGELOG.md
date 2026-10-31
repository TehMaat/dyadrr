# Changelog

Tutte le modifiche rilevanti, una sezione per versione. Le versioni seguono il
[semantic versioning](https://semver.org); le regole sono in
[CONTRIBUTING.md](../CONTRIBUTING.md#versioning).

## [0.17.1] - 2026-10-31

### Corretto
- Un'analisi o un merge annullati, o finiti in errore, non sostituiscono più
  il report di un'esecuzione finita (`eligible` o `refused`) con lo stesso
  `--report`: il loro report va accanto,
  `<nome>-<decisione>-<AAAAMMGG>T<HHMMSS>Z.json`, e stdout dà il percorso
  scritto. Su A Quiet Place un'analisi annullata aveva cancellato quella
  finita. L'analisi non cambia
- Documentazione: studio di fattibilità 0.23 (§10, §18, §20), primo passo
  della fase 2

## [0.17.0] - 2026-10-31

### Cambiato
- Chiusa la fase 1 sulle coppie reali (decisione 12). Su 25 coppie nessun
  merge sbagliato; nove coppie buone rifiutate, tutte con la causa scritta; 3
  coppie UHD + BD su 15 rifiutate per salti sotto il fotogramma. Le categorie
  `non-english` e `two-discs` mancano e passano alla fase 2
- La taratura resta la versione 4: i valori provvisori restano provvisori e si
  rivedono in fase 2, uno alla volta
- L'analisi si può di nuovo cambiare: finisce il fermo deciso nella 0.15.0
  (studio 0.18); ogni cambio ha la sua voce in `ANALYSIS_CHANGES`
- Documentazione: studio di fattibilità 0.22 (§9.2, §15, §17, §18), il
  riassunto di `dyadrr-pairs` in `docs/fase1/summary.md`, stato in README,
  COPPIE.md e TARATURA.md
- CI: i test girano su Ubuntu 24.04 fissata (ffmpeg 6.1.1, come dice lo
  studio, §14.2) e non più su `ubuntu-latest`, passata a 26.04 con ffmpeg 8.0

## [0.16.0] - 2026-10-25

### Aggiunto
- Sottotitoli italiani di testo del donatore (SubRip, SSA/ASS, WebVTT): si
  prendono come i PGS, spostati di S senza toccarli. Al taglio iniziale la
  riga a schermo si perde come per i PGS (`SUBTITLES_DROPPED_AT_CUT`); al
  taglio finale resta, perché ha la sua durata. Nel file finale non sono mai
  compressi; il primo forced, PGS o di testo, è predefinito. Nel report il
  campo `text` dei sottotitoli. Per Turning Red, con i sottotitoli italiani in
  SubRip in un file montato a mano
- Documentazione: studio di fattibilità 0.21 (P6, §6, §7)

### Cambiato
- `ITALIAN_SUBS_NOT_PGS` scatta solo per i sottotitoli italiani né PGS né di
  testo, per esempio VobSub
- Forced riconosciuti dai blocchi: il confronto è con la traccia più grande
  della stessa lingua e dello stesso formato, perché un sottotitolo PGS è
  almeno due blocchi e uno di testo uno solo
- `NO_FORCED_ITALIAN_SUBS` conta anche i forced di testo
- L'analisi cambia solo nei sottotitoli del piano e nei loro avvisi: voce
  0.16.0 in `ANALYSIS_CHANGES`, i report di prima restano validi per
  `dyadrr-pairs`

## [0.15.2] - 2026-10-25

### Corretto
- Verifiche dopo il merge: l'inizio di una traccia italiana che parte dopo i
  primi 10 s circa del file finale. mkvmerge -J non lo riporta, e il merge
  finiva in `VERIFY_FAILED` (*track 1 starts at none ms*); ora si legge il
  primo pacchetto con ffprobe, più il ritardo del codec. Trovato su Kung Fu
  Panda 2, con l'italiano a 24,7 s dopo il logo Universal. L'analisi non
  cambia
- Documentazione: studio di fattibilità 0.20 (§9.5)

## [0.15.1] - 2026-10-25

### Corretto
- `merge --expect`: una scelta in sospeso nell'analisi che il valore dato a
  un'altra rende inutile non è più una differenza. Con code diverse e
  `--edge-mismatch drop` `--tail` non serve, e il merge finiva in
  `INPUT_CHANGED` (*choice tail: not needed, confirmed needed*) anche con il
  piano uguale a quello confermato. Trovato su Kung Fu Panda 2. L'analisi non
  cambia
- Documentazione: studio di fattibilità 0.19 (§10)

## [0.15.0] - 2026-10-24

### Aggiunto
- `dyadrr-pairs`: chiave `report` nell'elenco delle coppie, il percorso di un
  report di `dyadrr analyze` già fatto. La coppia non si misura: entra nel
  riassunto con quel report, anche se i file non ci sono più. Così dopo
  l'analisi (e il merge) i rip si possono cancellare: restano il report e
  l'elenco. Si controlla prima di misurare che il report sia un'analisi
  `eligible` o `refused`, degli stessi file (per nome) e con la stessa lingua
  originale; altrimenti `BAD_ARGUMENTS`
- Verdetto `stale`: un report importato che non vale più, perché di un altro
  formato, di un'altra taratura, di prima della 0.13.0 o di una versione che
  una modifica successiva dell'analisi rende superata. Non conta tra le coppie
  misurate
- Riassunto: `imported` per ogni coppia (versione del report e differenze da
  oggi); in `summary.md` l'elenco dei report importati
- Elenco nel codice delle versioni che hanno cambiato l'analisi
  (`ANALYSIS_CHANGES` in `src/pairs.ts`), con la 0.14.0: una PR che cambia cosa
  scrive `analyze` ci aggiunge la sua versione, così `dyadrr-pairs` riconosce i
  report superati
- Documentazione: studio di fattibilità 0.18 (§15)

## [0.14.0] - 2026-10-21

### Aggiunto
- Avviso `MAIN_TRACKS_DISAGREE`: la coppia di misura non è quella delle tracce
  principali (più canali, poi lossless), e le tracce principali danno un altro
  S oltre la tolleranza. Su Scott Pilgrim la misura era su due commenti
  identici, a 0 ms, mentre il film dava 27 e 80 ms
- Report: `measurement.transfer.candidates` e
  `output.verification.transfer.candidates`, ogni traccia della lingua di
  misura provata nel controllo di trasferimento, con spostamento e picchi
  sicuri

### Modificato
- Controllo di trasferimento, nel donatore e nel file finale: prova tutte le
  tracce della lingua di misura e usa quella con più picchi sicuri; a parità
  lo stesso codec dell'italiano, poi la stessa classe (con o senza perdite),
  poi la traccia della misura. Prima usava solo la traccia della coppia
  scelta: con un commento dava `ITALIAN_UNVERIFIED`, e contro un TrueHD
  segnalava lo scarto di circa 23 ms tra tracce lossy e lossless
- Documentazione: studio di fattibilità 0.17 (§4.2, §4.5, §4.7, §9.5, §9.6)

### Corretto
- Forma della contraddizione: un tratto di un punto solo all'inizio o alla
  fine del film è un salto, non rumore. Su Thor: Ragnarok due salti di −27 ms
  e di un fotogramma risultavano `noise`, e `dyadrr-pairs` non li contava tra
  i salti di 1–2 fotogrammi

## [0.13.1] - 2026-10-19

### Corretto
- Verifiche dopo il merge: i capitoli si confrontano su inizi e titoli, non
  più sugli UID. Nel merge di un UHD rippato con MakeMKV mkvmerge ha generato
  UID nuovi per tutti i capitoli, e un file giusto finiva in `VERIFY_FAILED`
  (*the final file is not the planned one: layout (chapters …)*)
- Documentazione: studio di fattibilità 0.16 (§9.5)

## [0.13.0] - 2026-10-19

### Aggiunto
- `dyadrr-pairs`, per le coppie reali della fase 1 e la taratura delle
  soglie: lancia `dyadrr analyze` su un elenco di coppie, una alla volta e
  ognuna nel suo processo, e ne riassume i report. Nell'immagine è nel
  `PATH`: `docker run … ghcr.io/tehmaat/dyadrr dyadrr-pairs coppie.txt`
- Elenco delle coppie: una sezione `[<id>]` per coppia, con `input` (due),
  `expected` (`eligible` o `refused`), `original-language`, `category` (le
  categorie dello studio), `offset-ms` (S controllato a mano), `cause` e
  `note`; controllato tutto prima di misurare (`BAD_ARGUMENTS`, uscita 30)
- Risultati in `<elenco>-results/` (o `--results`): `<id>.json` e `<id>.log`
  per coppia, `summary.json` e `summary.md` per la serie. Un report della
  stessa versione di Dyadrr e della taratura si riusa, così una serie
  interrotta riprende; `--again` rimisura, `--only <id>` lancia solo quella
  coppia
- Riassunto: verdetto di ogni coppia (`ok`, `good-refused`, `wrong-merge`,
  `error`, `cancelled`, `missing`), S e differenza da quello a mano, punti
  per esito, margini dei picchi rispetto a θ_ncc e θ_rapporto, punti sotto
  E_min, integrità, buchi e livelli del piano; criterio di uscita della fase
  1 (coppie, categorie, merge sbagliati, rifiuti senza causa, quota di
  coppie UHD + BD rifiutate per salti di 1–2 fotogrammi)
- Report: i picchi misurati di ogni punto di conferma prima della decisione
  (`measurement.checkpoints[].local` e `.wide`). Il formato resta 1
- Libreria: `runPairs`, `parsePairList`, `summarizePair`, `summarizeSeries`,
  `summaryMarkdown`
- Documentazione: [COPPIE.md](COPPIE.md); studio di fattibilità 0.15 (§15)

### Modificato
- Workflow **Image**: controlla anche `dyadrr-pairs --version` e lancia un
  elenco di una coppia nell'immagine

### Corretto
- `dyadrr-runner`: due scritture di `dyadrr.alive` insieme, su un disco
  lento, potevano lasciarlo vuoto o a metà per un attimo; ora se ne fa una
  alla volta

## [0.12.0] - 2026-10-19

### Aggiunto
- Immagine Docker `ghcr.io/tehmaat/dyadrr` per Wayfinderr, amd64 e arm64:
  Alpine 3.22 con Node 22, ffmpeg 6.1.2, mkvtoolnix 92.0 e tini come init.
  Tag `latest`, `sha-…` e la versione, pubblicati a ogni push su `main`
- `dyadrr-runner`, il comando di default dell'immagine: prende i file job di
  Wayfinderr da `/data/watch/.wayfinderr/dyadrr/jobs/`, uno alla volta, e
  lancia la riga di comando. `<id>.job` → `<id>.run` → `<id>.log` →
  `<id>.json` → `<id>.exit`; `<id>.cancel` ferma il lavoro; `dyadrr.alive`
  ogni 5 s. Percorsi nel job relativi alle cartelle montate sotto `/data`
- `INTERRUPTED`: un lavoro nel container finito senza esito (Dyadrr ucciso,
  o trovato interrotto all'avvio del runner). Uscita 40, riprovabile
- Workflow **Image**: a ogni PR costruisce l'immagine, ci ripete tutta la
  suite, controlla le versioni e fa girare un job con il runner
- Libreria: `runRunner`, `parseJob`, `jobArguments`, `writeOutcomeReport`
- Documentazione: [CONTAINER.md](CONTAINER.md); studio di fattibilità 0.14
  (§14.1, §14.2)

## [0.11.0] - 2026-10-18

### Aggiunto
- `merge` con un `--output` che esiste già: in un terminale si chiede se
  cancellarlo e andare avanti. Il file vecchio si cancella solo dopo che il
  nuovo è costruito e verificato, e solo se è ancora lo stesso file; se il
  merge fallisce, è rifiutato o annullato, resta. Senza terminale, o con
  "no", `OUTPUT_EXISTS` come prima. Un ingresso o un report non si
  cancellano mai
- Report: `output.build.replace` e `output.build.replaced`
- Libreria: `existingOutput`, `BuildRequest.replace`; `commitBuild` cancella
  il file da sostituire subito prima del link fisico
- Studio di fattibilità 0.13 (§6.4)

## [0.10.0] - 2026-10-18

### Aggiunto
- `merge --inputs keep|delete` (o `DYADRR_INPUTS`): cosa fare dei due
  ingressi dopo un merge riuscito, verificato e consegnato. Senza opzione né
  variabile si chiede in un terminale; altrimenti gli ingressi si tengono.
  Un rifiuto, un errore o un annullamento non li toccano mai
- `INPUT_NOT_DELETED`: un ingresso cambiato da quando è stato letto, o che
  non si è potuto cancellare, resta dov'è; il merge resta consegnato
- Report: `output.inputs` (valore, origine, file cancellati) e la fase
  `inputs` negli avvisi
- Studio di fattibilità 0.12: chiuse le decisioni 3 (merge rifiutato: file
  trattenuti e scelta nella GUI), 4 (ingressi trattenuti finché non arriva il
  gemello o non li cancelli), 5 (nome normale del film, con un controllo se
  il file c'è già), 6 (tenere o cancellare gli ingressi) e 11 (voce di menu
  come Rips). Resta aperta la 12, le soglie definitive

## [0.9.0] - 2026-10-18

### Aggiunto
- Riga di comando `dyadrr analyze` e `dyadrr merge` (eseguibile `dist/bin.js`):
  - `merge` analizza, chiede o legge le scelte, costruisce, verifica e
    consegna il file finale; `--output` e la cartella dei temporanei si
    controllano prima di leggere gli ingressi;
  - opzioni `--output`, `--report`, `--original-language`, `--temp-dir`,
    `--expect`, `--progress json` e le quattro scelte, da opzione o da
    variabile d'ambiente; `--help` e `--version`;
  - su stdout solo il percorso del report; codici di uscita 0, 20, 30, 40, 50;
  - argomenti sbagliati: `BAD_ARGUMENTS`, con il report comunque scritto
- Report JSON, versione del formato 1 ([REPORT.md](REPORT.md)): intestazione
  con versioni, argomenti e taratura; decisione e motivo; ingressi; ruoli;
  misura; controlli; scelte con l'effetto di ogni valore; piano; confronto con
  `--expect`; costruzione e verifiche; avvisi di tutte le fasi in un solo
  elenco. Scritto con un nome temporaneo e poi rinominato, mai al posto di un
  ingresso o del file finale
- `--progress json`: una riga JSON per evento su stderr, con le fasi
  dell'analisi (ancore, confini, punti di conferma con i punti per esito,
  ricerche oltre i confini, trasferimento, piano) e del merge (intermedio,
  unione con la percentuale, verifiche)
- Scelte chieste in un terminale interattivo, con l'effetto di ogni valore e
  il piano ricalcolato dopo ogni risposta; senza terminale `CHOICE_REQUIRED`
- `--expect <report>`: impronte, ruoli, S e piano dell'analisi confermata,
  confrontati appena si conoscono; ogni differenza è `INPUT_CHANGED`, con
  l'elenco nel report
- Annullamento con SIGINT, SIGTERM o SIGHUP: programmi esterni terminati,
  temporanei eliminati, report `cancelled` (`CANCELLED`, uscita 50)
- Libreria: `runCli`, `Report` e il confronto di `--expect` (`src/cli.ts`,
  `src/report.ts`); `checkBuildTarget`; avanzamento della misura
  (`MeasureProgress`); ogni lettura con programmi esterni interrompibile con
  un `AbortSignal`
- Studio di fattibilità 0.11: forma del report e sua versione, eventi di
  `--progress json`, confronto di `--expect`, richiesta delle scelte,
  annullamento

## [0.8.0] - 2026-10-18

### Aggiunto
- Libreria: verifiche dopo il merge (`verifyBuild`), tra `buildMerge` e
  `commitBuild`. Il file costruito si legge come un ingresso e si confronta
  con il riferimento e con il risultato della costruzione:
  - tracce: numero, ordine, codec, lingue, nomi, flag default e forced,
    compressione dei PGS; titolo e capitoli del riferimento;
  - video identico al riferimento: dati del codec, metadati del flusso e del
    primo fotogramma (HDR10, HDR10+, Dolby Vision), fotogrammi, primo e
    ultimo timestamp entro un fotogramma;
  - stesso numero di pacchetti in ogni traccia del riferimento, dai tag
    statistici o, se il riferimento non li ha, contati con ffprobe;
  - inizio e fine di ogni traccia audio italiana entro un pacchetto del suo
    codec (AC-3 32 ms, DTS 11 ms, TrueHD 107 ms, FLAC 96 ms, altri 100 ms);
  - durata del file: la fine del riferimento o quella prevista
    dell'italiano, entro un pacchetto
- `VERIFY_FAILED`: una verifica bloccante fallita, o un file finale che non si
  legge; la cartella di lavoro si elimina e l'errore porta l'esito di ogni
  verifica (`VerifyFailedError`)
- Controllo di trasferimento sul file finale, tra l'italiano principale e la
  lingua di misura del riferimento: solo avvisi, `OUTPUT_TRANSFER_OFFSET`
  (con il valore) e `OUTPUT_TRANSFER_UNVERIFIED`
- Studio di fattibilità 0.10: metodo delle verifiche, tolleranze per codec,
  cosa è bloccante e cosa è un avviso

### Modificato
- Studio: con `--split` il taglio finale di una traccia TrueHD cade sul primo
  punto di sincronizzazione dopo il punto di taglio, fino a circa 107 ms dopo

## [0.7.0] - 2026-10-18

### Aggiunto
- Libreria: costruzione del file finale (`buildMerge`, poi `commitBuild` o
  `discardBuild`), dal piano senza scelte in sospeso. Il file resta nella
  cartella temporanea fino alla rinomina, che arriverà dopo le verifiche
- Intermedio con le sole tracce italiane prese: spostamento di S, taglio
  iniziale con due passate di `--sync` (anche sui confini e con FLAC), TrueHD
  che riparte da un punto di sincronizzazione, coda tagliata con
  `--split parts:` o, per FLAC, con ffmpeg senza ricodificare
- Unione finale: riferimento per primo, capitoli, tag e titolo solo del
  riferimento, ordine delle tracce esplicito, flag default e forced espliciti
  per ogni traccia, PGS non compressi come nell'originale
- `SUBTITLES_DROPPED_AT_CUT`: i sottotitoli a schermo in un punto di taglio,
  letti dai blocchi PGS; alla fine, se il taglio cade prima della fine del
  video, il sottotitolo si toglie tutto invece di restare a schermo
- Esito di mkvmerge: `MKVMERGE_WARNING` per ogni avviso, `MERGE_FAILED` con
  il codice 2 o un crash, `NO_SPACE` se il disco si riempie durante il merge
- Prima di scrivere: `NO_SPACE` (riferimento, tracce italiane due volte e
  2 GiB), `OUTPUT_EXISTS`, `OUTPUT_NOT_WRITABLE`, cartella dei temporanei
  con un punto e sullo stesso disco (`BAD_ARGUMENTS`), ingressi cambiati
  dall'analisi (`INPUT_BUSY`)
- Temporanei in `.dyadrr/` accanto al file finale, una cartella di lavoro per
  host e processo, avanzi di un'interruzione brusca eliminati all'avvio;
  rinomina con un link fisico, che non sovrascrive mai; annullamento con un
  `AbortSignal`
- Avanzamento di ogni comando dalle righe `#GUI#progress` di mkvmerge
- Studio di fattibilità 0.9: metodo della costruzione, con le prove su
  mkvmerge v82 e ffmpeg 6.1.1, e decisione 7 chiusa: in fase 2 Dyadrr gira in
  un container separato con profilo Compose, protocollo a file job come il
  runner MakeMKV e immagine propria multi-architettura

### Modificato
- Studio: il taglio di TrueHD si fa con due passate di `--sync` invece di
  `--split parts:t-`, che non vale fuori dallo zero né con una traccia FLAC

## [0.6.0] - 2026-10-18

### Aggiunto
- Libreria: piano di inizio e fine (`planMerge`, funzione pura, e `planPair`).
  `analyzePair` lo calcola per ogni coppia idonea, con le scelte indicate
  (`choices`), dallo spostamento definitivo e dai confini del materiale in
  comune
- Casi all'inizio e alla fine: il riferimento o il donatore hanno più intro o
  più coda, intro e code diverse (oltre 1 s fuori dal materiale in comune),
  punti di taglio, intervallo in cui l'italiano è presente, tratti senza
  italiano
- Scelte necessarie per la coppia, con l'effetto di ogni valore: intervallo
  dell'italiano, tracce prese, PGS italiani del riferimento tenuti, avvisi.
  `--tail` non serve con code diverse e `--edge-mismatch drop`
- Tracce italiane: ruolo stimato di ogni traccia audio (principale, commento o
  audiodescrizione, altra) con il motivo; PGS presi; forced riconosciuti dal
  flag, dal nome o dai pochi blocchi rispetto alla traccia più grande della
  stessa lingua, anche nel riferimento
- Avvisi del piano: `ITALIAN_TRACKS_SKIPPED`, `REFERENCE_HAS_ITALIAN_SUBS`,
  `ITALIAN_SUBS_NOT_PGS`, `NO_FORCED_ITALIAN_SUBS`, `SDR_SUBS_ON_HDR`,
  `INTRO_MISMATCH`, `OUTRO_MISMATCH`, `LONG_GAP_WITHOUT_ITALIAN`,
  `TAIL_EXCESS_KEPT` e `ABRUPT_START`, con il livello dell'italiano letto nei
  250 ms dopo ogni possibile taglio iniziale
- Taratura (versione 4 del file): `longGapWithoutItalianMs` (10 min),
  `abruptStartDbfs` (−40 dBFS) e `forcedSubsFraction` (15%), tutti
  provvisori, con i loro limiti
- Studio di fattibilità 0.8: metodo del piano, parametri e costanti

## [0.5.0] - 2026-10-18

### Aggiunto
- Libreria: misura della coppia (`measurePair`) e analisi completa
  (`analyzePair`: controlli strutturali, misura, decisione). Senza i controlli
  strutturali passati l'audio non si legge
- Correlazione senza dipendenze, con una FFT propria: posizione con la
  correlazione sbiancata (GCC-PHAT), rifinitura NCC al decimo di
  millisecondo, somiglianza indipendente da dove cade il picco tra i
  campioni, unicità sull'NCC fuori da una zona di esclusione di ±25 ms
- Coppie di tracce nella lingua di misura: tutte provate sulla prima ancora
  nella stessa lettura, esclusi commenti e audiodescrizioni; a parità due
  tracce lossless, poi lo stesso codec
- Ancore al 15/25/35/50% del film, cercate nel donatore entro ±(S_max + 60 s);
  diagnosi di velocità (1,001 e PAL) quando nessuna ancora corrisponde
- Confini del materiale in comune, al secondo, e ricerca oltre i confini di
  un film che continua a un altro spostamento
- Punti di conferma: finestre mute spostate sul contenuto restando nel loro
  intervallo, nuova ricerca su tutto l'intervallo per i punti senza
  corrispondenza, punti aggiunti nei tratti scoperti fino a 60
- Controllo di trasferimento in 5 punti, sulla traccia italiana principale:
  L+R, oppure (L − R)/2 quando le tracce non hanno il centrale
- Taratura (versione 3 del file): `anchorWindowMs` (30 s),
  `checkpointWindowMs` (10 s, provvisorio), `exclusionZoneMs` (25 ms),
  `checkpointCount` (30), `maxCheckpointCount` (60), `searchMarginMs` (60 s),
  con i limiti che legano i numeri di punti
- Riconoscimento di commenti e audiodescrizioni dal nome, anche in inglese, e
  traccia italiana principale
- Studio di fattibilità 0.7: metodo di correlazione, parametri e costanti

### Corretto
- Lettura delle finestre: con un file il cui primo timestamp è oltre i 2 s
  di pre-roll, la finestra cominciava tardi di quel tanto, o non aveva
  campioni (`INPUT_UNREADABLE`)

## [0.4.0] - 2026-10-18

### Aggiunto
- Libreria: lettura delle finestre audio (`readAudioWindow`). Una sola
  lettura con ffmpeg per finestra, anche di più tracce dello stesso file;
  timestamp delle tracce non ribasati, 2 s di pre-roll, taglio sui timestamp
  decodificati. Ogni finestra riporta il suo inizio reale (con il decimale),
  i campioni a 8 kHz con passa-basso a 3 kHz, l'energia in dBFS e i byte
  letti dal file
- Segnale di analisi: solo il canale centrale se entrambe le tracce della
  coppia lo hanno (`analysisMix`), altrimenti la media di L e R, senza LFE;
  AC3 ed E-AC3 senza compressione dinamica. I buchi nei timestamp oltre 2 ms
  si riempiono di silenzio, così ogni campione cade al suo istante
- `INPUT_UNREADABLE` anche per una finestra che decodifica meno del 90% dei
  campioni attesi, per esempio oltre il punto in cui un file è troncato;
  `INPUT_BUSY` se il file cambia tra la lettura degli ingressi e quella
  dell'audio
- `TOOL_TOO_OLD` anche per ffmpeg più vecchio di 6.1 (per le build da git
  conta la versione di libavformat)
- Ingressi: disposizione dei canali e indice del flusso di ogni traccia
- Studio di fattibilità 0.6: metodo di lettura delle finestre provato a mano
  su AC3, E-AC3, FLAC, TrueHD e DTS con ffmpeg 6.1.1 e 7.0.2 (errore di
  lettura entro ±0,5 ms, contro fino a 89 ms della lettura ingenua),
  costanti del metodo e versione minima di ffmpeg

### Modificato
- Requisiti: ffmpeg almeno 6.1

## [0.3.0] - 2026-10-18

### Aggiunto
- Libreria: lettura degli ingressi (`readInput`). Da mkvmerge -J le tracce con
  ID, tipo, lingua (campo classico e IETF), codec, canali, nome, flag default,
  forced, commento e non vedenti, compressione e primo timestamp; da ffprobe
  risoluzione, framerate, HDR (SDR, HLG, HDR10, HDR10+, Dolby Vision con il
  profilo) e tag statistici (fotogrammi, bitrate, durata, byte). Il risultato
  si passa direttamente alla decisione
- Impronta di ogni ingresso: dimensione, data di modifica, hash SHA-256 del
  primo e dell'ultimo MiB
- Controllo di integrità: Dyadrr legge da sé la coda del file e confronta la
  fine dei pacchetti con la durata dichiarata e con i tag statistici di ogni
  traccia audio e video. Un file troncato dà `INPUT_TRUNCATED`
- Errori `INPUT_UNREADABLE` (file mancante, non MKV o senza video),
  `INPUT_BUSY` (file modificato negli ultimi 30 s, con una data nel futuro o
  cambiato durante la lettura), `TOOL_MISSING` e `TOOL_TOO_OLD` (mkvmerge
  più vecchio di v57), con i loro test
- Taratura (versione 2 del file): `integrityToleranceMs` (1 s, provvisoria) e
  `inputBusyMs` (30 s)
- Studio di fattibilità 0.5: regole del controllo di integrità, di
  `INPUT_BUSY` e dei programmi esterni

### Modificato
- `INPUT_BUSY` vale anche per `analyze`, non solo per `merge`
- Per sviluppare e lanciare i test servono ffmpeg e mkvtoolnix; la CI li
  installa

## [0.2.0] - 2026-10-18

### Aggiunto
- Libreria: funzione di decisione pura (`decide`) che dalle misure e dalla
  taratura dà decisione, controlli in ordine, motivi e avvisi; S definitivo,
  deriva, forma di una contraddizione (un salto, più salti, rumore), confini
  del materiale in comune e copertura
- Codici prodotti dalla decisione: tutti i 14 codici di rifiuto, da
  `NO_ITALIAN_AUDIO` a `LOW_COVERAGE`; errori `INPUT_TRUNCATED` e `INTERNAL`;
  avvisi `VIDEO_QUALITY_UNCERTAIN`, `ORIGINAL_LANGUAGE_NOT_COMMON`,
  `MEASURE_MIX_DIFFERS`, `MANY_INCONCLUSIVE`, `ITALIAN_TRANSFER_OFFSET` e
  `ITALIAN_UNVERIFIED`
- Taratura: file versionato `src/calibration.json` con limiti fissi nel codice;
  un valore fuori dai limiti è `BAD_ARGUMENTS`. θ_ncc, θ_rapporto, E_min e la
  fascia di `MEASURE_MIX_DIFFERS` hanno valori provvisori
- Documentazione: [TARATURA.md](TARATURA.md) con valori, limiti e stato dei
  parametri; in [CODICI.md](CODICI.md) la tabella che collega ogni codice al
  test che lo produce, controllata dai test
- Studio di fattibilità 0.4: limiti della taratura, valori provvisori e regole
  della decisione (§9.6)

## [0.1.0] - 2026-10-18

### Aggiunto
- Studio di fattibilità 0.3: lingua originale con `--original-language`;
  coda, tracce italiane, PGS italiani del riferimento e audio su intro o code
  diverse come scelte dell'utente (opzione, variabile d'ambiente o scelta al
  merge); nuovo errore `CHOICE_REQUIRED`; licenza MIT
- Libreria: codici di rifiuto, errore e avviso con i codici di uscita
- Libreria: riconoscimento delle lingue (ISO 639-1, 639-2/B e /T, IETF),
  dell'italiano e scelta della lingua di misura
- Libreria: lettura e validazione delle scelte, con precedenza tra opzione e
  variabile d'ambiente
- Documentazione: riga di comando, codici, architettura, guida per chi
  contribuisce; test che la tengono allineata al codice
- Versioning: controllo della versione e del CHANGELOG nelle PR, tag e
  release GitHub automatici al merge su `main`
