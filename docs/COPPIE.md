# Coppie reali

> **Stato:** implementato dalla 0.13.0 (studio §15, fase 1, punto 3). Le
> coppie reali e la taratura (decisione 12) sono da fare.

Le soglie provvisorie ([TARATURA.md](TARATURA.md)) si tarano su coppie reali:
almeno 15–20, che coprano le categorie dello studio (§15, punto 3).
`dyadrr-pairs` lancia `dyadrr analyze` su un elenco di coppie, una alla volta,
e ne riassume i report: verdetto di ogni coppia, margini rispetto alle soglie,
criterio di uscita della fase 1. **Non decide le soglie:** le propone chi
legge il riassunto, nella PR che chiude la decisione 12.

## Uso

Con l'immagine, perché la taratura vale per le sue versioni di ffmpeg e
mkvtoolnix, quelle con cui Dyadrr gira in Wayfinderr
([CONTAINER.md](CONTAINER.md#immagine)):

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v /film:/data/film:ro -v ~/taratura:/data/taratura \
  ghcr.io/tehmaat/dyadrr:0.13.1 dyadrr-pairs taratura/coppie.txt
```

La cartella di lavoro del container è `/data`: i percorsi dell'elenco sono
relativi a lei. `--user` fa scrivere i risultati con il proprio utente invece
che con root. Fuori dall'immagine funziona lo stesso
(`node dist/pairs-bin.js coppie.txt`), ma le misure valgono per altre versioni.

```
dyadrr-pairs <elenco> [--results <cartella>] [--only <id>]... [--again]
```

| Opzione | Significato |
|---|---|
| `--results <cartella>` | Dove vanno i risultati; per default `<nome dell'elenco senza estensione>-results` accanto all'elenco |
| `--only <id>` | Lancia solo questa coppia (ripetibile); le altre entrano nel riassunto con il report che hanno già |
| `--again` | Rimisura anche le coppie con un report riusabile |

Su stderr una riga all'inizio e una alla fine di ogni coppia, su stdout i
percorsi di `summary.json` e `summary.md`. Un segnale di stop (Ctrl-C,
`docker stop`) annulla la coppia in corso, con un solo SIGTERM a Dyadrr, e
ferma la serie; il riassunto si scrive con le coppie fatte. Un secondo
segnale esce subito.

| Uscita | Quando |
|---|---|
| 0 | Serie finita e riassunto scritto, qualunque sia la decisione delle coppie |
| 30 | Elenco o argomenti sbagliati (`BAD_ARGUMENTS`), o cartella dei risultati che non si crea (`OUTPUT_NOT_WRITABLE`): niente si misura |
| 40 | Il riassunto non si scrive |
| 50 | Serie annullata |

## Elenco delle coppie

Un file di testo UTF-8, una sezione per coppia:

```
# Coppie per la taratura
[blade-runner]
input=film/Blade Runner (UHD).mkv
input=film/Blade Runner (BD).mkv
expected=eligible
original-language=eng
category=uhd-bd
category=dubbing-card
offset-ms=-1234
note=S controllato a mano sul labiale a 1:02:00

[blade-runner-final-cut]
input=film/Blade Runner (UHD).mkv
input=film/Blade Runner Final Cut (BD).mkv
expected=refused
category=different-cut
```

- `[<id>]` apre una coppia: da 1 a 64 tra lettere ASCII, cifre, `-` e `_`,
  che comincia con una lettera o una cifra, unico nell'elenco. Dà il nome ai
  file dei risultati ed è l'unico nome della coppia in `summary.md`.
- Sotto, righe `chiave=valore` come nel [file job](CONTAINER.md#il-file-job):
  la chiave è quello che precede il primo `=`, il valore tutto il resto, spazi
  compresi. Righe vuote ignorate, un CR in fondo tolto, righe che cominciano
  con `#` commenti.

Il test `test/docs.test.ts` controlla che questa tabella elenchi le chiavi del
codice.

| Chiave | Valore |
|---|---|
| `input` | Un percorso, due righe, obbligatorie. Relativo alla cartella corrente (nel container `/data`) |
| `expected` | Obbligatoria: `eligible` per una coppia buona (lo stesso film nella stessa versione), `refused` per una da rifiutare |
| `original-language` | Un codice di lingua, passato con `--original-language` ([CLI.md](CLI.md)) |
| `category` | Una categoria (sotto); ripetibile |
| `offset-ms` | S controllato a mano, in ms |
| `cause` | Per una coppia buona rifiutata, la causa trovata guardandola: si aggiunge dopo la misura |
| `note` | Testo libero |

Le scelte e `--expect` non ci sono: in `analyze` non cambiano la decisione, e
restano in sospeso nel report.

**Errori** (`BAD_ARGUMENTS`, prima di misurare qualsiasi coppia): una riga che
non è una sezione, un commento o `chiave=valore`; una chiave prima della prima
sezione; un id non valido o ripetuto; una chiave sconosciuta o ripetuta (salvo
`input` e `category`); una coppia senza due `input` o senza `expected`; un
ingresso vuoto; un valore non valido di `expected`, `category`, `offset-ms` o
`original-language`.

## Categorie

Il test `test/docs.test.ts` controlla che questa tabella elenchi le categorie
del codice. Le prime sette sono quelle che il criterio di uscita chiede di
coprire.

| Categoria | Coppia | Studio |
|---|---|---|
| `uhd-bd` | UHD Atmos contro vecchio BD 5.1 | §15, punto 3 |
| `long-silences` | Film con lunghi silenzi | §15, punto 3 |
| `disney-pixar` | Un Disney o Pixar | §15, punto 3 |
| `distributor-logos` | Loghi di distributori diversi | §15, punto 3 |
| `dubbing-card` | Cartello del doppiaggio a fine film | §15, punto 3 |
| `non-english` | Un film non in lingua inglese | §15, punto 3 |
| `two-discs` | Un film su due dischi | §15, punto 3 |
| `different-cut` | Theatrical contro extended | §15, punto 2 |
| `different-speed` | Framerate o velocità diversi | §15, punto 2 |
| `different-film` | Due film diversi | §15, punto 2 |
| `other` | Altro | — |

## Risultati

| File | Cosa contiene |
|---|---|
| `<id>.json` | Il report di `dyadrr analyze` ([REPORT.md](REPORT.md)), intero; se Dyadrr finisce senza report lo scrive `dyadrr-pairs`, con `INTERRUPTED` (ucciso da un segnale) o `INTERNAL` |
| `<id>.log` | Lo stderr di Dyadrr: le righe di `--progress json`, con i tempi di ogni fase |
| `summary.json` | Il riassunto della serie (sotto) |
| `summary.md` | Lo stesso, da leggere e da portare nella PR della decisione 12 |

`summary.json` e `summary.md` si riscrivono alla fine di ogni lancio, anche
annullato, e coprono sempre tutto l'elenco.

**Ripresa.** Un report che c'è già si riusa se ha la stessa versione del
formato, di Dyadrr e della taratura, gli stessi ingressi e la stessa lingua
originale, e una decisione `eligible` o `refused`. Altrimenti (un errore, un
annullamento, un'altra versione) la coppia si rimisura, e i suoi file vecchi si
cancellano prima. Le impronte non si confrontano: un file sostituito con lo
stesso nome va rimisurato con `--again`. Così una serie interrotta riprende
dalla coppia a cui era arrivata, e una `cause` aggiunta dopo la misura entra
nel riassunto senza rimisurare.

**Cosa entra nel repo.** I report contengono percorsi e nomi dei file e
restano a chi misura. Nel repo entrano `summary.md`, nella PR della decisione
12, e le conclusioni, nello studio (§18).

## Verdetti

Il test `test/docs.test.ts` controlla che questa tabella elenchi i verdetti del
codice.

| Verdetto | Quando |
|---|---|
| `ok` | Idonea e attesa idonea, con S entro la tolleranza per punto da `offset-ms` se c'è; oppure rifiutata e attesa rifiutata |
| `good-refused` | Una coppia buona rifiutata: ammesso, da documentare con `cause` |
| `wrong-merge` | Idonea ma attesa rifiutata, oppure S oltre la tolleranza per punto da `offset-ms`: sarebbe un merge sbagliato |
| `error` | Un errore: da capire e rimisurare |
| `cancelled` | Annullata |
| `missing` | Ancora senza report |

## Riassunto

Il test `test/docs.test.ts` controlla che questa tabella elenchi i campi di
`summary.json`, nell'ordine in cui si scrivono. I valori sono in inglese, come
nel report.

| Campo | Contenuto |
|---|---|
| `dyadrr` | Versione di `dyadrr-pairs` |
| `writtenAt` | Quando, ISO 8601 in UTC |
| `list` | L'elenco, percorso assoluto |
| `results` | La cartella dei risultati |
| `versions` | Versioni di Dyadrr, della taratura e dei programmi nelle coppie con un report; `mixed` se non sono tutte uguali |
| `criterion` | Il criterio di uscita della fase 1 (sotto), con `met` |
| `thresholds` | Per ogni soglia provvisoria il valore della taratura e i margini (sotto) |
| `verdicts` | Quante coppie per verdetto |
| `pairs` | Il riassunto di ogni coppia, nell'ordine dell'elenco (sotto) |

**Ogni coppia** (`pairs`): id, categorie, `expected`, S a mano, `cause` e
`note`; il report e se è stato riusato; verdetto con il dettaglio; decisione,
codice e messaggio; versioni di Dyadrr, dei programmi e della taratura; durata
e byte letti; lingua e tracce di misura; S dell'ancora e definitivo,
dispersione e differenza da `offset-ms`; ancore con spostamento, NCC, rapporto
ed esito; punti di conferma per esito e quelli aggiunti; deriva, forma della
contraddizione, copertura, trasferimento; codici degli avvisi. E i **margini**
(`margins`):

- **picchi dei punti di conferma** con energia almeno E_min (`silenceDbfs`),
  dai picchi misurati del report (`local` e `wide`), in quattro gruppi:
  `secureAtS` (sicuri ed entro la tolleranza per punto dallo S dell'ancora),
  `unsureAtS`, `secureElsewhere`, `unsureElsewhere`. Ognuno con `count`; per
  `secureAtS` il minimo di `ncc`, `ratio` ed `energyDbfs`, per gli altri il
  massimo di `ncc` e `ratio`;
- `silent`: i punti sotto E_min, e quanti avevano comunque un picco sicuro a S;
- `integrityGapMs`: la differenza più grande nei due ingressi tra la fine di
  una traccia e i suoi tag statistici, o tra la fine dei cluster e la durata
  dichiarata (studio §4.8);
- `startGapMs`, `endGapMs`, `cutLevelDbfs`: dal piano, i buchi senza italiano
  e il livello dopo il taglio iniziale.

**Il criterio di uscita** (`criterion`, studio §15):

| Campo | Criterio |
|---|---|
| `measured` | Coppie con una decisione `eligible` o `refused`: almeno 15 |
| `categories` | Coppie misurate per categoria; le sette del punto 3 senza coppie (`missing`) |
| `wrongMerges` | Coppie `wrong-merge`: nessuna |
| `goodRefused` | Coppie `good-refused` con e senza `cause`: tutte con |
| `uhdBdSmallJumps` | Coppie `uhd-bd` buone misurate, e quante rifiutate per salti di 1–2 fotogrammi (`CHECKPOINT_CONTRADICTION` con uno o più salti, tutti di al più 2 fotogrammi arrotondati): almeno una coppia, perché la quota va misurata |

**Le soglie** (`thresholds`), ognuna con `value`, `provisional` e i margini
della serie, ciascuno con il valore e la coppia che lo dà:

| Soglia | Margini |
|---|---|
| `nccMin`, `peakRatioMin` | `secureAtSMin`: il minimo dei picchi sicuri a S nelle coppie buone (quanto si può alzare la soglia); `unsureAtSMax`: il massimo dei non sicuri a S nelle coppie buone (quanto andrebbe abbassata per recuperarli); `unsureElsewhereMax`: il massimo dei non sicuri altrove in tutte le coppie (sotto quanto non si può scendere) |
| `silenceDbfs` | `secureAtSEnergyMin`: l'energia più bassa di un picco sicuro a S |
| `integrityToleranceMs` | `gapMax`: la differenza più grande nel controllo di integrità |
| `longGapWithoutItalianMs` | `gapMax`: il buco senza italiano più lungo |
| `abruptStartDbfs` | `cutLevelMax`: il livello più alto dopo un taglio iniziale |

`summary.md` ha le stesse cose in quattro tabelle: criterio di uscita,
coppie, soglie, rifiuti ed errori con la causa.
