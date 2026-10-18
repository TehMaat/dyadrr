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
di `src/`, e solo quelli.

| File | Cosa contiene | Studio |
|---|---|---|
| `src/index.ts` | Punto d'ingresso della libreria: riesporta i moduli | §14 |
| `src/codes.ts` | Codici di rifiuto, errore e avviso; codici di uscita; `DyadrrError` | §11–12 |
| `src/languages.ts` | Normalizzazione dei codici di lingua, riconoscimento dell'italiano, `--original-language`, scelta della lingua di misura | §3.1, §3.3 |
| `src/choices.ts` | Scelte dell'utente: opzione, variabile d'ambiente, in sospeso; `CHOICE_REQUIRED` | §10.1 |

## Moduli previsti

In ordine di sviluppo indicativo (fase 1, studio §15):

1. **Decisione:** funzione pura da misure e soglie al report (test 1e).
2. **Parametri di taratura:** file versionato con limiti fissi (§9.2).
3. **Ingressi:** metadati da `mkvmerge -J`, impronte, integrità (§4.8).
4. **Lettura delle finestre audio** con pre-roll e timestamp non ribasati (§4.3).
5. **Correlazione:** GCC-PHAT e NCC, ancore, punti di conferma, confini (§4.4–4.7).
6. **Piano** di inizio e fine (§5).
7. **Costruzione** con mkvmerge: intermedio e unione finale (§6).
8. **Verifiche** dopo il merge (§9.5).
9. **Report** e **riga di comando** (§10–11).

## Test

- `node:test`, file in `test/*.test.ts`, compilati in `build/` ed eseguiti con
  `npm test`.
- `test/docs.test.ts` tiene la documentazione allineata al codice
  (vedi [CONTRIBUTING.md](../CONTRIBUTING.md#documentazione)).
