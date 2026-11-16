# Glossario

Le parole di Dyadrr, in ordine alfabetico. Tra parentesi la sezione dello
[studio di fattibilità](STUDIO-DI-FATTIBILITA.md) che le definisce; il
glossario breve dello studio è in §20.

| Parola | Significato |
|---|---|
| **Analisi confermata** | Il report di un `analyze` che si passa al merge con `--expect`: il merge fa esattamente quel piano, o si ferma con `INPUT_CHANGED` (§10) |
| **Ancora** | Una finestra audio lunga (30 s) in cui si cerca lo spostamento su tutto l'intervallo di ricerca: dà il primo S e la diagnosi di velocità (§4.4) |
| **Avviso** | Un fatto da sapere che non ferma il merge, con un codice (`SDR_SUBS_ON_HDR`, `ITALIAN_TRANSFER_OFFSET`…; [CODICI.md](CODICI.md#avvisi)) |
| **Confini** | Inizio e fine del materiale in comune tra i due file: fuori ci sono intro, loghi o code diverse (§4.6) |
| **Contraddizione** | Punti di conferma che corrispondono a un altro spostamento: un montaggio o un master diverso. Rifiuto `CHECKPOINT_CONTRADICTION` (§4.5) |
| **Controllo di trasferimento** | Nel donatore, la verifica che l'italiano sia allineato alla lingua di misura: se è sfasato, lo spostamento giusto per l'inglese non lo è per l'italiano (§4.7) |
| **Copertura** | Materiale in comune ÷ durata del video di riferimento. Troppo poca: `LOW_COVERAGE` (§9.3) |
| **Coppia** | I due rip dello stesso film; in `dyadrr-pairs` una voce dell'elenco, con l'esito atteso ([COPPIE.md](COPPIE.md)) |
| **Deriva** | Pendenza dello spostamento lungo il film, in ms all'ora. Rifiuto `DRIFT` (§4.5). Le differenze di velocità tipiche (1,001, PAL) non danno deriva ma `FPS_MISMATCH`, `PAL_SPEEDUP` o `NO_MATCH` (§4.4) |
| **Donatore** | Il file con l'audio italiano, da cui si prendono tracce e sottotitoli italiani (§3.2) |
| **File job** | Un lavoro scritto da Wayfinderr nella cartella dei job, eseguito dal runner ([CONTAINER.md](CONTAINER.md#il-file-job)) |
| **Forced** | Sottotitoli che compaiono solo dove si parla un'altra lingua o ci sono scritte (§7) |
| **Full Vibe Coded** | Il modo in cui è scritto Dyadrr: codice, test e documentazione con un assistente AI, guidato e rivisto dal maintainer ([README](../README.md#full-vibe-coded)) |
| **Intermedio** | File temporaneo con le sole tracce italiane, già spostate e tagliate, poi unito al riferimento (§6.1) |
| **Lingua di misura** | La lingua presente in entrambi i file con cui si misura lo spostamento: la lingua originale, l'inglese o un'altra in comune (§3.3) |
| **Materiale in comune** | Il tratto del film presente in entrambi i file, tra i confini (§4.6) |
| **NCC** | Correlazione normalizzata tra due finestre audio, da −1 a 1: quanto si somigliano allo spostamento trovato. Sotto la soglia `nccMin` il picco non conta (§4.4) |
| **PGS** | Sottotitoli a immagini dei Blu-ray; si prendono senza ricodificarli (§7) |
| **Piano** | Cosa fare all'inizio e alla fine: tagli, tracce italiane prese, scelte necessarie con l'effetto di ogni valore (§5) |
| **Punto di conferma** | Una finestra breve (10 s) lungo il film in cui si controlla che lo spostamento sia ancora S: almeno 20 punti coerenti, ben distribuiti (§4.5) |
| **Rapporto del picco** | Quanto il picco della correlazione è più alto del secondo: un picco netto è unico. Sotto `peakRatioMin` non è sicuro (§4.4) |
| **Remux** | Riscrittura del contenitore spostando pacchetti, senza ricodificare: tutto quello che fa Dyadrr (§2.1) |
| **Report** | Il file JSON che ogni esecuzione scrive: decisione, motivi, misure, piano, avvisi. È il contratto con Wayfinderr ([REPORT.md](REPORT.md)) |
| **Riferimento** | Il file di cui si tengono video, capitoli e tracce, di norma il video migliore (§3.2) |
| **Rifiuto** | La coppia non va unita, per un motivo con un codice; uscita 20 ([CODICI.md](CODICI.md#rifiuti)) |
| **Runner** | `dyadrr-runner`, il processo che nel container esegue i file job uno alla volta ([CONTAINER.md](CONTAINER.md)) |
| **S** | Lo spostamento, in millisecondi: posizione nel riferimento − posizione nel donatore. Uno solo per tutto il film (§4.1) |
| **Scelta** | Un comportamento che decide chi usa Dyadrr (`--tail`, `--italian`…), con un'opzione, una variabile o una domanda; si chiede solo se serve ([CLI.md](CLI.md#scelte)) |
| **Taratura** | I valori delle soglie, nel file versionato `src/calibration.json`; non si cambiano a ogni esecuzione. **Provvisorio:** un valore ancora da confermare sulle coppie reali ([TARATURA.md](TARATURA.md)) |
| **Verdetto** | In `dyadrr-pairs`, il confronto tra la decisione e l'esito atteso: `ok`, `good-refused`, `wrong-merge`… ([COPPIE.md](COPPIE.md#verdetti)) |
| **Verifiche** | I controlli sul file finale prima di consegnarlo: se uno bloccante non torna, nessun file e `VERIFY_FAILED` (§9.5) |
