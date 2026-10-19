# Taratura

Le soglie che decidono se una coppia è idonea (studio §9). Se si potessero
cambiare a ogni esecuzione sarebbero di fatto un'opzione "forza comunque": per
questo **non esiste un'opzione né una variabile d'ambiente per cambiarle**.

- **Valori:** nel file versionato [`src/calibration.json`](../src/calibration.json),
  che ha un proprio numero di `version`. Si cambiano solo con una PR.
- **Limiti:** nel codice, in `src/calibration.ts` (`CALIBRATION_LIMITS`), e non
  superano mai le regole fisse di §9.1 (tolleranza per punto ≤ 30 ms,
  spostamento massimo ≤ 300 s). Un valore fuori dai limiti, mancante o
  sconosciuto è `BAD_ARGUMENTS`.
- **Report:** registra sempre la versione della taratura, tutti i valori usati
  e quali sono provvisori.
- **Provvisori:** valori fissati prima della taratura sulle coppie reali
  (studio §15, fase 1, punto 3; decisione aperta 12). Gli altri sono i valori
  iniziali dello studio. Le coppie reali si misurano con `dyadrr-pairs`, che
  riassume i margini di ogni soglia provvisoria ([COPPIE.md](COPPIE.md)).

## Parametri

Il test `test/docs.test.ts` controlla che questa tabella corrisponda al file di
taratura e ai limiti del codice.

| Parametro | Chiave | Valore | Limiti | Provvisorio | Studio |
|---|---|---|---|---|---|
| Tolleranza per punto (ms) | `toleranceMs` | `10` | `1` – `30` | no | §9.1, §9.2 |
| Spostamento massimo S_max (ms) | `maxOffsetMs` | `180000` | `1000` – `300000` | no | §4.4, §9.1 |
| Margine dell'intervallo di ricerca, ±(S_max + margine) (ms) | `searchMarginMs` | `60000` | `1000` – `120000` | no | §4.4 |
| θ_ncc: somiglianza minima del picco | `nccMin` | `0.5` | `0.2` – `0.99` | sì | §4.4 |
| θ_rapporto: unicità minima del picco | `peakRatioMin` | `1.5` | `1.05` – `10` | sì | §4.4 |
| Zona di esclusione intorno al picco, per lato (ms) | `exclusionZoneMs` | `25` | `5` – `250` | no | §4.4 |
| Fascia di `MEASURE_MIX_DIFFERS` sopra θ_ncc | `measureMixDiffersBand` | `0.1` | `0` – `0.5` | sì | §4.4 |
| Lunghezza delle ancore (ms) | `anchorWindowMs` | `30000` | `10000` – `120000` | no | §4.4 |
| Lunghezza delle finestre di punti di conferma, confini e trasferimento (ms) | `checkpointWindowMs` | `10000` | `2000` – `60000` | sì | §4.5–4.7 |
| Punti di conferma previsti | `checkpointCount` | `30` | `10` – `100` | no | §4.5 |
| Punti di conferma al massimo, con quelli aggiunti | `maxCheckpointCount` | `60` | `10` – `200` | no | §4.5 |
| E_min: soglia di silenzio (dBFS) | `silenceDbfs` | `-50` | `-90` – `-20` | sì | §4.5 |
| Punti coerenti minimi | `minConsistentCheckpoints` | `20` | `10` – `60` | no | §9.3 |
| Buco massimo tra punti coerenti (ms) | `maxCheckpointGapMs` | `900000` | `60000` – `1800000` | no | §9.3 |
| Frazione iniziale e finale con un punto coerente | `edgeFraction` | `0.1` | `0.02` – `0.25` | no | §9.3 |
| Copertura minima | `minCoverage` | `0.9` | `0.5` – `1` | no | §4.6, §9.3 |
| Soglia di `MANY_INCONCLUSIVE` | `manyInconclusiveFraction` | `0.1` | `0.01` – `0.5` | no | §9.3 |
| Buco senza italiano all'inizio o alla fine oltre cui scatta `LONG_GAP_WITHOUT_ITALIAN` (ms) | `longGapWithoutItalianMs` | `600000` | `60000` – `1800000` | sì | §5 |
| Livello dopo il taglio iniziale oltre cui scatta `ABRUPT_START` (dBFS) | `abruptStartDbfs` | `-40` | `-70` – `-10` | sì | §5 |
| Forced: meno di questa frazione dei blocchi della traccia più grande della stessa lingua | `forcedSubsFraction` | `0.15` | `0.01` – `0.5` | sì | §7 |
| Margine di bitrate per `VIDEO_QUALITY_UNCERTAIN` | `bitrateMargin` | `0.2` | `0.05` – `1` | no | §3.2 |
| Differenza relativa massima tra i framerate | `fpsRelativeTolerance` | `0.0001` | `0.000001` – `0.0005` | no | §9.2 |
| Tolleranza del controllo di integrità (ms) | `integrityToleranceMs` | `1000` | `50` – `5000` | sì | §4.8 |
| Finestra di `INPUT_BUSY` (ms) | `inputBusyMs` | `30000` | `5000` – `600000` | no | §10 |

