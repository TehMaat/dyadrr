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
  iniziali dello studio.

## Parametri

Il test `test/docs.test.ts` controlla che questa tabella corrisponda al file di
taratura e ai limiti del codice.

| Parametro | Chiave | Valore | Limiti | Provvisorio | Studio |
|---|---|---|---|---|---|
| Tolleranza per punto (ms) | `toleranceMs` | `10` | `1` – `30` | no | §9.1, §9.2 |
| Spostamento massimo S_max (ms) | `maxOffsetMs` | `180000` | `1000` – `300000` | no | §4.4, §9.1 |
| θ_ncc: somiglianza minima del picco | `nccMin` | `0.5` | `0.2` – `0.99` | sì | §4.4 |
| θ_rapporto: unicità minima del picco | `peakRatioMin` | `1.5` | `1.05` – `10` | sì | §4.4 |
| Fascia di `MEASURE_MIX_DIFFERS` sopra θ_ncc | `measureMixDiffersBand` | `0.1` | `0` – `0.5` | sì | §4.4 |
| E_min: soglia di silenzio (dBFS) | `silenceDbfs` | `-50` | `-90` – `-20` | sì | §4.5 |
| Punti coerenti minimi | `minConsistentCheckpoints` | `20` | `10` – `60` | no | §9.3 |
| Buco massimo tra punti coerenti (ms) | `maxCheckpointGapMs` | `900000` | `60000` – `1800000` | no | §9.3 |
| Frazione iniziale e finale con un punto coerente | `edgeFraction` | `0.1` | `0.02` – `0.25` | no | §9.3 |
| Copertura minima | `minCoverage` | `0.9` | `0.5` – `1` | no | §4.6, §9.3 |
| Soglia di `MANY_INCONCLUSIVE` | `manyInconclusiveFraction` | `0.1` | `0.01` – `0.5` | no | §9.3 |
| Margine di bitrate per `VIDEO_QUALITY_UNCERTAIN` | `bitrateMargin` | `0.2` | `0.05` – `1` | no | §3.2 |
| Differenza relativa massima tra i framerate | `fpsRelativeTolerance` | `0.0001` | `0.000001` – `0.0005` | no | §9.2 |
| Tolleranza del controllo di integrità (ms) | `integrityToleranceMs` | `1000` | `50` – `5000` | sì | §4.8 |
| Finestra di `INPUT_BUSY` (ms) | `inputBusyMs` | `30000` | `5000` – `600000` | no | §10 |

`minConsistentCheckpoints` deve essere un intero. Il massimo di
`fpsRelativeTolerance` resta sotto 0,001, la differenza tra 24 e 23,976.

Gli altri parametri di §9.2 (lunghezza delle finestre, zona di esclusione,
numero di punti, soglie di `LONG_GAP_WITHOUT_ITALIAN` e `ABRUPT_START`,
riconoscimento dei forced) entrano nel file insieme ai moduli che li usano.

Il pre-roll della lettura delle finestre (2 s), la soglia dei buchi nei
timestamp (2 ms) e quella della finestra troppo corta (90% dei campioni
attesi) **non** sono parametri di taratura: non decidono se una coppia è
idonea ma se la lettura è corretta, e stanno nel codice (`src/audio.ts`) come
costanti del metodo (studio §4.3).

## Come si cambia un valore

1. Si modifica `src/calibration.json` e si alza il suo `version`.
2. Si aggiorna la tabella qui sopra (il test lo controlla).
3. Se cambia un limite, o un valore smette di essere provvisorio dopo la
   taratura, si aggiorna anche lo studio (§9.2), con una voce nella cronologia.
