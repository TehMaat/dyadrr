# Dyadrr: studio di fattibilità

Stato: bozza 0.16, ottobre 2026.

Questo documento raccoglie le decisioni prese, quelle ancora aperte e i risultati delle prime verifiche sperimentali (§18). È il punto di partenza del repo.

La 0.2 corregge la 0.1 dopo una revisione indipendente. La 0.3 chiude le decisioni su lingua originale, scelte dell'utente e licenza. La 0.4 fissa i limiti dei parametri di taratura, i valori provvisori delle soglie ancora da tarare e le regole della funzione di decisione (§9.6). La 0.5 fissa le regole della lettura degli ingressi: controllo di integrità, file ancora in scrittura e programmi esterni (§4.8, §10, §13). La 0.6 fissa il metodo di lettura delle finestre audio, provato a mano, e la versione minima di ffmpeg (§4.2, §4.3, §13, §18). La 0.7 fissa il metodo di correlazione (confidenza dei picchi, ancore, confini, punti di conferma, controllo di trasferimento) con i suoi parametri di taratura, e corregge la lettura delle finestre per i file con uno `start_time` oltre il pre-roll (§4.2–4.7, §9.2, §18). La 0.8 fissa il piano di inizio e fine: casi, tagli, scelte necessarie con l'effetto di ogni valore, tracce italiane prese, riconoscimento dei forced e avvisi del piano, con i suoi parametri di taratura (§5, §7, §8, §9.2, §10.1). La 0.9 fissa la costruzione del file finale (tagli, TrueHD, coda, unione, sottotitoli persi ai tagli, file temporanei) e chiude la decisione 7: in fase 2 Dyadrr gira in un container separato (§6, §7, §13, §14, §17). La 0.10 fissa le verifiche dopo il merge: cosa si legge del file finale, le tolleranze "entro un pacchetto" per codec, cosa è bloccante e cosa è solo un avviso (§9.5, §12). La 0.11 fissa la riga di comando e il report: forma esatta del report e sua versione, eventi di `--progress json`, confronto di `--expect`, richiesta delle scelte e annullamento (§9.4, §10, §11). La 0.12 chiude le decisioni 3, 4, 5, 6 e 11 sull'integrazione con Wayfinderr, e aggiunge alla riga di comando la cancellazione degli ingressi dopo il merge (§10.2, §15, §17). La 0.13 fa chiedere in un terminale se cancellare un file finale che c'è già (§6.4, §10). La 0.14 fissa il runner dei file job e l'immagine Docker: chiavi del job, percorsi, lavori interrotti, `dyadrr.alive`, versioni di ffmpeg e mkvtoolnix, pubblicazione (§14.1, §14.2). La 0.15 fissa lo strumento per misurare le coppie reali della fase 1: elenco delle coppie, cartella dei risultati, verdetto di ogni coppia e riassunto per la taratura (§11.2, §15). La 0.16 toglie gli UID dei capitoli dalle verifiche dopo il merge, dopo il primo merge su una coppia vera (§9.5). Le modifiche principali sono elencate in §20.

---

## 0. Esito in breve

**Fattibile: sì.** Spostare la traccia italiana, tagliarne l'inizio e unire tutto senza ricodificare funziona con mkvmerge. Le verifiche fatte su file di prova lo confermano (§18).

