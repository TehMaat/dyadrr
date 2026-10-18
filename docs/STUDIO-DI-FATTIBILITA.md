# Dyadrr: studio di fattibilità

Stato: bozza 0.5, ottobre 2026.

Questo documento raccoglie le decisioni prese, quelle ancora aperte e i risultati delle prime verifiche sperimentali (§18). È il punto di partenza del repo.

La 0.2 corregge la 0.1 dopo una revisione indipendente. La 0.3 chiude le decisioni su lingua originale, scelte dell'utente e licenza. La 0.4 fissa i limiti dei parametri di taratura, i valori provvisori delle soglie ancora da tarare e le regole della funzione di decisione (§9.6). La 0.5 fissa le regole della lettura degli ingressi: controllo di integrità, file ancora in scrittura e programmi esterni (§4.8, §10, §13). Le modifiche principali sono elencate in §20.

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
- Nella prova del remix sintetico (§18), il downmix mono completo ha perso la corrispondenza in tutte le finestre, mentre il canale centrale l'ha tenuta in tutte.
- AC3 ed E-AC3 si decodificano **senza compressione dinamica** (DRC). Ogni decoder applica la sua, e falserebbe il confronto.
- **Ricerca grossolana** con una correlazione "sbiancata" (GCC-PHAT), più robusta con la musica. **Rifinitura** con la correlazione normalizzata classica (NCC) e interpolazione parabolica.

**La coppia di tracce**
- Si escludono le tracce marcate come commento o audiodescrizione, o con nomi che lo indicano.
- Nei rip da Blu-ray questi flag di solito mancano, perché il disco non li riporta. Per questo non si sceglie la coppia "guardando i metadati".
- Si misura **ogni coppia possibile** nella lingua di misura (in genere al massimo 3×2) sulla prima ancora (§4.4) e si tiene quella con la corrispondenza migliore. A parità si preferiscono due tracce lossless, poi lo stesso codec.
- Il costo è di pochi secondi, perché le coppie si decodificano nella stessa lettura.

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

**Quanto si legge davvero dal disco.** In un MKV audio e video sono intrecciati, quindi per leggere N secondi di audio si leggono N secondi di **tutto** il file, video compreso. Per un UHD sono decine di MB al secondo, e l'analisi completa legge alcuni GB.

Per ridurli: il pezzo da cercare si prende sempre dal riferimento e la ricerca ampia si fa nel donatore (§4.4, §4.6). Di solito il riferimento è il file più pesante (UHD) e il donatore il più leggero (BD), quindi la lettura è già quella minima.

### 4.4 Misura iniziale: le ancore

1. **Ancore multiple.** Si cerca un tratto di 30 s del riferimento al 15%, 25%, 35% e 50% della durata: sempre oltre lo spostamento massimo S_max (180 s di partenza, §9.2), e mai in un punto solo. Si accetta la prima ancora che passa la soglia, e una seconda ancora deve dare lo stesso S entro la tolleranza.
2. **Intervallo di ricerca simmetrico**, ±(S_max + 60 s), **indipendente dalle durate dei file**.
   - La differenza di durata non dice quanto vale S: un'intro in più da una parte e una coda in più dall'altra possono compensarsi.
   - La differenza di durata si usa solo come indizio e si riporta nel report.
3. **Confidenza: due numeri.**
   - **Somiglianza:** il valore NCC del picco, normalizzato tra −1 e 1. Deve superare una soglia θ_ncc. Se la supera solo di poco (fascia in §9.2, provvisoria), si va avanti con l'avviso `MEASURE_MIX_DIFFERS`.
   - **Unicità:** il rapporto tra il picco e il valore più alto **fuori da una zona di esclusione** intorno al picco (circa ±25 ms). Deve superare una soglia θ_rapporto. Senza zona di esclusione, il "secondo picco" sarebbe il campione accanto e il rapporto sarebbe sempre circa 1.
4. **Esiti:**
   - somiglianza sotto soglia su tutte le ancore: `NO_MATCH`;
   - somiglianza alta ma unicità bassa (per esempio musica ripetitiva): `AMBIGUOUS_MATCH`;
   - un picco sicuro con |S| > S_max: `OFFSET_TOO_LARGE`;
   - due ancore sicure con S diversi oltre la tolleranza: `CHECKPOINT_CONTRADICTION` (lo spostamento cambia a metà film); se una sola ancora passa la soglia, la conferma la danno i punti di conferma (§4.5).
