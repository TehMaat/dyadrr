# Documentazione

| Documento | Contenuto |
|---|---|
| [STUDIO-DI-FATTIBILITA.md](STUDIO-DI-FATTIBILITA.md) | Il progetto: obiettivo, metodo, regole, decisioni prese e aperte, piano. È la fonte delle decisioni |
| [CLI.md](CLI.md) | Riga di comando: comandi, opzioni, lingua originale, scelte, variabili d'ambiente |
| [REPORT.md](REPORT.md) | Il report JSON: versione del formato, campi, eventi di `--progress json` |
| [CODICI.md](CODICI.md) | Rifiuti, errori, avvisi e codici di uscita, con il test che produce ogni codice |
| [TARATURA.md](TARATURA.md) | Parametri di taratura: valori, limiti, quali sono provvisori |
| [ARCHITETTURA.md](ARCHITETTURA.md) | Moduli del codice e moduli previsti |
| [CHANGELOG.md](CHANGELOG.md) | Modifiche per versione |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Sviluppo, versioning e regole per tenere aggiornata la documentazione |

La documentazione descrive sempre il codice di `main`. Ogni PR aggiorna i
documenti che tocca (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)),
e i test falliscono se codici, test dei codici, scelte, taratura, campi del
report, fasi dell'avanzamento, moduli o versione non corrispondono.
