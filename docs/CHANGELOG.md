# Changelog

Tutte le modifiche rilevanti, una sezione per versione. Le versioni seguono il
[semantic versioning](https://semver.org); le regole sono in
[CONTRIBUTING.md](../CONTRIBUTING.md#versioning).

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