**A queste condizioni:**
- stessa versione del film e stessa velocità;
- una lingua di misura presente in entrambi i file (di norma l'inglese);
- tracce con i tag di lingua corretti.

**Le tre cose da fare bene:**
1. **Leggere l'audio nel modo giusto per misurare.** Un uso ingenuo di ffmpeg introduce errori costanti di 5–16 ms, errori su singole finestre fino a circa 107 ms (fino a 50 ms nelle prove) e rifiuti falsi (§4.3).
2. **La ricetta di mkvmerge.** I suoi comportamenti predefiniti rompono i flag decisi per le tracce, i capitoli e il taglio di TrueHD (§6).
3. **L'integrazione con Wayfinderr.** Oggi il disco italiano verrebbe caricato, e magari cancellato, prima ancora di poter essere abbinato (§15).

**Rischi che restano:**
- **Rifiuti di coppie buone.** Un master UHD nuovo contro un vecchio BD italiano può avere salti di 1–2 fotogrammi a metà film. Quanto succeda spesso lo dirà solo la fase 1 (§16).
- **PGS italiani troppo luminosi su video HDR**, con alcuni lettori (§7).
- **Lettori diversi** gestiscono in modo diverso una traccia che parte in ritardo (§16).

---

## 1. Obiettivo

Dati due rip dello **stesso film nella stessa versione**:

- uno con il video migliore e **senza audio italiano** (per esempio un Blu-ray UHD o un disco estero);
- uno con l'**audio italiano** (per esempio il Blu-ray italiano a 1080p);

Dyadrr produce **un unico MKV**. Contiene il video, i capitoli e le tracce del primo file, più l'audio e i sottotitoli italiani del secondo, sincronizzati. Tutto è automatico e **niente viene ricodificato**.

Il nome viene da *diade*: due elementi che formano una coppia.

---

## 2. Premesse, ipotesi e ambito

### 2.1 Premesse fissate dall'utente

| # | Premessa | Conseguenza |
|---|---|---|
| P1 | Mai ricodificare: né audio, né video, né sottotitoli | Si lavora solo per remux, cioè spostando pacchetti. Decodificare è ammesso **solo per l'analisi**, in memoria: nulla di decodificato finisce nel file. Cambiare i metadati delle tracce (flag, nomi) è ammesso |
| P2 | Nessun taglio di audio a metà film | Le differenze ammesse sono **solo all'inizio** (intro o loghi in più o diversi) **e alla fine** (titoli di coda in più o diversi) |
| P3 | Solo versioni identiche, mai theatrical con extended | La verifica la fa l'utente. Dyadrr la ricontrolla comunque e rifiuta se trova differenze a metà film |
| P4 | Il disco italiano ha sempre anche la traccia inglese | La sincronizzazione si misura confrontando **una lingua con la stessa lingua**: di norma inglese con inglese (§3.3) |
| P5 | Le differenze di framerate non si gestiscono | Con velocità diverse il merge si rifiuta |
| P6 | Sottotitoli in PGS (HDMV) | Si spostano nel tempo come l'audio, senza toccarli |
| P7 | Fa fede il video di qualità maggiore | Vedi "Ruoli" (§3.2) |

### 2.2 Ipotesi

Non dipendono dall'utente: il metodo le dà per vere e, dove si può, le verifica.

| # | Ipotesi | Come si controlla |
|---|---|---|
| H1 | Dentro il donatore, la traccia italiana è sincronizzata con quella inglese (stesso authoring) | Controllo di trasferimento (§4.7) |
| H2 | I due file hanno la stessa velocità | Controllo sui metadati del framerate e pendenza dello spostamento misurato (§4.5) |
| H3 | I tag di lingua delle tracce sono corretti | Il report elenca le tracce trovate. I tag sbagliati si correggono con mkvpropedit, che modifica solo l'intestazione senza remux |
| H4 | I file in ingresso sono completi | Controllo di integrità (§4.8) |

### 2.3 Fuori ambito

- Tagli o inserimenti di audio a metà film, e quindi montaggi diversi.
- Conversione del framerate, correzione PAL, time-stretch.
- Confronto basato sul video. Per la sincronia non serve, grazie a P4. La conseguenza è che Dyadrr **non vede differenze nell'immagine**, come scritte localizzate o inquadrature diverse (§16).
- Ricodifica di qualsiasi traccia, dissolvenze, generazione di silenzio codificato.
- Ritocco dei sottotitoli (luminosità, posizione, palette).
- Sottotitoli testuali o VobSub: i dischi di partenza sono Blu-ray.
- Lingue di destinazione diverse dall'italiano.

---

## 3. Definizioni e ruoli

### 3.1 Cosa vuol dire "italiano"

- Un file "ha l'italiano" quando contiene **almeno una traccia AUDIO** italiana. I sottotitoli non contano.
- Una traccia è italiana se la lingua è `ita`, `it` o `it-*`. Si legge sia il campo lingua classico di Matroska sia il campo IETF, se presente. La regola di Wayfinderr è simile ma non identica: accetta `ita`, `it`, `it-it` e i nomi che iniziano con `ital`, e legge solo il tag di lingua restituito da ffprobe.
- Una traccia con lingua `und` o senza lingua **non conta mai**, né come italiana né come lingua di misura.

Questa regola è diversa da quella di Wayfinderr, che considera "con italiano" anche un file con soli sottotitoli italiani. Con la regola di Wayfinderr, un UHD estero con PGS italiani verrebbe rifiutato come "entrambi italiani": è il caso più comune, quindi la differenza è voluta.

### 3.2 Ruoli dei file

- **Riferimento:** il file da cui si tengono video, capitoli e tutte le tracce.
- **Donatore:** il file da cui si prendono solo le tracce italiane, audio e PGS. Tutto il resto, video compreso, si scarta.

I ruoli li **decide Dyadrr**, senza opzione per imporli:

1. Il donatore è **l'unico** file con audio italiano; il riferimento è l'altro. Il riferimento può avere PGS italiani (per come vengono trattati vedi §7).
2. Se **nessuno** dei due ha audio italiano, o se ce l'hanno **entrambi**, il merge si rifiuta. Un file con soli sottotitoli italiani non è un donatore valido.
3. **Video:** il merge si rifiuta solo se il donatore è **chiaramente** migliore:
   - risoluzione più alta;
   - oppure, a parità di risoluzione, un livello HDR più alto. L'ordine è SDR < HLG ≈ HDR10 < HDR10+ ≈ Dolby Vision.

   A parità di risoluzione e di HDR, il bitrate si confronta solo se i codec sono uguali e la differenza supera un margine (per esempio il 20%). In quel caso non si rifiuta: si va avanti con l'avviso `VIDEO_QUALITY_UNCERTAIN`. Se il bitrate manca (in un MKV viene dai tag statistici e può non esserci) il criterio si salta, e il report lo dice.

### 3.3 Lingua di misura

- **Di norma è l'inglese**, presente in entrambi i file.
- **Il problema:** P4 garantisce l'inglese **sul disco**, non nel rip. Per i film non in lingua inglese, i rip automatici di Wayfinderr tengono solo l'italiano e la lingua originale, e scartano l'inglese.
- **La regola:** la lingua di misura è una lingua non italiana presente in entrambi i file, scelta in quest'ordine:
  1. la lingua originale del film, se indicata con `--original-language`;
  2. l'inglese;
  3. qualsiasi altra lingua in comune.
- **La lingua originale non si ricava dai file**: la indica chi lancia Dyadrr, con `--original-language <codice>` (§10). Si accettano codici ISO 639-2 e 639-1, senza distinguere maiuscole e minuscole (`eng`, `EN`, `jpn`, `fra`…). In fase 2 la passa Wayfinderr. Non ha una variabile d'ambiente, perché cambia da film a film.
  - Se è l'italiano, si ignora per la scelta della lingua di misura: l'italiano non è mai lingua di misura.
  - Se non è presente in entrambi i file, si passa all'inglese con l'avviso `ORIGINAL_LANGUAGE_NOT_COMMON`.
  - Il report registra la lingua originale indicata, o la sua assenza, e la lingua di misura scelta.
- Se non c'è nessuna lingua in comune il merge si rifiuta (`NO_COMMON_LANGUAGE`). Il messaggio suggerisce di rippare il disco italiano tenendo l'inglese o la lingua originale.

---

## 4. Metodo di misura

### 4.1 Lo spostamento S e la linea del tempo

**S** = posizione di un istante nel riferimento − posizione dello stesso istante nel donatore.

- S > 0: il riferimento ha più materiale all'inizio.
- S < 0: il donatore ha più materiale all'inizio.

**Su quale linea del tempo si misura:**
- Tutte le posizioni (finestre, S, piano di inizio e fine) sono **timestamp assoluti delle tracce Matroska**, la stessa linea del tempo che mkvmerge sposta.
- S si calcola con precisione al decimo di millisecondo e si arrotonda all'**intero di millisecondi** solo alla fine, perché mkvmerge `--sync` accetta solo valori interi.

**Perché S è costante:** grazie a P2, P3 e P5, S è **un solo numero per tutto il film**. L'analisi deve misurarlo e dimostrare che è davvero costante.

### 4.2 Segnale di analisi e scelta della coppia di tracce

**Il segnale**
- 8 kHz, con un filtro passa-basso intorno a 3 kHz.
- **Solo il canale centrale** se entrambe le tracce lo hanno: lì sta il dialogo, la parte più stabile tra un vecchio 5.1 e un remix Atmos. Altrimenti L+R, senza LFE.
  - "Hanno il canale centrale" le tracce con più di un canale la cui disposizione (`channel_layout` di ffprobe) comprende FC: 3.0, 5.1, 7.1 e simili. Una traccia mono non conta: il suo unico canale è il mix completo, non il dialogo.
  - L+R è la media di FL e FR. Una traccia mono dà il suo unico canale; una disposizione sconosciuta dà la media dei primi due canali.
- Nella prova del remix sintetico (§18), il downmix mono completo ha perso la corrispondenza in tutte le finestre, mentre il canale centrale l'ha tenuta in tutte.
- Il controllo di trasferimento (§4.7) usa i canali non centrali: L+R, oppure (L − R)/2, la semidifferenza di FL e FR, che toglie quello che sta al centro.
- AC3 ed E-AC3 si decodificano **senza compressione dinamica** (DRC). Ogni decoder applica la sua, e falserebbe il confronto.
- **Ricerca grossolana** con una correlazione "sbiancata" (GCC-PHAT), più robusta con la musica. **Rifinitura** con la correlazione normalizzata classica (NCC) e interpolazione parabolica. I dettagli sono in §4.4.

**La coppia di tracce**
- Si escludono le tracce marcate come commento o audiodescrizione, o con nomi che lo indicano (le stesse parole di §8, anche in inglese: "commentary", "audio description", "descriptive"). Se in un file restano solo tracce così, si usano comunque.
- Nei rip da Blu-ray questi flag di solito mancano, perché il disco non li riporta. Per questo non si sceglie la coppia "guardando i metadati".
- Si misura **ogni coppia possibile** nella lingua di misura (in genere al massimo 3×2) sulla prima ancora (§4.4) e si tiene quella con la corrispondenza migliore: tra le coppie con un picco sicuro, la somiglianza più alta. A parità (somiglianze entro 0,02) si preferiscono due tracce lossless, poi lo stesso codec, poi l'ordine delle tracce.
- Se sulla prima ancora nessuna coppia ha un picco sicuro (per esempio cade in un silenzio), si misurano tutte le coppie anche sulle ancore successive, finché una lo ha. Senza nessun picco sicuro si tiene la coppia più somigliante, per il report e per la diagnosi di velocità.
- Dopo la scelta, ancore, confini e punti usano solo quella coppia. Il report elenca tutte le coppie provate, con la loro confidenza (§11.2).
- Il costo è di pochi secondi, perché le coppie si decodificano nella stessa lettura e ogni tratto del donatore si trasforma una volta sola per tutte le coppie che lo usano.

### 4.3 Come si leggono le finestre di audio

È il punto più delicato. Le verifiche (§18) mostrano che un uso ingenuo di ffmpeg produce due tipi di errore:

| Errore | Causa | Effetto |
|---|---|---|
| **Errore costante su tutto S** | Per default ffmpeg sottrae lo `start_time` del file (il primo timestamp tra *tutte* le tracce, video compreso). Il PCM decodificato non porta timestamp, quindi si dà per scontato che il primo campione cada all'istante richiesto | Tutti i punti di conferma concordano sullo **stesso S sbagliato** di 5–16 ms, e tutti i controlli passano |
| **Errore su singole finestre** | Dopo un salto a metà file, il primo pacchetto audio decodificato può partire più tardi del previsto: fino a 32 ms con AC3 ed E-AC3, fino a 96 ms con FLAC, fino a circa 107 ms con TrueHD | La finestra risulta "contraddittoria" con confidenza alta, e il merge viene rifiutato senza motivo. Nelle prove, la probabilità di un rifiuto falso su 30 punti va da circa il 20% (AC3) a circa l'80% (TrueHD) |

**Regola:**
- Si decodifica **senza ribasare i timestamp** (`-copyts` oppure `-seek_timestamp 1`).
- Ogni finestra si legge **partendo qualche secondo prima** (pre-roll) e si taglia sui timestamp decodificati.
- Non si dà mai per scontato che il primo campione cada all'istante richiesto.
- Il report registra l'inizio reale di ogni finestra.

Con questa regola, nelle prove l'errore di lettura delle finestre è sceso sotto il millisecondo per AC3, FLAC, TrueHD e DTS. Il ritardo costante dei codec è un'altra cosa (§4.9).

**Il metodo, provato a mano (0.6).** Una lettura è un solo processo ffmpeg per finestra, con tutte le tracce che servono di quel file (§4.2):

```
ffmpeg -nostdin -v verbose -drc_scale 0 -copyts -seek_timestamp 1 -noaccurate_seek -ss <T − 2 s> -i <file>
  -filter_complex "[0:<flusso>]pan=mono|c0=FC,
                   aresample=8000:cutoff=0.75:min_comp=0.002:min_hard_comp=0.002:max_soft_comp=0,
                   atrim=start=<T>:end=<T + durata>,asetnsamples=n=8000:p=0,ashowinfo@s0[o0];
                   [0:<altro flusso>]…[o1]"
  -map [o0] -f f32le pipe:3  -map [o1] -f f32le pipe:4
```

- **Timestamp.** `-copyts` tiene i timestamp della traccia Matroska; `-seek_timestamp 1` fa cercare T sulla stessa linea del tempo, senza aggiungere lo `start_time`. `atrim` taglia sui timestamp decodificati, al campione. `-noaccurate_seek` toglie il taglio che ffmpeg fa da sé dopo `-ss`: con `-copyts` cadrebbe a T − 2 s **più lo `start_time` del file**, e con uno `start_time` oltre il pre-roll la finestra comincerebbe tardi, o non avrebbe campioni (corretto nella 0.7: nelle prove della 0.6 gli `start_time` erano sotto i 2 s e il pre-roll lo nascondeva, §18). `ashowinfo` scrive su stderr il timestamp di ogni blocco in uscita, in unità di 1/8000 s: quello del primo blocco è l'**inizio reale** della finestra. Di solito è T; è più tardi se la traccia comincia dopo T o se la decodifica è partita dopo T. Non si dà mai per scontato.
- **Ritardo del codec dichiarato (CodecDelay).** Se la traccia Matroska dichiara un ritardo del codec, ffmpeg lo sottrae dai timestamp, arrotondato al millisecondo, come prescrive Matroska: è la linea del tempo su cui un lettore suona la traccia. Gli AC3 ed E-AC3 scritti da ffmpeg dichiarano 5,33 ms, e una traccia che per mkvmerge comincia a 700 ms dà il primo campione a 695 ms. S non cambia: mkvmerge sposta i blocchi e lascia il ritardo dichiarato com'è. Sui rip di MakeMKV va controllato (§15, fase 0).
- **Continuità.** Il PCM in uscita non ha timestamp: il campione n deve cadere davvero all'inizio reale + n/8000 s. Per questo `aresample` riempie di silenzio i buchi nei timestamp e toglie le sovrapposizioni, ma solo oltre 2 ms, senza mai stirare il segnale (`max_soft_comp=0`). Sotto i 2 ms non tocca nulla: i timestamp di Matroska sono al millisecondo, e con i codec il cui pacchetto non dura un numero intero di ms (TrueHD 0,83 ms, DTS 10,67 ms) l'arrotondamento da solo dà scarti fino a 1 ms. Con la soglia a 1 ms, nelle prove, `aresample` toglieva e aggiungeva campioni nel DTS e la somiglianza con l'originale scendeva da 0,975 a 0,88. Senza compensazione, un buco di 50 ms sposta di 50 ms tutto quello che segue.
- **Passa-basso.** È il filtro del ricampionamento stesso: `cutoff=0.75` della metà di 8 kHz, cioè 3 kHz. Il filtro è a fase lineare e `aresample` ne compensa il ritardo nei timestamp: nelle prove l'errore su FLAC è 0,000 ms.
- **Canali e DRC.** `pan` sceglie il centrale o fa la media di L e R (§4.2). `-drc_scale 0` toglie la compressione dinamica di AC3 ed E-AC3: il valore predefinito di ffmpeg è 1, cioè compressione piena. Sui file di prova non si può verificare, perché l'encoder AC3 di ffmpeg non scrive dati DRC.
- **Più tracce.** Una catena di filtri per ogni segnale, ciascuna con la sua uscita su una pipe separata. Una traccia che serve sia con il centrale sia con L+R (perché fa coppia con tracce diverse) ha due catene, nella stessa lettura.
- **Pre-roll: 2 s.** Si cerca 2 s prima di T, così il decoder ha tempo di arrivare a un punto di sincronizzazione (su TrueHD fino a circa 107 ms) e di stabilizzarsi. Nelle prove i timestamp erano giusti anche senza pre-roll; il pre-roll migliora i primi campioni (su AC3 la somiglianza con l'originale passa da 0,964 a 0,968) e dà margine ai dischi veri. Costa 2 s di lettura in più per finestra: il 7% su una finestra di 30 s. ffmpeg si ferma da solo quando tutte le uscite hanno finito la finestra.
- **Energia:** media dei quadrati dei campioni, in dBFS (fondo scala 1,0; una finestra tutta a zero vale −∞). Serve a E_min (§4.5).
- **Byte letti:** dalle statistiche di ffmpeg (`Statistics: … bytes read`, con `-v verbose`), per il report (§11.2, punto 4).
- **Finestra troppo corta.** I campioni attesi sono la parte della finestra che cade dentro la traccia, secondo quello che il file dichiara: dal primo timestamp della traccia alla sua fine secondo i tag statistici, altrimenti alla fine dichiarata del file. Mai dalla fine letta in coda (§4.8), che è proprio quello che la finestra deve controllare: in un file troncato, poi, i tag statistici mancano, perché mkvmerge li scrive in fondo. Se la finestra decodifica **meno del 90%** dei campioni attesi, o nessun campione, è `INPUT_UNREADABLE` (§4.8). Il caso tipico è una finestra oltre il punto in cui un file è troncato. Una finestra che cade tutta fuori dalla traccia è una richiesta sbagliata di chi chiama (`INTERNAL`).
- **Costanti del metodo, non parametri di taratura.** Pre-roll, soglia dei buchi (2 ms) e soglia della finestra troppo corta (90%) non decidono se una coppia è idonea: decidono se la lettura è corretta, e lo dimostrano i test con spostamenti noti (§15, 1d). Per questo stanno nel codice e non in `calibration.json`; si cambiano con una PR che aggiorna questo paragrafo.
- **Versione di ffmpeg:** almeno 6.1 (§13).

**Quanto si legge davvero dal disco.** In un MKV audio e video sono intrecciati, quindi per leggere N secondi di audio si leggono N secondi di **tutto** il file, video compreso. Per un UHD sono decine di MB al secondo, e l'analisi completa legge alcuni GB.

Per ridurli: il pezzo da cercare si prende sempre dal riferimento e la ricerca ampia si fa nel donatore (§4.4, §4.6). Di solito il riferimento è il file più pesante (UHD) e il donatore il più leggero (BD), quindi la lettura è già quella minima.

### 4.4 Misura iniziale: le ancore

1. **Ancore multiple.** Si cerca un tratto di 30 s del riferimento al 15%, 25%, 35% e 50% della durata: sempre oltre lo spostamento massimo S_max (180 s di partenza, §9.2), e mai in un punto solo. Si accetta la prima ancora che passa la soglia, e una seconda ancora deve dare lo stesso S entro la tolleranza.
   - **Posizioni:** dal primo timestamp del video di riferimento, al 15%, 25%, 35% e 50% della sua durata, ma mai prima di S_max + 60 s (così nel donatore c'è posto per ogni S) né oltre la fine delle tracce. Posizioni uguali contano una volta.
   - **Quante:** ci si ferma a due ancore sicure, oppure alla prima se il suo |S| supera S_max (la decisione si ferma lì, punto 4). Altrimenti si misurano tutte e quattro.
   - **Lunghezza:** 30 s (`anchorWindowMs`, §9.2).
2. **Intervallo di ricerca simmetrico**, ±(S_max + 60 s), **indipendente dalle durate dei file**. I 60 s sono il margine `searchMarginMs` (§9.2): servono perché un picco poco oltre S_max dia `OFFSET_TOO_LARGE` e non `NO_MATCH`.
   - La differenza di durata non dice quanto vale S: un'intro in più da una parte e una coda in più dall'altra possono compensarsi.
   - La differenza di durata si usa solo come indizio e si riporta nel report.
3. **Confidenza: due numeri.**
   - **Somiglianza:** il valore NCC del picco, normalizzato tra −1 e 1. Deve superare una soglia θ_ncc. Se la supera solo di poco (fascia in §9.2, provvisoria), si va avanti con l'avviso `MEASURE_MIX_DIFFERS`.
   - **Unicità:** il rapporto tra il picco e il valore più alto **fuori da una zona di esclusione** intorno al picco (±25 ms, `exclusionZoneMs`). Deve superare una soglia θ_rapporto. Senza zona di esclusione, il "secondo picco" sarebbe il campione accanto e il rapporto sarebbe sempre circa 1.

   **Come si misura un picco (0.7).**
   - **Pezzo e tratto di ricerca.** Il pezzo è la finestra del riferimento, con il suo inizio reale (§4.3); il tratto è la finestra del donatore che copre l'intervallo di ricerca. Le letture si limitano al tratto in cui le tracce hanno audio. Si provano tutti gli spostamenti in cui il pezzo sta per intero nel tratto.
   - **Posizione grossolana:** il massimo della correlazione sbiancata (GCC-PHAT), nella banda da 20 Hz a 3 kHz. Fuori dalla banda i pesi sono zero: sopra il passa-basso della lettura c'è solo rumore, e sbiancarlo lo porterebbe al livello del segnale.
   - **Rifinitura:** NCC ai campioni entro ±2 ms dalla posizione grossolana, e parabola sui tre valori intorno al massimo: lo spostamento ha il decimale.
   - **Somiglianza:** NCC allo spostamento rifinito, con il tratto del donatore interpolato tra un campione e l'altro (sinc a finestra). Senza interpolazione, a mezzo campione dal picco l'NCC di un segnale fino a 3 kHz campionato a 8 kHz scende fino al 10% (0,90 invece di 1 nelle prove, §18): la somiglianza dipenderebbe da dove cade il picco rispetto ai campioni.
   - **Unicità:** sull'NCC, non sulla correlazione sbiancata. Il secondo valore è il massimo dell'NCC su tutti gli spostamenti fuori dalla zona di esclusione, con la stessa parabola del picco. Un contenuto che si ripete esattamente ha uno spettro a righe, e sbiancarlo darebbe un picco "unico" che non lo è: nelle prove il rapporto sulla correlazione sbiancata era 2,0, sull'NCC 1,0 (§18). È l'errore nel verso pericoloso, quello che accetta un allineamento sbagliato di un periodo. Il rapporto vale al massimo 1000, 1 se fuori dalla zona non c'è niente da confrontare, 0 se la somiglianza è nulla.
   - **S** = istante reale del pezzo − istante del donatore in cui il pezzo comincia, con il decimale (§4.1).
   - **Calcolo:** FFT scritta in TypeScript, nessuna dipendenza. Le due correlazioni si calcolano a blocchi (overlap-save), insieme in una sola trasformata inversa, così la memoria non cresce con l'intervallo di ricerca. Un'ancora (30 s contro 8,5 min) richiede circa 2 s.
4. **Esiti:**
   - somiglianza sotto soglia su tutte le ancore: `NO_MATCH`;
   - somiglianza alta ma unicità bassa (per esempio musica ripetitiva): `AMBIGUOUS_MATCH`;
   - un picco sicuro con |S| > S_max: `OFFSET_TOO_LARGE`;
   - due ancore sicure con S diversi oltre la tolleranza: `CHECKPOINT_CONTRADICTION` (lo spostamento cambia a metà film); se una sola ancora passa la soglia, la conferma la danno i punti di conferma (§4.5).
5. **Diagnosi di velocità (facoltativa).** Se nessuna ancora trova corrispondenza, si ripete la ricerca ricampionando in memoria il tratto da cercare ai rapporti tipici: 1,001 (24 contro 23,976) e i rapporti PAL. È solo diagnosi e nessun file viene convertito, quindi P5 resta. Una corrispondenza trovata così dà `FPS_MISMATCH` o `PAL_SPEEDUP` con il rapporto misurato. Senza questa diagnosi, le differenze di velocità risultano solo come `NO_MATCH`.
   - **Come (0.7):** sul tratto della prima ancora, già letto, con la coppia più somigliante. Il pezzo si stira in memoria (interpolazione cubica) a 1,001, 25/24 e 25/23,976, in tutti e due i versi; il primo picco sicuro dà il rapporto, riportato come durata nel donatore ÷ durata nel riferimento.

### 4.5 Punti di conferma

1. **Dove.** N punti (30 di partenza, `checkpointCount`), distribuiti solo **dentro il materiale in comune** (§4.6): ogni finestra al centro di uno di N intervalli uguali. Finestre di 10 s (`checkpointWindowMs`, **provvisorio**): con 30 punti si leggono circa 6 minuti di film nel riferimento e 7 nel donatore (finestra, pre-roll e la ricerca vicina), meno di un'ancora nel donatore (8,5 minuti); finestre più corte costano meno ma tengono peggio con mix diversi. Lo dirà la fase 1.
2. **Prima di correlare si controlla il donatore.** Se la finestra è quasi muta o povera di contenuto (energia sotto una soglia E_min), la si sposta fino a ±60 s in cerca di contenuto. Se non si trova nulla, il punto è **non conclusivo**. Questo esito si decide dall'energia, **mai** dall'assenza di una corrispondenza.
   - **Quale finestra (0.7):** quella del donatore allo spostamento S delle ancore, lunga quanto il pezzo del riferimento.
   - **Quanto si sposta:** fino a 60 s, ma restando nel suo intervallo, cioè al più metà della distanza dai punti vicini. Così lo spostamento non ammucchia i punti e la distribuzione di §9.3 resta quella prevista. Si sceglie il tratto con energia sopra E_min più vicino, a passi di 250 ms, in una sola lettura del donatore; poi si rilegge il riferimento nella posizione nuova. Il report riporta posizione richiesta e reale.
   - **Ricerca vicina:** il picco si cerca entro ±1 s dallo spostamento delle ancore. Il rapporto si misura fuori dalla zona di esclusione dentro questo ±1 s.
3. **Esiti** di un punto con contenuto:
   - **coerente:** corrispondenza sicura entro la tolleranza da S;
   - **contraddittorio:** corrispondenza sicura a un altro spostamento;
   - **senza corrispondenza:** c'è contenuto ma nessun picco sicuro. Si cerca di nuovo su tutto l'intervallo ±(S_max + 60 s), centrato sullo zero come per le ancore. Se si trova un picco sicuro altrove il punto diventa contraddittorio; se non si trova niente resta senza corrispondenza, ed è **bloccante** come un contraddittorio.

   Senza questo quarto esito, una scena in più nel donatore verso la fine del film passerebbe per "non conclusiva", e il merge riuscirebbe con l'italiano fuori sincrono per tutto l'ultimo tratto.
4. **S definitivo** = mediana degli spostamenti dei punti coerenti, riportata con la sua dispersione.
5. **Deriva.** È la pendenza di una retta robusta che descrive lo spostamento in funzione della posizione nel film. Si misura in ms all'ora; il report dà anche la deriva totale in ms sul tratto verificato. Si controlla **prima** delle contraddizioni, così una tendenza lineare viene riportata come `DRIFT` e non come contraddizione.
6. **Forma della contraddizione.** Quando ci sono punti contraddittori, il report descrive come cambia lo spostamento:
   - un solo salto, con posizione e ampiezza in ms e in fotogrammi;
   - più salti;
   - rumore.

   Un salto di 1–2 fotogrammi indica di solito un master diverso o una giunzione nel rip (§16), non una versione diversa del film.
7. **Più punti dove servono.** Se troppi punti sono non conclusivi, se ne aggiungono nei tratti scoperti, fino a un massimo (60, `maxCheckpointCount`). Il report distingue i punti previsti da quelli aggiunti.
   - **Quando (0.7):** finché i punti coerenti non soddisfano la regola di §9.3 (quanti, buco massimo, primo e ultimo 10%), e solo se non ci sono punti contraddittori o senza corrispondenza: con quelli la decisione è già un rifiuto. Non per abbassare la quota di non conclusivi: l'avviso `MANY_INCONCLUSIVE` deve dire com'è il film, non quanti punti si sono aggiunti.
   - **Dove:** uno alla volta, a metà del buco più lungo tra due punti coerenti, o tra un confine e il primo punto coerente. Un punto aggiunto si sposta sul contenuto al più di un quarto del buco. Un buco in cui il punto aggiunto non risulta coerente non si riprova; un buco più corto di una finestra non si divide.
8. **Dove ci si ferma.** Con un punto contraddittorio o senza corrispondenza le misure finiscono lì: la decisione rifiuta prima di arrivare ai confini e al trasferimento (§9.6).

### 4.6 Confini del materiale in comune

P2 ammette intro e code **diverse**, non solo in più. Bisogna quindi sapere dove comincia e dove finisce il tratto allineato con S.

- **Ricerca dei confini.** Si fa prima dei punti di conferma: si parte dalle ancore coerenti (§4.4) e si va indietro verso l'inizio, poi avanti verso la fine, a metà per volta con finestre brevi (le finestre mute si spostano come in §4.5). La precisione è di circa 1 s.
- **Il metodo (0.7):**
  - **"In comune"** vuol dire che il tratto del riferimento ha nel donatore un picco sicuro vicino a S (±1 s, la ricerca vicina di §4.5). Uno spostamento poco diverso, come un salto di qualche fotogramma o una deriva, resta dentro il materiale in comune: lo trovano i punti di conferma, che ne danno la forma (§4.5, punti 5 e 6).
  - **Dove si cerca:** l'inizio tra il primo istante in cui entrambe le tracce della coppia hanno audio, con S, e la prima ancora coerente; la fine tra la fine dell'ultima ancora coerente e l'ultimo istante comune.
  - **Prima l'estremo:** di solito il materiale in comune arriva fin lì, e basta una prova. Altrimenti si dimezza l'intervallo finché è più corto di 1 s.
  - **Finestre:** lunghe come quelle dei punti di conferma finché l'intervallo è più lungo di loro, poi brevi, di 2 s. Una prova sbagliata all'inizio, quando l'intervallo è largo, sposterebbe il confine di metà intervallo: lì servono le finestre più robuste.
  - **Finestre mute:** si spostano sul contenuto più vicino, entro 60 s e strettamente dentro l'intervallo (a più di 0,5 s dai suoi estremi), così ogni prova lo restringe. Se intorno è tutto muto, il tratto muto resta fuori dal materiale in comune. Al massimo 50 prove per confine: la metà per volta ne usa una dozzina, il tetto garantisce che la ricerca finisca.
  - **Precisione:** circa 1 s. Una finestra a cavallo del confine può ancora trovare il picco, quindi il confine può cadere fino a una finestra breve (2 s) dentro il materiale diverso. Nelle prove (§18): coda tagliata a 100 s, confine a 99,1 s; intro diversa fino a 5 s, confine a 4,5 s; 4 s tolti a 60 s, confine a 61,4 s.
- **Prima del confine iniziale e oltre quello finale** si cerca nel donatore una corrispondenza con qualsiasi altro spostamento:
  - se c'è, il film continua a un altro spostamento, cioè c'è una modifica a metà film, e il merge si rifiuta;
  - se non c'è, la coda è davvero diversa.
  - **Come (0.7):** se il riferimento ha almeno 2 s oltre il confine, fino a 3 finestre per lato, lunghe come quelle dei punti di conferma (o meno, se il tratto è più corto): la prima accanto al confine, le altre distribuite fino all'inizio o alla fine della traccia. Ognuna si cerca su tutto l'intervallo ±(S_max + 60 s).
- **Report:** inizio e fine del materiale in comune, e il tratto effettivamente verificato (dal primo all'ultimo punto coerente).
- **Copertura** = lunghezza del materiale in comune ÷ durata del video di riferimento, misurata.

### 4.7 Controllo di trasferimento (ipotesi H1)

S viene misurato sulla lingua di misura e applicato alla traccia italiana. Funziona solo se, dentro il donatore, l'italiano è allineato con quella lingua.

- **Di solito è vero.** Ma un doppiaggio adattato da un altro master può avere uno sfasamento costante di qualche fotogramma, e una traccia etichettata "ita" può essere in realtà un commento.
- **Come si controlla:** il doppiaggio italiano condivide musica ed effetti con la versione originale. Quindi, dentro il donatore, italiano e lingua di misura correlano a spostamento circa zero sui canali **non centrali**.
- **Cosa si fa:** si misura in 3–5 punti, senza costi di lettura aggiuntivi rilevanti.
  - **Come (0.7):** 5 punti, al centro di 5 intervalli uguali del materiale in comune, nella posizione corrispondente del donatore. Si confronta la traccia italiana principale (§8) con la traccia di misura della coppia scelta, nella stessa lettura, con la ricerca vicina (±1 s). Lo spostamento si misura come S: posizione nella lingua di misura − posizione nell'italiano; quello corretto per l'italiano sarebbe S più questo valore.
  - **Segnale:** L+R se entrambe le tracce hanno il centrale, perché lì il dialogo non c'è. Altrimenti (L − R)/2: in una traccia stereo il dialogo sta al centro, cioè uguale in L e R, e la differenza lo toglie, mentre musica ed effetti stereo restano. Se (L − R)/2 è muto (un mono su due canali) si torna a L+R per quel punto, letto nella stessa lettura; L+R anche se una delle due tracce non ha L e R.
  - Uno sfasamento costante diverso da zero dà l'avviso `ITALIAN_TRANSFER_OFFSET`, con il valore.
  - Nessuna correlazione da nessuna parte dà l'avviso `ITALIAN_UNVERIFIED`.
  - All'inizio sono solo avvisi; diventano bloccanti se la fase 1 li dimostra affidabili.
- **Seconda misura indipendente:** lo stesso confronto, fatto sul file finale tra italiano e lingua di misura del riferimento, controlla S in modo indipendente. È inserito anche tra le verifiche dopo il merge (§9.5), con i suoi avvisi: `OUTPUT_TRANSFER_OFFSET` e `OUTPUT_TRANSFER_UNVERIFIED`.

### 4.8 Integrità degli ingressi

- **Il rischio:** un MKV troncato riporta comunque la durata completa nell'intestazione. ffmpeg legge una finestra oltre il punto di troncamento senza errori e restituisce zero campioni, e mkvmerge unisce il file senza avvisi.
- **Controllo prima di misurare:** il timestamp più alto letto dagli ultimi cluster del file deve corrispondere, entro una tolleranza, alla durata dichiarata; per ogni traccia usata, l'ultimo timestamp reale deve corrispondere alla sua durata nei tag statistici, se ci sono. Altrimenti è errore `INPUT_TRUNCATED`. La fine di ogni traccia non si confronta con la durata del file: audio e sottotitoli possono finire legittimamente prima del video (§5).
- **Come si legge la coda.** Dyadrr legge da sé gli ultimi byte del file e ne riconosce i cluster Matroska, senza ffmpeg: un file troncato ha perso l'indice (Cues), che mkvmerge scrive in fondo, e ffmpeg cercherebbe la fine leggendo tutto il file. Si parte dagli ultimi 8 MiB e si raddoppia, fino a 256 MiB, finché ogni traccia controllata ha il suo ultimo pacchetto oppure il tratto letto arriva prima del punto in cui la traccia dovrebbe finire.
- **Fine di un pacchetto:** timestamp più durata. La durata è quella del blocco (BlockDuration) se c'è, altrimenti la durata predefinita della traccia per il numero di fotogrammi del blocco.
- **Durata dichiarata:** quella dell'intestazione del segmento. mkvmerge la scrive come fine più alta meno il primo timestamp del file; si accetta anche la fine più alta contata da zero, perché altri programmi possono scriverla così.
- **Tracce controllate:** audio e video. La fine attesa è il primo timestamp della traccia (`minimum_timestamp` di mkvmerge -J) più la durata dei tag statistici (`DURATION`).
  - I sottotitoli non si controllano: sono sparsi, e l'ultimo può stare molto prima della coda. Un troncamento lo trova comunque il controllo sul file.
  - Una traccia senza tag statistici, o la cui fine attesa cade prima del tratto letto, risulta "saltata".
  - Una traccia senza pacchetti nel tratto letto, quando il tratto arriva prima della sua fine attesa, è troncata.
- **Tolleranza:** un solo parametro di taratura, per il file e per le tracce (`integrityToleranceMs`, 1 s, **provvisorio**, §9.2). Assorbe l'ultimo fotogramma o pacchetto senza durata esplicita; si controlla sui rip reali di MakeMKV (§15, fase 0).
- **Quando non si può verificare:** senza durata dichiarata, o senza nessun cluster negli ultimi 256 MiB, il file risulta troncato. Meglio un errore da correggere che un merge su un file forse incompleto.
- **Esito:** il report degli ingressi riporta durata dichiarata, fine più alta, fine attesa e fine letta di ogni traccia (§11.2); la decisione lo usa nel controllo `integrity` (§9.6).
- **Finestra vuota:** una finestra che decodifica zero campioni, o troppo pochi (meno del 90% di quelli attesi, §4.3), è un errore (`INPUT_UNREADABLE`) e non un punto non conclusivo.

### 4.9 Precisione e accuratezza

| | Valore | Note |
|---|---|---|
| **Ripetibilità** | circa ±1 ms per finestra | Matroska memorizza i tempi al millisecondo |
| **Accuratezza** | errore atteso sotto circa 11 ms | Due codec diversi nella coppia di misura (per esempio TrueHD contro AC3) possono introdurre un errore sistematico di qualche millisecondo, dovuto al ritardo dei codec. È ben dentro la tolleranza del labiale (circa +45/−125 ms). L'obiettivo è ±5 ms |
| **Come si riduce** | | Coppie lossless con lossless, poi stesso codec. In fase 1 si misura l'errore su dischi che hanno lo stesso mix in due codec (§15) |

---

## 5. Piano di inizio e fine

Il piano si calcola dalle **estensioni reali delle tracce**, non dalle durate dei file:
- primo e ultimo timestamp di ogni traccia italiana;
- fine della traccia video del riferimento;
- confini del materiale in comune (§4.6).

La durata di un MKV è quella della traccia più lunga, non quella della traccia italiana.

| Situazione | Risultato, senza ricodifica |
|---|---|
| Il riferimento ha un'intro in più (S > 0) | La traccia italiana parte a S: i primi S ms sono senza italiano |
| Il donatore ha un'intro in più (S < 0) | Si scarta l'italiano che cade prima dell'inizio del film nel riferimento |
| Intro **diverse** (loghi diversi) | Prima del materiale in comune, l'audio italiano della sua intro suona sopra un'intro diversa. Tenerlo o scartarlo è una scelta dell'utente (`--edge-mismatch`, §10.1) |
| Il riferimento ha più coda | La traccia italiana finisce prima: coda senza italiano |
| Il donatore ha più coda (spesso il cartello "edizione italiana") | L'eccesso si toglie o si lascia: scelta dell'utente (`--tail`, §10.1) |
| Code **diverse** | Come per le intro diverse (`--edge-mismatch`, §10.1) |

Le situazioni di inizio e di fine si combinano liberamente.

**Note:**
- **Buco all'inizio.** Non si "inserisce silenzio": in Matroska una traccia che parte più tardi è valida, e il lettore tace finché non arrivano i pacchetti. Il comportamento dei lettori reali va però **provato** (§15, fase 1).
- **Partenza brusca.** Con S < 0 l'italiano può partire a metà di un suono, perché senza ricodifica non ci sono dissolvenze. Si avvisa solo se il livello audio nel punto di taglio supera una soglia.
- **Buco lungo senza italiano.** Se all'inizio o alla fine manca l'italiano per più di una soglia in minuti (per esempio 10, da tarare insieme alla copertura minima di §9.3, che altrimenti rifiuta prima che l'avviso possa scattare), il report avvisa con `LONG_GAP_WITHOUT_ITALIAN`. Vicino ai due confini del materiale in comune deve comunque esserci un punto coerente (regola di §9.3: almeno uno nel primo e nell'ultimo 10%).

**Il metodo (0.8).**
- **Estremi.** Il film va dal primo timestamp del video di riferimento alla fine del suo ultimo fotogramma. L'italiano va dal primo timestamp alla fine dell'ultimo pacchetto delle tracce audio italiane prese (§8; con `--italian` in sospeso, di tutte), spostate di S. La fine è quella letta in coda (§4.8), altrimenti quella dei tag statistici.
- **Caso.** All'inizio l'italiano comincia dopo l'inizio del film (il riferimento ha più intro: quel tratto resta senza italiano), prima (il donatore ha più intro: si taglia all'inizio del film), oppure insieme. Alla fine lo stesso con la fine del film: se l'italiano finisce dopo, la differenza è l'eccesso in coda.
- **Intro e code diverse:** c'è italiano fuori dal materiale in comune, dentro il film. Il materiale in comune comincia più di 1 s dopo il punto in cui comincerebbe l'italiano, o finisce più di 1 s prima del punto in cui finirebbe (al più la fine del film).
  - 1 s è la precisione dei confini: la ricerca si ferma con l'intervallo sotto 1 s (§4.6), quindi un tratto misurato oltre 1 s c'è davvero. Un tratto più corto non conta. Un'intro diversa può invece sfuggire se il confine cade dentro di lei, fino a una finestra breve (2 s, §4.6).
  - Un tratto muto all'inizio o alla fine resta fuori dal materiale in comune (§4.6) e conta come diverso: dal silenzio non si può sapere.
- **Tagli.** All'inizio sull'inizio del film, oppure sul confine iniziale con `--edge-mismatch drop`. Alla fine sulla fine del video con `--tail trim`, oppure sul confine finale con `--edge-mismatch drop`. Lo stesso taglio vale per tutte le tracce italiane, audio e PGS (§6.1).
- **Eccesso in coda sotto 1 s:** non conta. Si lascia, senza scelta né avviso: è l'ultimo pacchetto audio oltre l'ultimo fotogramma.
- **`--tail` con code diverse.** Con `--edge-mismatch drop` non serve: il taglio cade sul confine, prima della fine del video. Con `keep` l'italiano resta sulla coda diversa fino alla fine del video, e oltre lo decide `--tail`.
- **Partenza brusca.** Per ogni traccia italiana tagliata all'inizio si misura il livello nei 250 ms dopo il taglio: il più alto tra il canale centrale (se la traccia lo ha) e L+R, letti come in §4.3 e con la sua energia. Oltre −40 dBFS (`abruptStartDbfs`, **provvisorio**, §9.2) scatta `ABRUPT_START`. Si legge una volta per ogni punto di taglio possibile (inizio del film e confine iniziale), con tutte le tracce che vi verrebbero tagliate: così l'effetto di `--edge-mismatch` è noto anche prima della scelta.
- **Buco lungo senza italiano:** dall'inizio del film all'inizio dell'italiano, o dalla fine dell'italiano alla fine del film, oltre 10 minuti (`longGapWithoutItalianMs`, **provvisorio**). Un avviso per estremo.
- **Costanti del metodo:** la precisione di 1 s e il tratto di 250 ms, in `src/plan.ts` (§9.2).

---

## 6. Costruzione del file finale

Si usa mkvmerge, sempre in modalità `--gui-mode` per leggerne l'avanzamento e gli avvisi, come fa Wayfinderr. ffmpeg serve solo per la coda delle tracce FLAC, che mkvmerge non sa dividere (§6.1), e sempre senza ricodificare.

**Strumenti:**
- mkvtoolnix **almeno v57**, la prima versione che gestisce correttamente Dolby Vision;
- ffmpeg/ffprobe per l'analisi; nella costruzione ffprobe legge i pacchetti nei punti di taglio e ffmpeg taglia la coda delle tracce FLAC;
- versioni fissate nell'immagine e scritte nel report.

### 6.1 File intermedio con le sole tracce italiane

Prima si costruisce un file che contiene **solo** l'audio e i PGS italiani del donatore. Lo spostamento (`--sync`) si applica qui, e soltanto qui.

- **Taglio iniziale (S < 0).** mkvmerge scarta interi tutti i pacchetti che iniziano prima dello zero, compreso quello a cavallo dello zero: si perdono fino a circa 32 ms in più per AC3 ed E-AC3, 10,7 ms per DTS, 85–96 ms per FLAC. Il resto della traccia non si sposta di nulla.
- **TrueHD con S < 0.** TrueHD si può decodificare solo a partire da un punto di sincronizzazione completo, che sui Blu-ray può arrivare fino a circa ogni 107 ms. mkvmerge non sposta il taglio su quel punto.

  Il risultato è che la decodifica con ffmpeg, se non riempie i piccoli buchi nei timestamp, suona **tutta** la traccia in anticipo, fino a circa 107 ms (nelle prove 50–67 ms). Lettori e transcoder basati su ffmpeg probabilmente fanno lo stesso: va provato in fase 1.

  **Regola:** si taglia sul primo punto di sincronizzazione t dopo |S|, nel donatore. Una prima passata sposta la traccia di −t, così t cade sullo zero e mkvmerge scarta solo quello che viene prima; una seconda la sposta di S + t, cioè della differenza t − |S| (tra 0 e circa 107 ms). Anche questo fa parte della costruzione dell'intermedio. Così si perdono al massimo circa 107 ms di italiano all'inizio, e nelle prove l'errore è tornato a zero. Fino alla 0.8 il taglio era `--split parts:t-`, che dà lo stesso risultato ma non vale per un taglio fuori dallo zero né insieme a una traccia FLAC (0.9, §18).
- **Taglio finale (se si toglie l'eccesso, `--tail trim`):** `--split parts:` sull'intermedio, alla fine del video di riferimento. Il taglio cade sul primo pacchetto dopo il punto scelto, quindi può superarlo al massimo di un pacchetto.
  - Su un file che contiene anche il video il taglio **non funziona**: mkvmerge divide solo sui fotogrammi chiave del video.
  - **mkvmerge non sa dividere le tracce FLAC.** Per FLAC le alternative sono un remux con ffmpeg (`-c copy -copyts -to <fine>`, che non ricodifica) oppure lasciare sempre l'eccesso. Senza `-copyts` ffmpeg riporta la traccia a zero e perde lo spostamento già applicato (lo stesso problema di §4.3).
  - `--stop-after-video-ends` taglierebbe in un solo passaggio, ma taglia anche le code delle tracce del riferimento. Non si usa.

### 6.2 Unione finale

- Il **riferimento è il primo ingresso**: da lì vengono titolo, capitoli e tag.
- Dal donatore (l'intermedio) **niente capitoli e niente tag**. mkvmerge altrimenti unisce i capitoli dei due file, e quelli del donatore non vengono spostati da `--sync`.
- **Ordine delle tracce esplicito** (`--track-order`):
  1. video del riferimento;
  2. audio: italiano principale, poi le altre tracce italiane (§8), poi le tracce audio del riferimento;
  3. sottotitoli: PGS italiani forced, poi PGS italiani completi, poi quelli del riferimento;
  4. capitoli: quelli del riferimento.
- **Flag "default" esplicito per OGNI traccia.** Altrimenti mkvmerge tiene i flag di origine, e la traccia inglese del riferimento resta predefinita accanto a quella italiana. Il flag vale 1 solo per:
  - l'audio italiano principale;
  - il PGS italiano forced, se esiste.

  Vale 0 per tutte le altre tracce, compresi l'inglese e i forced del riferimento. Se non c'è un forced italiano, **nessun sottotitolo è predefinito**: un PGS completo predefinito sottotitolerebbe tutto il doppiaggio.
- **Flag "forced" esplicito**: è il flag della traccia Matroska. Quello interno al flusso PGS non si tocca.
- **Compressione dei PGS come nell'originale.** Per default mkvmerge comprime i PGS con zlib, e alcuni lettori lo gestiscono male. Si passa `--compression <traccia>:none` per ogni PGS che nell'originale non era compresso.
- Video, HDR e Dolby Vision del riferimento restano invariati, e la verifica lo controlla (§9.5).

### 6.3 Esito di mkvmerge

| Codice di uscita | Significato | Cosa fa Dyadrr |
|---|---|---|
| 0 | Riuscito | Verifica |
| 1 | Riuscito con avvisi ("il file potrebbe essere a posto o no") | Accetta, copia ogni avviso nel report (`MKVMERGE_WARNING`) e verifica comunque |
| 2 | Fallito | Errore `MERGE_FAILED`, il file temporaneo viene eliminato |

Nella 0.9:
- vale per ogni passata di mkvmerge, intermedi compresi: un `MKVMERGE_WARNING` per avviso;
- anche un crash (il processo finisce per un segnale) è `MERGE_FAILED`, e così ffmpeg che fallisce nel taglio delle FLAC;
- un errore che dice che il disco è pieno ("No space left on device") è invece `NO_SPACE`: riprovabile, come lo spazio che manca prima di cominciare (§12, §13).

### 6.4 File temporanei e nome del file finale

- **Uscita esplicita.** Il file finale si indica con `--output`. Se esiste già, o se è uno dei due ingressi (stesso file fisico), Dyadrr si ferma con l'errore `OUTPUT_EXISTS`. Nessuna opzione di sovrascrittura.
- **Un file finale che c'è già (0.13).** Da riga di comando, in un terminale (stdin e stderr, senza `--progress json`, §10), Dyadrr chiede se cancellarlo e andare avanti; con "no", o senza terminale, `OUTPUT_EXISTS` come prima. È la stessa domanda che in Wayfinderr fa la GUI (decisione 5, §15).
  - Si chiede prima di leggere gli ingressi, ma il file **si cancella solo in `commitBuild`**, dopo che il nuovo file è costruito e verificato, subito prima del link fisico. Se il merge fallisce, è rifiutato o annullato, il file vecchio resta.
  - Si cancella solo se è ancora lui (disco, inode, dimensione e data di modifica come alla domanda); altrimenti `OUTPUT_EXISTS`.
  - Mai un file che è anche un ingresso, il report di `--expect` o il report (stesso file fisico): lì non si chiede nemmeno. Né una cartella o un link: si chiede solo per un file normale.
  - Il report lo dice in `output.build` (`replace`, `replaced`).
- **File temporanei** in una cartella che inizia con un punto, **sullo stesso disco** del file finale (per esempio `<cartella>/.dyadrr/<lavoro>/`). Due motivi:
  - il watcher di Wayfinderr ignora i percorsi in cui una cartella o il nome del file inizia con un punto (e i nomi con `~tmp`), mentre carica qualsiasi altro `.mkv` stabile da 30 s;
  - un rename tra dischi diversi fallisce.
- **Rinomina atomica** al nome finale solo dopo la verifica.
- **Avanzi di un'interruzione brusca:** restano solo nella cartella temporanea, e si eliminano all'avvio successivo.

**Il metodo (0.9).**
- **Cartella di lavoro:** `<temporanei>/job-<host>-<processo>-<casuale>/`. All'avvio si eliminano quelle di questo host il cui processo non c'è più, e quelle con il numero del processo nuovo che non ha creato lui: in un container un processo riparte spesso con lo stesso numero. Quelle di un altro host, cioè di un altro container sulla stessa cartella, restano.
- **`--temp-dir`:** basta che una cartella del percorso inizi con un punto. Lo stesso disco si controlla sulla cartella, o sulla prima che esiste risalendo il percorso, prima di crearla.
- **Rinomina:** con un link fisico, che non sovrascrive mai: se nel frattempo il file finale è comparso, `OUTPUT_EXISTS`. Su un filesystem senza link fisici, una rinomina dopo aver controllato che il nome sia libero. Poi si eliminano la cartella di lavoro e, se resta vuota, `.dyadrr/`.
- **Cartella di uscita** mancante o non scrivibile: `OUTPUT_NOT_WRITABLE`, prima di scrivere qualsiasi cosa.

### 6.5 Metodo della costruzione (0.9)

- **Tagli al millisecondo.** I punti di taglio del piano (§5) si arrotondano al ms: `--sync` e `--split` vogliono interi.
- **Taglio iniziale in c**, sulla linea del tempo del riferimento (l'inizio del film o il confine iniziale, §5): due passate di `--sync`. La prima sposta ogni traccia di S − c, così c cade sullo zero e mkvmerge scarta i pacchetti che cominciano prima; la seconda la sposta di c. Vale per tutti i codec, FLAC compreso, e per i PGS. Con c = 0 la seconda passata serve solo per TrueHD. Una traccia che comincia dopo c non perde niente. Senza taglio iniziale c'è una sola passata, di S.
- **TrueHD** (§6.1): la prima passata porta a zero il primo punto di sincronizzazione dal taglio in poi. Il punto si riconosce dai dati, un pacchetto con la firma `F8 72 6F BA` (major sync) nei byte 4–7, letto con ffprobe entro 1 s dal taglio; il primo che si legge non conta, perché dopo una ricerca ffmpeg gli dà il tempo dei pacchetti che lo precedono. mkvmerge segna questi pacchetti come fotogrammi chiave, ma la firma vale anche per i file di altri programmi. Senza un punto entro 1 s: `INPUT_UNREADABLE`.
- **Taglio finale in e:** `--split parts:00:00:00-e` sull'intermedio, che tiene i timestamp e taglia sul primo pacchetto da e in poi, escluso. Per TrueHD sul primo punto di sincronizzazione da e in poi, perché mkvmerge divide solo sui fotogrammi chiave, che per TrueHD sono i punti di sincronizzazione: la traccia può finire fino a circa 107 ms dopo e (0.10, §18). Le tracce FLAC vanno in un file a parte, con `ffmpeg -copyts -c copy -to e`. Un PGS con un sottotitolo a schermo in e, se e cade prima della fine del video, si taglia all'inizio di quel sottotitolo (§7). Ogni punto di taglio diverso è un file.
- **Intermedi:** senza video, capitoli, tag, allegati e titolo, con le tracce nell'ordine finale. `--compression <traccia>:none` si ripete a ogni passata per i PGS non compressi nell'originale, perché ogni passata di mkvmerge li comprimerebbe. Ogni file si elimina appena non serve più.
- **Unione finale** (§6.2): gli intermedi con `--no-chapters --no-global-tags --no-track-tags --no-attachments`; `--default-track-flag` e `--forced-display-flag` per ogni traccia.
  - Default: la traccia video principale del riferimento, l'audio italiano principale e il primo PGS italiano forced che non sia un commento. Le altre tracce video, se ci sono, no.
  - Forced: i PGS italiani riconosciuti come forced (§7), anche senza il flag nell'originale; per tutte le altre tracce il flag dell'originale.
  - I PGS italiani del riferimento scartati con `--reference-italian-subs drop` si tolgono con `--subtitle-tracks !<tracce>`.
- **mkvmerge** sempre con `--gui-mode` e `--flush-on-close` e con `LC_ALL=C.UTF-8`, come Wayfinderr: l'avanzamento viene dalle righe `#GUI#progress`, avvisi ed errori da `#GUI#warning` e `#GUI#error`.
- **Prima di scrivere** (§9.4): scelte (`CHOICE_REQUIRED`), file finale (`OUTPUT_EXISTS`, `OUTPUT_NOT_WRITABLE`), cartella dei temporanei (`BAD_ARGUMENTS`), ingressi cambiati dall'analisi (`INPUT_BUSY`), spazio libero (`NO_SPACE`, §13).
- **Annullamento** (§10): mkvmerge e ffmpeg ricevono SIGTERM e la cartella di lavoro si elimina.
- **Risultato:** ogni traccia del file finale, in ordine, con origine, lingua, nome, flag e compressione, e per l'audio italiano inizio e fine attesi; i tagli, i sottotitoli persi e i comandi eseguiti con i loro avvisi. Servono alle verifiche (§9.5) e al report (§11.2, punto 8). Il file resta nella cartella di lavoro finché le verifiche non lo approvano.
- **Costanti del metodo:** il margine di spazio (2 GiB), la ricerca del punto di sincronizzazione TrueHD (1 s) e quanto si guarda indietro per un sottotitolo a schermo (30 s), in `src/build.ts` (§9.2).

---

## 7. Sottotitoli PGS

- **Spostamento:** sono immagini con un tempo associato, quindi lo stesso S li allinea senza toccarli.
- **Al taglio iniziale:**
  - un sottotitolo che è a schermo nel punto di taglio **si perde del tutto**, non viene accorciato;
  - possono restare pezzi orfani del sottotitolo tagliato, che i decoder scartano.

  Il report conta i sottotitoli persi. Ripararli vorrebbe dire modificare i PGS, che è fuori ambito.
- **Al taglio finale** (0.9): un sottotitolo a schermo nel punto di taglio perde il blocco che lo toglie, e resterebbe a schermo fino alla fine del video.
  - Se il taglio cade sulla fine del video (`--tail trim`) non conta: finisce con il video.
  - Se cade prima (code diverse con `--edge-mismatch drop`), quel sottotitolo si toglie tutto e si conta tra i persi.
- **Conteggio:** un sottotitolo è almeno due blocchi (uno che lo mostra e uno che lo toglie). Il report conta i **sottotitoli**, non i blocchi.
- **Geometria:** i PGS sono disegnati su una tela 1920×1080, anche sui dischi UHD. Un PGS italiano da un 1080p sopra un video 2160p viene scalato dal lettore.
- **Luminosità su HDR.** I PGS di un Blu-ray SDR sono pensati per SDR. Sopra un video HDR10 o Dolby Vision alcuni lettori li mostrano **molto più luminosi** del dovuto. Gli strumenti che lo correggono riscrivono la palette, cosa che P1 vieta.
  - Dyadrr non li tocca, e avvisa con `SDR_SUBS_ON_HDR`.
  - La soluzione sta nelle impostazioni del lettore (opacità, colore, luminosità dei sottotitoli).
  - Va verificato in fase 1 sui lettori che usi davvero.
- **Riconoscere i forced.** Il flag "forced" di Matroska c'è solo se il ripper lo ha messo:
  - MakeMKV lo mette solo sulla traccia "solo forzati" che ricava da una traccia completa;
  - una traccia "forzati" dedicata sul disco di solito arriva senza flag.

  Una traccia italiana si considera forced se vale almeno una di queste condizioni:
  - ha il flag;
  - il nome contiene "forced" o "forzati";
  - ha molti meno blocchi della traccia italiana più grande: meno del 15% (`forcedSubsFraction`, **provvisorio**, §9.2; lo studio 0.7 diceva "per esempio il 10–20%, da tarare"). I blocchi si contano dai tag statistici (`NUMBER_OF_FRAMES`); contare i sottotitoli veri vorrebbe dire leggere tutto il file, decine di GB. Nel report il numero di sottotitoli è una stima, salvo quelli persi ai tagli.

  Il report indica come è stata classificata e perché.
- **PGS italiani già nel riferimento:** si tengono dopo quelli del donatore e mai predefiniti, oppure si scartano. È una scelta dell'utente (`--reference-italian-subs`, §10.1). In entrambi i casi scatta l'avviso `REFERENCE_HAS_ITALIAN_SUBS`.
- **Sottotitoli italiani non PGS** nel donatore: si scartano con l'avviso `ITALIAN_SUBS_NOT_PGS`.
- **Avviso sui forced mancanti:** `NO_FORCED_ITALIAN_SUBS` scatta solo se il riferimento ha un forced in un'altra lingua (indizio di scritte straniere a schermo) e il donatore non ha un forced italiano. Altrimenti scatterebbe su quasi tutti i film.
- **Caso noto:** alcuni dischi italiani (tipicamente Disney e Pixar) hanno le scritte in italiano direttamente nel video. Su quei dischi possono mancare i forced per quelle scritte, che sul video inglese restano in inglese.

**Il metodo (0.8).**
- **Quali tracce:** tutti i PGS italiani del donatore. Gli altri sottotitoli italiani del donatore si scartano con `ITALIAN_SUBS_NOT_PGS`, un avviso per traccia; quelli non italiani non si prendono.
- **Forced:** il flag, poi il nome ("forced", "forzati"), poi i blocchi, confrontati con la traccia più grande **della stessa lingua**. Senza tag statistici il terzo criterio si salta. Lo stesso vale per i sottotitoli del riferimento: `NO_FORCED_ITALIAN_SUBS` guarda i suoi forced non italiani.
- **`SDR_SUBS_ON_HDR`:** si prende almeno un PGS italiano, il video del donatore è SDR e quello del riferimento no.
- **PGS italiani del riferimento:** le tracce del riferimento in italiano e in PGS. `REFERENCE_HAS_ITALIAN_SUBS` scatta anche con `--reference-italian-subs` in sospeso.

**Sottotitoli persi ai tagli (0.9).** Per ogni PGS preso e ogni taglio si leggono con ffprobe i blocchi dei 30 s prima del punto di taglio. Un sottotitolo è a schermo se, dopo l'ultima composizione che toglie tutto (nessun oggetto), ce n'è una che mostra qualcosa; il suo inizio è la prima di queste. Al più uno per traccia e per taglio. `SUBTITLES_DROPPED_AT_CUT` scatta una volta, con il numero dei sottotitoli persi; il report li elenca con traccia, taglio e inizio. Un sottotitolo che resta a schermo più di 30 s sfugge.

---

## 8. Tracce audio italiane

Quali tracce prendere è una scelta dell'utente (`--italian`, §10.1), che serve solo se il donatore ha più di una traccia audio italiana:

- **`all`:** tutte le tracce audio italiane, nell'ordine del donatore. Non serve indovinare niente e non si perde niente.
- **`main`:** solo la traccia principale, cioè quella che sarebbe predefinita (sotto). Ogni traccia scartata va nel report (`ITALIAN_TRACKS_SKIPPED`).

Queste regole valgono in entrambi i casi:

- **Traccia predefinita (principale):** quella italiana già marcata come predefinita nel donatore; altrimenti la prima traccia audio italiana che non sembri un commento o un'audiodescrizione (sotto); altrimenti la prima traccia audio italiana.
- **Commenti e audiodescrizione:** si riconoscono dai flag commento o non vedenti, o da parole nel nome (commento, audiodescrizione, non vedenti, AD). Questi indizi servono solo a **non** rendere predefinita una traccia, mai a scartarla in silenzio. Nei rip da Blu-ray i flag mancano quasi sempre.
- La stessa logica vale per i PGS italiani di commento.
- **Nel piano (0.8):** ogni traccia audio italiana ha un ruolo stimato (principale, commento o audiodescrizione, altra) con il motivo, e risulta presa o scartata. Con una sola traccia italiana `--italian` non serve. `ITALIAN_TRACKS_SKIPPED` scatta una volta per ogni traccia scartata.

---

## 9. Controlli di sicurezza

### 9.1 Regole fisse, non configurabili

Le soglie decidono cosa conta come "contraddittorio". Se si potessero cambiare a ogni esecuzione, sarebbero di fatto un'opzione "forza comunque". Per questo si dividono in due gruppi.

| Regola | Valore |
|---|---|
| Audio italiano in uno solo dei due file | obbligatorio |
| Lingua di misura in comune | obbligatoria |
| Video del donatore non chiaramente migliore | obbligatorio (§3.2) |
| Ingressi integri | obbligatorio |
| Punti contraddittori o senza corrispondenza | **zero**, sempre |
| Tolleranza per punto | mai oltre 30 ms (meno di un fotogramma fino a 30 fps) |
| Deriva totale sul tratto verificato | mai oltre la tolleranza per punto |
| Spostamento massimo | mai oltre 300 s |

### 9.2 Parametri di taratura

Hanno limiti fissi. Stanno in un file di configurazione versionato (`src/calibration.json`), deciso con la fase 1, e **non** si cambiano a ogni esecuzione: non c'è né un'opzione né una variabile d'ambiente per farlo. I limiti stanno nel codice e non superano mai le regole di §9.1. Un valore fuori dai limiti è un errore di utilizzo (`BAD_ARGUMENTS`). Il report registra sempre la versione del file, i valori usati e quali sono provvisori. L'elenco completo, con le chiavi del file, è in `docs/TARATURA.md`.

I valori **provvisori** sono fissati prima della taratura sulle coppie reali (§15, fase 1, punto 3) e restano tali fino alla decisione 12 (§17).

| Parametro | Valore iniziale | Limiti |
|---|---|---|
| Tolleranza per punto | ±10 ms | 1–30 ms |
| θ_ncc, θ_rapporto (ancore e punti) | 0,5 e 1,5, **provvisori** | 0,2–0,99 e 1,05–10 |
| E_min (soglia di "silenzio") | −50 dBFS, **provvisorio** | da −90 a −20 dBFS |
| Lunghezza delle finestre (§4.4–4.7) | 30 s per le ancore; 10 s per punti di conferma, confini e trasferimento, **provvisorio** | 10–120 s; 2–60 s |
| Zona di esclusione (§4.4) | ±25 ms | 5–250 ms |
| Punti di conferma (§4.5) | 30, fino a 60 | 10–100 e 10–200, interi; il massimo non sotto i punti previsti, né sotto i punti coerenti richiesti da §9.3 |
| Margine dell'intervallo di ricerca, ±(S_max + margine) (§4.4) | 60 s | 1–120 s |
| Copertura dei punti coerenti (§9.3) | almeno 20 punti coerenti, buco massimo 15 min, un punto nel primo e nell'ultimo 10%, copertura 90% | 10–60 punti (intero), 1–30 min, 2–25%, 50–100% |
| Soglie degli avvisi | `MANY_INCONCLUSIVE` 10%; `MEASURE_MIX_DIFFERS` per una somiglianza sotto θ_ncc + 0,1 (fascia **provvisoria**); `LONG_GAP_WITHOUT_ITALIAN` 10 min, **provvisorio**; `ABRUPT_START` sopra −40 dBFS dopo il taglio, **provvisorio** (§5) | 1–50%; fascia 0–0,5; 1–30 min; da −70 a −10 dBFS |
| Altre soglie | margine di bitrate 20% (§3.2), forced sotto il 15% dei blocchi della traccia più grande della stessa lingua, **provvisorio** (§7) | bitrate 5–100%; forced 1–50% (una traccia con metà dei blocchi non è "solo forzati") |
| Spostamento massimo S_max | 180 s | 1–300 s |
| Framerate uguale | differenza relativa sotto 1e-4 (non uguaglianza esatta: 23,976 si può scrivere in modi diversi) | da 1e-6 a 5e-4: sempre sotto 1e-3, la differenza tra 24 e 23,976 |
| Tolleranza del controllo di integrità (§4.8) | 1 s, **provvisoria** | 50 ms – 5 s |
| Finestra di `INPUT_BUSY` (§10) | 30 s, come Wayfinderr | 5 s – 10 min |

I parametri dei moduli non ancora scritti entrano nel file insieme ai moduli che li usano. Il pre-roll e le soglie della lettura delle finestre non sono parametri di taratura ma costanti del metodo (§4.3).

Anche le costanti della correlazione sono costanti del metodo: ricerca vicina ±1 s, rifinitura ±2 ms, banda della correlazione sbiancata, posizioni delle ancore, spostamento sul contenuto (60 s, a passi di 250 ms), finestre brevi (2 s), precisione (1 s) e numero massimo di prove dei confini, ricerche oltre i confini (3 per lato), punti del trasferimento (5), parità tra coppie (0,02) e rapporti della diagnosi di velocità (§4.2, §4.4–4.7). Dicono dove e come cercare, non quando una coppia è idonea; stanno in `src/measure.ts` e si cambiano con una PR che aggiorna questi paragrafi. Lunghezza delle finestre, zona di esclusione, numero di punti e margine di ricerca stanno invece in `calibration.json`: cambiano quanto è severo il giudizio, e vanno tarati con le soglie.

Costanti del metodo sono anche quelle del piano (§5): la precisione sotto la quale intro e code diverse ed eccesso in coda non contano (1 s, quella dei confini) e il tratto su cui si misura il livello dopo un taglio (250 ms). Stanno in `src/plan.ts`.

E quelle della costruzione (§6.5): il margine di spazio libero (2 GiB, §13), la ricerca del punto di sincronizzazione TrueHD dopo un taglio (1 s) e il tratto prima di un taglio in cui si cerca un sottotitolo a schermo (30 s, §7). Stanno in `src/build.ts`.

E quelle delle verifiche dopo il merge (§9.5): le tolleranze "entro un pacchetto" per codec e l'arrotondamento al millisecondo. Dicono quanto può scostarsi un file costruito bene, non quando una coppia è idonea. Stanno in `src/verify.ts`. Il controllo di trasferimento sul file finale usa invece i parametri di quello nel donatore (finestre, θ_ncc, θ_rapporto, tolleranza per punto).

### 9.3 Copertura dei punti coerenti

Il vecchio "80% dei punti" misurava solo quanto del film è muto: aggiungere punti non cambia quella percentuale. La regola nuova chiede che i punti coerenti siano abbastanza e ben distribuiti:

- almeno **20 punti coerenti**;
- nessun buco tra due punti coerenti consecutivi più lungo di circa **15 minuti**;
- almeno un punto coerente nel **primo** e nell'**ultimo 10%** del materiale in comune;
- copertura (§4.6) di almeno il **90%** del video di riferimento (da tarare).

Se la regola non è soddisfatta il merge si rifiuta con `TOO_FEW_CHECKPOINTS` o `LOW_COVERAGE`. L'avviso `MANY_INCONCLUSIVE` scatta quando più del 10% dei punti è non conclusivo ma la regola qui sopra è comunque soddisfatta: sui punti non conclusivi non c'è una soglia di rifiuto propria.

### 9.4 Ordine di valutazione

1. **Controlli strutturali** (lingue, ruoli, video, framerate, integrità): se uno fallisce ci si ferma subito, e i successivi risultano "saltati".
2. **Misura iniziale.**
3. **Punti di conferma:** prima la deriva, poi le contraddizioni, poi i confini del materiale in comune (§4.6) e la copertura; infine il controllo di trasferimento (§4.7), che all'inizio dà solo avvisi.
4. **Solo in modalità merge:** scelte dell'utente (§10.1, `CHOICE_REQUIRED`), confronto con il report di `--expect` (`INPUT_CHANGED`), poi spazio libero.
   - Dalla 0.11 il confronto con `--expect` si fa a pezzi, appena ciascun pezzo si conosce: le impronte subito dopo la lettura degli ingressi, prima di misurare (un file cambiato non vale gigabyte di letture); ruoli e S dopo l'analisi, prima di chiedere le scelte; il piano dopo le scelte (§10).
   - Anche il file finale e la cartella dei temporanei (`OUTPUT_EXISTS`, `OUTPUT_NOT_WRITABLE`, `BAD_ARGUMENTS`) si controllano prima di leggere gli ingressi, e di nuovo prima di scrivere (§6.4).

### 9.5 Verifiche dopo il merge

Prima della rinomina finale si controlla che:
- il **video** sia identico al riferimento: stessi dati di codec, stesso numero di fotogrammi, primo e ultimo timestamp entro un fotogramma, stessi metadati HDR e Dolby Vision;
- **ogni traccia del riferimento** sia presente con lo stesso numero di pacchetti;
- ogni **traccia italiana** inizi e finisca dove previsto dal piano, entro un pacchetto del suo codec. Si leggono i timestamp del contenitore, non quelli di ffprobe: l'inizio da mkvmerge -J (`minimum_timestamp`), la fine dagli ultimi cluster del file (mkvmerge -J non la riporta);
- la **durata del file** = max(fine del riferimento, fine prevista dell'italiano), entro un pacchetto. Se l'eccesso in coda viene lasciato, la fine attesa è quella dell'italiano;
- **ordine, lingue, flag default e forced, compressione** delle tracce e **capitoli** siano esattamente quelli previsti (§6.2);
- il controllo di trasferimento (§4.7) sul file finale, tra italiano e lingua di misura del riferimento, dia uno spostamento circa zero. All'inizio è solo un avviso.

Se una verifica bloccante fallisce, il file temporaneo viene eliminato ed esce l'errore `VERIFY_FAILED`.

**Il metodo (0.10).**
- **Quando:** dopo la costruzione, sul file ancora nella cartella di lavoro (§6.4); se le verifiche bloccanti passano, la rinomina. Se una fallisce, o se il file finale non si riesce a leggere, la cartella di lavoro si elimina ed esce `VERIFY_FAILED` (uscita 40), con l'esito di ogni verifica per il report (§11.2, punto 8).
- **Cosa si legge.** Il file finale come un ingresso (§4.8): tracce da mkvmerge -J, flussi e tag statistici da ffprobe, ultimi cluster; senza l'attesa di `INPUT_BUSY`, perché l'ha appena scritto Dyadrr. In più, del file finale e del riferimento: dati del codec video (CodecPrivate) e titolo da mkvmerge -J; capitoli, metadati del flusso video e side data del primo fotogramma da ffprobe. Niente si legge per intero, salvo il conteggio dei pacchetti quando il riferimento non ha i tag statistici (sotto).
- **Le verifiche**, tutte bloccanti tranne il trasferimento. Si fanno tutte, così il report dice tutto quello che non torna; il trasferimento solo se le altre passano. Se numero o tipi delle tracce non tornano, quelle che confrontano traccia per traccia risultano `skipped`.
  1. **Tracce** (`layout`): numero, ordine, tipo, codec, lingua, nome, flag default e forced e compressione dei PGS esattamente come nel risultato della costruzione (§6.5). Le tracce del riferimento sono tutte, tranne i PGS italiani scartati con `--reference-italian-subs drop`. Titolo e capitoli sono quelli del riferimento: stessi inizi e titoli. Gli UID dei capitoli no: mkvmerge può generarne di nuovi, ed è successo nel merge di un UHD rippato con MakeMKV; in un film senza capitoli ordinati nessuno li usa. La fine di un capitolo non si confronta: se il file non la scrive, ffprobe la ricava dalla durata del file, che con l'eccesso in coda cambia.
  2. **Video** (`video`): stessi dati del codec; stessi metadati del flusso secondo ffprobe (codec, profilo, livello, dimensioni, formato dei pixel, colore e curva, framerate, side data come la configurazione Dolby Vision) e del primo fotogramma (HDR10, HDR10+); stesso livello HDR e profilo Dolby Vision (§3.2); stesso numero di fotogrammi; primo e ultimo timestamp entro un fotogramma (1000/fps ms).
  3. **Tracce del riferimento** (`reference-tracks`): lo stesso numero di pacchetti. Viene dai tag statistici (`NUMBER_OF_FRAMES`), che mkvmerge riscrive nel file finale contando i pacchetti. Se una traccia del riferimento non li ha, si contano i pacchetti dei due file con ffprobe (`-count_packets`), che li legge per intero: costa una lettura in più, ma un riferimento senza tag statistici è raro.
  4. **Italiano** (`italian-tracks`): ogni traccia audio italiana inizia e finisce dove previsto dalla costruzione, entro la tolleranza del suo codec. L'inizio è il `minimum_timestamp` di mkvmerge -J; la fine quella letta negli ultimi cluster, o, se la traccia finisce prima del tratto letto, quella dei tag statistici che mkvmerge ha appena scritto. Per i PGS non si verifica: dipende da dove cadono i sottotitoli.
  5. **Durata** (`duration`): la fine più alta negli ultimi cluster e la durata dichiarata (contata dal primo timestamp del file o da zero, come in §4.8) cadono tra la più alta delle fini del riferimento e delle fini previste dell'italiano meno la tolleranza, e la più alta delle stesse fini più la tolleranza, con 1 ms di arrotondamento. La fine del riferimento è la più alta delle sue tracce tenute negli ultimi cluster.
  6. **Trasferimento** (`transfer`, solo avvisi): come §4.7, ma nel file finale e senza spostamento: 5 punti al centro di 5 intervalli uguali del materiale in comune, ristretto al tratto in cui c'è l'italiano principale; la traccia della lingua di misura del riferimento usata nella misura (la coppia scelta, §4.2) contro l'italiano principale, con lo stesso segnale (L+R o (L − R)/2), la ricerca vicina (±1 s) e la lunghezza delle finestre dei punti di conferma; la mediana dei picchi sicuri. Oltre la tolleranza per punto scatta `OUTPUT_TRANSFER_OFFSET` con il valore: S è sbagliato di tanto, oppure l'italiano era già sfasato nel donatore (`ITALIAN_TRANSFER_OFFSET`). Nessun picco sicuro: `OUTPUT_TRANSFER_UNVERIFIED`. Diventano bloccanti solo se la fase 1 li dimostra affidabili, come quelli di §4.7.
- **"Entro un pacchetto" (tolleranze).** Il tratto più lungo che un taglio può togliere o lasciare a una traccia, più 1 ms per l'arrotondamento dei timestamp di Matroska:

  | Codec | Tolleranza | Perché |
  |---|---|---|
  | AC-3, E-AC-3 | 32 ms | 1536 campioni a 48 kHz |
  | DTS (anche HD e X) | 11 ms | 512 campioni a 48 kHz |
  | TrueHD | 107 ms | All'inizio la costruzione taglia su un punto di sincronizzazione ed è esatta; alla fine mkvmerge divide solo sui punti di sincronizzazione, che sui Blu-ray possono distare fino a circa 107 ms (§6.5, §18) |
  | FLAC | 96 ms | Blocchi fino a 4608 campioni a 48 kHz (§6.1) |
  | Altri (AAC, Opus, PCM…) | 100 ms | Nessun pacchetto audio comune dura di più |

  Una traccia senza taglio non si sposta di nulla; una tagliata comincia dopo il taglio e finisce intorno al taglio finale, al più di un pacchetto (§6.1, §6.5). Una tolleranza più stretta darebbe `VERIFY_FAILED` falsi; una più larga non nasconde gli errori che contano, che sono di secondi o di uno S sbagliato, e uno S sbagliato lo cerca il trasferimento.
- **Costanti del metodo:** le tolleranze per codec e l'arrotondamento, in `src/verify.ts` (§9.2).
- **Da verificare sui rip di MakeMKV** (fase 1): che i tag statistici del riferimento contino davvero i pacchetti, e la dimensione dei blocchi FLAC.

### 9.6 Regole della decisione

La decisione è una **funzione pura**: riceve i fatti dei due file e le misure, più la taratura, e restituisce decisione, controlli, motivi e avvisi. Non legge file e non lancia programmi, così si prova con serie sintetiche (§15, 1e).

**Ordine e arresto**
- I controlli seguono §9.4: ruoli, lingua di misura, video, framerate, integrità; poi ancore (corrispondenza, spostamento massimo, accordo tra le ancore); poi deriva, contraddizioni, punti senza corrispondenza, confini, distribuzione dei punti, copertura; infine il controllo di trasferimento.
- Il **primo controllo bloccante che fallisce ferma tutto**, anche nelle fasi di misura: il report ha un solo motivo e i controlli successivi risultano `skipped`. Le misure di una fase servono solo se le precedenti sono passate; se mancano quando servono è `INTERNAL`.
- Il controllo di trasferimento non è bloccante: dà solo avvisi (§4.7).

**Picchi**
- Un picco è **sicuro** se la somiglianza (NCC) è almeno θ_ncc e l'unicità (rapporto) almeno θ_rapporto. È **somigliante ma non unico** se supera solo θ_ncc.

**Ancore (§4.4)**
- L'ancora accettata è la prima sicura nell'ordine di misura. **Ogni** altra ancora sicura deve dare lo stesso S entro la tolleranza, altrimenti `CHECKPOINT_CONTRADICTION`.
- Senza ancore sicure: `AMBIGUOUS_MATCH` se almeno un'ancora è somigliante ma non unica; altrimenti `FPS_MISMATCH` o `PAL_SPEEDUP` se la diagnosi di velocità ha trovato un rapporto; altrimenti `NO_MATCH`.
- Il rapporto della diagnosi si attribuisce al più vicino tra 1,001 (`FPS_MISMATCH`) e 25/24 o 25/23,976 (`PAL_SPEEDUP`), in un verso o nell'altro.
- `OFFSET_TOO_LARGE` si controlla sull'ancora accettata, prima dell'accordo tra le ancore.
- `MEASURE_MIX_DIFFERS` scatta se la somiglianza dell'ancora accettata è sotto θ_ncc + la fascia.

**Punti di conferma (§4.5)**
- Energia sotto E_min: **non conclusivo**, anche se c'è un picco.
- Altrimenti si usa il picco sicuro della ricerca vicina a S o, se manca, quello della ricerca su tutto l'intervallo. Entro la tolleranza dallo S dell'ancora accettata: **coerente**; altrove: **contraddittorio**; nessun picco sicuro: **senza corrispondenza**.
- **S definitivo** = mediana dei punti coerenti, arrotondata all'intero una sola volta, alla fine. La dispersione è la deviazione assoluta mediana.

**Deriva**
- Retta robusta di Theil–Sen sui punti con un picco sicuro (coerenti e contraddittori), se sono almeno 3. La deriva totale si misura sul tratto che va dal primo all'ultimo di questi punti.
- `DRIFT` se la retta spiega **tutti** quei punti entro la tolleranza e la deriva totale supera la tolleranza. Se la retta non li spiega (un salto, rumore), la deriva non c'entra e decidono le contraddizioni. Così una tendenza lineare dà `DRIFT` anche quando molti punti risultano contraddittori rispetto all'ancora, e un salto non viene scambiato per una deriva.

**Contraddizioni e confini**
- Prima i punti contraddittori (`CHECKPOINT_CONTRADICTION`), poi quelli senza corrispondenza (`CHECKPOINT_UNMATCHED`): per entrambi la soglia è zero (§9.1).
- **Forma:** i punti con un picco sicuro, in ordine di posizione, si dividono in tratti a spostamento costante (entro la tolleranza dal primo punto del tratto). Due tratti sono **un salto**; più tratti, tutti di almeno due punti, sono **più salti**; altrimenti è **rumore**. Ogni salto ha posizione, ampiezza in ms e in fotogrammi del riferimento.
- Un picco sicuro prima del confine iniziale o oltre quello finale, a uno spostamento diverso da S oltre la tolleranza, vuol dire che il film continua a un altro spostamento: `CHECKPOINT_CONTRADICTION` (§4.6).

**Video (§3.2)**
- "Risoluzione più alta" vuol dire più pixel (larghezza × altezza). A parità di pixel conta il livello HDR.
- L'avviso sul bitrate scatta solo se è il **donatore** ad avere il bitrate più alto oltre il margine; se un bitrate manca, il controllo lo riporta come criterio saltato.

**Controllo di trasferimento (§4.7)**
- Si usa la mediana dei picchi sicuri. Nessun picco sicuro: `ITALIAN_UNVERIFIED`. Mediana oltre la tolleranza: `ITALIAN_TRANSFER_OFFSET`, con il valore.
- Per ora usa le stesse θ_ncc e θ_rapporto delle ancore. Se la fase 1 mostra che sui canali non centrali servono soglie diverse, diventeranno parametri propri.

---

## 10. Interfaccia a riga di comando

**Comandi:** `dyadrr analyze` e `dyadrr merge`.

**Parametri:**
- due file MKV in ingresso, senza ruoli (li decide Dyadrr);
- `--output` (file finale, solo per merge);
- `--report` (percorso del report);
- `--original-language <codice>` (lingua originale del film, facoltativa, §3.3);
- le quattro scelte dell'utente: `--tail`, `--italian`, `--reference-italian-subs`, `--edge-mismatch` (§10.1);
- `--inputs keep|delete` (solo merge: cosa fare dei due ingressi dopo un merge riuscito, §10.2);
- `--temp-dir` (cartella temporanea; per default `.dyadrr/` accanto al file finale; deve stare sullo stesso disco del file finale e in una cartella che inizia con un punto, altrimenti `BAD_ARGUMENTS`, §6.4);
- `--expect <report di analyze>`;
- `--progress json`.

**Modalità:**
- **analyze:** misura e controlli, solo report, nessun MKV scritto.
- **merge:** analisi, scrittura, verifica.
  - Con `--expect`, il merge controlla che ingressi (impronte, §11.2), ruoli, S e piano coincidano con quelli dell'analisi confermata. Altrimenti esce con `INPUT_CHANGED`. Così il merge esegue esattamente il piano che hai approvato.
- **In entrambe le modalità**, se un ingresso è stato modificato negli ultimi secondi Dyadrr si ferma con l'errore riprovabile `INPUT_BUSY`: MakeMKV scrive lentamente, e analizzare un file a metà non serve.
  - La finestra è un parametro di taratura (`inputBusyMs`, §9.2): 30 s, come la stabilità che Wayfinderr aspetta prima di prendere un file (§19).
  - Una data di modifica nel futuro conta come recente: meglio un errore riprovabile che analizzare un file forse ancora in scrittura.
  - È `INPUT_BUSY` anche un file che cambia dimensione o data di modifica mentre Dyadrr ne legge i metadati.

**Interruzione:**
- Con un segnale di stop (o un file di annullamento in Wayfinderr), Dyadrr termina mkvmerge e ffmpeg, elimina i temporanei e scrive un report con esito "annullato".
- Dopo un'interruzione brusca (SIGKILL, mancanza di corrente) non può fare pulizia, ma gli avanzi stanno solo nella cartella temporanea (§6.4).
- Nell'immagine Docker serve un piccolo init: un processo Node con PID 1 altrimenti ignora l'arresto normale e viene ucciso dopo 10 s. L'immagine ha il suo (tini, §14.2).

**Ingressi:** Dyadrr parte da **due MKV già rippati**, non dai dischi. Il ripping resta compito di MakeMKV o di Wayfinderr.

**Il metodo (0.11).**
- **Argomenti.** `dyadrr <analyze|merge> <a.mkv> <b.mkv> [opzioni]`, opzioni nella forma `--nome valore` o `--nome=valore`. Sono `BAD_ARGUMENTS`: un comando sconosciuto, un numero di file diverso da due, un'opzione sconosciuta o senza valore, un'opzione ripetuta, `--output`, `--temp-dir` o `--expect` con `analyze`, `merge` senza `--output`, `--progress` con un valore diverso da `json`. `--help` e `--version` scrivono su stdout ed escono con 0, senza report: non sono un'analisi.
- **Il report** si scrive sempre, anche per `BAD_ARGUMENTS`: chi chiama decide solo da lì (§11.1). Le sole eccezioni sono i due casi qui sotto in cui non si può scrivere.
  - Il percorso è `--report`; senza, `dyadrr-<modalità>-<AAAAMMGG>T<HHMMSS>Z.json` nella cartella corrente, con l'ora UTC (`dyadrr-report-…` se il comando non si riconosce).
  - Non può coincidere con un ingresso, con il file finale o con il report di `--expect`: è `BAD_ARGUMENTS`, ma senza report, perché scriverlo sostituirebbe quel file. Il messaggio va su stderr, l'uscita è 30. Un report che esiste già si sostituisce.
  - Si scrive accanto con un nome che inizia con un punto, ignorato dal watcher di Wayfinderr, e poi si rinomina.
  - Se la sua cartella manca o non è scrivibile, nessun report si può scrivere: Dyadrr lo dice su stderr ed esce con 30 prima di leggere gli ingressi, senza niente su stdout.
- **Ordine nel merge:** argomenti, programmi esterni (§13), file finale e cartella dei temporanei, report di `--expect`, ingressi, impronte, analisi, ruoli e S, scelte, piano, costruzione (con lo spazio libero), verifiche, rinomina (§9.4).
- **Le scelte** (§10.1) si chiedono solo se stdin e stderr sono un terminale e non c'è `--progress json` (chi legge righe JSON è un programma, e la domanda le romperebbe). La domanda va su stderr, con l'effetto di ogni valore.
  - Prima `--edge-mismatch`, poi `--tail`, `--italian` e `--reference-italian-subs`. Dopo ogni risposta il piano si ricalcola: una scelta cambia l'effetto delle altre e può renderne una non necessaria (`--tail` con `--edge-mismatch drop`).
  - Una risposta che non è uno dei valori si richiede; la fine dell'ingresso (Ctrl-D) è `CHOICE_REQUIRED`. L'origine nel report è `prompt`.
  - `analyze` non chiede mai: elenca le scelte in sospeso, con l'effetto di ogni valore, ed esce con 0.
- **`--expect <report>`:**
  - il report deve essere della stessa versione del formato (§11.3), idoneo, con ingressi, ruoli, S e piano; altrimenti, o se non si legge, è `BAD_ARGUMENTS`;
  - **impronte:** quelle dei due ingressi (dimensione, data di modifica, hash del primo e dell'ultimo MiB) sono quelle del report, in qualsiasi ordine. I percorsi non contano: in Wayfinderr lo stesso file ha percorsi diversi nei due container (§14);
  - **ruoli:** il riferimento ha l'impronta del riferimento del report;
  - **S:** lo S definitivo è lo stesso;
  - **piano:** è lo stesso, salvo quello che nel report era in sospeso. Le scelte necessarie sono le stesse; una scelta decisa nel report ha lo stesso valore (l'origine può cambiare); ogni valore del piano che nel report non era in sospeso è uguale; quello che lo era è l'effetto, nel report, del valore scelto ora (intervallo dell'italiano, tracce audio prese, PGS del riferimento tenuti);
  - ogni differenza è `INPUT_CHANGED`, e il report le elenca tutte. Versione di Dyadrr e taratura non si confrontano: se cambiano, cambia S o il piano, ed è quello che conta.
- **Annullamento:** SIGINT, SIGTERM o SIGHUP interrompono l'analisi o il merge.
  - mkvmerge, ffmpeg e ffprobe ricevono SIGTERM; la cartella di lavoro si elimina, il file finale non si consegna;
  - il report dice `cancelled`, con il motivo `CANCELLED`, e si esce con 50;
  - un secondo segnale fa uscire subito con 50, senza pulizia né report: gli avanzi stanno solo nella cartella dei temporanei e si eliminano all'avvio successivo (§6.4);
  - un segnale dopo la rinomina arriva tardi: il merge è completo e il report dice `eligible`.

### 10.1 Scelte dell'utente

Alcuni comportamenti non hanno una risposta giusta per tutti: li decide chi usa Dyadrr, non Dyadrr. Ogni scelta si può fare in tre modi, in quest'ordine di precedenza:

1. **opzione da riga di comando**, per il singolo film;
2. **variabile d'ambiente**, come preimpostazione (per esempio nel `docker-compose.yml`);
3. altrimenti la fa **l'utente al momento del merge**.

| Scelta | Opzione | Variabile d'ambiente | Valori | Serve solo se |
|---|---|---|---|---|
| Eccesso italiano in coda (§5, §6.1) | `--tail` | `DYADRR_TAIL` | `trim`, `keep` | il donatore ha più coda del riferimento |
| Tracce audio italiane (§8) | `--italian` | `DYADRR_ITALIAN` | `all`, `main` | il donatore ha più di una traccia audio italiana |
| PGS italiani già nel riferimento (§7) | `--reference-italian-subs` | `DYADRR_REFERENCE_ITALIAN_SUBS` | `keep`, `drop` | il riferimento ha PGS italiani |
| Audio italiano fuori dal materiale in comune: intro o code diverse (§5) | `--edge-mismatch` | `DYADRR_EDGE_MISMATCH` | `drop`, `keep` | intro o code diverse |

**Regole:**
- **Una scelta si chiede solo se serve.** analyze calcola quali scelte servono per quella coppia e, per ognuna, l'effetto di ogni valore (per esempio l'intervallo in cui l'italiano è presente). Nel report, ogni scelta necessaria ha il valore deciso con la sua origine (`option`, `env`, `prompt`) oppure risulta in sospeso.
- **merge con una scelta necessaria e non decisa:**
  - in un terminale interattivo la chiede, mostrando l'effetto di ogni valore;
  - altrimenti (lanciato da Wayfinderr o da uno script) si ferma **prima di scrivere qualsiasi cosa** con l'errore `CHOICE_REQUIRED`, e il report elenca le scelte mancanti.
- Una scelta indicata ma non necessaria si ignora, e il report lo dice.
- Un valore non valido, da opzione o da variabile d'ambiente, è `BAD_ARGUMENTS`.
- Con `--expect`, il piano confrontato è quello che corrisponde alle scelte fatte.
- **L'effetto di ogni valore** (0.8): l'intervallo in cui l'italiano è presente, le tracce audio italiane prese, i PGS italiani del riferimento tenuti e gli avvisi che scatterebbero. Quello che dipende da un'altra scelta in sospeso resta in sospeso.
- **`--tail` e `--edge-mismatch`** (0.8): con code diverse e `--edge-mismatch drop`, `--tail` non serve, perché il taglio cade sul confine, prima della fine del video (§5).
- Con `--edge-mismatch drop` il taglio cade sul confine del materiale in comune, che è noto con circa 1 s di precisione (§4.6). Con `keep` scattano `INTRO_MISMATCH` o `OUTRO_MISMATCH`.

**In Wayfinderr (fase 2)** le stesse quattro scelte diventano impostazioni della GUI, ognuna con un valore fisso oppure "chiedi ogni volta". Wayfinderr passa sempre a Dyadrr le scelte come opzioni, anche quelle preimpostate, così il report registra il valore usato. Con "chiedi ogni volta" la GUI mostra le scelte in sospeso del report di analyze insieme alla conferma del merge.

### 10.2 Gli ingressi dopo il merge (0.12)

Decisione 6 (§17), per la riga di comando. In Wayfinderr la pulizia la fa Wayfinderr (§15, fase 2), che passa sempre `--inputs keep`.

- **`--inputs keep|delete`**, oppure la variabile `DYADRR_INPUTS`, con la stessa precedenza e le stesse regole di validazione delle scelte (§10.1): un valore non valido è `BAD_ARGUMENTS`, una variabile vuota vale come non impostata. Solo per merge: con `analyze` l'opzione è `BAD_ARGUMENTS`, la variabile si ignora.
- **Quando:** solo dopo un merge riuscito, verificato e consegnato. Un rifiuto, un errore o un annullamento non toccano mai gli ingressi.
- **Senza opzione né variabile:** in un terminale (con le stesse condizioni di §10: stdin e stderr terminali, niente `--progress json`) si chiede, con i due percorsi; altrimenti, o alla fine dell'ingresso, gli ingressi **si tengono**. Cancellare non si annulla: serve un consenso esplicito, e uno script non si blocca per questo. Non è una scelta necessaria nel senso di §10.1: non dà mai `CHOICE_REQUIRED`.
- **Cancellare:** ogni ingresso si cancella solo se dimensione e data di modifica sono ancora quelle lette all'inizio; se è cambiato, o la cancellazione fallisce, resta dov'è con l'avviso `INPUT_NOT_DELETED`. La decisione resta `eligible`: il file finale è consegnato.
- **Nel report:** in `output.inputs`, il valore, la sua origine (`option`, `env`, `prompt`, `default`) e i file cancellati.

---

## 11. Il report: il contratto

### 11.1 Forma

- **JSON**, scritto con un nome temporaneo e poi rinominato, così non si legge mai a metà.
- **Su stdout** solo il percorso del report.
- **Avanzamento su stderr**, una riga JSON per evento. Esempi: fase dei punti di conferma con fatti e totali; fase di merge con la percentuale. Fasi: lettura, ancore, punti di conferma, confini, intermedio, merge, verifica.
- **Chi chiama decide solo dal campo `decision` del report.** Un report mancante o illeggibile, o un codice di uscita non documentato, è un errore. Dopo un SIGKILL o un esaurimento di memoria nessun report può essere scritto.
- **Valori in inglese:**
  - decisione: `eligible`, `refused`, `error`, `cancelled` (un merge completato e verificato riporta `eligible`, codice di uscita 0);
  - controlli: `pass`, `fail`, `skipped`;
  - punti: `consistent`, `inconclusive`, `contradictory`, `unmatched`.
- **Tempi:** millisecondi interi sulla linea del tempo del riferimento, salvo dove serve il decimale.
- **Tracce:** identificate con gli ID di mkvmerge -J. ffprobe serve solo per decodificare e per i metadati HDR e Dolby Vision.

### 11.2 Contenuto

1. **Intestazione:**
   - versione del formato e di Dyadrr;
   - versioni di mkvmerge e ffmpeg;
   - modalità, orari e durata;
   - tutti i parametri usati, sia quelli predefiniti sia quelli cambiati.
2. **Ingressi**, per ciascun file:
   - **impronta:** dimensione, data di modifica, hash del primo e dell'ultimo MiB;
   - durata, `start_time`, integrità;
   - **video:** codec, risoluzione, framerate, HDR (SDR, HLG, HDR10, HDR10+, Dolby Vision con profilo), bitrate o "sconosciuto";
   - **ogni traccia:** ID, tipo, lingua, codec e profilo (per esempio Atmos, DTS:X), canali, nome, flag default, forced, commento e non vedenti, primo e ultimo timestamp;
   - **per i PGS:** numero di sottotitoli e compressione;
   - **separatamente:** audio italiano sì o no, sottotitoli italiani sì o no.
3. **Ruoli:**
   - riferimento e donatore, con il motivo;
   - confronto video;
   - lingua originale indicata e lingua di misura scelta;
   - tutte le coppie di tracce provate, con la loro confidenza.
4. **Misura:**
   - ancore provate, ciascuna con posizione, NCC, rapporto ed esito;
   - per ogni punto di conferma: posizione richiesta e reale, livello di energia, spostamento, scarto, NCC, rapporto, esito; dalla 0.15 anche i picchi misurati prima della decisione (ricerca vicina e su tutto l'intervallo), che servono alla taratura (§15, fase 1, punto 3);
   - S definitivo e dispersione;
   - deriva in ms all'ora e in ms totali;
   - forma di un'eventuale contraddizione;
   - confini del materiale in comune, tratto verificato, copertura;
   - controllo di trasferimento;
   - byte letti.
5. **Scelte** (§10.1): per ognuna, se serve, l'effetto di ogni valore, il valore usato e la sua origine, oppure "in sospeso".
6. **Piano:**
   - caso e quantità all'inizio e alla fine;
   - eccesso tolto o lasciato;
   - intervallo in cui l'italiano è presente;
   - sottotitoli persi ai tagli;
   - tracce italiane prese, con ruolo stimato e motivo;
   - classificazione dei forced.
7. **Controlli:** per ognuno nome, esito, valore misurato, soglia. Poi la decisione e l'elenco dei motivi.
8. **Uscita** (solo merge):
   - percorso, dimensione, durata;
   - tracce finali in ordine con lingua, nome e flag;
   - comandi mkvmerge eseguiti e relativi avvisi;
   - esito di ogni verifica (§9.5).
9. **Avvisi**, con codice (§12).

### 11.3 Il metodo (0.11)

- **Versione del formato:** `format`, un intero, oggi **1**. Si alza solo con una modifica incompatibile: un campo tolto o cambiato di significato. Un campo o un evento nuovo non la alza; chi legge ignora quello che non conosce. Le righe di `--progress json` seguono la stessa versione.
- **Campi,** in quest'ordine:
  1. intestazione: `format`, `dyadrr` (la versione), `mode` (`analyze`, `merge`, `null` se il comando non si riconosce), `startedAt` e `finishedAt` (ISO 8601, UTC), `durationMs`, `tools` (versioni di mkvmerge, ffprobe e ffmpeg, `null` se non lette), `arguments` (file, `--output`, `--report`, `--original-language`, `--temp-dir`, `--expect`, `--progress`, scelte da opzione e da variabile d'ambiente), `calibration` (versione, tutti i valori, quali sono provvisori);
  2. `decision` e `reasons`: un solo motivo per un rifiuto, un errore (il codice) o un annullamento (`CANCELLED`); nessuno per una coppia idonea;
  3. `inputs`: i due file nell'ordine in cui sono passati, come li legge Dyadrr (impronta, durate, integrità, video, tracce, italiano sì o no); `null` per un file non letto;
  4. `roles`: indici di riferimento e donatore in `inputs`, con il motivo; il controllo del video; lingua originale e lingua di misura; le coppie di tracce provate;
  5. `measurement`: coppia scelta, ancore con l'esito, diagnosi di velocità, S (dell'ancora, mediana, definitivo, dispersione), deriva, forma della contraddizione, punti di conferma (posizione richiesta e reale, energia, spostamento, scarto, NCC, rapporto, esito; dalla 0.15 i picchi misurati `local` e `wide`), materiale in comune e copertura, ricerche oltre i confini, trasferimento, byte letti; `null` se un controllo strutturale ha già deciso;
  6. `checks`: tutti i controlli della decisione, con esito, valore, soglia e codice;
  7. `choices`: tutte le scelte, con l'effetto di ogni valore per quelle necessarie; `null` senza piano;
  8. `plan`: il piano (§5) senza scelte e avvisi, che stanno in `choices` e `warnings`; `null` per una coppia non idonea. I sottotitoli persi ai tagli si leggono dal donatore nella costruzione (§6.5): stanno in `output`, solo nel merge;
  9. `expect`: percorso del report confrontato, esito e differenze; `null` senza `--expect`;
  10. `output`, solo nel merge: percorso del file finale, se è stato consegnato, dimensione e durata, la costruzione (tagli, tracce finali, sottotitoli persi, spazio, comandi eseguiti con i loro avvisi), le verifiche (§9.5) e, dalla 0.12, cosa si è fatto degli ingressi (§10.2). Dopo `VERIFY_FAILED` ci sono costruzione e verifiche, e il file non è consegnato;
  11. `warnings`: gli avvisi di decisione, piano, costruzione e verifiche in un solo elenco, ognuno con la fase che l'ha dato (`analysis`, `plan`, `build`, `verify`).
- **Numeri:** l'energia di un tratto tutto a zero è −∞, che in JSON si scrive `null`.
- **Avanzamento** (`--progress json`): su stderr, una riga JSON per evento, con `event`, `phase` ed `elapsedMs` (dall'avvio):
  - `{"event":"phase","phase":…}` all'inizio di ogni fase: `read` (ingressi), `anchors`, `edges` (confini), `checkpoints`, `edge-probes` (ricerche oltre i confini), `transfer`, `plan`, `intermediate`, `merge`, `verify`;
  - `{"event":"progress",…}` dentro una fase: `done` e `total` (`null` se non si sa prima) per l'analisi, con i punti per esito (`outcomes`) nei punti di conferma; `step`, `steps` e `percent` (`null` finché mkvmerge non lo dice) per intermedio e merge;
  - `{"event":"end","decision":…,"exitCode":…}` per ultimo, appena scritto il report.
  - Senza `--progress json` stderr ha solo la domanda delle scelte e, alla fine, una riga leggibile con la decisione e il motivo.

---

## 12. Codici

Ogni rifiuto, errore e avviso ha un **codice fisso** più un messaggio leggibile in inglese, come il resto di Wayfinderr.

**Rifiuto: questa coppia non va unita**

| Codice | Significato |
|---|---|
| `NO_ITALIAN_AUDIO` | Nessuno dei due file ha audio italiano |
| `BOTH_ITALIAN_AUDIO` | Entrambi hanno audio italiano: il merge è inutile |
| `NO_COMMON_LANGUAGE` | Nessuna lingua di misura in comune |
| `DONOR_BETTER_VIDEO` | Il video del donatore è chiaramente migliore |
| `FPS_MISMATCH` | Velocità diverse (dai metadati o dalla diagnosi di velocità) |
| `PAL_SPEEDUP` | Velocizzazione PAL, riconosciuta dal rapporto misurato e non dalle durate |
| `NO_MATCH` | Nessuna ancora trova una corrispondenza abbastanza somigliante |
| `AMBIGUOUS_MATCH` | Corrispondenze somiglianti ma non uniche |
| `OFFSET_TOO_LARGE` | Spostamento sicuro ma oltre il massimo |
| `CHECKPOINT_CONTRADICTION` | Lo spostamento cambia a metà film: montaggio diverso, master diverso o giunzione nel rip. Il report ne mostra la forma |
| `CHECKPOINT_UNMATCHED` | Un tratto con contenuto non trova corrispondenza da nessuna parte |
| `DRIFT` | Lo spostamento cresce nel tempo |
| `TOO_FEW_CHECKPOINTS` | Punti coerenti troppo pochi o mal distribuiti |
| `LOW_COVERAGE` | Il materiale in comune copre troppo poco del film |

Ogni rifiuto elenca le tracce trovate. Se c'entra un tag di lingua, suggerisce come correggerlo con mkvpropedit.

**Errore: riprovabile o da correggere, mai un giudizio sulla coppia**

| Codice | Significato |
|---|---|
| `BAD_ARGUMENTS` | Parametri non validi, oppure un valore di taratura fuori dai limiti |
| `INPUT_UNREADABLE` | File mancante, illeggibile o non MKV |
| `INPUT_TRUNCATED` | File troncato (§4.8) |
| `INPUT_BUSY` | File ancora in scrittura |
| `INPUT_CHANGED` | Gli ingressi o il piano non coincidono con l'analisi confermata |
| `CHOICE_REQUIRED` | Manca una scelta dell'utente necessaria per questa coppia, e Dyadrr non può chiederla (§10.1) |
| `OUTPUT_EXISTS` | Il file finale esiste già o coincide con un ingresso |
| `OUTPUT_NOT_WRITABLE` | Cartella di uscita non scrivibile |
| `NO_SPACE` | Spazio insufficiente. È riprovabile, e non è un rifiuto: un disco pieno non deve mai far caricare un file senza italiano |
| `TOOL_MISSING`, `TOOL_TOO_OLD` | mkvmerge o ffmpeg mancanti o troppo vecchi |
| `MERGE_FAILED` | mkvmerge fallito (codice 2, crash, errore di I/O) |
| `VERIFY_FAILED` | Una verifica dopo il merge non torna |
| `INTERNAL` | Errore imprevisto |
| `INTERRUPTED` | Nel container, un lavoro finito senza esito: Dyadrr o il container fermati di colpo (§14.1). Riprovabile |

**Annullato:** `CANCELLED`.

**Avviso**

| Codice | Quando scatta |
|---|---|
| `VIDEO_QUALITY_UNCERTAIN` | Video confrontabile solo in modo incerto (§3.2) |
| `ORIGINAL_LANGUAGE_NOT_COMMON` | La lingua originale indicata non è presente in entrambi i file (§3.3) |
| `MEASURE_MIX_DIFFERS` | La somiglianza della coppia di misura è in una fascia bassa ma sufficiente |
| `ITALIAN_TRANSFER_OFFSET`, `ITALIAN_UNVERIFIED` | Controllo di trasferimento (§4.7) |
| `ITALIAN_TRACKS_SKIPPED` | Solo con `--italian main` |
| `REFERENCE_HAS_ITALIAN_SUBS` | Il riferimento ha già PGS italiani |
| `ITALIAN_SUBS_NOT_PGS` | Sottotitoli italiani non PGS scartati |
| `NO_FORCED_ITALIAN_SUBS` | Vedi §7 |
| `SDR_SUBS_ON_HDR` | PGS da un disco SDR sopra un video HDR |
| `SUBTITLES_DROPPED_AT_CUT` | Sottotitoli persi ai tagli |
| `INTRO_MISMATCH`, `OUTRO_MISMATCH` | Intro o code diverse, se si sceglie di tenere l'audio |
| `LONG_GAP_WITHOUT_ITALIAN` | Buco senza italiano oltre la soglia |
| `TAIL_EXCESS_KEPT` | Eccesso in coda lasciato |
| `ABRUPT_START` | Taglio iniziale con audio sopra soglia |
| `MANY_INCONCLUSIVE` | Più del 10% di punti non conclusivi |
| `MKVMERGE_WARNING` | Avvisi di mkvmerge (codice 1) |
| `OUTPUT_TRANSFER_OFFSET`, `OUTPUT_TRANSFER_UNVERIFIED` | Controllo di trasferimento sul file finale (§4.7, §9.5) |
| `INPUT_NOT_DELETED` | Con `--inputs delete`, un ingresso cambiato dall'inizio o che non si è potuto cancellare: resta dov'è (§10.2) |

**Codici di uscita:** numeri che Node non usa mai da solo (Node usa 1, 3–7, 9, 10, 12–14 e i valori sopra 128 per i segnali). Un crash di Node esce con 1, e sembrerebbe un rifiuto.

| Codice | Esito |
|---|---|
| 0 | Idoneo (analyze) oppure merge completato |
| 20 | Rifiutato |
| 30 | Errore negli ingressi, nell'ambiente o nei parametri (compresi `NO_SPACE` e `CHOICE_REQUIRED`) |
| 40 | Errore interno, merge fallito o verifica fallita |
| 50 | Annullato |

---

## 13. Requisiti tecnici

- **Nessuna scheda grafica:** il video non viene mai decodificato né codificato.
- **Programmi esterni:** mkvmerge almeno v57, ffmpeg e ffprobe. Dyadrr controlla le versioni prima di cominciare (`TOOL_TOO_OLD`) e si ferma se un programma manca (`TOOL_MISSING`); le versioni finiscono nel report (§11.2).
  - **ffmpeg almeno 6.1.** Il metodo di lettura delle finestre (§4.3) è provato su ffmpeg 6.1.1 (Ubuntu 24.04) e 7.0.2 (§18), e legge alcuni messaggi di ffmpeg (`ashowinfo`, statistiche di lettura) il cui formato è garantito solo sulle versioni provate. La versione si legge da `ffmpeg -version`; per le build da git ("N-…"), che non hanno un numero di versione, da libavformat (almeno 60.16, quella di ffmpeg 6.1).
  - **ffprobe:** basta che ci sia; serve per i metadati e, nella costruzione, per i pacchetti nei punti di taglio (§6.5).
- **Processore:** carico leggero. Correlare alcuni minuti di audio a 8 kHz richiede secondi.
- **Disco:** è il vero limite.
  - **Analisi:** legge alcuni GB, per i motivi di §4.3.
  - **Merge:** legge l'intero riferimento e scrive l'intero file finale.
- **Spazio libero necessario**, sul disco del file finale: dimensione del riferimento + tracce italiane scelte × 2 (l'intermedio c'è sempre, §6.1) + un margine di 2 GiB, come Wayfinderr (costante del metodo, 0.9). Le dimensioni delle tracce vengono dai tag statistici; se mancano (§3.2), si stima per eccesso con la dimensione intera del donatore.
  - Bastano due copie delle tracce italiane anche con le due passate del taglio iniziale e il taglio finale: ogni intermedio si elimina appena il successivo è scritto (§6.5).
  - Lo spazio si controlla prima di scrivere qualsiasi cosa. Se il disco si riempie lo stesso durante il merge (un altro programma che scrive), è `NO_SPACE` (§6.3).
- **Ingombro totale** durante il lavoro: i due rip più il file finale, cioè 2,5–3 volte un film.

---

## 14. Architettura e repo

- **Repo separato `dyadrr`.** Ha una vita propria (fase sperimentale, soglie da tarare) e non pesa sulle versioni di Wayfinderr, dove ogni PR verso `main` alza la versione.
- **TypeScript/Node, libreria + riga di comando.** La logica sta nella libreria; il contratto è la riga di comando con il report JSON (§11): si annulla con un segnale di stop, l'avanzamento arriva come righe, il report come file JSON.
- **In fase 2 Dyadrr gira in un container separato** (decisione 7, chiusa nella 0.9), con un profilo Compose e un'immagine propria. Wayfinderr gli passa i lavori con un protocollo a file job (sotto), come fa già con il runner MakeMKV. Così:
  - un crash o un esaurimento di memoria di Dyadrr non fa cadere gli upload;
  - ffmpeg e mkvtoolnix hanno le versioni fissate e provate con Dyadrr (§16), indipendenti da quelle del backend, che le prende dai pacchetti di Alpine;
  - chi non usa il merge non scarica né avvia niente;
  - il contratto (§11) resta identico: nel container il runner lancia la riga di comando.
- **Formato del pacchetto:** se in futuro il backend volesse importare la libreria direttamente, servono un punto d'ingresso compatibile CommonJS e nessun `await` al livello principale, perché il backend di Wayfinderr compila in CommonJS.
- **Container separato** (decisione 7):
  - **Servizio** `dyadrr` nel `docker-compose.yml` di Wayfinderr, con un profilo Compose (`profiles: ["merge"]`) come il servizio `makemkv` e un hostname fisso (§14.1). L'init è nell'immagine (§14.2): `init: true` non serve.
  - **Protocollo a file job** su una cartella condivisa, come quello del runner MakeMKV (§19). La cartella sta dentro la cartella di lavoro di Wayfinderr (`.wayfinderr/` nella cartella sorvegliata, ignorata dal watcher), in `dyadrr/jobs/`:
    - `<id>.job`: comando (`analyze` o `merge`), ingressi, uscita e opzioni, una riga `chiave=valore` ciascuno. Wayfinderr lo scrive con un altro nome e poi lo rinomina, così non si legge mai a metà;
    - `<id>.run`: il runner ha preso il lavoro, rinominando il `.job`. Un lavoro alla volta;
    - `<id>.log`: le righe di avanzamento (`--progress json`, §11.1), mentre il lavoro va avanti;
    - `<id>.json`: il report (§11), scritto con un nome temporaneo e poi rinominato;
    - `<id>.exit`: il codice di uscita (§12), quando il lavoro è finito;
    - `<id>.cancel`: lo scrive Wayfinderr per fermare il lavoro. Il runner manda a Dyadrr il segnale di stop, e il report dice "annullato" (§10);
    - `dyadrr.alive`: secondi dall'epoch, riscritti dal runner ogni pochi secondi, per sapere se il container è attivo.
  - **Percorsi:** nel job sono relativi alle cartelle montate, come nel runner MakeMKV: ogni container aggiunge il suo percorso di quella cartella.
  - **Runner:** sta nell'immagine di Dyadrr e lancia la riga di comando con gli argomenti del job. Il protocollo è l'unica cosa nuova oltre al contratto di §11.
  - **Volumi:** la cartella sorvegliata (`MAKEMKV_OUTPUT_DIR`) in scrittura, con gli stessi permessi del backend: lì stanno i job, gli ingressi trattenuti (decisione 4), il file finale (decisione 5) e i temporanei `.dyadrr/`, sullo stesso disco del file finale (§6.4). Gli altri ingressi possibili, per esempio i download, in sola lettura.
- **Immagine Docker** propria, costruita in questo repo:
  - Node 22 su Alpine, come il backend, con ffmpeg ≥ 6.1 e mkvtoolnix ≥ v57 a versioni fissate;
  - un piccolo init per i segnali;
  - amd64 e arm64, come le immagini di Wayfinderr, pubblicata su GitHub Container Registry con gli stessi tag (`latest`, `sha-…`, versione);
  - la suite della fase 1 si ripete sull'immagine (§15, fase 2).
- **Windows:** con Docker Desktop le cartelle Windows montate sono lente per file di decine di GB, e lo sono sia l'analisi (alcuni GB) sia il merge. Se diventa un problema, si tengono i file di prova nel filesystem di WSL2.
- **Licenza MIT**, come Wayfinderr, che così può includere Dyadrr senza vincoli. ffmpeg e mkvtoolnix sono GPL ma vengono lanciati come programmi esterni, quindi non vincolano la licenza di Dyadrr.
- **Repo pubblico (consigliato, motivi rivisti nella 0.9):**
  - con il container separato Dyadrr non sta più nell'immagine del backend, ma la sua immagine la scarica ogni installazione di Wayfinderr che attiva il merge, senza login: deve essere pubblica, e con lei il codice che contiene. Un repo privato non nasconderebbe niente;
  - chi compila Wayfinderr in locale può costruire anche l'immagine di Dyadrr;
  - nessuna credenziale nella CI e nella build.

### 14.1 Il runner dei file job (0.14)

Il protocollo di §14 visto dal runner. Wayfinderr ne scrive l'altra metà (§15, fase 2).

- **Cartelle nel container.** Tutto quello che il container condivide con Wayfinderr sta sotto `/data`, una cartella montata per nome: `/data/watch` è la cartella sorvegliata (in scrittura, obbligatoria: senza, il runner non parte), le altre (per esempio `/data/downloads`) si montano con il nome che si vuole, di norma in sola lettura.
- **Percorsi nel job.** Relativi a `/data`, separati da `/`, con il nome della cartella montata come primo elemento: `watch/Film (2).mkv`, `downloads/Film/Film.mkv`. Wayfinderr sostituisce il proprio percorso di ogni cartella con il suo nome. Un percorso assoluto, vuoto o con un elemento vuoto, `.` o `..` è `BAD_ARGUMENTS`: non per sicurezza (Wayfinderr è fidato), ma perché è sempre un errore di chi scrive il job.
  - Il report riporta i percorsi del container (`/data/watch/…`): Wayfinderr fa il cammino inverso. `--expect` non confronta i percorsi (§10), quindi un report di analyze resta valido anche se cambia il punto di montaggio.
- **Cartella dei job:** `/data/watch/.wayfinderr/dyadrr/jobs/`. Il runner la crea se manca.
- **Il file `<id>.job`.**
  - `<id>`: da 1 a 64 tra lettere ASCII, cifre, `-` e `_`, che comincia con una lettera o una cifra. Wayfinderr usa id che non si ripetono (per esempio un UUID). Un file con un altro nome si ignora: è il nome temporaneo con cui Wayfinderr lo scrive, prima di rinominarlo.
  - UTF-8, una riga `chiave=valore` per riga: la chiave è quello che precede il primo `=`, il valore tutto il resto, spazi compresi. Le righe vuote si ignorano, un CR in fondo alla riga si toglie.
  - Le chiavi sono le opzioni della riga di comando senza i due trattini, più `command` e `input`:

    | Chiave | Valore | Opzione |
    |---|---|---|
    | `command` | `analyze` o `merge`, obbligatoria | il comando |
    | `input` | un percorso; due righe, una per ingresso | i due file |
    | `output`, `temp-dir`, `expect` | un percorso | `--output`, `--temp-dir`, `--expect` |
    | `original-language` | un codice di lingua | `--original-language` |
    | `tail`, `italian`, `reference-italian-subs`, `edge-mismatch` | un valore della scelta (§10.1) | le quattro scelte |
    | `inputs` | `keep` o `delete` (Wayfinderr passa sempre `keep`, §15) | `--inputs` |

  - Sono `BAD_ARGUMENTS`, decisi dal runner: una riga senza `=`, una chiave sconosciuta, una chiave ripetuta (salvo `input`), `command` mancante o diverso da `analyze` e `merge`, un percorso non valido. Non ci sono `report` e `progress`: li decide il runner. Tutto il resto (numero degli ingressi, valori delle scelte, opzioni solo per merge) lo controlla la riga di comando, come per chi la lancia a mano.
- **Riga di comando:** `dyadrr <command> <ingresso> <ingresso> --<chiave>=<valore>… --report=<jobs>/<id>.json --progress=json`, con i percorsi tradotti, lanciata in `/data` con l'ambiente del container. Le variabili delle scelte nel Compose valgono come preimpostazioni (§10.1), ma Wayfinderr passa comunque sempre le scelte.
- **Un lavoro.**
  1. I `.job` si prendono uno alla volta, dal più vecchio (data di modifica, poi nome). La cartella si guarda ogni secondo: niente notifiche del filesystem, che sulle cartelle montate da Docker Desktop o via rete non sono affidabili.
  2. **Preso:** il `.job` si rinomina in `.run`. Se c'è già un file di quel lavoro (`.run`, `.log`, `.json`, `.exit`) l'id è stato riusato: il `.job` resta dov'è, non si sovrascrive niente, e il runner lo scrive nel suo log.
  3. **`<id>.log`** si crea subito, vuoto; ci finisce lo stderr di Dyadrr man mano: le righe di `--progress json` (§11.3) e, solo quando Dyadrr non può scrivere un report o non legge gli argomenti, un messaggio che non è JSON.
  4. Un job sbagliato, o con un `.cancel` già presente, non lancia Dyadrr: il report lo scrive il runner (`BAD_ARGUMENTS` o `cancelled`).
  5. **`<id>.cancel`**, controllato ogni secondo: il runner manda SIGTERM a Dyadrr **una volta sola**, perché un secondo segnale lo farebbe uscire senza pulizia (§10). Il contenuto non conta; un `.cancel` dopo la fine non fa niente.
  6. **Fine:** `<id>.json` è il report di Dyadrr. Se Dyadrr finisce senza report (crash di Node, ucciso), il runner ne scrive uno con il solo esito: `INTERRUPTED` se un segnale l'ha ucciso, `INTERNAL` altrimenti. Poi **`<id>.exit`**: il codice di uscita (§12) e un a capo, con un nome temporaneo e una rinomina. **`.exit` è sempre l'ultimo file, e quando c'è c'è anche `.json`**: Wayfinderr aspetta solo lui.
  7. Il runner non cancella mai i file di un lavoro: li cancella Wayfinderr dopo aver letto `.exit`, `.cancel` compreso.
- **Runner fermato** (`docker stop`, che manda SIGTERM all'init, §14.2): con un lavoro in corso il runner manda SIGTERM a Dyadrr, aspetta il report `cancelled` (50), scrive `.exit` ed esce. Fermare il container vuol dire annullare il lavoro. Docker aspetta 10 s prima di SIGKILL: di norma bastano, ma il Compose dà `stop_grace_period: 30s`. Un secondo segnale fa uscire il runner subito.
- **All'avvio, i `.run` senza `.exit`:** il container è stato fermato di colpo (SIGKILL, memoria esaurita, corrente) mentre il lavoro andava. Non si rilanciano: potrebbe essere proprio quel lavoro a far cadere il container, e un merge si ripete solo con una conferma nella GUI.
  - Se c'è `<id>.json`, Dyadrr aveva finito: `.exit` si ricava dal report.
  - Altrimenti il runner scrive il report con `INTERRUPTED` (uscita 40, riprovabile) e `.exit`. Nuovo codice di errore (§12).
  - Gli avanzi nella cartella dei temporanei li elimina il lavoro successivo che la usa (§6.4), purché il container abbia sempre lo stesso nome host: per questo il servizio ha `hostname: dyadrr`. Con il nome casuale che Docker dà a ogni container sarebbero di "un altro host" e resterebbero.
- **`dyadrr.alive`:** i secondi dall'epoch e un a capo, riscritti con un nome temporaneo e una rinomina subito all'avvio e poi **ogni 5 s**, anche durante un lavoro. Wayfinderr considera il container spento se il valore è più vecchio di **30 s** (sei scritture mancate): non manda lavori e lo mostra nella GUI. Un lavoro in `.run` con il container spento resta lì finché il container non riparte e lo chiude come sopra.
- **Un solo runner per cartella dei job.** Due container sulla stessa cartella prenderebbero lavori diversi senza contare lo spazio l'uno dell'altro (§15, concorrenza).
- **Costanti del metodo** (non parametri di taratura, §9.2): la cartella guardata ogni secondo, `dyadrr.alive` ogni 5 s, il limite di 30 s per Wayfinderr.

### 14.2 L'immagine (0.14)

- **Base:** `alpine:3.22`, con i pacchetti di Alpine `nodejs` 22, `ffmpeg` **6.1.2**, `mkvtoolnix` **92.0** e `tini` 0.19.
  - **Perché Alpine 3.22 e non l'ultima.** `node:22-alpine` oggi è Alpine 3.24, che ha ffmpeg 8.1 (la 3.23 ha la 8.0). Il metodo di lettura delle finestre è provato su ffmpeg 6.1.1 e 7.0.2 e legge messaggi il cui formato è garantito solo lì (§4.3, §13). La 3.22 ha la 6.1.2: la stessa versione minore della CI (Ubuntu 24.04, 6.1.1). mkvtoolnix 92.0 supera v57; la CI ha v82, e la suite ripetuta sull'immagine copre la differenza.
  - **Node dai pacchetti di Alpine**, non da `node:22-alpine3.22`: le immagini di Node per una versione di Alpine non più recente smettono di essere aggiornate (oggi ferme alla 22.22.3), mentre il pacchetto `nodejs` della 3.22 riceve gli aggiornamenti di sicurezza (22.23.2).
  - **Versioni fissate** con il vincolo `~` di apk sulla versione del programma: la revisione di Alpine (`-rN`) può cambiare per una correzione di sicurezza, la versione no. Se Alpine la cambiasse dentro il ramo, la costruzione dell'immagine fallisce e la si rivede a mano. Le versioni usate finiscono comunque in ogni report (§11.2).
  - **Scadenza:** Alpine 3.22 è supportata fino a maggio 2027. Prima si passa a un ramo nuovo, con ffmpeg 8: serve rifare le prove della lettura delle finestre (§4.3, §18) oltre alla suite.
- **Init:** tini come `ENTRYPOINT`, che inoltra i segnali al runner e raccoglie i processi orfani.
- **Comandi:** per default il runner (`dyadrr-runner`); `dyadrr` è nel `PATH`, per lanciare la riga di comando a mano nel container, e dalla 0.15 anche `dyadrr-pairs`, per le coppie reali della fase 1 (§15).
- **Utente:** quello di default (root). Il Compose gli dà con `user:` lo stesso utente del backend, così i file scritti da uno si possono cancellare dall'altro (§14, volumi).
- **Costruzione:** il TypeScript si compila una volta sola, sulla piattaforma della build (non ha codice nativo); per arm64 si installano solo i pacchetti di Alpine.
- **Workflow `Image`**, in questo repo, a ogni PR e a ogni push su `main`:
  - costruisce l'immagine per amd64 e arm64;
  - ripete **tutta la suite** (`npm test`) dentro l'immagine amd64: uno stadio di prova che aggiunge all'immagine npm, i sorgenti e i test, con gli stessi Node, ffmpeg e mkvtoolnix;
  - controlla le versioni di Node, ffmpeg e mkvmerge su entrambe le architetture (arm64 in emulazione);
  - su `main` pubblica su GitHub Container Registry, `ghcr.io/tehmaat/dyadrr`, con i tag `latest`, `sha-<7 caratteri del commit>` e la versione di `package.json` (per esempio `0.12.0`), con le credenziali del workflow e nessun segreto.
- **Le coppie reali** (fase 1, punto 3) e la taratura vanno fatte con le versioni dell'immagine: sono quelle con cui Dyadrr girerà in Wayfinderr. Dalla 0.15 con `dyadrr-pairs`, nell'immagine (§15); il workflow `Image` lo prova con un elenco di una coppia.

---

## 15. Piano

### Fase 0: verifiche preliminari (in buona parte già fatte)

Prima di scrivere codice si verificano su file di prova i meccanismi da cui dipende tutto. Molte di queste verifiche sono già state fatte durante questa revisione (§18). Restano da fare:

- [ ] lettura delle finestre su **rip reali di MakeMKV** (l'intreccio audio/video può essere diverso da quello dei file di prova);
- [ ] velocità di lettura su una cartella montata in Docker Desktop;
- [ ] mkvmerge su un **vero file Dolby Vision** (profilo 7 e profilo 8).

### Fase 1: Dyadrr standalone, senza interfaccia grafica

**1a. Test sintetici con risultato noto (meccanica)**
- Da un rip si ricavano due copie: a una si tolgono le tracce italiane con un remux, altrimenti la coppia viene rifiutata già sui ruoli.
- Gli spostamenti noti si creano con mkvmerge `--sync` su tutte le tracce di una copia: valori interi in ms, di entrambi i segni.
- Le code si tagliano con `--split` su intermedi senza video, mai su file con FLAC.
- **Lo spostamento atteso si legge dai timestamp dei file prodotti, non dal valore richiesto.** Un `--split` su un file con video taglia sul fotogramma chiave successivo: nelle prove, 7,500 s richiesti sono diventati 8,008 s.
- Si verificano segno di S, piano di inizio e fine, flag, capitoli e sottotitoli persi, al millisecondo.
- *Stato (Dyadrr 0.5.0):* misura provata su MKV di 120 s generati al volo, in AC3: spostamenti con `--sync` di entrambi i segni (S esatto al decimo di ms, letto dai timestamp dei file prodotti), code tagliate con `--split` su intermedi senza video, intro diverse, silenzi all'inizio e alla fine, `OFFSET_TOO_LARGE`, deriva, velocità 1,001, contenuto ripetitivo, centrale contro L+R su un remix e scelta della coppia.
- *Stato (Dyadrr 0.6.0):* piano di inizio e fine provato sugli stessi file: `--sync` di entrambi i segni, intro diversa con `--edge-mismatch` e `ABRUPT_START`, riferimento con la coda tagliata e `--tail`. Flag, capitoli e sottotitoli persi arrivano con la costruzione.
- *Stato (Dyadrr 0.7.0):* costruzione provata su MKV di 30 s con audio italiano AC3, TrueHD e FLAC e PGS scritti a mano (formato .sup): S positivo con la coda tagliata anche in FLAC, S negativo con il taglio all'inizio del film e TrueHD su un punto di sincronizzazione, tagli sui confini con `--edge-mismatch drop`; ordine, flag default e forced, compressione dei PGS, capitoli, titolo e sottotitoli persi ai tagli, controllati sul file prodotto. Le verifiche dopo il merge arrivano con il loro modulo.
- *Stato (Dyadrr 0.8.0):* verifiche dopo il merge provate sugli stessi file e su file di rumore rosa con l'inglese e l'italiano che condividono musica ed effetti: tracce, video (anche HEVC HDR10), pacchetti, inizio e fine di AC3, TrueHD e FLAC dopo i tagli, durata con l'eccesso in coda tolto e lasciato, trasferimento a zero sul file finale e `OUTPUT_TRANSFER_OFFSET` con uno S sbagliato di 40 ms.
- *Stato (Dyadrr 0.9.0):* riga di comando provata su MKV di 60 s di rumore rosa con due tracce italiane: `analyze` con il report completo e `--italian` in sospeso, `merge --expect` fino al file consegnato e verificato, scelte da variabile d'ambiente e chieste in un terminale, `--progress json`, il processo vero fermato con SIGTERM.

**1b. Test sintetici con un taglio a metà film**
- Si tolgono e si ricuciono parti di una copia, sempre senza ricodifica.
- Esito atteso: `CHECKPOINT_CONTRADICTION` o `CHECKPOINT_UNMATCHED`.
- *Stato (Dyadrr 0.5.0):* 4 s tolti a metà film con `--split` e ricuciti (salto unico di 4032 ms, trovato oltre il confine), circa 100 ms tolti (salto unico di 144 ms tra due punti di conferma), 20 s sostituiti da un altro contenuto (`CHECKPOINT_UNMATCHED`), 30 s di silenzio (punti non conclusivi e punti aggiunti).

**1c. Errore dei codec**
- Si confrontano due codifiche dello stesso mix ottenute solo per remux: TrueHD contro il suo nucleo AC3, DTS-HD MA contro il suo nucleo DTS.
- Lo spostamento vero è zero, quindi qualsiasi valore diverso da zero è l'errore sistematico (§4.9).

**1d. Robustezza della lettura**
- Punti di conferma posti 0–100 ms dopo i fotogrammi chiave, su AC3, FLAC e TrueHD con punti di sincronizzazione rari.
- Un file con `start_time` diverso da zero, una traccia che non parte da zero.
- Richiesti **zero** rifiuti falsi.
- *Stato (Dyadrr 0.4.0):* lettura delle finestre provata su MKV generati al volo: spostamenti noti con `--sync` di entrambi i segni (letti dai timestamp dei file prodotti), finestre 0–100 ms dopo i fotogrammi chiave su AC3, E-AC3, FLAC, TrueHD e DTS, `start_time` diverso da zero, traccia che parte dopo lo zero, centrale contro L+R, file troncato. Errore sotto il millisecondo in tutte le finestre, con ffmpeg 6.1.1 e 7.0.2. Resta da ripetere su rip reali di MakeMKV (fase 0). Dalla 0.5.0 anche con uno `start_time` oltre il pre-roll (6,5 s), che con il metodo della 0.6 dava finestre in ritardo (§18).

**1e. Logica di decisione senza file**
- La decisione è una funzione pura: misure + soglie → report.
- `DRIFT`, `TOO_FEW_CHECKPOINTS`, `AMBIGUOUS_MATCH` e gli avvisi si provano con serie di punti sintetiche.
- `NO_SPACE` con un disco piccolo, `VERIFY_FAILED` con un errore iniettato apposta.
- Una tabella collega **ogni codice** al test che lo produce.
- *Stato (Dyadrr 0.2.0):* funzione di decisione e tabella dei codici fatte (`docs/CODICI.md`, sezione Test). Dalla 0.6.0 anche il piano, funzione pura, con le sue serie sintetiche: casi di inizio e fine, scelte con il loro effetto, tracce prese, forced e avvisi del piano. Dalla 0.7.0 `NO_SPACE` con un disco piccolo (spazio libero simulato) e con un disco che si riempie, `MERGE_FAILED` e `MKVMERGE_WARNING` con un mkvmerge finto, `SUBTITLES_DROPPED_AT_CUT` su file veri. `VERIFY_FAILED` arriva con le verifiche. Dalla 0.8.0 `VERIFY_FAILED` con errori iniettati: il risultato della costruzione alterato (un flag, un inizio previsto) e il file costruito cambiato con mkvpropedit. Dalla 0.9.0 `INPUT_CHANGED` con report confermati alterati (S, piano, una scelta) e con un ingresso copiato, `CANCELLED` durante l'analisi e durante il merge, `BAD_ARGUMENTS` per gli argomenti: ogni codice ha un test.

**2. Casi da rifiutare con file reali**
- Theatrical contro extended, framerate diversi, due film diversi.
- Un file senza lingua in comune, entrambi con audio italiano, donatore con video migliore, un file troncato.
- *Stato (Dyadrr 0.3.0):* lettura degli ingressi provata su piccoli MKV generati con ffmpeg e mkvmerge: tracce in più lingue, tag IETF, file troncato, traccia più corta dei suoi tag, file non MKV, file in scrittura, programmi mancanti o vecchi.

**3. Coppie reali: è qui che si tarano le soglie**

I test sintetici hanno audio identico bit per bit da entrambe le parti: servono a verificare la meccanica, ma non dicono niente sulle soglie. Le coppie reali devono coprire queste categorie:
- UHD Atmos contro vecchio BD 5.1;
- film con lunghi silenzi;
- un Disney o Pixar;
- loghi di distributori diversi;
- cartello del doppiaggio a fine film;
- un film non in lingua inglese;
- un film su due dischi.

Su alcune coppie S va controllato anche a mano.

**Come si misurano (0.15).** Con `dyadrr-pairs`, un terzo eseguibile nell'immagine: lancia `dyadrr analyze` su un elenco di coppie, una alla volta, e ne riassume i report per la taratura (decisione 12). Non decide le soglie: le propone chi legge il riassunto, nella PR che chiude la decisione 12.

- **Dove gira:** nell'immagine pubblicata, perché la taratura vale per le versioni di ffmpeg e mkvtoolnix con cui Dyadrr girerà in Wayfinderr (§14.2): `docker run --rm -v <film>:/data/film -v <taratura>:/data/taratura ghcr.io/tehmaat/dyadrr:<versione> dyadrr-pairs taratura/coppie.txt`. Fuori dall'immagine funziona lo stesso, ma le misure valgono per altre versioni (il riassunto le riporta).
- **L'elenco delle coppie:** un file di testo UTF-8, una sezione per coppia.
  - `[<id>]` apre una coppia. L'id segue le regole dei job (§14.1: da 1 a 64 tra lettere ASCII, cifre, `-` e `_`, che comincia con una lettera o una cifra), è unico nell'elenco e dà il nome ai file dei risultati.
  - Sotto, righe `chiave=valore` come nel job (§14.1): la chiave è quello che precede il primo `=`, il valore tutto il resto; le righe vuote si ignorano, un CR in fondo alla riga si toglie. In più, le righe che cominciano con `#` sono commenti.

    | Chiave | Valore |
    |---|---|
    | `input` | un percorso, due righe, obbligatorie; relativo alla cartella corrente (nel container `/data`), come per la riga di comando |
    | `expected` | obbligatoria: `eligible` per una coppia buona (lo stesso film nella stessa versione), `refused` per una coppia da rifiutare (punto 2: versioni diverse, velocità diverse, film diversi) |
    | `original-language` | un codice di lingua: `--original-language` (§3.3) |
    | `category` | una categoria (sotto); ripetibile |
    | `offset-ms` | S controllato a mano, in ms |
    | `cause` | per una coppia buona rifiutata, la causa trovata guardandola (si aggiunge dopo la misura) |
    | `note` | testo libero |

  - **Categorie:** le sette del punto 3, `uhd-bd` (UHD Atmos contro vecchio BD 5.1), `long-silences`, `disney-pixar`, `distributor-logos`, `dubbing-card` (cartello del doppiaggio a fine film), `non-english`, `two-discs`; tre del punto 2, `different-cut` (theatrical contro extended), `different-speed` (framerate o velocità diversi), `different-film`; e `other`.
  - Le scelte (§10.1) e `--expect` non ci sono: in `analyze` non cambiano la decisione, e la taratura riguarda la decisione. Le scelte restano in sospeso nel report.
  - Sono errori dell'elenco, `BAD_ARGUMENTS`: una riga che non è una sezione, un commento o `chiave=valore`; una chiave prima della prima sezione; un id non valido o ripetuto; una chiave sconosciuta o ripetuta (salvo `input` e `category`); una coppia senza due `input` o senza `expected`; un ingresso vuoto; un valore non valido di `expected`, `category`, `offset-ms` o `original-language`. L'elenco si controlla tutto prima di misurare: un errore nella diciottesima coppia non deve arrivare dopo ore di misure.
- **Una coppia alla volta,** nell'ordine dell'elenco, con un processo `dyadrr analyze <ingressi> [--original-language …] --report <id>.json --progress json` per coppia, con i percorsi assoluti e la taratura versionata. Un crash o un esaurimento di memoria fanno perdere una coppia, non la serie: se Dyadrr finisce senza report, il report lo scrive `dyadrr-pairs`, come il runner (§14.1: `INTERRUPTED` se un segnale l'ha ucciso, `INTERNAL` altrimenti). Su stderr una riga all'inizio e una alla fine di ogni coppia.
- **I risultati** vanno in una cartella, `--results <dir>`, per default `<nome dell'elenco senza estensione>-results` accanto all'elenco:
  - per ogni coppia `<id>.json`, il report di `analyze` intero, e `<id>.log`, lo stderr di Dyadrr (le righe di `--progress json`, con i tempi di ogni fase);
  - per la serie `summary.json` e `summary.md`, riscritti alla fine di ogni lancio, anche annullato. Su stdout i loro percorsi.
  - **Ripresa:** una serie di venti film dura ore. Un report che c'è già si riusa se ha la stessa versione di Dyadrr e della taratura, gli stessi ingressi e la stessa lingua originale, e se la decisione è `eligible` o `refused`; altrimenti (un errore, un annullamento, un'altra versione) la coppia si rimisura, e i suoi file vecchi si cancellano prima. `--again` rimisura comunque, `--only <id>` (ripetibile) lancia solo quelle coppie. Il riassunto copre sempre tutto l'elenco. Le impronte degli ingressi non si confrontano, perché costerebbero una lettura: un file sostituito con lo stesso nome va rimisurato con `--again`.
  - **Dove restano:** i report contengono percorsi e nomi dei file e restano a chi misura. Nel repo entrano il riassunto (`summary.md` nomina le coppie solo con l'id), nella PR della decisione 12, e le conclusioni, in §18.
- **Annullamento:** un segnale di stop arriva a Dyadrr una volta sola (SIGTERM, come nel runner); la serie si ferma, il riassunto si scrive con le coppie fatte. Un secondo segnale esce subito.
- **Uscita:** 0 se la serie è finita e il riassunto è scritto, qualunque sia la decisione delle coppie; 30 per un elenco o argomenti sbagliati, o una cartella dei risultati che non si crea, prima di misurare; 40 se il riassunto non si scrive; 50 se la serie è annullata.
- **Verdetto di ogni coppia,** dalla decisione e da `expected`:

  | Verdetto | Quando |
  |---|---|
  | `ok` | idonea e attesa idonea, con S entro la tolleranza per punto da `offset-ms` se c'è; oppure rifiutata e attesa rifiutata |
  | `good-refused` | una coppia buona rifiutata: ammesso, da documentare con `cause` |
  | `wrong-merge` | idonea ma attesa rifiutata, oppure S oltre la tolleranza per punto da `offset-ms`: sarebbe un merge sbagliato |
  | `error` | un errore: da capire e rimisurare |
  | `cancelled` | annullata |
  | `missing` | ancora senza report |

- **Il riassunto di ogni coppia:** decisione, motivo e verdetto; lingua e tracce di misura; S dell'ancora e definitivo, dispersione e differenza da `offset-ms`; ancore con NCC, rapporto ed esito; punti di conferma per esito e quelli aggiunti; deriva, forma della contraddizione, copertura, trasferimento; avvisi; durata e byte letti; versioni di Dyadrr, dei programmi e della taratura. E i **margini** rispetto alle soglie provvisorie:
  - **picchi dei punti di conferma** con energia almeno E_min, in quattro gruppi: sicuri a S (entro la tolleranza per punto dallo S dell'ancora), non sicuri a S, sicuri altrove, non sicuri altrove. Per i sicuri a S il minimo di NCC, rapporto ed energia; per gli altri il massimo di NCC e rapporto. Ogni punto dà al più due picchi: quello della ricerca vicina e, se non è sicuro, quello su tutto l'intervallo. Per questo il report dà anche i picchi misurati (§11.2);
  - **punti sotto E_min:** quanti, e quanti avevano comunque un picco sicuro a S;
  - **integrità:** la differenza più grande nei due ingressi tra la fine di una traccia e i suoi tag statistici, o tra la fine dei cluster e la durata dichiarata (§4.8);
  - **piano:** i buchi senza italiano all'inizio e alla fine e il livello dopo il taglio iniziale.
- **Il riassunto della serie:**
  - il **criterio di uscita** della fase 1 (sotto): coppie con un report (almeno 15), categorie del punto 3 coperte e mancanti, merge sbagliati (zero), coppie buone rifiutate con e senza `cause`, e la quota di coppie `uhd-bd` buone rifiutate per salti di 1–2 fotogrammi (`CHECKPOINT_CONTRADICTION` con uno o più salti, tutti di al più 2 fotogrammi arrotondati);
  - per ogni soglia provvisoria, il valore della taratura accanto ai margini, con la coppia che li dà: per θ_ncc e θ_rapporto il minimo dei picchi sicuri a S nelle coppie buone (quanto si può alzare la soglia), il massimo dei non sicuri a S nelle coppie buone (quanto andrebbe abbassata per recuperarli) e il massimo dei non sicuri altrove in tutte le coppie (sotto quanto non si può scendere); per E_min l'energia più bassa di un picco sicuro a S; per la tolleranza di integrità la differenza più grande; per buco senza italiano e partenza brusca i valori più alti del piano;
  - le versioni di Dyadrr, dei programmi e della taratura, con un avviso se le coppie non le hanno tutte uguali.

**4. Merge reali e lettori**

Verifica a occhio su ogni lettore che usi davvero (app della TV, Plex o Jellyfin in riproduzione diretta e in transcodifica, Kodi, VLC, mpv):
- labiale a inizio, metà e fine film;
- traccia italiana che parte in ritardo, anche tornando indietro dentro il buco iniziale;
- TrueHD con S < 0;
- sottotitoli forced;
- luminosità dei PGS sopra HDR e Dolby Vision.

**Criterio di uscita della fase 1**
- tutti i test 1a–1e superati;
- almeno 15–20 coppie reali che coprano le categorie del punto 3;
- **zero merge sbagliati**. I rifiuti di coppie buone sono ammessi, ma vanno documentati con la causa;
- misurata la quota di coppie UHD + BD italiano rifiutate per salti di 1–2 fotogrammi. È un risultato di fattibilità in sé.

### Fase 2: integrazione in Wayfinderr, spenta di default

**Come funziona Wayfinderr oggi** (verificato sul codice):
- **Ogni MKV** che compare nella cartella sorvegliata entra **subito** in coda di upload. Non esiste uno stato di attesa.
- **Il controllo lingua è per server:** `SKIP_NO_ITA` (il default) oppure `ALWAYS_UPLOAD`. Salta solo i file che non hanno né audio né sottotitoli italiani. Un file saltato è in uno stato finale.
- **Il disco italiano** passa quindi ogni controllo e viene caricato appena arriva. Con `DELETE_AFTER_UPLOAD` viene poi cancellato, e la pulizia dei torrent ne rimuove il torrent.
- **Un riferimento con PGS italiani** viene caricato subito anche lui.
- **Un MKV estratto da un archivio RAR** viene cancellato a fine upload, anche se l'upload è stato saltato.
- **La pulizia dei torrent** collega un upload a un solo torrent.
- **Il ripper** non rippa in automatico un disco senza audio né sottotitoli italiani: si ferma in attesa di una scelta.
- **I rip automatici** tengono solo l'italiano e la lingua originale (§3.3).
- **Il ripper** dà ai file che consegna un nome mai usato da un upload, aggiungendo " (2)". Un file messo nella cartella in altro modo, con un nome già caricato, viene invece caricato con lo stesso nome e sostituisce quello sul server.

**Cosa serve:**
- **`MERGE_ENABLED`**, spento di default. Va aggiunto alla configurazione del backend, a `docker-compose.yml`, a `.env.example` e alla tabella del README.
- **Ciclo di vita dei due ingressi** (decisione 4, chiusa nella 0.12):
  - con il merge attivo, **entrambi** i file di una possibile coppia vanno trattenuti prima della coda di upload, qualunque sia la politica del server, **finché non arriva il gemello o non li cancelli a mano**: nessun limite di tempo;
  - se il gemello è già stato caricato (con il merge spento, o prima che il merge si attivasse), il file nuovo si trattiene e si **aspetta sempre una tua scelta nella GUI**, che mostra se il gemello è ancora sul disco: merge (solo se c'è ancora), caricare il file così com'è, aspettare, cancellare;
  - il modo può essere un nuovo stato di attesa (richiede una modifica al database) oppure una cartella di ingresso separata, fuori da quella sorvegliata;
  - i file trattenuti vanno protetti da upload, cancellazione, pulizia degli archivi e pulizia dei torrent finché non vengono abbinati o rilasciati.
- **Ripper:** con il merge attivo deve rippare anche un disco senza italiano, tenendo la lingua originale e l'inglese.
- **Abbinamento:** si lavora sugli upload, non sui rip, perché i file rippati a mano con MakeMKV non hanno un rip associato. È manuale, coerente con P3.
- **Nome del file finale** (decisione 5, chiusa nella 0.12): lo sceglie Wayfinderr e lo passa a Dyadrr con `--output`. È il nome che Wayfinderr darebbe normalmente al film; gli ingressi hanno nomi diversi (il ripper aggiunge già " (2)"), e Dyadrr rifiuta comunque un file finale uguale a un ingresso (`OUTPUT_EXISTS`).
  - Prima di lanciare il merge Wayfinderr controlla se un file con quel nome c'è già, nella cartella sorvegliata o sul server. Se c'è, chiede nella GUI: cancellarlo (o sostituirlo sul server) e andare avanti, oppure fermarsi per verificare.
  - Dyadrr non sovrascrive mai (§6.4): il file che c'è già lo toglie Wayfinderr, dopo la tua conferma.
- **Merge rifiutato** (decisione 3, chiusa nella 0.12): i due file restano trattenuti e la GUI mostra il motivo del rifiuto, con le azioni: caricare il riferimento, caricare il donatore, caricare entrambi, cancellare. Niente si carica da solo. Un errore (per esempio `NO_SPACE`) non è un rifiuto: si può riprovare, e non porta mai a caricare un file senza italiano.
- **Pulizia dopo il merge** (decisione 6, chiusa nella 0.12): un'impostazione nel pannello Dyadrr di Wayfinderr, con due valori:
  - **tenerli**, cancellabili poi dalla GUI;
  - **cancellarli**, dopo un merge riuscito e verificato.
  Wayfinderr li cancella lui (i file e il loro stato nel database sono suoi) e passa a Dyadrr `--inputs keep`. Da riga di comando vale §10.2.
- **Lingua originale:** Wayfinderr la prende da TMDB e la passa con `--original-language` (§3.3).
- **Impostazioni delle scelte** (§10.1): le quattro scelte, ognuna con un valore fisso o "chiedi ogni volta", passate sempre a Dyadrr come opzioni.
- **Pulizia dei torrent** collegata a **entrambi** i torrent di partenza.
- **Interfaccia:**
  - lancio dell'analisi e lettura del report (S, piano, controlli, motivi);
  - conferma, poi merge con `--expect` sul report confermato;
  - avanzamento in tempo reale.
- **Voce di menu** (decisione 11, chiusa nella 0.12): come Rips, sempre visibile; a funzione spenta mostra come attivarla. Il menu resta statico.
- **Concorrenza:** un merge alla volta, in coda con i rip. In alternativa, lo spazio va contato insieme a quello riservato dai lavori in corso: oggi il controllo di spazio del ripper conta solo sé stesso.
- **Lingua:** Dyadrr lavora solo con l'italiano. Il merge si attiva solo se `RIP_LANGUAGE` è `it`.
- **Container Dyadrr** (decisione 7, §14): il servizio con il suo profilo nel `docker-compose.yml`, il runner dei job nell'immagine di Dyadrr, il lato Wayfinderr del protocollo e i volumi.
  - *Stato (Dyadrr 0.12.0):* runner e immagine fatti, in questo repo (§14.1, §14.2). Restano, in Wayfinderr, il servizio nel Compose, i volumi e il lato Wayfinderr del protocollo.
- **Prima di attivarlo:** si ripete la suite della fase 1 sull'immagine dove Dyadrr girerà davvero, con le sue versioni di ffmpeg e mkvtoolnix.
  - *Stato (Dyadrr 0.12.0):* i test sintetici (`npm test`) girano sull'immagine a ogni PR (§14.2). Le coppie reali (fase 1, punto 3) si faranno con l'immagine.

### Fase 3: abbinamento automatico (idea, da discutere)

Non se n'è ancora parlato. L'idea: proporre le coppie in automatico, una con audio italiano e una senza, dello stesso film.
- Se entrambi i file vengono da rip di Wayfinderr, si usa l'ID TMDB del rip.
- Altrimenti si usano titolo e anno dal nome del file, più una ricerca su TMDB.

La conferma resta sempre all'utente.

---

## 16. Rischi e casi limite

| Rischio | Effetto | Cosa si fa |
|---|---|---|
| Stessa versione ma master diverso (per esempio un restauro 4K contro un vecchio BD): possibili salti di 1–2 fotogrammi a metà film. Le giunzioni tra le clip del disco (seamless branching), in un rip fatto bene, lasciano solo scarti di pochi ms, da considerare nella taratura della tolleranza | Rifiuto (corretto per P2) | Il report mostra dove e quanto. In fase 1 si misura quanto è frequente |
| Film su due dischi, uniti da Wayfinderr, con punto di divisione o attacco del secondo disco diversi tra i due rip | Uno scalino nel punto di giunzione: rifiuto (P2). Se la giunzione è pulita, S resta costante e il merge procede | Il report mostra dove e quanto. Non si unisce parte per parte: vorrebbe dire tagliare l'audio italiano, o lasciarci un buco, a metà film |
| PGS SDR sopra video HDR | Sottotitoli troppo luminosi su alcuni lettori | Avviso; impostazioni del lettore; verifica in fase 1 |
| Riferimento estero con scritte localizzate nel video, o inquadratura diversa | Scritte non italiane; forced fuori posto | Non rilevabile; meglio riferimenti con video originale inglese |
| Lettori che gestiscono male una traccia che parte in ritardo (segnalato per alcune versioni di Plex) | Audio italiano assente o fuori sincrono | Matrice di lettori in fase 1 |
| TrueHD con S < 0 | Italiano in anticipo fino a circa 107 ms | Taglio su un punto di sincronizzazione (§6.1) |
| Doppiaggio italiano adattato da un altro master | Sfasamento ereditato dal disco | Controllo di trasferimento (§4.7) |
| Mix molto diversi (Atmos sull'UHD, vecchio 5.1 sul BD) | Confidenza più bassa | Canale centrale, GCC-PHAT, scelta della coppia per misura (§4.2) |
| Film con lunghi silenzi | Molti punti non conclusivi | Punti spostati sul contenuto e aggiunti nei buchi; rifiuto se la copertura non basta |
| File troncati | File finale mezzo vuoto | Controllo di integrità (§4.8) |
| Tag di lingua sbagliati | Ruoli sbagliati o rifiuto | Report delle tracce; correzione con mkvpropedit |
| Cartelle Windows lente in Docker Desktop | Analisi e merge lenti | File nel filesystem di WSL2; in produzione, dischi locali |
| Poco spazio | Merge impossibile | Controllo dello spazio (errore riprovabile) |
| Versioni diverse di ffmpeg o mkvtoolnix | Comportamenti e soglie diversi | Versioni fissate e scritte nel report; suite ripetuta sull'immagine finale |

---

## 17. Decisioni aperte

Le decisioni 1, 2, 8, 9 e 10 sono chiuse nella 0.3, la 7 nella 0.9, la 3, la 4, la 5, la 6 e la 11 nella 0.12. Resta aperta la 12. La numerazione resta quella della 0.2.

1. ~~**Eccesso italiano in coda**~~ → **scelta dell'utente** (`--tail`, §10.1). Con FLAC `trim` richiede un remux con ffmpeg (§6.1).
2. ~~**Tracce audio italiane**~~ → **scelta dell'utente** (`--italian`, §10.1).
3. ~~**Merge rifiutato in Wayfinderr**~~ → i due file **restano trattenuti** e la GUI mostra il motivo con le azioni possibili (caricare il riferimento, il donatore, entrambi, cancellare); niente si carica da solo. Gli errori (per esempio `NO_SPACE`) non sono rifiuti e non portano mai a caricare un file senza italiano (§15, fase 2).
4. ~~**Ciclo di vita dei due ingressi in Wayfinderr**~~ → si trattengono **finché non arriva il gemello o non li cancelli a mano**. Se il gemello è già stato caricato si aspetta sempre una tua scelta nella GUI (§15, fase 2).
5. ~~**Nome del file finale e upload**~~ → il **nome normale** che Wayfinderr dà al film, diverso da quelli degli ingressi. Se un file con quel nome c'è già, Wayfinderr chiede se cancellarlo e andare avanti o fermarsi per verificare (§15, fase 2).
6. ~~**Pulizia dopo il merge**~~ → in Wayfinderr un'impostazione del pannello Dyadrr: **tenerli** (cancellabili dalla GUI) o **cancellarli**. Da riga di comando `--inputs keep|delete`: si chiede in un terminale dopo un merge riuscito e verificato, altrimenti si tengono (§10.2).
7. ~~**Dove gira in fase 2**~~ → **container separato** con un profilo Compose (§14). Il contratto è lo stesso della riga di comando. Servono un protocollo a file job su una cartella condivisa, come quello del runner MakeMKV (§19), i volumi giusti (la cartella sorvegliata in scrittura) e un'immagine multi-architettura propria, costruita in questo repo.
8. ~~**Repo pubblico o privato**~~ → **licenza MIT**; repo pubblico consigliato (§14).
9. ~~**PGS italiani già presenti nel riferimento**~~ → **scelta dell'utente** (`--reference-italian-subs`, §10.1).
10. ~~**Audio italiano fuori dal materiale in comune**~~ → **scelta dell'utente** (`--edge-mismatch`, §10.1).
11. ~~**Voce di menu "Merge" in Wayfinderr**~~ → **come Rips**: sempre visibile, a funzione spenta mostra come attivarla (§15, fase 2).
12. **Soglie definitive,** dopo la taratura sulle coppie reali. Fino ad allora hanno valori provvisori θ_ncc, θ_rapporto, E_min, la fascia di `MEASURE_MIX_DIFFERS`, la lunghezza delle finestre dei punti di conferma, la tolleranza del controllo di integrità e le soglie del piano: buco lungo senza italiano, partenza brusca, forced (§9.2).

---

## 18. Evidenze sperimentali (fase 0)

Durante la revisione sono state fatte prove su **file sintetici** generati con ffmpeg: video di prova, audio AC3, E-AC3, DTS, TrueHD, FLAC e PGS di prova. Strumenti: mkvmerge v82 e ffmpeg 6.1.1. Nessun file reale, nessun codice del progetto.

| Verifica | Risultato |
|---|---|
| `--sync` positivo e negativo su una traccia | ✅ Spostamento esatto. Con valori negativi si scartano solo pacchetti interi e il contenuto resta allineato (errore 0,000 ms) |
| Granularità | ✅ Timestamp al ms. `--sync` accetta solo interi in ms |
| Precisione della misura a 8 kHz | ✅ Uguale a 48 kHz entro 0,013 ms. Su 60 punti, con lettura corretta: errore tra −0,16 e +0,03 ms |
| Lettura ingenua con ffmpeg | ❌ Errore costante di 5–16 ms ed errori su singole finestre fino a 50 ms (§4.3). Corretta con lettura con pre-roll e senza ribasare i timestamp |
| Ritardo dei codec, lettura ingenua | AC3/E-AC3 −5,33 ms, DTS −10,67 ms, TrueHD/FLAC 0. Leggendo i timestamp, l'AC3 di prova scende a circa −0,3 ms. Va misurato su dischi veri (1c) |
| Taglio della coda | ❌ Un `--split` sul file completo non taglia l'italiano. ✅ Funziona su un intermedio senza video |
| FLAC | ❌ mkvmerge rifiuta di dividere le tracce FLAC. ✅ `ffmpeg -c copy -t` funziona |
| TrueHD con taglio iniziale | ❌ L'audio suona 50–67 ms in anticipo nei percorsi basati su ffmpeg. ✅ Il taglio su un punto di sincronizzazione lo riporta a 0 |
| Flag e capitoli predefiniti di mkvmerge | ❌ Due audio predefiniti, due forced predefiniti, capitoli del donatore uniti e non spostati (§6.2) |
| PGS | ✅ Si spostano esattamente. ❌ mkvmerge aggiunge la compressione zlib per default. Un sottotitolo a cavallo del taglio iniziale si perde |
| File troncato | ❌ La durata dichiarata resta piena, ffmpeg e mkvmerge non segnalano niente (§4.8) |
| Differenze di velocità | ❌ Con un rapporto di 1,001 o PAL la correlazione sparisce del tutto: risulta `NO_MATCH`, non `DRIFT` (§4.4) |
| Remix sintetico: stesso dialogo, musica ed effetti diversi | ❌ Il downmix mono completo perde la corrispondenza in tutte le finestre. ✅ La tengono in tutte il solo canale centrale e la correlazione sbiancata (GCC-PHAT) sul downmix (§4.2) |
| HEVC HDR10 dopo il remux | ✅ Pacchetti identici, metadati di colore conservati. Dolby Vision è ancora da provare su un file vero |
| Lettura dal disco | Per leggere N secondi di audio si leggono N secondi di tutto il file (circa 1,15 volte, con il pre-roll) |
| Metodo di lettura della 0.6 (§4.3), ffmpeg 6.1.1 e 7.0.2: 63 finestre da 1 s per codec, 0–100 ms dopo 7 fotogrammi chiave, pre-roll 2 s | ✅ Dispersione dell'errore tra le finestre (il ritardo costante del codec è a parte, §4.9): AC3 ed E-AC3 0,001 ms (ritardo −0,34 ms: il CodecDelay di 5,33 ms che ffmpeg arrotonda a 5), FLAC 0,000 ms, TrueHD 0,66 ms, DTS 1,0 ms (ritardo −10,4 ms). Il resto è l'arrotondamento al ms dei timestamp di Matroska, ±0,5 ms. ❌ La lettura ingenua sugli stessi file: AC3 ed E-AC3 da −5,3 a +14,7 ms, FLAC da 0 a 89 ms, TrueHD 4,7 ms, DTS 9,7 ms. Con pre-roll da 0 a 3 s la dispersione resta sotto 1 ms |
| Buco di 50 ms nei timestamp di una traccia FLAC | ❌ Senza compensazione tutto quello che segue è spostato di −50 ms. ✅ Con la compensazione di `aresample` oltre 2 ms l'errore è 0 (§4.3) |
| File con `start_time` oltre il pre-roll (6,5 s), 0.7 | ❌ Con il metodo della 0.6 la finestra comincia a T + 6,5 s: ffmpeg, con `-copyts`, taglia dopo `-ss` a T − 2 s più lo `start_time`; una finestra di 1 s non ha campioni (`INPUT_UNREADABLE`). ✅ Con `-noaccurate_seek` comincia a T, su ffmpeg 6.1.1 e 7.0.2 (§4.3) |
| Unicità di un motivo ripetuto esattamente, 0.7 | ❌ Rapporto 2,0 sulla correlazione sbiancata: lo spettro a righe, sbiancato, dà un picco che sembra unico. ✅ 1,0 sull'NCC (§4.4) |
| Somiglianza a mezzo campione dal picco, 0.7 | ❌ NCC 0,90 sui campioni, per un segnale identico. ✅ 1,00 con il donatore interpolato (sinc a finestra, §4.4) |
| Correlazione (0.7) su MKV di 120 s in AC3 generati al volo (ancore 10 s, punti 3 s, S_max 5 s), ffmpeg 6.1.1 e 7.0.2 | ✅ `--sync` di +1537 e −263 ms: S esatto, dispersione 0, trasferimento 0. Coda tagliata a 100 s: confine a 99,1 s. Intro diversa fino a 5 s: confine a 4,5 s. 4 s tolti a 60 s: confine a 61,4 s e salto unico di 4032 ms oltre il confine. Circa 100 ms tolti: salto unico di 144 ms. 20 s sostituiti: punti senza corrispondenza. 30 s di silenzio: 3 punti su 20 non conclusivi. Remix con lo stesso centrale: NCC 0,9995 sul centrale, 0,02 su L+R. Velocità 0,3‰: deriva di 1125 ms all'ora. Velocità 1,001: somiglianza 0,45–0,48 con ancore da 10 s, sotto 0,35 con ancore da 30 s; la diagnosi trova 1/1,001. Motivo di 1,5 s ripetuto: rapporto 1,0 |
| `--sync` negativo su TrueHD, 0.9 (mkvmerge v82, ffmpeg 6.1.1) | ❌ mkvmerge tiene i pacchetti dallo zero anche se non sono un punto di sincronizzazione; ffprobe li scarta e dà al primo punto di sincronizzazione il tempo del primo pacchetto scartato (7 ms prima, nella prova). ✅ Con lo zero sul punto di sincronizzazione (−t, poi S + t) il primo blocco è un punto di sincronizzazione e i timestamp seguenti sono quelli del donatore spostati di S, entro 1 ms. mkvmerge segna i punti di sincronizzazione come fotogrammi chiave; nei dati hanno la firma `F8 72 6F BA` |
| `--split parts:` sull'intermedio, 0.9 | `parts:00:00:00-e` tiene i timestamp, anche con uno spostamento positivo, e taglia sul primo pacchetto da e in poi, escluso. Con una sola parte il nome del file resta quello dato. ❌ Un file con una traccia FLAC non si divide ("Splitting tracks of this type is not supported") |
| ffmpeg `-copyts -c copy -to` su FLAC, 0.9 | ✅ Tiene lo spostamento; l'ultimo pacchetto è l'ultimo che comincia prima del taglio |
| PGS ai tagli, 0.9 | Al taglio iniziale si perde il sottotitolo a schermo e resta il blocco che lo toglie; al taglio finale resta il sottotitolo senza il blocco che lo toglie. ffprobe dà i blocchi decompressi anche dai PGS con zlib |
| `--split parts:` su TrueHD, 0.10 (mkvmerge v82) | Il taglio cade sul primo punto di sincronizzazione da e in poi: mkvmerge divide solo sui fotogrammi chiave. Nella prova, con un punto ogni 13 ms, la traccia finisce 4 ms dopo e. Sui Blu-ray i punti possono distare fino a circa 107 ms |
| Unione finale, 0.9 | ✅ Flag default e forced, ordine, `--compression <traccia>:none`, capitoli e titolo del solo riferimento come previsti (§6.2). Un avviso in `--gui-mode` è una riga `#GUI#warning`, con codice di uscita 1 |
| Tempo di calcolo della correlazione, 0.7 | Un'ancora (30 s contro 8,5 min) circa 2 s in Node, tre coppie insieme circa 4 s; una ricerca ampia di un punto (10 s contro 8 min) circa 1,4 s |

---

## 19. Riferimenti

**Wayfinderr: file da cui dipende il progetto**

- *Scansione della cartella:* `backend/src/services/fileWatcher.ts`. Regole di esclusione: cartelle o nomi che iniziano con un punto, nomi con `~tmp`; stabilità di 30 s.
- *Lingua, HDR e bitrate:* `backend/src/services/mediaInfo.ts`. Riconoscimento dell'italiano, HDR10/HLG/Dolby Vision, bitrate dai tag statistici.
- *Coda e politica di upload:* `backend/src/services/jobQueue.ts`.
- *Ripper, lingue tenute e consegna nella cartella sorvegliata:*
  - `backend/src/services/ripper/makemkv.ts` (tracce tenute);
  - `backend/src/services/ripper/index.ts` (consegna atomica nella cartella sorvegliata).
- *Esecuzione di mkvmerge:*
  - `backend/src/services/ripper/remux.ts`: avanzamento, flag espliciti per ogni traccia, controllo della lunghezza;
  - `backend/src/services/ripper/join.ts`: codici 0/1 accettati.
- *Protocollo a file job del runner MakeMKV:* `backend/src/services/ripper/runner.ts`.
- *Pagina Rips:* `frontend/app/rips/page.tsx`, con il menu statico in `frontend/components/sidebar.tsx`.
- *Pulizia dei torrent:* `backend/src/services/torrentCleanup.ts`.

**Strumenti con un approccio simile**

- **Sushi:** correlazione audio contro audio per spostare i sottotitoli. Gestisce anche i tagli, che Dyadrr invece deve rifiutare.
- **audio-offset-finder** (BBC) e **syncstart:** misurano lo spostamento tra due registrazioni per correlazione.
- **ffsubsync** è meno vicino: allinea i sottotitoli al parlato rilevato, non un audio a un altro.

---

## 20. Glossario e cronologia

**Glossario**

| Termine | Significato |
|---|---|
| Riferimento | Il file senza audio italiano, da cui si tengono video, capitoli e tutte le tracce; di norma ha il video migliore (il merge si rifiuta solo se il donatore è chiaramente migliore, §3.2) |
| Donatore | Il file con l'audio italiano, da cui si prendono solo le tracce italiane |
| Lingua di misura | La lingua (di norma l'inglese) presente in entrambi i file, usata per misurare S |
| S | Spostamento: posizione nel riferimento − posizione nel donatore |
| Ancora | Tratto usato per la misura iniziale di S |
| Punto di conferma | Tratto usato per verificare S lungo il film; esiti: coerente, non conclusivo, contraddittorio, senza corrispondenza |
| Materiale in comune | Il tratto dei due film allineato con S |
| Copertura | Materiale in comune ÷ durata del video di riferimento |
| Deriva | Pendenza dello spostamento lungo il film, in ms all'ora (§4.5). Le differenze di velocità tipiche (1,001, PAL) non danno deriva ma `NO_MATCH` (§4.4, §18) |
| Remux | Riscrittura del contenitore spostando pacchetti, senza ricodificare |
| PGS | Sottotitoli a immagini dei Blu-ray |
| Forced | Sottotitoli che traducono solo scritte o dialoghi in un'altra lingua |
| Intermedio | File temporaneo con le sole tracce italiane, già spostate e tagliate |

**Cronologia**

- **0.1:** prima stesura dalla conversazione di progetto.
- **0.2:** revisione indipendente (7 revisori, ogni problema controllato da due verificatori, più un controllo di completezza) e prove sperimentali. Modifiche principali:
  - **Definizioni:** "italiano" = audio; lingua di misura generalizzata (§3).
  - **Lettura dell'audio:** regola per leggere le finestre senza errori (§4.3).
  - **Misura iniziale:** ancore multiple, intervallo di ricerca indipendente dalle durate, confidenza su due numeri (§4.4).
  - **Punti di conferma:** quarto esito "senza corrispondenza", deriva come pendenza, copertura per distribuzione dei punti (§4.5, §9.3).
  - **Nuovi controlli:** confini del materiale in comune, controllo di trasferimento, controllo di integrità (§4.6–4.8).
  - **Costruzione del file:** ricetta mkvmerge esplicita (flag, capitoli, compressione dei PGS, TrueHD, FLAC) (§6).
  - **Sottotitoli:** luminosità su HDR e riconoscimento dei forced (§7).
  - **Soglie:** fisse e non modificabili a ogni esecuzione (§9).
  - **Contratto:** report JSON, codici di uscita compatibili con Node, errori separati dai rifiuti (§11–12).
  - **Wayfinderr:** descrizione corretta del suo funzionamento attuale e del ciclo di vita dei file (§15).
  - **Test:** piano riscritto, con le soglie tarate su coppie reali (§15).
  - **Decisioni aperte** passate da 6 a 12 (§17).
  - **Ultimo controllo** di coerenza interna e di fedeltà alle verifiche, con le relative correzioni.
- **0.3:** decisioni dell'utente.
  - **Lingua originale:** non si ricava dai file; si indica con `--original-language` (§3.3).
  - **Scelte dell'utente:** coda, tracce italiane, PGS italiani del riferimento e audio fuori dal materiale in comune si decidono con un'opzione, una variabile d'ambiente o al momento del merge; in Wayfinderr diventano impostazioni della GUI (§10.1). Nuovo errore `CHOICE_REQUIRED`.
  - **Traccia principale** definita (§8).
  - **Licenza:** MIT (§14).
- **0.4:** funzione di decisione.
  - **Taratura:** limiti dei parametri e valori provvisori di θ_ncc, θ_rapporto, E_min e della fascia di `MEASURE_MIX_DIFFERS`; file versionato `src/calibration.json` (§9.2).
  - **Regole della decisione:** ordine e arresto al primo controllo bloccante, picco sicuro, accordo tra le ancore, classificazione dei punti, deriva come retta che spiega tutti i punti, forma della contraddizione, confini, video, controllo di trasferimento (§9.6).
- **0.5:** lettura degli ingressi.
  - **Integrità:** lettura della coda del file senza ffmpeg, fine dei pacchetti, durata dichiarata nelle due letture, tracce controllate (audio e video), casi non verificabili; nuovo parametro `integrityToleranceMs`, provvisorio (§4.8, §9.2, decisione 12).
  - **File in scrittura:** `INPUT_BUSY` anche in analyze, con la finestra `inputBusyMs` di 30 s, le date nel futuro e i cambiamenti durante la lettura (§10).
  - **Programmi esterni:** mkvmerge almeno v57 (`TOOL_TOO_OLD`), ffmpeg e ffprobe presenti (`TOOL_MISSING`); versione minima di ffmpeg rimandata alla lettura delle finestre (§13).
- **0.6:** lettura delle finestre audio.
  - **Metodo provato a mano:** comando ffmpeg, timestamp dei campioni da `ashowinfo`, buchi oltre 2 ms riempiti, passa-basso nel ricampionamento, più tracce nella stessa lettura, byte letti (§4.3, §18).
  - **Canale centrale:** quando una traccia "lo ha", mono e disposizioni sconosciute (§4.2).
  - **Costanti del metodo:** pre-roll 2 s, buchi oltre 2 ms, finestra troppo corta sotto il 90% dei campioni attesi (`INPUT_UNREADABLE`, §4.3, §4.8); non sono parametri di taratura (§9.2).
  - **ffmpeg almeno 6.1** (`TOOL_TOO_OLD`, §13).
- **0.7:** correlazione.
  - **Confidenza dei picchi:** posizione con la correlazione sbiancata nella banda 20 Hz – 3 kHz, rifinitura NCC con parabola, somiglianza con il donatore interpolato tra i campioni, unicità sull'NCC e non sulla correlazione sbiancata (§4.4, §18).
  - **Coppie di tracce:** tutte sulla prima ancora con un picco sicuro, parità entro 0,02 (§4.2).
  - **Ancore:** posizioni, due ancore sicure bastano, diagnosi di velocità sul tratto della prima (§4.4).
  - **Punti di conferma:** finestre di 10 s (provvisorie), ricerca vicina ±1 s, spostamento sul contenuto dentro l'intervallo del punto, punti aggiunti solo per la regola di §9.3 (§4.5).
  - **Confini:** "in comune" vuol dire un picco sicuro vicino a S; prima l'estremo, poi a metà per volta, finestre lunghe e poi brevi, precisione e ricerche oltre i confini (§4.6).
  - **Trasferimento:** 5 punti, traccia italiana principale, L+R o (L − R)/2 (§4.2, §4.7).
  - **Taratura:** `anchorWindowMs`, `checkpointWindowMs` (provvisorio), `exclusionZoneMs`, `checkpointCount`, `maxCheckpointCount`, `searchMarginMs`, con i limiti; le altre costanti della correlazione sono costanti del metodo (§9.2).
  - **Lettura delle finestre:** `-noaccurate_seek`, per i file con uno `start_time` oltre il pre-roll (§4.3, §18).
- **0.8:** piano di inizio e fine.
  - **Casi e tagli:** estremi del film e dell'italiano, caso all'inizio e alla fine, intro e code diverse oltre la precisione dei confini (1 s), punti di taglio, eccesso in coda sotto 1 s che non conta (§5).
  - **Scelte:** effetto di ogni valore; `--tail` non serve con code diverse e `--edge-mismatch drop` (§10.1).
  - **Partenza brusca:** livello nei 250 ms dopo il taglio, il più alto tra centrale e L+R, letto in ogni punto di taglio possibile (§5).
  - **Sottotitoli:** PGS presi, forced riconosciuti per lingua anche nel riferimento, condizioni di `SDR_SUBS_ON_HDR` e `REFERENCE_HAS_ITALIAN_SUBS` (§7).
  - **Tracce audio:** ruolo stimato con il motivo, `ITALIAN_TRACKS_SKIPPED` per traccia (§8).
  - **Taratura:** `longGapWithoutItalianMs` (10 min), `abruptStartDbfs` (−40 dBFS), `forcedSubsFraction` (15%), tutti provvisori, con i limiti; precisione e tratto del livello sono costanti del metodo (§9.2, decisione 12).
- **0.9:** costruzione del file finale e decisione 7.
  - **Taglio iniziale:** sempre con due passate di `--sync`, anche fuori dallo zero e con FLAC; per TrueHD lo zero cade sul punto di sincronizzazione, riconosciuto dalla firma nei dati, al posto di `--split parts:t-` (§6.1, §6.5, §18).
  - **Taglio finale:** `--split parts:` per ogni punto di taglio, ffmpeg per FLAC; un PGS con un sottotitolo a cavallo di un taglio prima della fine del video si taglia all'inizio del sottotitolo (§6.5, §7).
  - **Unione finale:** default sulla traccia video principale, forced dei PGS riconosciuti come forced, compressione a ogni passata, intermedi senza titolo (§6.5).
  - **Esito:** ogni passata di mkvmerge, crash compresi; un disco che si riempie è `NO_SPACE`, non `MERGE_FAILED` (§6.3).
  - **Temporanei:** cartelle di lavoro per host e processo, avanzi eliminati all'avvio, rinomina con un link fisico che non sovrascrive (§6.4).
  - **Sottotitoli persi ai tagli:** dai blocchi PGS dei 30 s prima del taglio (§7).
  - **Costanti del metodo:** margine di spazio 2 GiB, ricerca del punto di sincronizzazione TrueHD 1 s, 30 s per i sottotitoli a schermo (§9.2, §13).
  - **Decisione 7 chiusa:** container separato con profilo Compose, protocollo a file job come il runner MakeMKV, volumi, immagine propria multi-architettura; motivi del repo pubblico rivisti (§14, §17).
- **0.10:** verifiche dopo il merge.
  - **Cosa si legge e si confronta:** il file finale come un ingresso, più dati del codec, metadati video, titolo e capitoli; tracce, video, pacchetti delle tracce del riferimento (dai tag statistici, contati se mancano), inizio e fine dell'italiano, durata (§9.5).
  - **Tolleranze "entro un pacchetto"** per codec, costanti del metodo in `src/verify.ts` (§9.2, §9.5).
  - **Bloccanti e avvisi:** tutte bloccanti tranne il trasferimento sul file finale, che dà `OUTPUT_TRANSFER_OFFSET` e `OUTPUT_TRANSFER_UNVERIFIED` (§4.7, §9.5, §12). Un file finale che non si legge è `VERIFY_FAILED`.
  - **TrueHD alla fine:** mkvmerge divide solo sui punti di sincronizzazione, quindi il taglio finale può cadere fino a circa 107 ms dopo e (§6.5, §18).
- **0.11:** riga di comando e report.
  - **Argomenti e report:** errori degli argomenti, percorso predefinito del report, report scritto sempre (anche per `BAD_ARGUMENTS`), mai al posto di un ingresso o del file finale; `--help` e `--version` senza report (§10).
  - **Ordine:** file finale e temporanei controllati prima di leggere gli ingressi; `--expect` a pezzi, appena si può (§9.4, §10).
  - **`--expect`:** impronte in qualsiasi ordine e senza i percorsi, ruoli, S, piano salvo quello che era in sospeso (§10).
  - **Scelte chieste in un terminale:** solo senza `--progress json`, in un ordine fisso, con il piano ricalcolato dopo ogni risposta (§10, §10.1).
  - **Annullamento:** segnali, report `cancelled`, secondo segnale (§10).
  - **Forma esatta del report**, versione del formato 1, eventi di `--progress json` (§11.3).
- **0.12:** decisioni sull'integrazione con Wayfinderr e ingressi dopo il merge.
  - **Decisione 3 chiusa:** un merge rifiutato lascia i file trattenuti, con il motivo e le azioni nella GUI (§15, §17).
  - **Decisione 4 chiusa:** ingressi trattenuti finché non arriva il gemello o non li cancelli; con il gemello già caricato, sempre una tua scelta (§15, §17).
  - **Decisione 5 chiusa:** nome normale del film; se il file c'è già, Wayfinderr chiede se cancellarlo o fermarsi (§15, §17).
  - **Decisione 6 chiusa:** tenerli o cancellarli, impostazione di Wayfinderr; da riga di comando `--inputs keep|delete`, chiesto in un terminale dopo un merge riuscito, altrimenti si tengono; nuovo avviso `INPUT_NOT_DELETED` (§10, §10.2, §11.3, §12, §17).
  - **Decisione 11 chiusa:** voce di menu sempre visibile, come Rips (§15, §17).
- **0.13:** un file finale che c'è già.
  - **Da riga di comando** in un terminale si chiede se cancellarlo e andare avanti; si cancella solo dopo le verifiche, se è ancora lui, e mai se è un ingresso o un report. Senza terminale `OUTPUT_EXISTS` (§6.4, §10).
- **0.14:** runner dei file job e immagine Docker.
  - **Percorsi:** le cartelle condivise montate sotto `/data` per nome, `/data/watch` la cartella sorvegliata; nel job percorsi relativi a `/data` (§14.1).
  - **File job:** nome, formato `chiave=valore`, chiavi uguali alle opzioni più `command` e `input`; errori del job decisi dal runner, il resto dalla riga di comando (§14.1).
  - **Un lavoro:** dal più vecchio, cartella guardata ogni secondo, `.log` dallo stderr, `.cancel` con un solo SIGTERM, report scritto dal runner se Dyadrr non lo scrive, `.exit` sempre per ultimo e mai senza `.json`; il runner non cancella niente (§14.1).
  - **Lavori interrotti:** all'avvio un `.run` senza `.exit` non si rilancia: `.exit` dal report se c'è, altrimenti il nuovo errore `INTERRUPTED`; hostname fisso perché gli avanzi si eliminino (§6.4, §12, §14.1).
  - **`dyadrr.alive`:** ogni 5 s; per Wayfinderr il container è spento dopo 30 s (§14.1).
  - **Immagine:** Alpine 3.22 con Node 22, ffmpeg 6.1.2 e mkvtoolnix 92.0 dai pacchetti di Alpine, tini come init, amd64 e arm64; workflow che ripete la suite sull'immagine e la pubblica su GHCR con i tag `latest`, `sha-…` e la versione (§10, §14, §14.2).
- **0.15:** strumento per le coppie reali della fase 1.
  - **`dyadrr-pairs`:** un terzo eseguibile nell'immagine, che lancia `dyadrr analyze` su un elenco di coppie, una alla volta e ognuna nel suo processo, e ne riassume i report; si usa con le versioni dell'immagine (§14.2, §15).
  - **Elenco:** una sezione `[<id>]` per coppia con righe `chiave=valore` come nel job: ingressi, lingua originale, esito atteso, categorie del punto 3 e del punto 2, S controllato a mano, causa di un rifiuto, note; controllato tutto prima di misurare (§15).
  - **Risultati:** report e log di ogni coppia, `summary.json` e `summary.md`, in una cartella accanto all'elenco; un report della stessa versione si riusa, così una serie interrotta riprende; i report restano a chi misura, nel repo entrano il riassunto e le conclusioni (§15).
  - **Verdetti e riassunto:** `ok`, `good-refused`, `wrong-merge`, `error`, `cancelled`, `missing`; margini dei picchi rispetto a θ_ncc e θ_rapporto, punti sotto E_min, integrità, buchi e livelli del piano; criterio di uscita della fase 1 calcolato dalla serie (§15).
  - **Report:** i picchi misurati di ogni punto di conferma (`local`, `wide`), un campo nuovo che non alza la versione del formato (§11.2, §11.3).
- **0.16:** verifiche dopo il merge sulla prima coppia vera.
  - **Capitoli:** si confrontano inizi e titoli, non più gli UID. Nel merge di un UHD rippato con MakeMKV mkvmerge ha generato UID nuovi per tutti i capitoli, con inizi e titoli identici, e la verifica dava `VERIFY_FAILED` su un file giusto (§9.5).
