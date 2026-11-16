# Dyadrr pairs

> Il riassunto scritto da `dyadrr-pairs`, con i titoli dei film e gli id
> delle coppie sostituiti da nomi di fantasia ([nomi](../README.md#nomi)).
> Misure, verdetti e cause sono quelli reali.

Written by dyadrr-pairs 0.16.0 on 2026-10-31T14:04:30.837Z. Reports: Dyadrr 0.14.0, 0.13.1, 0.15.0, 0.15.2, 0.16.0, calibration 4, mkvmerge 92.0.0, ffmpeg 6.1.2.

**Warning:** the pairs were not all measured with the same versions.

Imported reports (not measured by this run):

- martello-di-vetro: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- piccoli-malvagi-4: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- lega-dei-custodi: Dyadrr 0.13.1; differences: 0.14.0: contradiction shape: a one-point stretch at an edge of the film is a jump; 0.14.0: warning MAIN_TRACKS_DISAGREE; 0.14.0: transfer check on every track of the measure language; 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- gina-contro-tutti: Dyadrr 0.13.1; differences: 0.14.0: contradiction shape: a one-point stretch at an edge of the film is a jump; 0.14.0: warning MAIN_TRACKS_DISAGREE; 0.14.0: transfer check on every track of the measure language; 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- allieva-del-dojo: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- robottino-r7: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- ora-zero-e-trenta: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- different-film-astronave-martello: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- talpa-del-mais: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- mvc-different-cut: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- tasso-volante-2: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- lontano-zxx: Dyadrr 0.15.2; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- lontano-eng: Dyadrr 0.15.2; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- diventare-volpe: Dyadrr 0.16.0
- pattini-acciaio-1975: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- casa-volante: Dyadrr 0.16.0
- acchiappaspettri-gelo: Dyadrr 0.16.0
- paese-muto: Dyadrr 0.16.0
- pesce-smarrito: Dyadrr 0.16.0
- ultimo-in-citta-alternate: Dyadrr 0.16.0
- isola-chiusa: Dyadrr 0.16.0
- governante-24fps: Dyadrr 0.16.0
- governante-23976: Dyadrr 0.16.0
- giri-veloci: Dyadrr 0.16.0
- otto-minuti: Dyadrr 0.16.0

## Phase 1 exit criterion

| Criterion | Value | Required | Met |
|---|---|---|---|
| Pairs measured | 25 | at least 15 | yes |
| Categories of point 3 | 5 of 7 (missing: non-english, two-discs) | all | no |
| Wrong merges | 0 | 0 | yes |
| Good pairs refused without a cause | 0 | 0 | yes |
| Good uhd-bd pairs refused for jumps of 1–2 frames | 3 of 15 (20%) | measured | yes |

Criterion met: **no**.

## Pairs

| Pair | Categories | Expected | Decision | Verdict | S (ms) | Dispersion (ms) | Anchors (secure) | Checkpoints c/i/x/u | Coverage | Lowest secure NCC / ratio | Warnings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| martello-di-vetro | uhd-bd | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.14.0) | 1 | 0.3 | 2 of 2 | 27/0/2/1 | — | 0.965 / 2.763 | — |
| piccoli-malvagi-4 | uhd-bd | eligible | eligible | ok (imported, 0.14.0) | 0 | 0.4 | 2 of 2 | 30/0/0/0 | 1 | 0.999 / 2.282 | SDR_SUBS_ON_HDR |
| lega-dei-custodi | uhd-bd | eligible | eligible | ok (imported, 0.13.1) | 149 | 0.3 | 2 of 2 | 30/0/0/0 | 0.999 | 0.811 / 1.95 | SDR_SUBS_ON_HDR |
| gina-contro-tutti | uhd-bd | eligible | eligible | ok (imported, 0.13.1) | 0 | 0 | 2 of 2 | 30/0/0/0 | 1 | 1 / 4.649 | ITALIAN_UNVERIFIED, SDR_SUBS_ON_HDR |
| allieva-del-dojo | uhd-bd | eligible | eligible | ok (imported, 0.14.0) | 1002 | 0.7 | 2 of 2 | 30/0/0/0 | 1 | 0.994 / 2.083 | MAIN_TRACKS_DISAGREE, ITALIAN_UNVERIFIED, SDR_SUBS_ON_HDR |
| robottino-r7 | uhd-bd, disney-pixar, long-silences | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.14.0) | 656 | 0.3 | 2 of 2 | 13/0/16/1 | — | 0.999 / 1.562 | MAIN_TRACKS_DISAGREE |
| ora-zero-e-trenta | uhd-bd, distributor-logos | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.14.0) | -23973 | 0.7 | 2 of 2 | 22/0/8/0 | — | 0.999 / 2.784 | MAIN_TRACKS_DISAGREE |
| different-film-astronave-martello | different-film | refused | refused NO_MATCH | ok (imported, 0.14.0) | — | — | 0 of 4 | 0/0/0/0 | — | — | — |
| talpa-del-mais | uhd-bd | eligible | eligible | ok (imported, 0.15.0) | -2002 | 0 | 2 of 2 | 30/0/0/0 | 1 | 1 / 6.858 | SDR_SUBS_ON_HDR |
| mvc-different-cut | different-cut | refused | refused CHECKPOINT_UNMATCHED | ok (imported, 0.15.0) | 179722 | 0.3 | 2 of 2 | 29/0/0/1 | — | 0.999 / 2.011 | — |
| tasso-volante-2 | uhd-bd, distributor-logos | eligible | eligible | ok (imported, 0.15.0) | 24691 | 1.7 | 2 of 2 | 30/0/0/0 | 0.995 | 0.996 / 1.915 | ITALIAN_TRANSFER_OFFSET, SDR_SUBS_ON_HDR |
| lontano-zxx | other | eligible | refused NO_COMMON_LANGUAGE | good-refused (imported, 0.15.2) | — | — | — | — | — | — | — |
| lontano-eng | other | eligible | refused CHECKPOINT_UNMATCHED | good-refused (imported, 0.15.2) | -38417 | 0.3 | 1 of 4 | 22/2/0/6 | — | 1 / 1.511 | — |
| diventare-volpe | disney-pixar | eligible | eligible | ok (imported, 0.16.0) | -1 | 0.3 | 2 of 2 | 30/0/0/0 | 1 | 0.999 / 1.658 | ITALIAN_TRANSFER_OFFSET |
| pattini-acciaio-1975 | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.15.0) | — | — | — | — | — | — | — |
| casa-volante | uhd-bd, disney-pixar, dubbing-card | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.16.0) | 667 | 0.3 | 2 of 2 | 13/0/14/3 | — | 0.999 / 1.894 | MAIN_TRACKS_DISAGREE |
| acchiappaspettri-gelo | uhd-bd | eligible | refused CHECKPOINT_UNMATCHED | good-refused (imported, 0.16.0) | -29 | 0.2 | 2 of 2 | 29/0/0/1 | — | 0.511 / 1.625 | — |
| paese-muto | uhd-bd, long-silences | eligible | refused CHECKPOINT_UNMATCHED | good-refused (imported, 0.16.0) | 0 | 0.2 | 2 of 2 | 26/0/0/4 | — | 0.999 / 1.688 | — |
| pesce-smarrito | uhd-bd, disney-pixar | eligible | eligible | ok (imported, 0.16.0) | 0 | 0.3 | 2 of 2 | 30/0/0/0 | 0.993 | 0.91 / 2.133 | ITALIAN_TRANSFER_OFFSET, SDR_SUBS_ON_HDR |
| ultimo-in-citta-alternate | different-cut | refused | refused LOW_COVERAGE | ok (imported, 0.16.0) | 0 | 0.3 | 2 of 2 | 30/0/0/0 | 0.338 | 0.999 / 2.096 | — |
| isola-chiusa | uhd-bd, distributor-logos | eligible | eligible | ok (imported, 0.16.0) | -18904 | 1.3 | 2 of 2 | 30/0/0/0 | 0.992 | 1 / 1.943 | SDR_SUBS_ON_HDR |
| governante-24fps | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.16.0) | — | — | — | — | — | — | — |
| governante-23976 | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.16.0) | — | — | 0 of 4 | 0/0/0/0 | — | — | — |
| giri-veloci | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.16.0) | — | — | — | — | — | — | — |
| otto-minuti | uhd-bd | eligible | refused NO_MATCH | good-refused (imported, 0.16.0) | — | — | 0 of 4 | 0/0/0/0 | — | — | — |

