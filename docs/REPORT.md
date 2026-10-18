# Report

Il report è il contratto di Dyadrr (studio §11): un file JSON per ogni
`analyze` o `merge`. Chi chiama decide **solo** dal campo `decision`; un
report mancante o illeggibile, o un codice di uscita non documentato, è un
errore. Il tipo è `Report` in `src/report.ts`.

## Versione del formato

Versione del formato: **1** (`format`, `REPORT_FORMAT` in `src/report.ts`).

È separata dalla versione di Dyadrr e si alza solo con una modifica
incompatibile: un campo tolto o cambiato di significato. Un campo o un evento
nuovo non la alza: chi legge ignora quello che non conosce. Vale anche per le
righe di `--progress json`. `merge --expect` accetta solo report della stessa
versione.

## Campi

Il test `test/docs.test.ts` controlla che questa tabella elenchi i campi del
report, nell'ordine in cui si scrivono.

| Campo | Contenuto |
|---|---|
| `format` | Versione del formato, un intero |
| `dyadrr` | Versione di Dyadrr |
| `mode` | `analyze`, `merge`, oppure `null` se il comando non si riconosce |
| `startedAt` | Inizio, ISO 8601 in UTC |
| `finishedAt` | Fine, ISO 8601 in UTC |
| `durationMs` | Durata, in ms |
| `tools` | Versioni di mkvmerge, ffprobe e ffmpeg; `null` se non lette |
| `arguments` | File come passati, `output`, `report`, `originalLanguage`, `tempDir`, `expect` (percorsi assoluti), `progress`, scelte da opzione e da variabile d'ambiente (`choices`, con l'origine) |
| `calibration` | Taratura usata: versione, tutti i valori, quali sono provvisori ([TARATURA.md](TARATURA.md)) |
| `decision` | `eligible`, `refused`, `error`, `cancelled`. Un merge completato e verificato è `eligible` |
| `reasons` | `{ code, message }`: un solo motivo per un rifiuto, un errore o un annullamento (`CANCELLED`), nessuno per `eligible` ([CODICI.md](CODICI.md)) |
| `inputs` | I due file nell'ordine in cui sono passati: percorso, impronta, durata, `startTimeMs`, integrità, video (codec, risoluzione, framerate, HDR, profilo Dolby Vision, bitrate), ogni traccia (ID di mkvmerge, tipo, lingua, codec e profilo, canali, nome, flag, compressione, primo e ultimo timestamp, tag statistici), italiano sì o no; `null` per un file non letto |
| `roles` | `reference` e `donor` (indici in `inputs`), `reason`, controllo del video (`video`), lingua originale e lingua di misura (`measureLanguage`), coppie di tracce provate con la confidenza (`pairs`); `null` se i ruoli non si sono decisi |
| `measurement` | Lingua e coppia scelta, ancore con l'esito, `speedRatio`, `offset` (S dell'ancora, mediana, definitivo, dispersione), `drift`, `contradiction`, `checkpoints` (posizione richiesta e reale, energia, spostamento, scarto, NCC, rapporto, esito, aggiunto), `commonMaterial` (confini, tratto verificato, copertura), `edgeProbes`, `transfer`, `bytesRead`; `null` se un controllo strutturale ha già deciso o se l'analisi si è interrotta |
| `checks` | Tutti i controlli della decisione: nome, esito (`pass`, `fail`, `skipped`), bloccante o no, codice, valore misurato, soglia |
| `choices` | Tutte le scelte: necessaria o no, stato (`decided`, `pending`, `ignored`, `not-needed`), valore e origine (`option`, `env`, `prompt`), effetto di ogni valore per quelle necessarie; `null` senza piano |
| `plan` | Il piano di inizio e fine (studio §5): S, film, materiale in comune, inizio e fine (caso, quantità, intro o coda diversa, taglio, buco, livello al taglio, eccesso), intervallo dell'italiano, tracce audio con ruolo e motivo, sottotitoli presi e forced, PGS italiani del riferimento, scelte in sospeso (`pending`); `null` per una coppia non idonea |
| `expect` | Con `--expect`: `path`, `result` (`pass`, `fail`) e `differences`; altrimenti `null` |
| `output` | Solo nel merge, da quando la costruzione è finita: `path`, `delivered` (il file finale c'è), `sizeBytes`, `durationMs`, `build` (tagli, tracce finali in ordine, sottotitoli persi ai tagli, spazio, comandi eseguiti con codice di uscita, avvisi ed errori) e `verification` (esito di ogni verifica, inizio e fine dell'italiano, durata, trasferimento); dopo `VERIFY_FAILED` c'è tutto e `delivered` è falso. Altrimenti `null` |
| `warnings` | Tutti gli avvisi in un solo elenco: `{ code, message, value?, source }`, con `source` la fase che l'ha dato (`analysis`, `plan`, `build`, `verify`) |

**Valori:** in inglese, come i codici. Tempi in millisecondi sulla linea del
tempo del riferimento, interi salvo dove serve il decimale. Tracce con gli ID
di mkvmerge -J. L'energia di un tratto tutto a zero (−∞) si scrive `null`.

I sottotitoli persi ai tagli non si conoscono in `analyze`: si leggono dal
donatore nella costruzione (`output.build.droppedSubtitles`).

## Avanzamento

Con `--progress json`, su stderr una riga JSON per evento, con `event`,
`phase` ed `elapsedMs` (ms dall'avvio). Su stderr non c'è nient'altro.

| Evento | Campi | Quando |
|---|---|---|
| `phase` | `phase` | All'inizio di ogni fase |
| `progress` | `phase`, `done`, `total` (`null` se non si sa prima); `outcomes` nei punti di conferma | Dentro le fasi dell'analisi |
| `progress` | `phase`, `step`, `steps`, `percent` (`null` finché mkvmerge non lo dice) | Dentro `intermediate` e `merge` |
| `end` | `decision`, `exitCode` | Per ultimo, appena scritto il report |

Il test `test/docs.test.ts` controlla che questa tabella elenchi le fasi,
nell'ordine in cui arrivano.

| Fase | Cosa si fa |
|---|---|
| `read` | Lettura degli ingressi |
| `anchors` | Misura iniziale: le ancore |
| `edges` | Confini del materiale in comune |
| `checkpoints` | Punti di conferma, con i punti per esito (`outcomes`: `consistent`, `inconclusive`, `contradictory`, `unmatched`) |
| `edge-probes` | Ricerche oltre i confini |
| `transfer` | Controllo di trasferimento nel donatore |
| `plan` | Piano di inizio e fine |
| `intermediate` | Intermedio con le tracce italiane (merge) |
| `merge` | Unione finale (merge) |
| `verify` | Verifiche dopo il merge (merge) |

Una fase può mancare: l'analisi si ferma al primo controllo che fallisce, e
`intermediate`, `merge` e `verify` ci sono solo nel merge.
