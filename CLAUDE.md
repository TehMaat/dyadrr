# Dyadrr

Unisce l'audio italiano di un rip al video migliore di un altro, senza
ricodificare. Il progetto è descritto in `docs/STUDIO-DI-FATTIBILITA.md`, che è
la fonte delle decisioni: se il codice deve scostarsene, si aggiorna prima lo
studio (con una voce nella cronologia, §20).

## Proposte → issue

Quando il maintainer propone qualcosa ("c'è questa cosa…": una funzione, una
modifica, un problema, un'idea), non si scrive codice:

1. si analizza la proposta sul codice e sui documenti (studio compreso):
   cosa tocca, come si potrebbe fare, rischi, domande aperte;
2. si apre una issue su GitHub con l'analisi: titolo chiaro, contesto,
   proposta, cosa cambia (codice, documenti, studio), criteri di
   accettazione, domande aperte;
3. si dà al maintainer il link della issue e **ci si ferma**: si procede solo
   quando il maintainer lo dice.

La PR che realizza la issue la chiude con `Closes #N`.

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
- **README, docs, diagrammi e schermate sempre aggiornati**, in ogni PR:
  - un comando, un'opzione, una variabile, il report o l'uscita di
    `dyadrr-pairs` cambiano → `npm run build && npm run docs:screens` e si
    committano le schermate (la CI fallisce se sono vecchie);
  - un flusso, una fase, un modulo, un workflow o una regola cambiano → il
    diagramma in `docs/diagrams/*.mmd` e `npm run docs:diagrams`;
  - installazione, requisiti, variabili → `README.md` e
    `docs/INSTALLAZIONE.md`; un errore frequente → `docs/FAQ.md`;
  - mai diagrammi ASCII nei `.md`: sempre immagini da sorgente Mermaid.
- **Full Vibe Coded:** la dicitura resta nel README e in `docs/README.md`.
- **Nomi inventati:** negli esempi, nei test e nei documenti mai titoli veri
  dei film, nomi di persone, utenti, host o percorsi personali
  (`docs/README.md`, "Nomi").
- **Branch:** si cancellano da soli dopo il merge (workflow **Branch
  cleanup**, `docs/WORKFLOW.md`).

## Convenzioni

- Documentazione e commenti in italiano; codici, messaggi d'errore e valori
  del report in inglese.
- Nessuna dipendenza a runtime senza un motivo forte; ffmpeg e mkvtoolnix si
  lanciano come programmi esterni.
- Le soglie non si cambiano a ogni esecuzione (studio §9): stanno nel file di
  taratura versionato.
- Nessuna ricodifica, mai (premessa P1).