5. **Diagnosi di velocità (facoltativa).** Se nessuna ancora trova corrispondenza, si ripete la ricerca ricampionando in memoria il tratto da cercare ai rapporti tipici: 1,001 (24 contro 23,976) e i rapporti PAL. È solo diagnosi e nessun file viene convertito, quindi P5 resta. Una corrispondenza trovata così dà `FPS_MISMATCH` o `PAL_SPEEDUP` con il rapporto misurato. Senza questa diagnosi, le differenze di velocità risultano solo come `NO_MATCH`.

### 4.5 Punti di conferma

1. **Dove.** N punti (30 di partenza), distribuiti solo **dentro il materiale in comune** (§4.6).
2. **Prima di correlare si controlla il donatore.** Se la finestra è quasi muta o povera di contenuto (energia sotto una soglia E_min), la si sposta fino a ±60 s in cerca di contenuto. Se non si trova nulla, il punto è **non conclusivo**. Questo esito si decide dall'energia, **mai** dall'assenza di una corrispondenza.
3. **Esiti** di un punto con contenuto:
   - **coerente:** corrispondenza sicura entro la tolleranza da S;
   - **contraddittorio:** corrispondenza sicura a un altro spostamento;
   - **senza corrispondenza:** c'è contenuto ma nessun picco sicuro. Si cerca di nuovo su tutto l'intervallo ±(S_max + 60 s). Se si trova un picco sicuro altrove il punto diventa contraddittorio; se non si trova niente resta senza corrispondenza, ed è **bloccante** come un contraddittorio.

   Senza questo quarto esito, una scena in più nel donatore verso la fine del film passerebbe per "non conclusiva", e il merge riuscirebbe con l'italiano fuori sincrono per tutto l'ultimo tratto.
4. **S definitivo** = mediana degli spostamenti dei punti coerenti, riportata con la sua dispersione.
5. **Deriva.** È la pendenza di una retta robusta che descrive lo spostamento in funzione della posizione nel film. Si misura in ms all'ora; il report dà anche la deriva totale in ms sul tratto verificato. Si controlla **prima** delle contraddizioni, così una tendenza lineare viene riportata come `DRIFT` e non come contraddizione.
6. **Forma della contraddizione.** Quando ci sono punti contraddittori, il report descrive come cambia lo spostamento:
   - un solo salto, con posizione e ampiezza in ms e in fotogrammi;
   - più salti;
   - rumore.

   Un salto di 1–2 fotogrammi indica di solito un master diverso o una giunzione nel rip (§16), non una versione diversa del film.
7. **Più punti dove servono.** Se troppi punti sono non conclusivi, se ne aggiungono nei tratti scoperti, fino a un massimo (per esempio 60). Il report distingue i punti previsti da quelli aggiunti.

### 4.6 Confini del materiale in comune

P2 ammette intro e code **diverse**, non solo in più. Bisogna quindi sapere dove comincia e dove finisce il tratto allineato con S.

- **Ricerca dei confini.** Si fa prima dei punti di conferma: si parte dalle ancore coerenti (§4.4) e si va indietro verso l'inizio, poi avanti verso la fine, a metà per volta con finestre brevi (le finestre mute si spostano come in §4.5). La precisione è di circa 1 s.
- **Prima del confine iniziale e oltre quello finale** si cerca nel donatore una corrispondenza con qualsiasi altro spostamento:
  - se c'è, il film continua a un altro spostamento, cioè c'è una modifica a metà film, e il merge si rifiuta;
  - se non c'è, la coda è davvero diversa.
