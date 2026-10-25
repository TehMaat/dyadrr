# Riga di comando

> **Stato:** implementata dalla 0.9.0 (studio §10–11). La forma del report e
> gli eventi di `--progress json` sono in [REPORT.md](REPORT.md). Nel
> container la lancia il runner dei file job ([CONTAINER.md](CONTAINER.md)).
> Per le coppie reali della fase 1, `dyadrr-pairs` lancia `analyze` su un
> elenco di coppie ([COPPIE.md](COPPIE.md)).

## Comandi

```
dyadrr analyze <a.mkv> <b.mkv> [opzioni]
dyadrr merge   <a.mkv> <b.mkv> --output <file> [opzioni]
dyadrr --help
dyadrr --version
```

I due file si passano senza ruoli: Dyadrr decide quale è il **donatore** (l'unico
con audio italiano) e quale il **riferimento** (studio §3.2).

| Comando | Cosa fa | Stato |
|---|---|---|
| `analyze` | Misura e controlli. Scrive solo il report, nessun MKV. Non chiede mai le scelte: le elenca, con l'effetto di ogni valore | implementato |
| `merge` | Analisi, scelte, scrittura del file finale, verifiche, consegna. Il file finale compare solo se tutte le verifiche bloccanti passano | implementato |
| `--help`, `--version` | Uso e versione su stdout, uscita 0, nessun report | implementato |

## Opzioni

