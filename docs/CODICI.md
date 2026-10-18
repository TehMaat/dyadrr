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

## Test

Ogni codice e il test che lo produce (studio §15, test 1e). I codici dei
moduli non ancora scritti indicano il modulo previsto
([ARCHITETTURA.md](ARCHITETTURA.md#moduli-previsti)). Il test
`test/docs.test.ts` controlla che ogni codice sia elencato e che ogni test
citato esista e usi quel codice.

| Codice | Test |
|---|---|
| `NO_ITALIAN_AUDIO` | `test/decision.test.ts` › NO_ITALIAN_AUDIO: nessuno dei due file ha audio italiano; i controlli seguenti sono saltati |
| `BOTH_ITALIAN_AUDIO` | `test/decision.test.ts` › BOTH_ITALIAN_AUDIO: entrambi i file hanno audio italiano |
| `NO_COMMON_LANGUAGE` | `test/decision.test.ts` › NO_COMMON_LANGUAGE: nessuna lingua di misura in comune |
| `DONOR_BETTER_VIDEO` | `test/decision.test.ts` › DONOR_BETTER_VIDEO: risoluzione più alta, o HDR più alto a parità di risoluzione |
| `FPS_MISMATCH` | `test/decision.test.ts` › FPS_MISMATCH: framerate diversi nei metadati; 23,976 scritto in modi diversi è uguale<br>`test/decision.test.ts` › FPS_MISMATCH: la diagnosi di velocità trova un rapporto 1,001 |
| `PAL_SPEEDUP` | `test/decision.test.ts` › PAL_SPEEDUP: la diagnosi di velocità trova un rapporto PAL, in un verso o nell'altro |
| `NO_MATCH` | `test/decision.test.ts` › NO_MATCH: nessuna ancora abbastanza somigliante |
| `AMBIGUOUS_MATCH` | `test/decision.test.ts` › AMBIGUOUS_MATCH: ancore somiglianti ma non uniche |
| `OFFSET_TOO_LARGE` | `test/decision.test.ts` › OFFSET_TOO_LARGE: picco sicuro oltre lo spostamento massimo |
| `CHECKPOINT_CONTRADICTION` | `test/decision.test.ts` › CHECKPOINT_CONTRADICTION: due ancore sicure con spostamenti diversi<br>`test/decision.test.ts` › CHECKPOINT_CONTRADICTION: un salto di due fotogrammi a metà film<br>`test/decision.test.ts` › CHECKPOINT_CONTRADICTION: più salti, oppure rumore<br>`test/decision.test.ts` › CHECKPOINT_CONTRADICTION: il film continua a un altro spostamento oltre il confine |
| `CHECKPOINT_UNMATCHED` | `test/decision.test.ts` › CHECKPOINT_UNMATCHED: un tratto con contenuto non trova corrispondenza da nessuna parte |
| `DRIFT` | `test/decision.test.ts` › DRIFT: lo spostamento cresce nel tempo, e risulta deriva e non contraddizione |
| `TOO_FEW_CHECKPOINTS` | `test/decision.test.ts` › TOO_FEW_CHECKPOINTS: meno di 20 punti coerenti<br>`test/decision.test.ts` › TOO_FEW_CHECKPOINTS: un buco oltre 15 minuti tra punti coerenti<br>`test/decision.test.ts` › TOO_FEW_CHECKPOINTS: nessun punto coerente nell'ultimo 10% del materiale in comune |
| `LOW_COVERAGE` | `test/decision.test.ts` › LOW_COVERAGE: il materiale in comune copre troppo poco del video di riferimento |
| `BAD_ARGUMENTS` | `test/choices.test.ts` › valori non validi sono BAD_ARGUMENTS, da opzione o da variabile<br>`test/calibration.test.ts` › BAD_ARGUMENTS: un valore di taratura fuori dai limiti, mancante o sconosciuto |
| `INPUT_UNREADABLE` | previsto: ingressi e lettura delle finestre audio |
| `INPUT_TRUNCATED` | `test/decision.test.ts` › INPUT_TRUNCATED: un ingresso troncato è un errore, non un rifiuto |
| `INPUT_BUSY` | previsto: ingressi |
| `INPUT_CHANGED` | previsto: report e riga di comando (`--expect`) |
| `CHOICE_REQUIRED` | `test/choices.test.ts` › merge senza terminale: una scelta in sospeso è CHOICE_REQUIRED |
| `OUTPUT_EXISTS` | previsto: report e riga di comando |
| `OUTPUT_NOT_WRITABLE` | previsto: report e riga di comando |
| `NO_SPACE` | previsto: costruzione (test con un disco piccolo) |
| `TOOL_MISSING` | previsto: report e riga di comando |
| `TOOL_TOO_OLD` | previsto: report e riga di comando |
| `MERGE_FAILED` | previsto: costruzione |
| `VERIFY_FAILED` | previsto: verifiche dopo il merge (con un errore iniettato) |
| `INTERNAL` | `test/decision.test.ts` › INTERNAL: mancano le misure di una fase che serve |
| `CANCELLED` | previsto: report e riga di comando |
| `VIDEO_QUALITY_UNCERTAIN` | `test/decision.test.ts` › VIDEO_QUALITY_UNCERTAIN: stessa risoluzione, HDR e codec, bitrate del donatore oltre il margine |
| `ORIGINAL_LANGUAGE_NOT_COMMON` | `test/decision.test.ts` › ORIGINAL_LANGUAGE_NOT_COMMON: la lingua originale non è in entrambi i file |
| `MEASURE_MIX_DIFFERS` | `test/decision.test.ts` › MEASURE_MIX_DIFFERS: somiglianza nella fascia bassa ma sufficiente |
| `ITALIAN_TRANSFER_OFFSET` | `test/decision.test.ts` › ITALIAN_TRANSFER_OFFSET: nel donatore l'italiano è sfasato rispetto alla lingua di misura |
| `ITALIAN_UNVERIFIED` | `test/decision.test.ts` › ITALIAN_UNVERIFIED: l'italiano non correla con la lingua di misura |
| `ITALIAN_TRACKS_SKIPPED` | previsto: piano |
| `REFERENCE_HAS_ITALIAN_SUBS` | previsto: piano |
| `ITALIAN_SUBS_NOT_PGS` | previsto: piano |
| `NO_FORCED_ITALIAN_SUBS` | previsto: piano |
| `SDR_SUBS_ON_HDR` | previsto: piano |
| `SUBTITLES_DROPPED_AT_CUT` | previsto: piano e costruzione |
| `INTRO_MISMATCH` | previsto: piano |
| `OUTRO_MISMATCH` | previsto: piano |
| `LONG_GAP_WITHOUT_ITALIAN` | previsto: piano |
| `TAIL_EXCESS_KEPT` | previsto: piano |
| `ABRUPT_START` | previsto: piano |
| `MANY_INCONCLUSIVE` | `test/decision.test.ts` › MANY_INCONCLUSIVE: più del 10% di punti non conclusivi, copertura comunque sufficiente |
| `MKVMERGE_WARNING` | previsto: costruzione |