`minConsistentCheckpoints`, `checkpointCount` e `maxCheckpointCount` devono
essere interi. Il massimo di `fpsRelativeTolerance` resta sotto 0,001, la
differenza tra 24 e 23,976.

Due limiti legano due parametri, e un file che non li rispetta è
`BAD_ARGUMENTS`:
- `maxCheckpointCount` non sotto `checkpointCount`;
- `minConsistentCheckpoints` non sopra `maxCheckpointCount`: nessuna coppia
  potrebbe passare.

Il massimo di `forcedSubsFraction` resta sotto la metà: una traccia con metà
dei blocchi della più grande non è "solo forzati". `longGapWithoutItalianMs`
va tarato insieme a `minCoverage`: con una copertura minima alta, la coppia si
rifiuta prima che un buco così lungo possa esserci (studio §5).

## Costanti del metodo

Il pre-roll della lettura delle finestre (2 s), la soglia dei buchi nei
timestamp (2 ms) e quella della finestra troppo corta (90% dei campioni
attesi) **non** sono parametri di taratura: non decidono se una coppia è
idonea ma se la lettura è corretta, e stanno nel codice (`src/audio.ts`) come
costanti del metodo (studio §4.3).

Lo stesso vale per le costanti della correlazione, in `src/measure.ts` (studio
§4.4–4.7, §9.2): dicono dove e come cercare, non quando una coppia è idonea.

| Costante | Valore |
|---|---|
| Posizioni delle ancore | 15%, 25%, 35%, 50% della durata del video di riferimento |
| Ricerca vicina a S (punti, confini, trasferimento) | ±1 s |
| Rifinitura NCC intorno al picco della correlazione sbiancata | ±2 ms |
| Banda della correlazione sbiancata | 20 Hz – 3 kHz |
| Spostamento di una finestra muta sul contenuto | fino a 60 s, a passi di 250 ms, dentro l'intervallo del punto |
| Finestre brevi e precisione della ricerca dei confini | 2 s; 1 s; al massimo 50 prove per confine |
| Ricerche oltre i confini | fino a 3 per lato |
| Punti del controllo di trasferimento | 5 |
| Parità tra due coppie di tracce | somiglianze entro 0,02 |
| Rapporti della diagnosi di velocità | 1,001, 25/24, 25/23,976, nei due versi |

Anche il piano di inizio e fine ha le sue costanti del metodo, in `src/plan.ts`
(studio §5):

| Costante | Valore |
|---|---|
| Intro e code diverse ed eccesso in coda più corti di così non contano (la precisione dei confini) | 1 s |
| Tratto dopo il taglio iniziale su cui si misura il livello, il più alto tra centrale e L+R | 250 ms |

E la costruzione, in `src/build.ts` (studio §6.5, §7, §13):

| Costante | Valore |
|---|---|
| Margine di spazio libero, oltre al riferimento e alle tracce italiane due volte | 2 GiB |
| Ricerca del punto di sincronizzazione TrueHD dopo un taglio | 1 s |
| Tratto prima di un taglio in cui si cerca un sottotitolo a schermo | 30 s |

E le verifiche dopo il merge, in `src/verify.ts` (studio §9.5): quanto l'inizio
e la fine di una traccia audio italiana possono scostarsi da quelli previsti,
"entro un pacchetto" del codec. Il controllo di trasferimento sul file finale
usa invece i parametri di quello nel donatore (`checkpointWindowMs`,
`nccMin`, `peakRatioMin`, `toleranceMs`).

| Costante | Valore |
|---|---|
| AC-3, E-AC-3 | 32 ms |
| DTS, anche HD e X | 11 ms |
| TrueHD (alla fine mkvmerge divide solo sui punti di sincronizzazione) | 107 ms |
| FLAC | 96 ms |
| Altri codec | 100 ms |
| Arrotondamento dei timestamp, in più su ogni confronto di tempi | 1 ms |

## Come si cambia un valore

1. Si modifica `src/calibration.json` e si alza il suo `version`. Per una
   soglia provvisoria, la PR porta il `summary.md` delle coppie reali
   ([COPPIE.md](COPPIE.md)).
2. Si aggiorna la tabella dei [parametri](#parametri) (il test lo controlla).
3. Se cambia un limite, o un valore smette di essere provvisorio dopo la
   taratura, si aggiorna anche lo studio (§9.2), con una voce nella cronologia.
