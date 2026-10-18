# Changelog

Tutte le modifiche rilevanti, una sezione per versione. Le versioni seguono il
[semantic versioning](https://semver.org); le regole sono in
[CONTRIBUTING.md](../CONTRIBUTING.md#versioning).

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
