# Dyadrr

Unisce due rip dello **stesso film nella stessa versione** in un unico MKV:
il video, i capitoli e le tracce del rip migliore, più l'audio e i sottotitoli
italiani dell'altro, sincronizzati. **Niente viene ricodificato**: si spostano
solo i pacchetti, con mkvmerge.

Il nome viene da *diade*: due elementi che formano una coppia.

> **Stato:** fase 1, in sviluppo. La riga di comando funziona dalla 0.9.0,
> l'immagine Docker per Wayfinderr dalla 0.12.0
> ([docs/CONTAINER.md](docs/CONTAINER.md)); le soglie sono ancora
> provvisorie, da tarare su coppie reali ([docs/TARATURA.md](docs/TARATURA.md))
> con `dyadrr-pairs` dalla 0.13.0 ([docs/COPPIE.md](docs/COPPIE.md)). Le modifiche sono nel
> [CHANGELOG](docs/CHANGELOG.md).

## Come funziona

1. **Ruoli.** Il file con l'audio italiano è il **donatore**, l'altro il
   **riferimento** (di norma il video migliore). Li decide Dyadrr.
2. **Misura.** La sincronia si misura confrontando la stessa lingua nei due
   file (di norma l'inglese, o la lingua originale del film). Il risultato è
   un solo spostamento per tutto il film, verificato in decine di punti.
3. **Controlli.** Se lo spostamento cambia a metà film (montaggio o master
   diversi), se le velocità sono diverse o se qualcosa non torna, la coppia
   si rifiuta con un codice preciso.
4. **Merge.** Le tracce italiane vengono spostate e tagliate solo all'inizio
   o alla fine, unite al riferimento e verificate prima di consegnare il file.

Tutti i dettagli sono nello
[studio di fattibilità](docs/STUDIO-DI-FATTIBILITA.md).

## Uso

```bash
npm ci && npm run build      # poi: node dist/bin.js, o npm link per avere `dyadrr`
```

```
dyadrr analyze <a.mkv> <b.mkv> [--original-language <codice>] [--report <file>]
dyadrr merge   <a.mkv> <b.mkv> --output <file> [--expect <report>] [scelte]
```

- `analyze` misura e controlla, e scrive solo il report JSON.
- `merge` fa l'analisi, scrive il file finale e lo verifica; il file compare
  solo se le verifiche passano.
- `--original-language` indica la lingua originale del film (`ENG`, `jpn`,
  `fr`…): serve a scegliere la lingua con cui misurare.
- `--expect <report>` fa eseguire al merge esattamente il piano di un'analisi
  confermata; `--progress json` scrive l'avanzamento su stderr.
- `--inputs keep|delete` dice cosa fare dei due rip dopo un merge riuscito;
  senza, in un terminale si chiede, altrimenti si tengono.
- Su stdout c'è solo il percorso del report; la decisione sta nel report
  ([docs/REPORT.md](docs/REPORT.md)) e nel codice di uscita.

### Scelte

Alcuni comportamenti li decide chi usa Dyadrr: con un'opzione, oppure
preimpostati con una variabile d'ambiente; altrimenti si scelgono al momento
del merge. Una scelta si chiede solo se serve per quella coppia.

| Scelta | Opzione | Variabile d'ambiente | Valori |
|---|---|---|---|
| Eccesso italiano in coda | `--tail` | `DYADRR_TAIL` | `trim`, `keep` |
| Tracce audio italiane | `--italian` | `DYADRR_ITALIAN` | `all`, `main` |
| PGS italiani già nel riferimento | `--reference-italian-subs` | `DYADRR_REFERENCE_ITALIAN_SUBS` | `keep`, `drop` |
| Audio italiano su intro o code diverse | `--edge-mismatch` | `DYADRR_EDGE_MISMATCH` | `drop`, `keep` |

Il riferimento completo è in [docs/CLI.md](docs/CLI.md); il report in
[docs/REPORT.md](docs/REPORT.md); rifiuti, errori e codici di uscita in
[docs/CODICI.md](docs/CODICI.md).

## Requisiti

- Node 22
- mkvtoolnix, almeno v57
- ffmpeg almeno 6.1 e ffprobe (per l'analisi; nel merge solo per leggere i
  punti di taglio e per la coda delle tracce FLAC, sempre senza ricodificare)

Nessuna scheda grafica: il video non viene mai decodificato.

Oppure l'immagine Docker `ghcr.io/tehmaat/dyadrr`, che ha già tutto, con il
runner dei file job per Wayfinderr ([docs/CONTAINER.md](docs/CONTAINER.md)).

## Documentazione

Tutta la documentazione è in [docs/](docs/README.md) ed è tenuta allineata al
codice a ogni PR.

## Versioni

[Semantic versioning](https://semver.org): ogni PR verso `main` alza la
versione e la descrive nel [CHANGELOG](docs/CHANGELOG.md); al merge viene
creata la release `vX.Y.Z`. Le regole sono in
[CONTRIBUTING.md](CONTRIBUTING.md#versioning).

## Licenza

[MIT](LICENSE)
