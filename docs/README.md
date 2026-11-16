# Documentazione

[![Full Vibe Coded](https://img.shields.io/badge/Full-Vibe%20Coded-blueviolet)](../README.md#full-vibe-coded)

**Full Vibe Coded:** come il codice, anche questa documentazione è scritta con
un assistente AI, guidato e rivisto dal maintainer, e controllata da
`npm test` contro il codice.

## Per chi usa Dyadrr

| Documento | Contenuto |
|---|---|
| [INSTALLAZIONE.md](INSTALLAZIONE.md) | Requisiti, Docker, Docker Compose con Wayfinderr, da sorgente; variabili; aggiornare e disinstallare |
| [CLI.md](CLI.md) | Riga di comando: comandi, opzioni, lingua originale, scelte, variabili d'ambiente |
| [CODICI.md](CODICI.md) | Rifiuti, errori, avvisi e codici di uscita, con dove nasce ogni rifiuto e il test che produce ogni codice |
| [FAQ.md](FAQ.md) | Domande frequenti e cosa fare con i rifiuti e gli errori più comuni |
| [GLOSSARIO.md](GLOSSARIO.md) | Le parole del progetto: donatore, riferimento, S, ancore, punti di conferma… |

## Per chi integra Dyadrr

| Documento | Contenuto |
|---|---|
| [REPORT.md](REPORT.md) | Il report JSON: versione del formato, campi, eventi di `--progress json` |
| [CONTAINER.md](CONTAINER.md) | L'immagine Docker e il runner dei file job per Wayfinderr: tag, versioni, cartelle, file job |
| [COPPIE.md](COPPIE.md) | Le coppie reali della fase 1: `dyadrr-pairs`, l'elenco delle coppie, i risultati, il riassunto per la taratura |
| [fase1/summary.md](fase1/summary.md) | Il riassunto di `dyadrr-pairs` sulle 25 coppie reali che chiudono la fase 1 (31 ottobre 2026) |
| [TARATURA.md](TARATURA.md) | Parametri di taratura: valori, limiti, quali sono provvisori |

## Per chi contribuisce

| Documento | Contenuto |
|---|---|
| [STUDIO-DI-FATTIBILITA.md](STUDIO-DI-FATTIBILITA.md) | Il progetto: obiettivo, metodo, regole, decisioni prese e aperte, piano. È la fonte delle decisioni |
| [ARCHITETTURA.md](ARCHITETTURA.md) | Moduli del codice e moduli previsti, immagine, test |
| [WORKFLOW.md](WORKFLOW.md) | I workflow di GitHub Actions, la pulizia dei branch, diagrammi e schermate sempre aggiornati |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Sviluppo, versioning e regole per tenere aggiornata la documentazione |
| [CHANGELOG.md](CHANGELOG.md) | Modifiche per versione |

## Immagini

- **Diagrammi:** sorgenti Mermaid in [diagrams/](diagrams/), immagini in
  `img/diagrams/`, chiara e scura ([WORKFLOW.md](WORKFLOW.md#diagrammi)).
- **Schermate:** `img/screens/`, generate con i veri comandi su film sintetici
  ([WORKFLOW.md](WORKFLOW.md#schermate)).

## Nomi

Tutti i nomi negli esempi sono **inventati**: titoli dei film ("Faro di
Velmora", "Isola Chiusa"…), nomi dei file, cartelle e percorsi. Anche i film
delle prove reali della fase 1 e della fase 2, citati nello studio, nel
CHANGELOG, nei commenti e nei test, hanno un **titolo di fantasia** al posto
di quello vero; le misure (spostamenti, NCC, posizioni, codec) sono quelle
reali. `npm test` controlla che i titoli veri non tornino.

## Sempre aggiornata

La documentazione descrive sempre il codice di `main`. Ogni PR aggiorna i
documenti che tocca (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)),
e i test falliscono se codici, test dei codici, scelte, variabili, taratura,
campi del report, fasi dell'avanzamento, moduli, versione, link, immagini o
diagrammi non corrispondono; la CI rigenera le schermate e fallisce se sono
cambiate ([WORKFLOW.md](WORKFLOW.md#documentazione-sempre-aggiornata)).
