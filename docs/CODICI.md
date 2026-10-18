# Codici

Ogni rifiuto, errore e avviso ha un **codice fisso** e un messaggio leggibile
in inglese (studio §12). I codici sono definiti in `src/codes.ts`; il test
`test/docs.test.ts` controlla che questa pagina li elenchi tutti, e solo quelli.

## Rifiuti

Questa coppia non va unita. Codice di uscita **20**. Ogni rifiuto elenca le
tracce trovate; se c'entra un tag di lingua, suggerisce come correggerlo con
mkvpropedit.

| Codice | Significato |
|---|---|
| `NO_ITALIAN_AUDIO` | Nessuno dei due file ha audio italiano |
| `BOTH_ITALIAN_AUDIO` | Entrambi hanno audio italiano: il merge è inutile |
| `NO_COMMON_LANGUAGE` | Nessuna lingua di misura in comune |
| `DONOR_BETTER_VIDEO` | Il video del donatore è chiaramente migliore |
| `FPS_MISMATCH` | Velocità diverse (dai metadati o dalla diagnosi di velocità) |
| `PAL_SPEEDUP` | Velocizzazione PAL, riconosciuta dal rapporto misurato |
| `NO_MATCH` | Nessuna ancora trova una corrispondenza abbastanza somigliante |
| `AMBIGUOUS_MATCH` | Corrispondenze somiglianti ma non uniche |
| `OFFSET_TOO_LARGE` | Spostamento sicuro ma oltre il massimo |
| `CHECKPOINT_CONTRADICTION` | Lo spostamento cambia a metà film. Il report ne mostra la forma |
| `CHECKPOINT_UNMATCHED` | Un tratto con contenuto non trova corrispondenza da nessuna parte |
| `DRIFT` | Lo spostamento cresce nel tempo |
| `TOO_FEW_CHECKPOINTS` | Punti coerenti troppo pochi o mal distribuiti |
| `LOW_COVERAGE` | Il materiale in comune copre troppo poco del film |

## Errori

Riprovabili o da correggere, mai un giudizio sulla coppia. Un errore non deve
mai portare a caricare un file senza italiano.

| Codice | Uscita | Significato |
|---|---|---|
| `BAD_ARGUMENTS` | 30 | Parametri o variabili d'ambiente non validi, oppure un valore di taratura fuori dai limiti |
| `INPUT_UNREADABLE` | 30 | File mancante, illeggibile o non MKV |
| `INPUT_TRUNCATED` | 30 | File troncato |
| `INPUT_BUSY` | 30 | File ancora in scrittura |
| `INPUT_CHANGED` | 30 | Gli ingressi o il piano non coincidono con l'analisi confermata (`--expect`) |
| `CHOICE_REQUIRED` | 30 | Manca una scelta necessaria per questa coppia, e Dyadrr non può chiederla ([CLI.md](CLI.md#scelte)) |
| `OUTPUT_EXISTS` | 30 | Il file finale esiste già o coincide con un ingresso |
| `OUTPUT_NOT_WRITABLE` | 30 | Cartella di uscita non scrivibile |
| `NO_SPACE` | 30 | Spazio insufficiente. Riprovabile, non è un rifiuto |
| `TOOL_MISSING` | 30 | mkvmerge o ffmpeg mancanti |
| `TOOL_TOO_OLD` | 30 | mkvmerge o ffmpeg troppo vecchi |
| `MERGE_FAILED` | 40 | mkvmerge fallito (codice 2, crash, errore di I/O) |
| `VERIFY_FAILED` | 40 | Una verifica dopo il merge non torna |
| `INTERNAL` | 40 | Errore imprevisto |

## Annullamento

| Codice | Uscita | Significato |
|---|---|---|
| `CANCELLED` | 50 | Interrotto con un segnale di stop: processi terminati, temporanei eliminati |

## Avvisi

Non cambiano la decisione: finiscono nel report.

| Codice | Quando scatta |
|---|---|
| `VIDEO_QUALITY_UNCERTAIN` | Video confrontabile solo in modo incerto |
| `ORIGINAL_LANGUAGE_NOT_COMMON` | La lingua originale indicata non è presente in entrambi i file |
| `MEASURE_MIX_DIFFERS` | La somiglianza della coppia di misura è in una fascia bassa ma sufficiente |
| `ITALIAN_TRANSFER_OFFSET` | L'italiano è sfasato rispetto alla lingua di misura dentro il donatore |
| `ITALIAN_UNVERIFIED` | L'allineamento dell'italiano con la lingua di misura non si è potuto verificare |
| `ITALIAN_TRACKS_SKIPPED` | Tracce italiane scartate con `--italian main` |
| `REFERENCE_HAS_ITALIAN_SUBS` | Il riferimento ha già PGS italiani |
| `ITALIAN_SUBS_NOT_PGS` | Sottotitoli italiani non PGS scartati |
| `NO_FORCED_ITALIAN_SUBS` | Il riferimento ha forced in un'altra lingua e il donatore non ha forced italiani |
| `SDR_SUBS_ON_HDR` | PGS da un disco SDR sopra un video HDR |
| `SUBTITLES_DROPPED_AT_CUT` | Sottotitoli persi ai tagli |
| `INTRO_MISMATCH` | Intro diverse, audio italiano tenuto (`--edge-mismatch keep`) |
| `OUTRO_MISMATCH` | Code diverse, audio italiano tenuto (`--edge-mismatch keep`) |
| `LONG_GAP_WITHOUT_ITALIAN` | Buco senza italiano oltre la soglia |
| `TAIL_EXCESS_KEPT` | Eccesso in coda lasciato (`--tail keep`) |
| `ABRUPT_START` | Taglio iniziale con audio sopra soglia |
| `MANY_INCONCLUSIVE` | Più del 10% di punti non conclusivi |
| `MKVMERGE_WARNING` | Avvisi di mkvmerge (codice 1) |

## Codici di uscita

Numeri che Node non usa mai da solo (Node usa 1, 3–7, 9, 10, 12–14 e i valori
sopra 128): un crash di Node esce con 1 e non deve sembrare un rifiuto.

| Codice | Esito |
|---|---|
| 0 | Idoneo (`analyze`) oppure merge completato e verificato |
| 20 | Rifiutato |
| 30 | Errore negli ingressi, nell'ambiente o nei parametri |
| 40 | Errore interno, merge fallito o verifica fallita |
| 50 | Annullato |

Qualsiasi altro codice, o un report mancante o illeggibile, va trattato come
errore.
