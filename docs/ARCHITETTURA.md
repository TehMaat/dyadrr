# Architettura

Dyadrr è una **libreria TypeScript con una riga di comando** (studio §14). La
logica sta nella libreria; Wayfinderr userà la riga di comando come processo
figlio, con il report JSON come contratto.

- **Compilazione:** CommonJS, senza `await` al livello principale, così il
  backend di Wayfinderr (che compila in CommonJS) può anche importare la
  libreria.
- **Dipendenze:** nessuna a runtime. ffmpeg/ffprobe (solo analisi) e
  mkvtoolnix (≥ v57) si lanciano come programmi esterni.
- **Node:** 22.

## Moduli

Il test `test/docs.test.ts` controlla che questa tabella elenchi tutti i file
`.ts` e `.json` di `src/`, e solo quelli.

| File | Cosa contiene | Studio |
|---|---|---|
| `src/index.ts` | Punto d'ingresso della libreria: riesporta i moduli | §14 |
| `src/codes.ts` | Codici di rifiuto, errore e avviso; codici di uscita; `DyadrrError` | §11–12 |
| `src/languages.ts` | Normalizzazione dei codici di lingua, riconoscimento dell'italiano, `--original-language`, scelta della lingua di misura | §3.1, §3.3 |
| `src/choices.ts` | Scelte dell'utente: opzione, variabile d'ambiente, in sospeso; `CHOICE_REQUIRED` | §10.1 |
| `src/calibration.json` | Valori di taratura versionati ([TARATURA.md](TARATURA.md)) | §9.2 |
| `src/calibration.ts` | Limiti fissi dei parametri di taratura; lettura e validazione del file (`BAD_ARGUMENTS`) | §9.1–9.2 |
| `src/decision.ts` | Decisione: funzione pura dalle misure e dalla taratura a decisione, controlli, motivi, avvisi, S definitivo, deriva, forma della contraddizione e copertura | §4.4–4.7, §9.3–9.4, §9.6 |

## Moduli previsti

In ordine di sviluppo indicativo (fase 1, studio §15):

1. **Ingressi:** metadati da `mkvmerge -J`, impronte, integrità (§4.8). Danno
   alla decisione i fatti di ogni file (`FileFacts`).
2. **Lettura delle finestre audio** con pre-roll e timestamp non ribasati (§4.3).
3. **Correlazione:** GCC-PHAT e NCC, ancore, punti di conferma, confini,
   controllo di trasferimento (§4.4–4.7). Danno alla decisione le misure
   (`AnchorMeasure`, `CheckpointMeasure`, `EdgeProbe`, `TransferProbe`) e usano
   `isConfident` per sapere quando cercare più lontano.
4. **Piano** di inizio e fine (§5), scelte necessarie e avvisi del piano.
5. **Costruzione** con mkvmerge: intermedio e unione finale (§6).
6. **Verifiche** dopo il merge (§9.5).
7. **Report** e **riga di comando** (§10–11).

## Test

- `node:test`, file in `test/*.test.ts`, compilati in `build/` ed eseguiti con
  `npm test`.
- `test/docs.test.ts` tiene la documentazione allineata al codice
  (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)).