- **Report:** inizio e fine del materiale in comune, e il tratto effettivamente verificato (dal primo all'ultimo punto coerente).
- **Copertura** = lunghezza del materiale in comune ÷ durata del video di riferimento, misurata.

### 4.7 Controllo di trasferimento (ipotesi H1)

S viene misurato sulla lingua di misura e applicato alla traccia italiana. Funziona solo se, dentro il donatore, l'italiano è allineato con quella lingua.

- **Di solito è vero.** Ma un doppiaggio adattato da un altro master può avere uno sfasamento costante di qualche fotogramma, e una traccia etichettata "ita" può essere in realtà un commento.
- **Come si controlla:** il doppiaggio italiano condivide musica ed effetti con la versione originale. Quindi, dentro il donatore, italiano e lingua di misura correlano a spostamento circa zero sui canali **non centrali**.
- **Cosa si fa:** si misura in 3–5 punti, senza costi di lettura aggiuntivi rilevanti.
  - Uno sfasamento costante diverso da zero dà l'avviso `ITALIAN_TRANSFER_OFFSET`, con il valore.
  - Nessuna correlazione da nessuna parte dà l'avviso `ITALIAN_UNVERIFIED`.
  - All'inizio sono solo avvisi; diventano bloccanti se la fase 1 li dimostra affidabili.
- **Seconda misura indipendente:** lo stesso confronto, fatto sul file finale tra italiano e lingua di misura del riferimento, controlla S in modo indipendente. È inserito anche tra le verifiche dopo il merge (§9.5).

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
- **Finestra vuota:** una finestra che decodifica zero campioni, o troppo pochi, è un errore (`INPUT_UNREADABLE`) e non un punto non conclusivo.

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

---

## 6. Costruzione del file finale

Si usa solo mkvmerge, sempre in modalità `--gui-mode` per leggerne l'avanzamento e gli avvisi, come fa Wayfinderr.

**Strumenti:**
- mkvtoolnix **almeno v57**, la prima versione che gestisce correttamente Dolby Vision;
- ffmpeg/ffprobe, solo per l'analisi;
- versioni fissate nell'immagine e scritte nel report.

### 6.1 File intermedio con le sole tracce italiane

Prima si costruisce un file che contiene **solo** l'audio e i PGS italiani del donatore. Lo spostamento (`--sync`) si applica qui, e soltanto qui.

- **Taglio iniziale (S < 0).** mkvmerge scarta interi tutti i pacchetti che iniziano prima dello zero, compreso quello a cavallo dello zero: si perdono fino a circa 32 ms in più per AC3 ed E-AC3, 10,7 ms per DTS, 85–96 ms per FLAC. Il resto della traccia non si sposta di nulla.
- **TrueHD con S < 0.** TrueHD si può decodificare solo a partire da un punto di sincronizzazione completo, che sui Blu-ray può arrivare fino a circa ogni 107 ms. mkvmerge non sposta il taglio su quel punto.

  Il risultato è che la decodifica con ffmpeg, se non riempie i piccoli buchi nei timestamp, suona **tutta** la traccia in anticipo, fino a circa 107 ms (nelle prove 50–67 ms). Lettori e transcoder basati su ffmpeg probabilmente fanno lo stesso: va provato in fase 1.

  **Regola:** sulle tracce italiane non ancora spostate si taglia con `--split parts:t-`, dove t è il primo punto di sincronizzazione dopo |S|. La parte tagliata riparte da zero, quindi poi si sposta di S + t, cioè della differenza t − |S| (tra 0 e circa 107 ms). Anche questo fa parte della costruzione dell'intermedio. Così si perdono al massimo circa 107 ms di italiano all'inizio, e nelle prove l'errore è tornato a zero.
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

### 6.4 File temporanei e nome del file finale

- **Uscita esplicita.** Il file finale si indica con `--output`. Se esiste già, o se è uno dei due ingressi (stesso file fisico), Dyadrr si ferma con l'errore `OUTPUT_EXISTS`. Nessuna opzione di sovrascrittura.
- **File temporanei** in una cartella che inizia con un punto, **sullo stesso disco** del file finale (per esempio `<cartella>/.dyadrr/<lavoro>/`). Due motivi:
  - il watcher di Wayfinderr ignora i percorsi in cui una cartella o il nome del file inizia con un punto (e i nomi con `~tmp`), mentre carica qualsiasi altro `.mkv` stabile da 30 s;
  - un rename tra dischi diversi fallisce.
- **Rinomina atomica** al nome finale solo dopo la verifica.
- **Avanzi di un'interruzione brusca:** restano solo nella cartella temporanea, e si eliminano all'avvio successivo.

---

## 7. Sottotitoli PGS

- **Spostamento:** sono immagini con un tempo associato, quindi lo stesso S li allinea senza toccarli.
- **Al taglio iniziale:**
  - un sottotitolo che è a schermo nel punto di taglio **si perde del tutto**, non viene accorciato;
  - possono restare pezzi orfani del sottotitolo tagliato, che i decoder scartano.

  Il report conta i sottotitoli persi. Ripararli vorrebbe dire modificare i PGS, che è fuori ambito.
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
  - ha molti meno blocchi della traccia italiana più grande (per esempio meno del 10–20%, da tarare). I blocchi si contano dai tag statistici (`NUMBER_OF_FRAMES`); contare i sottotitoli veri vorrebbe dire leggere tutto il file, decine di GB. Nel report il numero di sottotitoli è una stima, salvo quelli persi ai tagli.

  Il report indica come è stata classificata e perché.
- **PGS italiani già nel riferimento:** si tengono dopo quelli del donatore e mai predefiniti, oppure si scartano. È una scelta dell'utente (`--reference-italian-subs`, §10.1). In entrambi i casi scatta l'avviso `REFERENCE_HAS_ITALIAN_SUBS`.
- **Sottotitoli italiani non PGS** nel donatore: si scartano con l'avviso `ITALIAN_SUBS_NOT_PGS`.
- **Avviso sui forced mancanti:** `NO_FORCED_ITALIAN_SUBS` scatta solo se il riferimento ha un forced in un'altra lingua (indizio di scritte straniere a schermo) e il donatore non ha un forced italiano. Altrimenti scatterebbe su quasi tutti i film.
- **Caso noto:** alcuni dischi italiani (tipicamente Disney e Pixar) hanno le scritte in italiano direttamente nel video. Su quei dischi possono mancare i forced per quelle scritte, che sul video inglese restano in inglese.

---

## 8. Tracce audio italiane

Quali tracce prendere è una scelta dell'utente (`--italian`, §10.1), che serve solo se il donatore ha più di una traccia audio italiana:

- **`all`:** tutte le tracce audio italiane, nell'ordine del donatore. Non serve indovinare niente e non si perde niente.
- **`main`:** solo la traccia principale, cioè quella che sarebbe predefinita (sotto). Ogni traccia scartata va nel report (`ITALIAN_TRACKS_SKIPPED`).

Queste regole valgono in entrambi i casi:

- **Traccia predefinita (principale):** quella italiana già marcata come predefinita nel donatore; altrimenti la prima traccia audio italiana che non sembri un commento o un'audiodescrizione (sotto); altrimenti la prima traccia audio italiana.
- **Commenti e audiodescrizione:** si riconoscono dai flag commento o non vedenti, o da parole nel nome (commento, audiodescrizione, non vedenti, AD). Questi indizi servono solo a **non** rendere predefinita una traccia, mai a scartarla in silenzio. Nei rip da Blu-ray i flag mancano quasi sempre.
- La stessa logica vale per i PGS italiani di commento.

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
| Lunghezza della finestra, zona di esclusione | 30 s per le ancore, finestre di conferma da tarare; ±25 ms | con il modulo di correlazione |
| Punti di conferma | 30, fino a 60 | con il modulo di correlazione |
| Copertura dei punti coerenti (§9.3) | almeno 20 punti coerenti, buco massimo 15 min, un punto nel primo e nell'ultimo 10%, copertura 90% | 10–60 punti (intero), 1–30 min, 2–25%, 50–100% |
| Soglie degli avvisi | `MANY_INCONCLUSIVE` 10%; `MEASURE_MIX_DIFFERS` per una somiglianza sotto θ_ncc + 0,1 (fascia **provvisoria**); `LONG_GAP_WITHOUT_ITALIAN` 10 min; `ABRUPT_START` da tarare | 1–50%; fascia 0–0,5; le altre con il modulo del piano |
| Altre soglie | margine di bitrate 20% (§3.2), forced sotto il 10–20% dei sottotitoli della traccia più grande (§7) | bitrate 5–100%; forced con il modulo del piano |
| Spostamento massimo S_max | 180 s | 1–300 s |
| Framerate uguale | differenza relativa sotto 1e-4 (non uguaglianza esatta: 23,976 si può scrivere in modi diversi) | da 1e-6 a 5e-4: sempre sotto 1e-3, la differenza tra 24 e 23,976 |
| Tolleranza del controllo di integrità (§4.8) | 1 s, **provvisoria** | 50 ms – 5 s |
| Finestra di `INPUT_BUSY` (§10) | 30 s, come Wayfinderr | 5 s – 10 min |

I parametri dei moduli non ancora scritti entrano nel file insieme ai moduli che li usano.

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

### 9.5 Verifiche dopo il merge

Prima della rinomina finale si controlla che:
- il **video** sia identico al riferimento: stessi dati di codec, stesso numero di fotogrammi, primo e ultimo timestamp entro un fotogramma, stessi metadati HDR e Dolby Vision;
- **ogni traccia del riferimento** sia presente con lo stesso numero di pacchetti;
- ogni **traccia italiana** inizi e finisca dove previsto dal piano, entro un pacchetto del suo codec. Si leggono i timestamp del contenitore, non quelli di ffprobe: l'inizio da mkvmerge -J (`minimum_timestamp`), la fine dagli ultimi cluster del file (mkvmerge -J non la riporta);
- la **durata del file** = max(fine del riferimento, fine prevista dell'italiano), entro un pacchetto. Se l'eccesso in coda viene lasciato, la fine attesa è quella dell'italiano;
- **ordine, lingue, flag default e forced, compressione** delle tracce e **capitoli** siano esattamente quelli previsti (§6.2);
- il controllo di trasferimento (§4.7) sul file finale, tra italiano e lingua di misura del riferimento, dia uno spostamento circa zero. All'inizio è solo un avviso.

Se una verifica bloccante fallisce, il file temporaneo viene eliminato ed esce l'errore `VERIFY_FAILED`.

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
- Nell'immagine Docker serve un piccolo init (`init: true` in Compose): un processo Node con PID 1 altrimenti ignora l'arresto normale e viene ucciso dopo 10 s.

**Ingressi:** Dyadrr parte da **due MKV già rippati**, non dai dischi. Il ripping resta compito di MakeMKV o di Wayfinderr.

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
- Con `--edge-mismatch drop` il taglio cade sul confine del materiale in comune, che è noto con circa 1 s di precisione (§4.6). Con `keep` scattano `INTRO_MISMATCH` o `OUTRO_MISMATCH`.

**In Wayfinderr (fase 2)** le stesse quattro scelte diventano impostazioni della GUI, ognuna con un valore fisso oppure "chiedi ogni volta". Wayfinderr passa sempre a Dyadrr le scelte come opzioni, anche quelle preimpostate, così il report registra il valore usato. Con "chiedi ogni volta" la GUI mostra le scelte in sospeso del report di analyze insieme alla conferma del merge.

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
   - per ogni punto di conferma: posizione richiesta e reale, livello di energia, spostamento, scarto, NCC, rapporto, esito;
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
- **Programmi esterni:** mkvmerge almeno v57, ffmpeg e ffprobe. Dyadrr controlla la versione di mkvmerge prima di cominciare (`TOOL_TOO_OLD`) e si ferma se un programma manca (`TOOL_MISSING`); le versioni finiscono nel report (§11.2). La versione minima di ffmpeg si fissa con la lettura delle finestre audio (§4.3): fino ad allora basta che ci sia.
- **Processore:** carico leggero. Correlare alcuni minuti di audio a 8 kHz richiede secondi.
- **Disco:** è il vero limite.
  - **Analisi:** legge alcuni GB, per i motivi di §4.3.
  - **Merge:** legge l'intero riferimento e scrive l'intero file finale.
- **Spazio libero necessario**, sul disco del file finale: dimensione del riferimento + tracce italiane scelte × 2 (l'intermedio c'è sempre, §6.1) + un margine (per esempio 2 GiB, come Wayfinderr). Le dimensioni delle tracce vengono dai tag statistici; se mancano (§3.2), si stima per eccesso con la dimensione intera del donatore.
- **Ingombro totale** durante il lavoro: i due rip più il file finale, cioè 2,5–3 volte un film.

---

## 14. Architettura e repo

- **Repo separato `dyadrr`.** Ha una vita propria (fase sperimentale, soglie da tarare) e non pesa sulle versioni di Wayfinderr, dove ogni PR verso `main` alza la versione.
- **TypeScript/Node, libreria + riga di comando.** La logica sta nella libreria. Wayfinderr la usa **lanciando la riga di comando come processo figlio** (proposta; l'alternativa del container separato è la decisione aperta 7), come fa già con mkvmerge: si annulla terminando il processo, l'avanzamento arriva come righe, il report come file JSON. Così:
  - un crash o un esaurimento di memoria di Dyadrr non fa cadere gli upload;
  - il contratto (§11) resta identico in tutti i casi.
- **Formato del pacchetto:** se in futuro il backend volesse importare la libreria direttamente, servono un punto d'ingresso compatibile CommonJS e nessun `await` al livello principale, perché il backend di Wayfinderr compila in CommonJS.
- **Immagine Docker:**
  - stessa base del backend (Node 22 su Alpine), con ffmpeg e mkvtoolnix ≥ v57 a versioni fissate;
  - un piccolo init per i segnali;
  - amd64 e arm64, come le immagini di Wayfinderr.
- **Windows:** con Docker Desktop le cartelle Windows montate sono lente per file di decine di GB, e lo sono sia l'analisi (alcuni GB) sia il merge. Se diventa un problema, si tengono i file di prova nel filesystem di WSL2.
- **Licenza MIT**, come Wayfinderr, che così può includere Dyadrr senza vincoli. ffmpeg e mkvtoolnix sono GPL ma vengono lanciati come programmi esterni, quindi non vincolano la licenza di Dyadrr.
- **Repo pubblico (consigliato):**
  - Wayfinderr è pubblico e le sue immagini si scaricano senza login. Un Dyadrr privato incluso nell'immagine pubblica del backend sarebbe comunque distribuito a tutti.
  - Restare privato avrebbe senso solo con un container separato con immagine propria. Servirebbero però credenziali nella CI e nella build, e chi compila Wayfinderr in locale non potrebbe più farlo.

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

**1b. Test sintetici con un taglio a metà film**
- Si tolgono e si ricuciono parti di una copia, sempre senza ricodifica.
- Esito atteso: `CHECKPOINT_CONTRADICTION` o `CHECKPOINT_UNMATCHED`.

**1c. Errore dei codec**
- Si confrontano due codifiche dello stesso mix ottenute solo per remux: TrueHD contro il suo nucleo AC3, DTS-HD MA contro il suo nucleo DTS.
- Lo spostamento vero è zero, quindi qualsiasi valore diverso da zero è l'errore sistematico (§4.9).

**1d. Robustezza della lettura**
- Punti di conferma posti 0–100 ms dopo i fotogrammi chiave, su AC3, FLAC e TrueHD con punti di sincronizzazione rari.
- Un file con `start_time` diverso da zero, una traccia che non parte da zero.
- Richiesti **zero** rifiuti falsi.

**1e. Logica di decisione senza file**
- La decisione è una funzione pura: misure + soglie → report.
- `DRIFT`, `TOO_FEW_CHECKPOINTS`, `AMBIGUOUS_MATCH` e gli avvisi si provano con serie di punti sintetiche.
- `NO_SPACE` con un disco piccolo, `VERIFY_FAILED` con un errore iniettato apposta.
- Una tabella collega **ogni codice** al test che lo produce.
- *Stato (Dyadrr 0.2.0):* funzione di decisione e tabella dei codici fatte (`docs/CODICI.md`, sezione Test). `NO_SPACE`, `VERIFY_FAILED` e gli avvisi del piano arrivano con i rispettivi moduli.

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
- **Ciclo di vita dei due ingressi** (decisione aperta 4):
  - con il merge attivo, **entrambi** i file di una possibile coppia vanno trattenuti prima della coda di upload, qualunque sia la politica del server;
  - il modo può essere un nuovo stato di attesa (richiede una modifica al database) oppure una cartella di ingresso separata, fuori da quella sorvegliata;
  - i file trattenuti vanno protetti da upload, cancellazione, pulizia degli archivi e pulizia dei torrent finché non vengono abbinati o rilasciati.
- **Ripper:** con il merge attivo deve rippare anche un disco senza italiano, tenendo la lingua originale e l'inglese.
- **Abbinamento:** si lavora sugli upload, non sui rip, perché i file rippati a mano con MakeMKV non hanno un rip associato. È manuale, coerente con P3.
- **Nome del file finale:** lo sceglie Wayfinderr e lo passa a Dyadrr con `--output` (decisione aperta 5).
- **Lingua originale:** Wayfinderr la prende da TMDB e la passa con `--original-language` (§3.3).
- **Impostazioni delle scelte** (§10.1): le quattro scelte, ognuna con un valore fisso o "chiedi ogni volta", passate sempre a Dyadrr come opzioni.
- **Pulizia dei torrent** collegata a **entrambi** i torrent di partenza.
- **Interfaccia:**
  - lancio dell'analisi e lettura del report (S, piano, controlli, motivi);
  - conferma, poi merge con `--expect` sul report confermato;
  - avanzamento in tempo reale.
- **Voce di menu** (decisione aperta 11): oggi la voce Rips c'è sempre e, a funzione spenta, mostra come attivarla. Nasconderla quando il merge è spento richiede che il menu legga lo stato dal backend.
- **Concorrenza:** un merge alla volta, in coda con i rip. In alternativa, lo spazio va contato insieme a quello riservato dai lavori in corso: oggi il controllo di spazio del ripper conta solo sé stesso.
- **Lingua:** Dyadrr lavora solo con l'italiano. Il merge si attiva solo se `RIP_LANGUAGE` è `it`.
- **Prima di attivarlo:** si ripete la suite della fase 1 sull'immagine dove Dyadrr girerà davvero, con le sue versioni di ffmpeg e mkvtoolnix.

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

Le decisioni 1, 2, 8, 9 e 10 sono chiuse nella 0.3. La numerazione resta quella della 0.2.

1. ~~**Eccesso italiano in coda**~~ → **scelta dell'utente** (`--tail`, §10.1). Con FLAC `trim` richiede un remux con ffmpeg (§6.1).
2. ~~**Tracce audio italiane**~~ → **scelta dell'utente** (`--italian`, §10.1).
3. **Merge rifiutato in Wayfinderr:** si carica comunque il riferimento senza italiano, si aspetta una scelta nella UI, o non si fa niente? Gli errori (per esempio `NO_SPACE`) non sono rifiuti e non devono mai portare a caricare un file senza italiano.
4. **Ciclo di vita dei due ingressi in Wayfinderr:**
   - quanto si trattiene un rip italiano in attesa del gemello con il video migliore (subito, N ore o giorni, fino a una tua scelta)?
   - cosa si fa se il donatore era già stato caricato?
5. **Nome del file finale e upload:** stesso nome del riferimento, che sul server **sostituisce** quello già caricato, oppure caricamento accanto?
6. **Pulizia dopo il merge:** cosa fare dei due rip di partenza.
7. **Dove gira in fase 2:** processo figlio dentro il container del backend, oppure container separato con profilo Compose (avevi chiesto se si potesse fare in un container a parte). Il contratto è lo stesso. Nel container separato servono un protocollo a file job su una cartella condivisa, come quello del runner MakeMKV (§19), i volumi giusti e un'immagine multi-architettura propria.
8. ~~**Repo pubblico o privato**~~ → **licenza MIT**; repo pubblico consigliato (§14).
9. ~~**PGS italiani già presenti nel riferimento**~~ → **scelta dell'utente** (`--reference-italian-subs`, §10.1).
10. ~~**Audio italiano fuori dal materiale in comune**~~ → **scelta dell'utente** (`--edge-mismatch`, §10.1).
11. **Voce di menu "Merge" in Wayfinderr:** nascosta quando il merge è spento, oppure sempre visibile come Rips?
12. **Soglie definitive,** dopo la taratura sulle coppie reali. Fino ad allora θ_ncc, θ_rapporto, E_min, la fascia di `MEASURE_MIX_DIFFERS` e la tolleranza del controllo di integrità hanno valori provvisori (§9.2).

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