## Thresholds

| Parameter | Value | Provisional | Margins |
|---|---|---|---|
| `nccMin` | 0.5 | yes | secureAtSMin 0.511 (acchiappaspettri-gelo); unsureAtSMax 1 (robottino-r7); unsureElsewhereMax 1 (martello-di-vetro) |
| `peakRatioMin` | 1.5 | yes | secureAtSMin 1.511 (lontano-eng); unsureAtSMax 1.417 (paese-muto); unsureElsewhereMax 1.209 (martello-di-vetro) |
| `silenceDbfs` | -50 | yes | secureAtSEnergyMin -50 (mvc-different-cut) |
| `integrityToleranceMs` | 1000 | yes | gapMax 54 (isola-chiusa) |
| `longGapWithoutItalianMs` | 600000 | yes | gapMax 24691 (tasso-volante-2) |
| `abruptStartDbfs` | -40 | yes | cutLevelMax -239.7 (talpa-del-mais) |

## Refusals and errors

| Pair | Verdict | Code | Message | Cause |
|---|---|---|---|---|
| martello-di-vetro | good-refused | CHECKPOINT_CONTRADICTION | 2 checkpoint(s) match at another offset: 2 jumps | salto di -27 ms nei primi minuti e di 1 fotogramma (+43 ms) nei titoli di coda, da 123 min, tra TrueHD Atmos e DTS-HD MA |
| robottino-r7 | good-refused | CHECKPOINT_CONTRADICTION | 16 checkpoint(s) match at another offset: noise | spostamento a frame DTS interi (10,67 ms) dal livello 656,4: +1 a 4,8-8,1 min, 0 fino a 31 min, -1/-2 (34-54 min), -2 (57-70), circa -5 e -6 (73-90, 1,5-2 ms sopra il multiplo esatto), di nuovo 0 a 93 min; NCC da 0,94 a 1, stesso audio; lo stesso fenomeno di Casa Volante (rip di MakeMKV), qui forse sommato dal remux |
| ora-zero-e-trenta | good-refused | CHECKPOINT_CONTRADICTION | 8 checkpoint(s) match at another offset: 3 jumps | salti sotto il fotogramma nelle tracce audio dell'UHD, non nel video: sull'AC-3 5.1 #2 contro il DTS-HD +11 ms (3-13 min) e -18 ms (97,6-117,5 min); con il solo TrueHD le ancore non concordano (-23987,8 a 23,5 min, -23971,6 a 39,2 min); TrueHD e AC-3 dello stesso UHD si spostano tra loro di 16 ms |
| different-film-astronave-martello | ok | NO_MATCH | no anchor finds a sufficiently similar match | — |
| mvc-different-cut | ok | CHECKPOINT_UNMATCHED | 1 checkpoint(s) with content match nowhere, first at 1248786.75 ms | — |
| lontano-zxx | good-refused | NO_COMMON_LANGUAGE | no non-Italian audio language is present in both files: rip the Italian disc keeping English or the original language | film senza dialoghi: nel riferimento l'unica traccia è zxx (nessun contenuto linguistico), nel donatore tre tracce ita; nessuna lingua di misura in comune: NO_COMMON_LANGUAGE |
| lontano-eng | good-refused | CHECKPOINT_UNMATCHED | 6 checkpoint(s) with content match nowhere, first at 169114.625 ms | film senza dialoghi, solo musica e ambiente in stereo: 6 punti senza corrispondenza, ma tutti con il picco proprio a S (NCC 1) e poco netto (rapporto da 1,08 a 1,40 contro 1,5); stesso caso del punto a 20:50 di Mostri contro Cacciatori (decisione aperta 8) |
| pattini-acciaio-1975 | ok | FPS_MISMATCH | different frame rates: 23.976023976023978 vs 24 | — |
| casa-volante | good-refused | CHECKPOINT_CONTRADICTION | 14 checkpoint(s) match at another offset: 2 jumps | salti di un frame DTS (10,7 ms) sulla coppia DTS-HD MA/DTS-HD MA: due livelli soli, 656,5 (4,6-17,1 min e un punto a 73,4) e 667 (1,5 min e da 20,2 alla fine), NCC 0,999-1; i coerenti a 666,7 e i contraddittori a 667,3-668 sono lo stesso livello; da capire in quale disco stanno |
| acchiappaspettri-gelo | good-refused | CHECKPOINT_UNMATCHED | 1 checkpoint(s) with content match nowhere, first at 4704145.125 ms | un solo punto senza corrispondenza a 78,40 min: -23,1 dBFS, picco a -31 ms (vicino a S) con NCC 0,42 e rapporto 0,92; il mix Atmos diverso dal 5.1 in quel tratto (tracce.mjs: TrueHD contro AC-3 dello stesso UHD NCC 0,41, le due AC-3 0,80) |
| paese-muto | good-refused | CHECKPOINT_UNMATCHED | 4 checkpoint(s) with content match nowhere, first at 456818.875 ms | 4 punti senza corrispondenza, tutti con il picco proprio a S (da -0,5 a +0,83 ms) con NCC 1 e rapporto 1,05-1,42 contro 1,5: tre in tratti quasi muti (-46/-50 dBFS), uno forte ma ripetitivo (-29 dBFS a 82,6 min); decisione aperta 8 |
| ultimo-in-citta-alternate | ok | LOW_COVERAGE | the common material covers 33.8% of the reference video (minimum 90%) | — |
| governante-24fps | ok | FPS_MISMATCH | different frame rates: 24 vs 23.976023976023978 | — |
| governante-23976 | ok | FPS_MISMATCH | the files match only at a speed ratio of 0.999 | — |
| giri-veloci | ok | FPS_MISMATCH | different frame rates: 24 vs 23.976023976023978 | — |
| otto-minuti | good-refused | NO_MATCH | no anchor finds a sufficiently similar match | audio uguale all'orecchio ma diverso nel segnale: NCC sotto 0,15 con finestre da 1 a 10 s, con la polarita invertita e con velocita da -0,2% a +0,2% (velocita.mjs), mentre lo spostamento grossolano e circa -4,5 s ovunque; probabilmente un audio rielaborato in uno dei due dischi; NO_MATCH prudente |
