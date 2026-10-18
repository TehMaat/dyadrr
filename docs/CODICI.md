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
| `BAD_ARGUMENTS` | 30 | Parametri o variabili d'ambiente non validi (anche una cartella dei temporanei senza un punto nel percorso o su un altro disco), oppure un valore di taratura fuori dai limiti |
| `INPUT_UNREADABLE` | 30 | File mancante, illeggibile o non MKV, oppure una finestra audio che decodifica meno del 90% dei campioni attesi (per esempio oltre il punto in cui il file è troncato), o una traccia TrueHD senza punto di sincronizzazione entro 1 s da un taglio |
| `INPUT_TRUNCATED` | 30 | File troncato: la coda non arriva alla durata dichiarata, o una traccia finisce prima dei suoi tag statistici |
| `INPUT_BUSY` | 30 | File ancora in scrittura: modificato da meno di 30 s ([`inputBusyMs`](TARATURA.md)), con una data nel futuro, o cambiato durante la lettura o tra la lettura degli ingressi e quella dell'audio. Riprovabile |
| `INPUT_CHANGED` | 30 | Gli ingressi o il piano non coincidono con l'analisi confermata (`--expect`) |
| `CHOICE_REQUIRED` | 30 | Manca una scelta necessaria per questa coppia, e Dyadrr non può chiederla ([CLI.md](CLI.md#scelte)) |
| `OUTPUT_EXISTS` | 30 | Il file finale esiste già o coincide con un ingresso, anche se compare durante il merge |
| `OUTPUT_NOT_WRITABLE` | 30 | Cartella di uscita mancante o non scrivibile, o cartella dei temporanei che non si può creare |
| `NO_SPACE` | 30 | Spazio insufficiente prima di cominciare (il riferimento, le tracce italiane due volte e 2 GiB), oppure un disco che si riempie durante il merge. Riprovabile, non è un rifiuto |
| `TOOL_MISSING` | 30 | mkvmerge, ffprobe o ffmpeg mancanti, o non si possono lanciare |
| `TOOL_TOO_OLD` | 30 | mkvmerge più vecchio di v57, oppure ffmpeg più vecchio di 6.1 o di cui non si riesce a leggere la versione |
| `MERGE_FAILED` | 40 | mkvmerge fallito (codice 2, crash, errore di I/O), o ffmpeg fallito nel taglio della coda delle tracce FLAC |
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
| `ITALIAN_TRACKS_SKIPPED` | Una traccia audio italiana scartata con `--italian main`: un avviso per traccia |
| `REFERENCE_HAS_ITALIAN_SUBS` | Il riferimento ha già PGS italiani, tenuti o scartati (`--reference-italian-subs`) |
| `ITALIAN_SUBS_NOT_PGS` | Una traccia di sottotitoli italiani non PGS del donatore, scartata |
| `NO_FORCED_ITALIAN_SUBS` | Il riferimento ha forced in un'altra lingua e il donatore non ha forced italiani |
| `SDR_SUBS_ON_HDR` | PGS italiani da un donatore SDR sopra un video di riferimento HDR |
| `SUBTITLES_DROPPED_AT_CUT` | Sottotitoli a schermo in un punto di taglio, persi: all'inizio, o alla fine se il taglio cade prima della fine del video. Un avviso, con il numero |
| `INTRO_MISMATCH` | Intro diverse (oltre 1 s di italiano prima del materiale in comune), audio italiano tenuto (`--edge-mismatch keep`) |
| `OUTRO_MISMATCH` | Code diverse (oltre 1 s di italiano dopo il materiale in comune), audio italiano tenuto (`--edge-mismatch keep`) |
| `LONG_GAP_WITHOUT_ITALIAN` | All'inizio o alla fine del film manca l'italiano per più di 10 minuti ([`longGapWithoutItalianMs`](TARATURA.md)) |
| `TAIL_EXCESS_KEPT` | Italiano oltre la fine del video di riferimento lasciato (`--tail keep`) |
| `ABRUPT_START` | Taglio iniziale con l'italiano sopra −40 dBFS nei 250 ms dopo il taglio ([`abruptStartDbfs`](TARATURA.md)) |
| `MANY_INCONCLUSIVE` | Più del 10% di punti non conclusivi |
| `MKVMERGE_WARNING` | Avvisi di mkvmerge (codice 1), uno per avviso, di ogni passata |

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

Ogni codice e il test che lo produce (studio §15, test 1e): i test della
decisione con serie sintetiche, quelli della misura (`test/measure.test.ts`)
con MKV veri generati al volo (studio §15, 1a e 1b), quelli del piano
(`test/plan.test.ts`) con ingressi sintetici e, dove si può, anche con i MKV
della misura, quelli della costruzione (`test/build.test.ts`) con MKV veri e,
per gli esiti di mkvmerge, con un mkvmerge finto. I codici dei
moduli non ancora scritti indicano il modulo previsto
([ARCHITETTURA.md](ARCHITETTURA.md#moduli-previsti)). Il test
`test/docs.test.ts` controlla che ogni codice sia elencato e che ogni test
citato esista e usi quel codice.

| Codice | Test |
|---|---|
| `NO_ITALIAN_AUDIO` | `test/decision.test.ts` › NO_ITALIAN_AUDIO: nessuno dei due file ha audio italiano; i controlli seguenti sono saltati<br>`test/measure.test.ts` › controlli strutturali falliti: non si legge l'audio |
| `BOTH_ITALIAN_AUDIO` | `test/decision.test.ts` › BOTH_ITALIAN_AUDIO: entrambi i file hanno audio italiano |
| `NO_COMMON_LANGUAGE` | `test/decision.test.ts` › NO_COMMON_LANGUAGE: nessuna lingua di misura in comune |
| `DONOR_BETTER_VIDEO` | `test/decision.test.ts` › DONOR_BETTER_VIDEO: risoluzione più alta, o HDR più alto a parità di risoluzione |
| `FPS_MISMATCH` | `test/decision.test.ts` › FPS_MISMATCH: framerate diversi nei metadati; 23,976 scritto in modi diversi è uguale<br>`test/decision.test.ts` › FPS_MISMATCH: la diagnosi di velocità trova un rapporto 1,001<br>`test/measure.test.ts` › FPS_MISMATCH: con un rapporto di 1,001 nessuna ancora corrisponde, la diagnosi di velocità lo trova |
| `PAL_SPEEDUP` | `test/decision.test.ts` › PAL_SPEEDUP: la diagnosi di velocità trova un rapporto PAL, in un verso o nell'altro |
| `NO_MATCH` | `test/decision.test.ts` › NO_MATCH: nessuna ancora abbastanza somigliante<br>`test/measure.test.ts` › canale centrale contro L+R su un remix: la coppia con il centrale, NO_MATCH con il solo L+R |
| `AMBIGUOUS_MATCH` | `test/decision.test.ts` › AMBIGUOUS_MATCH: ancore somiglianti ma non uniche<br>`test/measure.test.ts` › AMBIGUOUS_MATCH: un contenuto che si ripete corrisponde ovunque |
| `OFFSET_TOO_LARGE` | `test/decision.test.ts` › OFFSET_TOO_LARGE: picco sicuro oltre lo spostamento massimo<br>`test/measure.test.ts` › OFFSET_TOO_LARGE: spostamento sicuro oltre il massimo, dentro l'intervallo di ricerca |
| `CHECKPOINT_CONTRADICTION` | `test/decision.test.ts` › CHECKPOINT_CONTRADICTION: due ancore sicure con spostamenti diversi<br>`test/decision.test.ts` › CHECKPOINT_CONTRADICTION: un salto di due fotogrammi a metà film<br>`test/decision.test.ts` › CHECKPOINT_CONTRADICTION: più salti, oppure rumore<br>`test/decision.test.ts` › CHECKPOINT_CONTRADICTION: il film continua a un altro spostamento oltre il confine<br>`test/measure.test.ts` › CHECKPOINT_CONTRADICTION: un taglio a metà film, di 4 s o di pochi fotogrammi |
| `CHECKPOINT_UNMATCHED` | `test/decision.test.ts` › CHECKPOINT_UNMATCHED: un tratto con contenuto non trova corrispondenza da nessuna parte<br>`test/measure.test.ts` › CHECKPOINT_UNMATCHED: un tratto sostituito a metà film non trova corrispondenza |
| `DRIFT` | `test/decision.test.ts` › DRIFT: lo spostamento cresce nel tempo, e risulta deriva e non contraddizione<br>`test/measure.test.ts` › DRIFT: il donatore va più veloce di 0,3 per mille |
| `TOO_FEW_CHECKPOINTS` | `test/decision.test.ts` › TOO_FEW_CHECKPOINTS: meno di 20 punti coerenti<br>`test/decision.test.ts` › TOO_FEW_CHECKPOINTS: un buco oltre 15 minuti tra punti coerenti<br>`test/decision.test.ts` › TOO_FEW_CHECKPOINTS: nessun punto coerente nell'ultimo 10% del materiale in comune |
| `LOW_COVERAGE` | `test/decision.test.ts` › LOW_COVERAGE: il materiale in comune copre troppo poco del video di riferimento<br>`test/measure.test.ts` › code tagliate con --split: confine finale al secondo, LOW_COVERAGE se il materiale in comune non basta |
| `BAD_ARGUMENTS` | `test/choices.test.ts` › valori non validi sono BAD_ARGUMENTS, da opzione o da variabile<br>`test/calibration.test.ts` › BAD_ARGUMENTS: un valore di taratura fuori dai limiti, mancante o sconosciuto<br>`test/build.test.ts` › CHOICE_REQUIRED, OUTPUT_EXISTS, OUTPUT_NOT_WRITABLE e BAD_ARGUMENTS prima di scrivere qualsiasi cosa |
| `INPUT_UNREADABLE` | `test/inputs.test.ts` › INPUT_UNREADABLE: file mancante, non MKV o senza video<br>`test/audio.test.ts` › INPUT_UNREADABLE: finestra oltre la fine di un file troncato, o a cavallo del troncamento |
| `INPUT_TRUNCATED` | `test/decision.test.ts` › INPUT_TRUNCATED: un ingresso troncato è un errore, non un rifiuto<br>`test/inputs.test.ts` › INPUT_TRUNCATED: un file troncato a metà, e una traccia più corta dei suoi tag |
| `INPUT_BUSY` | `test/inputs.test.ts` › INPUT_BUSY: file modificato negli ultimi secondi, o con una data nel futuro<br>`test/audio.test.ts` › INPUT_BUSY: il file è cambiato da quando è stato letto |
| `INPUT_CHANGED` | previsto: report e riga di comando (`--expect`) |
| `CHOICE_REQUIRED` | `test/choices.test.ts` › merge senza terminale: una scelta in sospeso è CHOICE_REQUIRED<br>`test/plan.test.ts` › INTRO_MISMATCH: intro diverse, l'italiano dell'intro si tiene o si scarta con --edge-mismatch<br>`test/build.test.ts` › CHOICE_REQUIRED, OUTPUT_EXISTS, OUTPUT_NOT_WRITABLE e BAD_ARGUMENTS prima di scrivere qualsiasi cosa |
| `OUTPUT_EXISTS` | `test/build.test.ts` › CHOICE_REQUIRED, OUTPUT_EXISTS, OUTPUT_NOT_WRITABLE e BAD_ARGUMENTS prima di scrivere qualsiasi cosa<br>`test/build.test.ts` › rinomina: un file finale comparso durante il merge non si sovrascrive; avanzi di un'interruzione brusca |
| `OUTPUT_NOT_WRITABLE` | `test/build.test.ts` › CHOICE_REQUIRED, OUTPUT_EXISTS, OUTPUT_NOT_WRITABLE e BAD_ARGUMENTS prima di scrivere qualsiasi cosa |
| `NO_SPACE` | `test/build.test.ts` › NO_SPACE: con un disco piccolo ci si ferma prima di scrivere<br>`test/build.test.ts` › MERGE_FAILED: mkvmerge esce con 2, i temporanei si eliminano |
| `TOOL_MISSING` | `test/tools.test.ts` › TOOL_MISSING: mkvmerge, ffprobe o ffmpeg mancanti |
| `TOOL_TOO_OLD` | `test/tools.test.ts` › TOOL_TOO_OLD: mkvmerge più vecchio di v57<br>`test/tools.test.ts` › TOOL_TOO_OLD: ffmpeg più vecchio di 6.1 |
| `MERGE_FAILED` | `test/build.test.ts` › MERGE_FAILED: mkvmerge esce con 2, i temporanei si eliminano |
| `VERIFY_FAILED` | previsto: verifiche dopo il merge (con un errore iniettato) |
| `INTERNAL` | `test/decision.test.ts` › INTERNAL: mancano le misure di una fase che serve<br>`test/plan.test.ts` › INTERNAL: il piano di un donatore senza audio italiano |
| `CANCELLED` | previsto: report e riga di comando |
| `VIDEO_QUALITY_UNCERTAIN` | `test/decision.test.ts` › VIDEO_QUALITY_UNCERTAIN: stessa risoluzione, HDR e codec, bitrate del donatore oltre il margine |
| `ORIGINAL_LANGUAGE_NOT_COMMON` | `test/decision.test.ts` › ORIGINAL_LANGUAGE_NOT_COMMON: la lingua originale non è in entrambi i file |
| `MEASURE_MIX_DIFFERS` | `test/decision.test.ts` › MEASURE_MIX_DIFFERS: somiglianza nella fascia bassa ma sufficiente |
| `ITALIAN_TRANSFER_OFFSET` | `test/decision.test.ts` › ITALIAN_TRANSFER_OFFSET: nel donatore l'italiano è sfasato rispetto alla lingua di misura |
| `ITALIAN_UNVERIFIED` | `test/decision.test.ts` › ITALIAN_UNVERIFIED: l'italiano non correla con la lingua di misura |
| `ITALIAN_TRACKS_SKIPPED` | `test/plan.test.ts` › ITALIAN_TRACKS_SKIPPED: con --italian main si prende solo la traccia principale |
| `REFERENCE_HAS_ITALIAN_SUBS` | `test/plan.test.ts` › REFERENCE_HAS_ITALIAN_SUBS: PGS italiani già nel riferimento, tenuti o scartati |
| `ITALIAN_SUBS_NOT_PGS` | `test/plan.test.ts` › ITALIAN_SUBS_NOT_PGS: i sottotitoli italiani non PGS del donatore si scartano |
| `NO_FORCED_ITALIAN_SUBS` | `test/plan.test.ts` › NO_FORCED_ITALIAN_SUBS: il riferimento ha un forced in un'altra lingua e il donatore nessun forced italiano |
| `SDR_SUBS_ON_HDR` | `test/plan.test.ts` › SDR_SUBS_ON_HDR: PGS italiani da un disco SDR sopra un video HDR |
| `SUBTITLES_DROPPED_AT_CUT` | `test/build.test.ts` › SUBTITLES_DROPPED_AT_CUT: con S < 0 si taglia all'inizio del film; TrueHD riparte da un punto di sincronizzazione<br>`test/build.test.ts` › --edge-mismatch drop: tagli sui confini, anche prima della fine del video; i sottotitoli a cavallo si perdono |
| `INTRO_MISMATCH` | `test/plan.test.ts` › INTRO_MISMATCH: intro diverse, l'italiano dell'intro si tiene o si scarta con --edge-mismatch<br>`test/measure.test.ts` › INTRO_MISMATCH: su file veri l'italiano di un'intro diversa si tiene o si scarta (--edge-mismatch) |
| `OUTRO_MISMATCH` | `test/plan.test.ts` › OUTRO_MISMATCH: code diverse, l'italiano dopo il materiale in comune si tiene o si scarta<br>`test/plan.test.ts` › --tail non serve con code diverse e --edge-mismatch drop: il taglio cade già sul confine |
| `LONG_GAP_WITHOUT_ITALIAN` | `test/plan.test.ts` › LONG_GAP_WITHOUT_ITALIAN: un buco senza italiano oltre la soglia, all'inizio o alla fine |
| `TAIL_EXCESS_KEPT` | `test/plan.test.ts` › TAIL_EXCESS_KEPT: il donatore ha più coda, l'eccesso si lascia o si toglie con --tail<br>`test/measure.test.ts` › TAIL_EXCESS_KEPT: su file veri il donatore ha 20 s di coda in più; --tail trim taglia alla fine del video |
| `ABRUPT_START` | `test/plan.test.ts` › ABRUPT_START: taglio iniziale con l'italiano sopra soglia; senza il livello del taglio è INTERNAL<br>`test/measure.test.ts` › INTRO_MISMATCH: su file veri l'italiano di un'intro diversa si tiene o si scarta (--edge-mismatch) |
| `MANY_INCONCLUSIVE` | `test/decision.test.ts` › MANY_INCONCLUSIVE: più del 10% di punti non conclusivi, copertura comunque sufficiente<br>`test/measure.test.ts` › MANY_INCONCLUSIVE: silenzi lunghi danno punti non conclusivi, e punti aggiunti nei tratti scoperti |
| `MKVMERGE_WARNING` | `test/build.test.ts` › MKVMERGE_WARNING: mkvmerge esce con 1, il file si accetta e ogni avviso va nel report |
