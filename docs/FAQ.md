# Domande frequenti e problemi

Cosa fare con gli esiti più frequenti. Ogni codice è spiegato per intero in
[CODICI.md](CODICI.md); il motivo preciso è sempre nel report, in `reasons`:

```bash
jq '{decision, reasons, warnings: [.warnings[] | {code, message}]}' analisi.json
```

## Il merge

**Il file finale non c'è.** Compare solo se tutte le verifiche passano: con
un rifiuto (uscita 20), un errore (30 o 40) o un annullamento (50) non c'è, e
i rip non si toccano. Il motivo è nel report.

**Dyadrr ricodifica qualcosa?** No, mai (premessa P1): sposta e taglia
pacchetti con mkvmerge. ffmpeg legge l'audio per la misura e, nel merge, scrive
solo la coda delle tracce FLAC copiando i pacchetti.

**Posso cambiare una soglia per far passare una coppia?** No. Le soglie stanno
nel file di taratura versionato e cambiano solo con una nuova versione di
Dyadrr, dopo una misura sulle coppie reali ([TARATURA.md](TARATURA.md)).

**Il merge si ferma con `CHOICE_REQUIRED`.** La coppia ha bisogno di una
scelta (code, tracce italiane, sottotitoli, intro diverse) e non c'è un
terminale per chiederla. Il report dice quali scelte mancano e l'effetto di
ogni valore (`choices`): si passano con l'opzione o con la variabile
([README](../README.md#variabili-dambiente)).

**`OUTPUT_EXISTS`.** Il file finale c'è già. In un terminale Dyadrr chiede se
cancellarlo (lo cancella solo dopo le verifiche del nuovo); senza terminale si
ferma. Non c'è un'opzione per sovrascrivere.

**`INPUT_CHANGED` con `--expect`.** Dall'analisi confermata sono cambiati i
file, i ruoli, lo spostamento o il piano: si rifà `analyze` e si conferma il
nuovo report. Succede anche dopo un aggiornamento di Dyadrr che cambia
l'analisi.

## I rifiuti

**`NO_ITALIAN_AUDIO` o `BOTH_ITALIAN_AUDIO`.** Dyadrr riconosce l'italiano dal
tag di lingua delle tracce. Se un tag è sbagliato, il rifiuto elenca le
tracce trovate e suggerisce come correggerlo con mkvpropedit, per esempio:

```bash
mkvpropedit "Faro di Velmora (2011) [BD ITA].mkv" --edit track:a1 --set language=ita
```

**`NO_COMMON_LANGUAGE`.** Per misurare serve una stessa lingua non italiana
nei due file. Si rifà il rip del disco italiano tenendo anche l'inglese, o la
lingua originale.

**`DONOR_BETTER_VIDEO`.** Il file con l'italiano ha anche il video migliore:
il merge non serve.

**`FPS_MISMATCH` o `PAL_SPEEDUP`.** I due video vanno a velocità diverse
(23,976 contro 24, o 25 del PAL): allineare l'audio vorrebbe dire
ricodificarlo, e Dyadrr non lo fa.

**`NO_MATCH`.** Nessun tratto dei due file si somiglia abbastanza: film
diversi, versioni molto diverse, o un audio rifatto. Conviene controllare di
aver scelto la versione giusta del film.

**`CHECKPOINT_CONTRADICTION`, `CHECKPOINT_UNMATCHED`, `DRIFT`.** Lo
spostamento cambia lungo il film, in un tratto non c'è corrispondenza, o
cresce nel tempo: di norma montaggi o master diversi. Il report dice dove
(`measurement.checkpoints`, con la posizione di ogni punto). Unire comunque
porterebbe l'italiano fuori sincrono in quei tratti.

**`LOW_COVERAGE`.** Il materiale in comune copre troppo poco del film: per
esempio una versione estesa contro quella cinematografica.

## Gli errori

**`INPUT_BUSY`.** Un file è stato modificato da meno di 30 secondi: è ancora
in copia o in scrittura. Si riprova quando ha finito.

**`INPUT_TRUNCATED` o `INPUT_UNREADABLE`.** Il file è incompleto, non è un MKV
o non si legge. Si rifà il rip o la copia.

**`INPUT_UNREADABLE` con `… is not mounted in this container`.** Nel
container il file è in una cartella che Dyadrr non vede, per esempio
`/data/seeding` per i film in seeding: il backend di Wayfinderr la monta, il
servizio `dyadrr` no. Si aggiunge il mount nel Compose, con lo stesso nome,
e si riavvia il container ([CONTAINER.md](CONTAINER.md#nel-compose-di-wayfinderr)):

```yaml
      - ${SEEDING_DIR:-./seeding}:/data/seeding:ro
```

All'avvio il runner scrive le cartelle che vede (`mounted: watch (rw),
downloads (ro), seeding (ro)`), nella pagina **Logs** di Wayfinderr (sorgente
*dyadrr*) e in `docker compose logs dyadrr`.

**Il runner non parte: `/data/watch is not writable`.** La cartella
sorvegliata è montata in sola lettura (`:ro`): il runner ci scrive i job, i
temporanei e il file finale. Si toglie `:ro` dal mount di `/data/watch`.

**`TOOL_MISSING` o `TOOL_TOO_OLD`.** Mancano mkvmerge, ffprobe o ffmpeg, o
sono troppo vecchi ([INSTALLAZIONE.md](INSTALLAZIONE.md#requisiti)). Con
l'immagine Docker non succede.

**`NO_SPACE`.** Non c'è abbastanza spazio per il file finale e i temporanei:
Dyadrr si ferma prima di scrivere.

**`MERGE_FAILED`, `VERIFY_FAILED` o `INTERNAL` (uscita 40).** Non dipende
dalla coppia: è un problema di Dyadrr o dell'ambiente. Va aperta una issue con
il report allegato (senza i percorsi personali, se si preferisce).

## Wayfinderr e Docker

**Il runner non prende i lavori.** Deve essere montata la cartella sorvegliata
su `/data/watch`; il runner riscrive `dyadrr.alive` ogni 5 secondi nella
cartella dei job, e le sue righe sono in `dyadrr.runner.jsonl`
([CONTAINER.md](CONTAINER.md)).

**I file scritti sono di root.** Il container gira come root: con la riga di
comando si aggiunge `--user "$(id -u):$(id -g)"`, nel Compose `user:` con
l'utente del backend di Wayfinderr ([INSTALLAZIONE.md](INSTALLAZIONE.md#docker)).
