# Container

> **Stato:** implementato dalla 0.12.0 (studio §14.1–14.2). Il lato
> Wayfinderr (servizio nel Compose, volumi, scrittura dei job) è da fare in
> Wayfinderr (studio §15, fase 2).

In Wayfinderr Dyadrr gira in un container separato, con un'immagine propria
costruita in questo repo. Wayfinderr gli passa i lavori con file job su una
cartella condivisa; il **runner** nel container li prende uno alla volta e
lancia la [riga di comando](CLI.md). Il contratto resta il
[report](REPORT.md).

## Immagine

`ghcr.io/tehmaat/dyadrr`, per amd64 e arm64.

| Tag | Cosa è |
|---|---|
| `latest` | L'ultimo commit di `main` |
| `sha-<7 caratteri>` | Un commit di `main` |
| `<versione>` (per esempio `0.12.0`) | La versione di `package.json` |

| Componente | Versione | Da dove |
|---|---|---|
| Alpine | 3.22 | `alpine:3.22` |
| Node | 22 | pacchetto `nodejs` |
| ffmpeg e ffprobe | 6.1.2 | pacchetto `ffmpeg` |
| mkvtoolnix | 92.0 | pacchetto `mkvtoolnix` |
| tini | 0.19 | pacchetto `tini`, come `ENTRYPOINT` |

Perché proprio queste versioni è nello studio (§14.2): in breve, ffmpeg 6.1 è
quella con cui è provato il metodo di lettura dell'audio.

- **Comando di default:** `dyadrr-runner` (sotto). `dyadrr` è nel `PATH`:
  `docker run --rm -v /film:/data/watch ghcr.io/tehmaat/dyadrr dyadrr analyze watch/a.mkv watch/b.mkv --report watch/a.json`
  (la cartella di lavoro è `/data`).
- **Init:** tini inoltra i segnali al runner: `docker stop` ferma il runner
  in modo pulito, e `init: true` non serve.
- **Utente:** root, salvo `user:` nel Compose (sotto).
- **Coppie reali:** `dyadrr-pairs` è nel `PATH`, per misurare le coppie della
  fase 1 con le versioni dell'immagine ([COPPIE.md](COPPIE.md)).

Il workflow **Image** (`.github/workflows/image.yml`) a ogni PR e a ogni push
su `main` costruisce l'immagine per le due architetture, ripete tutta la suite
(`npm test`) dentro l'immagine amd64, controlla le versioni di Node, ffmpeg e
mkvmerge su entrambe, fa girare un job vero con il runner e `docker stop` e un
elenco di una coppia con `dyadrr-pairs`; su `main` pubblica i tre tag. In locale:

```bash
docker build --target runtime -t dyadrr .     # l'immagine
docker build --target test -t dyadrr:test . && docker run --rm dyadrr:test   # la suite sull'immagine
```

## Cartelle

| Nel container | Cosa è | Montata |
|---|---|---|
| `/data` | Cartella di lavoro: ogni cartella condivisa con Wayfinderr è una sua sottocartella, con un nome | — |
| `/data/watch` | La cartella sorvegliata di Wayfinderr (`MAKEMKV_OUTPUT_DIR`): ingressi trattenuti, file finale, temporanei `.dyadrr/`, job. Obbligatoria: senza, il runner non parte | in scrittura |
| `/data/<nome>` | Altre cartelle con ingressi possibili, per esempio i download | di norma in sola lettura |
| `/data/watch/.wayfinderr/dyadrr/jobs/` | La cartella dei job; il runner la crea se manca | — |

I percorsi nel job sono **relativi a `/data`**, con `/`, e cominciano con il
nome della cartella montata: `watch/Film (2).mkv`, `downloads/Film/Film.mkv`.
Assoluti, vuoti o con un elemento vuoto, `.` o `..` sono `BAD_ARGUMENTS`.
Il report riporta i percorsi del container (`/data/watch/…`).

## File della cartella dei job

