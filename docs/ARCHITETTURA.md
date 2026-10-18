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
| `src/tools.ts` | Programmi esterni: lancio, versioni per il report, `TOOL_MISSING` e `TOOL_TOO_OLD` (mkvmerge almeno v57) | §13 |
| `src/matroska.ts` | Lettura della coda di un MKV senza programmi esterni: cluster, blocchi, fine di ogni traccia, a finestre da 8 a 256 MiB | §4.8 |
| `src/inputs.ts` | Ingressi: tracce da mkvmerge -J, framerate, HDR e tag statistici da ffprobe, impronta, integrità; `INPUT_UNREADABLE` e `INPUT_BUSY`. Danno alla decisione i fatti di ogni file (`FileFacts`) e al report i dati di §11.2, punto 2 | §3.1–3.2, §4.8, §10, §11.2 |
| `src/decision.ts` | Decisione: funzione pura dalle misure e dalla taratura a decisione, controlli, motivi, avvisi, S definitivo, deriva, forma della contraddizione e copertura | §4.4–4.7, §9.3–9.4, §9.6 |

## Moduli previsti

In ordine di sviluppo indicativo (fase 1, studio §15):

1. **Lettura delle finestre audio** con pre-roll e timestamp non ribasati
   (§4.3); una finestra vuota è `INPUT_UNREADABLE` (§4.8). Fissa anche la
   versione minima di ffmpeg (§13).
2. **Correlazione:** GCC-PHAT e NCC, ancore, punti di conferma, confini,
   controllo di trasferimento (§4.4–4.7). Danno alla decisione le misure
   (`AnchorMeasure`, `CheckpointMeasure`, `EdgeProbe`, `TransferProbe`) e usano
   `isConfident` per sapere quando cercare più lontano.
3. **Piano** di inizio e fine (§5), scelte necessarie e avvisi del piano.
4. **Costruzione** con mkvmerge: intermedio e unione finale (§6).
5. **Verifiche** dopo il merge (§9.5).
6. **Report** e **riga di comando** (§10–11).

## Test

- `node:test`, file in `test/*.test.ts`, compilati in `build/` ed eseguiti con
  `npm test`.
- `test/docs.test.ts` tiene la documentazione allineata al codice
  (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)).
- `test/inputs.test.ts` e `test/tools.test.ts` usano ffmpeg, ffprobe e
  mkvtoolnix veri: generano piccoli MKV in una cartella temporanea
  (`test/helpers/mkv.ts`) e la cancellano alla fine. La CI li installa.