| Opzione | Comandi | Significato | Stato |
|---|---|---|---|
| `--output <file>` | merge, obbligatoria | File finale. Se esiste già, in un terminale si chiede se cancellarlo e andare avanti ([sotto](#file-finale-che-cè-già)); altrimenti, o se coincide con un ingresso, o se compare durante il merge: `OUTPUT_EXISTS`. Nessuna opzione di sovrascrittura. Cartella mancante o non scrivibile: `OUTPUT_NOT_WRITABLE`. Si controlla prima di leggere gli ingressi | implementato |
| `--report <file>` | entrambi | Percorso del report JSON (sotto) | implementato |
| `--original-language <codice>` | entrambi | Lingua originale del film (sotto) | implementato |
| `--temp-dir <cartella>` | merge | Cartella dei temporanei. Default `.dyadrr/` accanto al file finale, che si toglie quando resta vuota; deve stare sullo stesso disco e in una cartella che inizia con un punto, altrimenti `BAD_ARGUMENTS` | implementato |
| `--expect <report>` | merge | Report di un'analisi confermata: se ingressi, ruoli, spostamento o piano sono cambiati, `INPUT_CHANGED` (sotto) | implementato |
| `--progress json` | entrambi | Avanzamento su stderr, una riga JSON per evento ([REPORT.md](REPORT.md#avanzamento)) | implementato |
| `--inputs keep\|delete` | merge | Cosa fare dei due ingressi dopo un merge riuscito ([sotto](#ingressi-dopo-il-merge)) | implementato |

Le opzioni delle scelte sono nella sezione [Scelte](#scelte). Le opzioni si
scrivono `--nome valore` o `--nome=valore`. Sono `BAD_ARGUMENTS`: un comando
sconosciuto, un numero di file diverso da due, un'opzione sconosciuta, senza
valore o ripetuta, `--output`, `--temp-dir`, `--expect` o `--inputs` con `analyze`, `merge`
senza `--output`, `--progress` con un valore diverso da `json`.

## Report

- **Percorso:** `--report`; senza, `dyadrr-<modalità>-<AAAAMMGG>T<HHMMSS>Z.json`
  nella cartella corrente, con l'ora UTC.
- **Sempre scritto**, anche per `BAD_ARGUMENTS`, con un nome temporaneo che
  inizia con un punto e poi rinominato. Un report che esiste già si
  sostituisce.
- **Mai al posto di un altro file:** se `--report` coincide con un ingresso,
  con il file finale o con il report di `--expect`, nessun report: messaggio
  `BAD_ARGUMENTS` su stderr e uscita 30.
- **Cartella del report mancante o non scrivibile:** nessun report, messaggio
  `OUTPUT_NOT_WRITABLE` su stderr e uscita 30, prima di leggere gli ingressi.

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
- L'effetto di un valore è l'intervallo in cui l'italiano è presente, le
  tracce audio italiane prese, i PGS italiani del riferimento tenuti e gli
  avvisi che scatterebbero. Quello che dipende da un'altra scelta in sospeso
  resta in sospeso.
- `--tail` non serve con code diverse e `--edge-mismatch drop`: il taglio
  cade già sul confine del materiale in comune, prima della fine del video.
- Un'intro o una coda diversa, o un eccesso in coda, più corti di 1 s non
  contano: nessuna scelta. È la precisione con cui si trovano i confini.
- `merge` con una scelta necessaria in sospeso:
  - se stdin e stderr sono un terminale e non c'è `--progress json`, la
    chiede su stderr, con l'effetto di ogni valore: prima `--edge-mismatch`,
    poi `--tail`, `--italian` e `--reference-italian-subs`, ricalcolando il
    piano dopo ogni risposta. Una risposta non valida si richiede; la fine
    dell'ingresso (Ctrl-D) è `CHOICE_REQUIRED`;
  - altrimenti si ferma prima di scrivere con `CHOICE_REQUIRED`.
- Una scelta indicata ma non necessaria si ignora, e il report lo dice.
- Un valore non valido è `BAD_ARGUMENTS`, anche se viene da una variabile
  d'ambiente sovrascritta da un'opzione valida.
- Una variabile d'ambiente vuota vale come non impostata.

**Stato:** implementato.

## File finale che c'è già

Se `--output` esiste già e stdin e stderr sono un terminale (senza
`--progress json`), `merge` chiede, prima di leggere gli ingressi:

```
/film/Titolo (2020).mkv already exists.
Delete it and continue? It is deleted only after the new file is built and verified.
Choose yes or no:
```

- **`yes`:** il file si cancella solo dopo che il nuovo file è costruito e
  verificato, subito prima della consegna, e solo se è ancora lo stesso file.
  Se il merge fallisce, è rifiutato o annullato, il file vecchio resta.
- **`no`**, la fine dell'ingresso o nessun terminale: `OUTPUT_EXISTS`.
- Un file che è anche un ingresso, il report di `--expect` o il report non si
  cancella mai, e non si chiede nemmeno; lo stesso per una cartella o un link.
- Il report lo dice in `output.build.replace` e `output.build.replaced`.

## Ingressi dopo il merge

Cosa fare dei due rip di partenza (studio §10.2, decisione 6). In Wayfinderr è
un'impostazione del pannello Dyadrr (tenerli o cancellarli): li cancella
Wayfinderr, che passa sempre `--inputs keep`.

| Opzione | Variabile d'ambiente | Valori |
|---|---|---|
| `--inputs` | `DYADRR_INPUTS` | `keep` (tienili), `delete` (cancellali) |

- Vale solo per `merge`, e solo dopo un merge riuscito, verificato e
  consegnato: un rifiuto, un errore o un annullamento non toccano mai gli
  ingressi.
- L'opzione vince sulla variabile; un valore non valido è `BAD_ARGUMENTS`,
  una variabile vuota vale come non impostata. Con `analyze` l'opzione è
  `BAD_ARGUMENTS`, la variabile si ignora.
- Senza opzione né variabile: in un terminale (stdin e stderr, senza
  `--progress json`) si chiede, con i due percorsi; altrimenti, o alla fine
  dell'ingresso, gli ingressi **si tengono**. Non dà mai `CHOICE_REQUIRED`.
- Un ingresso si cancella solo se dimensione e data di modifica sono ancora
  quelle lette all'inizio; se è cambiato o non si può cancellare resta dov'è,
  con l'avviso `INPUT_NOT_DELETED`. La decisione resta `eligible`.
- Il report lo dice in `output.inputs` ([REPORT.md](REPORT.md#campi)).

## Analisi confermata (`--expect`)

`merge --expect <report>` esegue esattamente il piano approvato con `analyze`
(studio §10). Il report deve essere della stessa versione del formato e di una
coppia idonea, altrimenti `BAD_ARGUMENTS`. Poi, appena ogni pezzo si conosce:

1. **impronte** (dimensione, data di modifica, hash del primo e dell'ultimo
   MiB) dei due ingressi uguali a quelle del report, in qualsiasi ordine e
   senza guardare i percorsi; prima di misurare;
2. **ruoli** e **S** definitivo uguali, dopo l'analisi;
3. **piano** uguale, dopo le scelte: stesse scelte necessarie (salvo una in
   sospeso nel report che il valore dato ora a un'altra in sospeso rende
   inutile: con code diverse e `--edge-mismatch drop`, `--tail`), una scelta
   decisa nel report con lo stesso valore, ogni valore che nel report non era
   in sospeso uguale, e quello che lo era uguale all'effetto, nel report, del
   valore scelto ora.

Ogni differenza è `INPUT_CHANGED`; il report le elenca tutte (`expect`).
Versione di Dyadrr e taratura non si confrontano.

## Annullamento

SIGINT, SIGTERM o SIGHUP fermano analisi e merge: mkvmerge, ffmpeg e ffprobe
ricevono SIGTERM, la cartella di lavoro si elimina, il file finale non si
consegna, il report dice `cancelled` (`CANCELLED`) e si esce con 50. Un
secondo segnale fa uscire subito con 50, senza pulizia né report (gli avanzi
si eliminano al merge successivo). Un segnale dopo la consegna del file arriva
tardi: il report dice `eligible`. Nel container i segnali arrivano attraverso
l'init dell'immagine e il runner ([CONTAINER.md](CONTAINER.md#un-lavoro)).

## Uscita

- **stdout:** solo il percorso del report (o l'uso e la versione con
  `--help` e `--version`).
- **stderr:** con `--progress json`, una riga JSON per evento, nient'altro;
  senza, la domanda delle scelte e alla fine una riga leggibile con la
  decisione e il motivo.
- **Codice di uscita:** vedi [CODICI.md](CODICI.md#codici-di-uscita). Chi
  chiama decide solo dal campo `decision` del report.
