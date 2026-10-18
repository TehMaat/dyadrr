# Changelog

Tutte le modifiche rilevanti, una sezione per versione. Le versioni seguono il
[semantic versioning](https://semver.org); le regole sono in
[CONTRIBUTING.md](../CONTRIBUTING.md#versioning).

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