| File | Chi lo scrive | Cosa contiene |
|---|---|---|
| `<id>.job` | Wayfinderr, con un nome che inizia con un punto e poi rinominato | Il lavoro (sotto) |
| `<id>.run` | Il runner, rinominando il `.job` | Il lavoro preso |
| `<id>.log` | Il runner, da subito | Lo stderr di Dyadrr man mano: le righe di `--progress json` ([REPORT.md](REPORT.md#avanzamento)); un messaggio non JSON solo se Dyadrr non scrive un report |
| `<id>.json` | Dyadrr, o il runner se Dyadrr non lo scrive | Il report |
| `<id>.exit` | Il runner, per ultimo | Il codice di uscita ([CODICI.md](CODICI.md#codici-di-uscita)) e un a capo |
| `<id>.cancel` | Wayfinderr | Ferma il lavoro: Dyadrr riceve SIGTERM, una volta sola. Il contenuto non conta |
| `dyadrr.alive` | Il runner, all'avvio e ogni 5 s | I secondi dall'epoch e un a capo. Più vecchio di 30 s: container spento |

`<id>`: da 1 a 64 tra lettere ASCII, cifre, `-` e `_`, che comincia con una
lettera o una cifra, mai riusato (un UUID va bene). Un `.job` con un nome
diverso si ignora; uno con un id già usato non si prende. Il runner non
cancella mai i file di un lavoro: li cancella Wayfinderr dopo aver letto
`.exit`. **Quando c'è `.exit`, c'è anche `.json`.**

## Il file job

Una riga `chiave=valore` per riga, in UTF-8: la chiave è quello che precede il
primo `=`, il valore tutto il resto, spazi compresi. Righe vuote ignorate, un
CR in fondo alla riga tolto.

```
command=merge
input=watch/Film (2).mkv
input=downloads/Film/Film.mkv
output=watch/Film (2001).mkv
expect=watch/.wayfinderr/dyadrr/jobs/3f2a….json
original-language=eng
tail=trim
italian=main
reference-italian-subs=drop
edge-mismatch=drop
inputs=keep
```

| Chiave | Valore | Opzione |
|---|---|---|
| `command` | `analyze` o `merge`, obbligatoria | il comando |
| `input` | un percorso; due righe | i due file |
| `output` | un percorso | `--output` |
| `temp-dir` | un percorso | `--temp-dir` |
| `expect` | un percorso | `--expect` |
| `original-language` | un codice di lingua | `--original-language` |
| `tail`, `italian`, `reference-italian-subs`, `edge-mismatch` | un valore della scelta | le [scelte](CLI.md#scelte) |
| `inputs` | `keep` o `delete` | `--inputs` |

Il runner lancia, nella cartella `/data`:

```
dyadrr <command> <input> <input> --<chiave>=<valore>… --report=<jobs>/<id>.json --progress=json
```

Sono `BAD_ARGUMENTS` decisi dal runner, con un report che scrive lui e senza
lanciare Dyadrr: una riga senza `=`, una chiave sconosciuta (anche `report` e
`progress`, che decide il runner), una chiave ripetuta salvo `input`, `command`
mancante o diverso da `analyze` e `merge`, un percorso non valido. Il resto lo
controlla la riga di comando.

## Un lavoro

1. Il runner guarda la cartella ogni secondo e prende un `.job` alla volta,
   dal più vecchio (data di modifica, poi nome), rinominandolo in `.run`.
2. Crea `<id>.log`. Se c'è già `<id>.cancel`, chiude il lavoro come
   annullato senza lanciare Dyadrr.
3. Lancia Dyadrr; lo stderr va in `<id>.log`. Un `<id>.cancel`, controllato
   ogni secondo, gli manda SIGTERM: report `cancelled`, uscita 50.
4. Alla fine, se Dyadrr non ha scritto il report, lo scrive il runner con il
   solo esito: `INTERRUPTED` se Dyadrr è stato ucciso da un segnale,
   `INTERNAL` altrimenti. Poi scrive `<id>.exit`.

Un report scritto dal runner ha la forma di sempre, con `mode` e
`arguments.files` se il job li dice e tutto il resto `null` o vuoto.

**Container fermato** (`docker stop`): con un lavoro in corso, il runner manda
SIGTERM a Dyadrr, aspetta il report `cancelled`, scrive `.exit` ed esce.

**All'avvio**, un `.run` senza `.exit` è un lavoro interrotto di colpo
(SIGKILL, memoria esaurita, corrente). Non si rilancia: `.exit` si ricava dal
report se c'è, altrimenti il runner scrive un report `INTERRUPTED` (uscita
40, riprovabile).

## Nel Compose di Wayfinderr

```yaml
  dyadrr:
    image: ghcr.io/tehmaat/dyadrr:0.13.0
    profiles: ["merge"]
    hostname: dyadrr            # fisso: gli avanzi di un lavoro interrotto si eliminano al successivo
    user: "1000:1000"           # lo stesso utente del backend
    stop_grace_period: 30s
    restart: unless-stopped
    volumes:
      - /percorso/della/cartella/sorvegliata:/data/watch
      - /percorso/dei/download:/data/downloads:ro
```

- **`hostname` fisso:** Dyadrr riconosce i propri temporanei dal nome host
  ([CLI.md](CLI.md#annullamento)); con il nome casuale che Docker dà a ogni
  container, quelli di un container precedente resterebbero.
- **`user`:** lo stesso del backend, così i file scritti da uno si possono
  cancellare dall'altro.
- **Un solo runner** per cartella dei job.
