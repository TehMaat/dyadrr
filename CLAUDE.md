# Dyadrr

Unisce l'audio italiano di un rip al video migliore di un altro, senza
ricodificare. Il progetto è descritto in `docs/STUDIO-DI-FATTIBILITA.md`, che è
la fonte delle decisioni: se il codice deve scostarsene, si aggiorna prima lo
studio (con una voce nella cronologia, §20).

## Regole per ogni pull request

- **Versione:** ogni PR verso `main` alza la versione in `package.json` con
  `npm version <x.y.z> --no-git-tag-version` (patch per sole correzioni, minor
  per funzioni o comportamenti nuovi, major solo se lo chiede il maintainer).
- **CHANGELOG:** sezione `## [x.y.z] - AAAA-MM-GG` in cima a
  `docs/CHANGELOG.md`.
- **Documentazione:** aggiornata nella stessa PR secondo la tabella
  "Documentazione" di `CONTRIBUTING.md` (CLI, report, codici, architettura,
  stato delle voci previste, studio).
- **Test:** `npm test` deve passare; comprende `test/docs.test.ts`, che
  confronta la documentazione con il codice.

## Convenzioni

- Documentazione e commenti in italiano; codici, messaggi d'errore e valori
  del report in inglese.
- Nessuna dipendenza a runtime senza un motivo forte; ffmpeg e mkvtoolnix si
  lanciano come programmi esterni.
- Le soglie non si cambiano a ogni esecuzione (studio §9): stanno nel file di
  taratura versionato.
- Nessuna ricodifica, mai (premessa P1).
