# Changelog

Tutte le modifiche rilevanti, una sezione per versione. Le versioni seguono il
[semantic versioning](https://semver.org); le regole sono in
[CONTRIBUTING.md](../CONTRIBUTING.md#versioning).

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
