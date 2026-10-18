# Dyadrr

Unisce due rip dello **stesso film nella stessa versione** in un unico MKV:
il video, i capitoli e le tracce del rip migliore, più l'audio e i sottotitoli
italiani dell'altro, sincronizzati. Niente viene ricodificato.

Il nome viene da *diade*: due elementi che formano una coppia.

> **Stato:** fase 1, in sviluppo. Il progetto è descritto nello
> [studio di fattibilità](docs/STUDIO-DI-FATTIBILITA.md).

## Uso previsto

```
dyadrr analyze <a.mkv> <b.mkv> [--original-language <codice>] [--report <file>]
dyadrr merge   <a.mkv> <b.mkv> --output <file> [--expect <report>] [scelte]
```

I ruoli dei due file li decide Dyadrr: il **donatore** è l'unico con audio
italiano, il **riferimento** è l'altro.

### Lingua originale

`--original-language` indica la lingua originale del film (per esempio `eng`,
`jpn`, `FR`). Serve a scegliere la lingua con cui misurare la sincronia: dai
file non si può ricavare. Se manca si usa l'inglese, poi un'altra lingua in
comune (studio §3.3).

### Scelte

Alcuni comportamenti li decide chi usa Dyadrr. Ogni scelta si fa con
un'opzione, oppure si preimposta con una variabile d'ambiente; se non è
impostata in nessuno dei due modi, la fa l'utente al momento del merge. Una
scelta si chiede solo se serve per quella coppia (studio §10.1).

| Scelta | Opzione | Variabile d'ambiente | Valori |
|---|---|---|---|
| Eccesso italiano in coda | `--tail` | `DYADRR_TAIL` | `trim`, `keep` |
| Tracce audio italiane | `--italian` | `DYADRR_ITALIAN` | `all`, `main` |
| PGS italiani già nel riferimento | `--reference-italian-subs` | `DYADRR_REFERENCE_ITALIAN_SUBS` | `keep`, `drop` |
| Audio italiano su intro o code diverse | `--edge-mismatch` | `DYADRR_EDGE_MISMATCH` | `drop`, `keep` |

## Sviluppo

Richiede Node 22. Per l'analisi e il merge servono anche ffmpeg e mkvtoolnix
(almeno v57).

```
npm ci
npm test
npm run build
```

## Licenza

[MIT](LICENSE)
