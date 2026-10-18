# Riga di comando

> **Stato:** la riga di comando non esiste ancora. La libreria legge e valida
> già `--original-language` e le scelte. Questa pagina descrive l'interfaccia
> prevista (studio §10) e, per ogni voce, se è già implementata.

## Comandi

```
dyadrr analyze <a.mkv> <b.mkv> [opzioni]
dyadrr merge   <a.mkv> <b.mkv> --output <file> [opzioni]
```

I due file si passano senza ruoli: Dyadrr decide quale è il **donatore** (l'unico
con audio italiano) e quale il **riferimento** (studio §3.2).

| Comando | Cosa fa | Stato |
|---|---|---|
| `analyze` | Misura e controlli. Scrive solo il report, nessun MKV | previsto |
| `merge` | Analisi, scrittura del file finale, verifica | previsto |

## Opzioni

| Opzione | Comandi | Significato | Stato |
|---|---|---|---|
| `--output <file>` | merge | File finale. Se esiste già o coincide con un ingresso: `OUTPUT_EXISTS`. Nessuna sovrascrittura | previsto |
| `--report <file>` | entrambi | Percorso del report JSON | previsto |
| `--original-language <codice>` | entrambi | Lingua originale del film (sotto) | lettura e validazione implementate |
| `--temp-dir <cartella>` | merge | Cartella dei temporanei. Default `.dyadrr/` accanto al file finale; deve stare sullo stesso disco e iniziare con un punto, altrimenti `BAD_ARGUMENTS` | previsto |
| `--expect <report>` | merge | Report di un'analisi confermata: se ingressi, ruoli, spostamento o piano sono cambiati, `INPUT_CHANGED` | previsto |
| `--progress json` | entrambi | Avanzamento su stderr, una riga JSON per evento | previsto |

Le opzioni delle scelte sono nella sezione [Scelte](#scelte).

## Lingua originale

`--original-language` indica la lingua originale del film. Serve a scegliere
la lingua con cui si misura la sincronia (studio §3.3): dai file non si può
ricavare. In Wayfinderr la passa Wayfinderr, che la conosce da TMDB.

- Accetta codici ISO 639-1 e 639-2 e tag IETF, in maiuscolo o minuscolo:
  `ITA`, `ENG`, `jpn`, `fr`, `pt-BR`. `fra`, `fre` e `fr` sono la stessa
  lingua. Un valore non riconoscibile, o `und`, è `BAD_ARGUMENTS`.
- La lingua di misura è, in quest'ordine: la lingua originale, l'inglese, la
  prima altra lingua presente in entrambi i file. Mai l'italiano.
- Se la lingua originale è l'italiano, non conta per la lingua di misura.
- Se la lingua originale non è presente in entrambi i file, si passa
  all'inglese con l'avviso `ORIGINAL_LANGUAGE_NOT_COMMON`.
- Non ha una variabile d'ambiente: cambia da film a film.

## Scelte

Alcuni comportamenti li decide chi usa Dyadrr (studio §10.1). Ogni scelta si
fa in uno di questi modi, in ordine di precedenza:

1. **opzione** da riga di comando, per il singolo film;
2. **variabile d'ambiente**, come preimpostazione (per esempio in
   `docker-compose.yml`);
3. altrimenti la fa **l'utente al momento del merge**.

| Scelta | Opzione | Variabile d'ambiente | Valori | Serve solo se |
|---|---|---|---|---|
| Eccesso italiano in coda | `--tail` | `DYADRR_TAIL` | `trim` (togli), `keep` (lascia) | il donatore ha più coda del riferimento |
| Tracce audio italiane | `--italian` | `DYADRR_ITALIAN` | `all` (tutte), `main` (solo la principale) | il donatore ha più di una traccia audio italiana |
| PGS italiani già nel riferimento | `--reference-italian-subs` | `DYADRR_REFERENCE_ITALIAN_SUBS` | `keep` (tieni, mai predefiniti), `drop` (scarta) | il riferimento ha PGS italiani |
| Audio italiano su intro o code diverse | `--edge-mismatch` | `DYADRR_EDGE_MISMATCH` | `drop` (scarta), `keep` (tieni, con avviso) | intro o code diverse |

**Regole**

- Una scelta si chiede solo se serve per quella coppia. Il report di
  `analyze` elenca le scelte necessarie con l'effetto di ogni valore, e per
  ognuna il valore deciso e la sua origine (`option`, `env`, `prompt`)
  oppure "in sospeso".
- `merge` con una scelta necessaria in sospeso:
  - in un terminale interattivo la chiede (previsto);
  - altrimenti si ferma prima di scrivere con `CHOICE_REQUIRED` (implementato
    nella libreria).
- Una scelta indicata ma non necessaria si ignora, e il report lo dice.
- Un valore non valido è `BAD_ARGUMENTS`, anche se viene da una variabile
  d'ambiente sovrascritta da un'opzione valida.
- Una variabile d'ambiente vuota vale come non impostata.

**Stato:** lettura, validazione e precedenza implementate; richiesta
interattiva prevista.

## Uscita

- **stdout:** solo il percorso del report.
- **stderr:** avanzamento, una riga JSON per evento (con `--progress json`).
- **Codice di uscita:** vedi [CODICI.md](CODICI.md#codici-di-uscita). Chi
  chiama decide solo dal campo `decision` del report.
