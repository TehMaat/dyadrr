# Dyadrr pairs

Written by dyadrr-pairs 0.16.0 on 2026-10-31T14:04:30.837Z. Reports: Dyadrr 0.14.0, 0.13.1, 0.15.0, 0.15.2, 0.16.0, calibration 4, mkvmerge 92.0.0, ffmpeg 6.1.2.

**Warning:** the pairs were not all measured with the same versions.

Imported reports (not measured by this run):

- thor-ragnarok: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- despicable-me-4: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- avengers-endgame: Dyadrr 0.13.1; differences: 0.14.0: contradiction shape: a one-point stretch at an edge of the film is a jump; 0.14.0: warning MAIN_TRACKS_DISAGREE; 0.14.0: transfer check on every track of the measure language; 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- scott-pilgrim: Dyadrr 0.13.1; differences: 0.14.0: contradiction shape: a one-point stretch at an edge of the film is a jump; 0.14.0: warning MAIN_TRACKS_DISAGREE; 0.14.0: transfer check on every track of the measure language; 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- next-karate-kid: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- wall-e: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- zero-dark-thirty: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- different-film-star-trek-thor: Dyadrr 0.14.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- the-informant: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- avp-different-cut: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- kung-fu-panda-2: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- away-zxx: Dyadrr 0.15.2; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- away-eng: Dyadrr 0.15.2; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- turning-red: Dyadrr 0.16.0
- rollerball-1975: Dyadrr 0.15.0; differences: 0.16.0: Italian text subtitles taken; forced by blocks within the same format
- up: Dyadrr 0.16.0
- ghostbusters-frozen-empire: Dyadrr 0.16.0
- a-quiet-place: Dyadrr 0.16.0
- finding-nemo: Dyadrr 0.16.0
- i-am-legend-alternate: Dyadrr 0.16.0
- shutter-island: Dyadrr 0.16.0
- housemaid-24fps: Dyadrr 0.16.0
- housemaid-23976: Dyadrr 0.16.0
- rush: Dyadrr 0.16.0
- source-code: Dyadrr 0.16.0

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
| thor-ragnarok | uhd-bd | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.14.0) | 1 | 0.3 | 2 of 2 | 27/0/2/1 | — | 0.965 / 2.763 | — |
| despicable-me-4 | uhd-bd | eligible | eligible | ok (imported, 0.14.0) | 0 | 0.4 | 2 of 2 | 30/0/0/0 | 1 | 0.999 / 2.282 | SDR_SUBS_ON_HDR |
| avengers-endgame | uhd-bd | eligible | eligible | ok (imported, 0.13.1) | 149 | 0.3 | 2 of 2 | 30/0/0/0 | 0.999 | 0.811 / 1.95 | SDR_SUBS_ON_HDR |
| scott-pilgrim | uhd-bd | eligible | eligible | ok (imported, 0.13.1) | 0 | 0 | 2 of 2 | 30/0/0/0 | 1 | 1 / 4.649 | ITALIAN_UNVERIFIED, SDR_SUBS_ON_HDR |
| next-karate-kid | uhd-bd | eligible | eligible | ok (imported, 0.14.0) | 1002 | 0.7 | 2 of 2 | 30/0/0/0 | 1 | 0.994 / 2.083 | MAIN_TRACKS_DISAGREE, ITALIAN_UNVERIFIED, SDR_SUBS_ON_HDR |
| wall-e | uhd-bd, disney-pixar, long-silences | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.14.0) | 656 | 0.3 | 2 of 2 | 13/0/16/1 | — | 0.999 / 1.562 | MAIN_TRACKS_DISAGREE |
| zero-dark-thirty | uhd-bd, distributor-logos | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.14.0) | -23973 | 0.7 | 2 of 2 | 22/0/8/0 | — | 0.999 / 2.784 | MAIN_TRACKS_DISAGREE |
| different-film-star-trek-thor | different-film | refused | refused NO_MATCH | ok (imported, 0.14.0) | — | — | 0 of 4 | 0/0/0/0 | — | — | — |
| the-informant | uhd-bd | eligible | eligible | ok (imported, 0.15.0) | -2002 | 0 | 2 of 2 | 30/0/0/0 | 1 | 1 / 6.858 | SDR_SUBS_ON_HDR |
| avp-different-cut | different-cut | refused | refused CHECKPOINT_UNMATCHED | ok (imported, 0.15.0) | 179722 | 0.3 | 2 of 2 | 29/0/0/1 | — | 0.999 / 2.011 | — |
| kung-fu-panda-2 | uhd-bd, distributor-logos | eligible | eligible | ok (imported, 0.15.0) | 24691 | 1.7 | 2 of 2 | 30/0/0/0 | 0.995 | 0.996 / 1.915 | ITALIAN_TRANSFER_OFFSET, SDR_SUBS_ON_HDR |
| away-zxx | other | eligible | refused NO_COMMON_LANGUAGE | good-refused (imported, 0.15.2) | — | — | — | — | — | — | — |
| away-eng | other | eligible | refused CHECKPOINT_UNMATCHED | good-refused (imported, 0.15.2) | -38417 | 0.3 | 1 of 4 | 22/2/0/6 | — | 1 / 1.511 | — |
| turning-red | disney-pixar | eligible | eligible | ok (imported, 0.16.0) | -1 | 0.3 | 2 of 2 | 30/0/0/0 | 1 | 0.999 / 1.658 | ITALIAN_TRANSFER_OFFSET |
| rollerball-1975 | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.15.0) | — | — | — | — | — | — | — |
| up | uhd-bd, disney-pixar, dubbing-card | eligible | refused CHECKPOINT_CONTRADICTION | good-refused (imported, 0.16.0) | 667 | 0.3 | 2 of 2 | 13/0/14/3 | — | 0.999 / 1.894 | MAIN_TRACKS_DISAGREE |
| ghostbusters-frozen-empire | uhd-bd | eligible | refused CHECKPOINT_UNMATCHED | good-refused (imported, 0.16.0) | -29 | 0.2 | 2 of 2 | 29/0/0/1 | — | 0.511 / 1.625 | — |
| a-quiet-place | uhd-bd, long-silences | eligible | refused CHECKPOINT_UNMATCHED | good-refused (imported, 0.16.0) | 0 | 0.2 | 2 of 2 | 26/0/0/4 | — | 0.999 / 1.688 | — |
| finding-nemo | uhd-bd, disney-pixar | eligible | eligible | ok (imported, 0.16.0) | 0 | 0.3 | 2 of 2 | 30/0/0/0 | 0.993 | 0.91 / 2.133 | ITALIAN_TRANSFER_OFFSET, SDR_SUBS_ON_HDR |
| i-am-legend-alternate | different-cut | refused | refused LOW_COVERAGE | ok (imported, 0.16.0) | 0 | 0.3 | 2 of 2 | 30/0/0/0 | 0.338 | 0.999 / 2.096 | — |
| shutter-island | uhd-bd, distributor-logos | eligible | eligible | ok (imported, 0.16.0) | -18904 | 1.3 | 2 of 2 | 30/0/0/0 | 0.992 | 1 / 1.943 | SDR_SUBS_ON_HDR |
| housemaid-24fps | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.16.0) | — | — | — | — | — | — | — |
| housemaid-23976 | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.16.0) | — | — | 0 of 4 | 0/0/0/0 | — | — | — |
| rush | different-speed | refused | refused FPS_MISMATCH | ok (imported, 0.16.0) | — | — | — | — | — | — | — |
| source-code | uhd-bd | eligible | refused NO_MATCH | good-refused (imported, 0.16.0) | — | — | 0 of 4 | 0/0/0/0 | — | — | — |

## Thresholds

| Parameter | Value | Provisional | Margins |
|---|---|---|---|
| `nccMin` | 0.5 | yes | secureAtSMin 0.511 (ghostbusters-frozen-empire); unsureAtSMax 1 (wall-e); unsureElsewhereMax 1 (thor-ragnarok) |
| `peakRatioMin` | 1.5 | yes | secureAtSMin 1.511 (away-eng); unsureAtSMax 1.417 (a-quiet-place); unsureElsewhereMax 1.209 (thor-ragnarok) |
| `silenceDbfs` | -50 | yes | secureAtSEnergyMin -50 (avp-different-cut) |
| `integrityToleranceMs` | 1000 | yes | gapMax 54 (shutter-island) |
| `longGapWithoutItalianMs` | 600000 | yes | gapMax 24691 (kung-fu-panda-2) |
| `abruptStartDbfs` | -40 | yes | cutLevelMax -239.7 (the-informant) |

## Refusals and errors

| Pair | Verdict | Code | Message | Cause |
|---|---|---|---|---|
| thor-ragnarok | good-refused | CHECKPOINT_CONTRADICTION | 2 checkpoint(s) match at another offset: 2 jumps | salto di -27 ms nei primi minuti e di 1 fotogramma (+43 ms) nei titoli di coda, da 123 min, tra TrueHD Atmos e DTS-HD MA |
| wall-e | good-refused | CHECKPOINT_CONTRADICTION | 16 checkpoint(s) match at another offset: noise | spostamento a frame DTS interi (10,67 ms) dal livello 656,4: +1 a 4,8-8,1 min, 0 fino a 31 min, -1/-2 (34-54 min), -2 (57-70), circa -5 e -6 (73-90, 1,5-2 ms sopra il multiplo esatto), di nuovo 0 a 93 min; NCC da 0,94 a 1, stesso audio; lo stesso fenomeno di Up (rip di MakeMKV), qui forse sommato dal remux |
| zero-dark-thirty | good-refused | CHECKPOINT_CONTRADICTION | 8 checkpoint(s) match at another offset: 3 jumps | salti sotto il fotogramma nelle tracce audio dell'UHD, non nel video: sull'AC-3 5.1 #2 contro il DTS-HD +11 ms (3-13 min) e -18 ms (97,6-117,5 min); con il solo TrueHD le ancore non concordano (-23987,8 a 23,5 min, -23971,6 a 39,2 min); TrueHD e AC-3 dello stesso UHD si spostano tra loro di 16 ms |
| different-film-star-trek-thor | ok | NO_MATCH | no anchor finds a sufficiently similar match | — |
| avp-different-cut | ok | CHECKPOINT_UNMATCHED | 1 checkpoint(s) with content match nowhere, first at 1248786.75 ms | — |
| away-zxx | good-refused | NO_COMMON_LANGUAGE | no non-Italian audio language is present in both files: rip the Italian disc keeping English or the original language | film senza dialoghi: nel riferimento l'unica traccia è zxx (nessun contenuto linguistico), nel donatore tre tracce ita; nessuna lingua di misura in comune: NO_COMMON_LANGUAGE |
| away-eng | good-refused | CHECKPOINT_UNMATCHED | 6 checkpoint(s) with content match nowhere, first at 169114.625 ms | film senza dialoghi, solo musica e ambiente in stereo: 6 punti senza corrispondenza, ma tutti con il picco proprio a S (NCC 1) e poco netto (rapporto da 1,08 a 1,40 contro 1,5); stesso caso del punto a 20:50 di Alien vs. Predator (decisione aperta 8) |
| rollerball-1975 | ok | FPS_MISMATCH | different frame rates: 23.976023976023978 vs 24 | — |
| up | good-refused | CHECKPOINT_CONTRADICTION | 14 checkpoint(s) match at another offset: 2 jumps | salti di un frame DTS (10,7 ms) sulla coppia DTS-HD MA/DTS-HD MA: due livelli soli, 656,5 (4,6-17,1 min e un punto a 73,4) e 667 (1,5 min e da 20,2 alla fine), NCC 0,999-1; i coerenti a 666,7 e i contraddittori a 667,3-668 sono lo stesso livello; da capire in quale disco stanno |
| ghostbusters-frozen-empire | good-refused | CHECKPOINT_UNMATCHED | 1 checkpoint(s) with content match nowhere, first at 4704145.125 ms | un solo punto senza corrispondenza a 78,40 min: -23,1 dBFS, picco a -31 ms (vicino a S) con NCC 0,42 e rapporto 0,92; il mix Atmos diverso dal 5.1 in quel tratto (tracce.mjs: TrueHD contro AC-3 dello stesso UHD NCC 0,41, le due AC-3 0,80) |
| a-quiet-place | good-refused | CHECKPOINT_UNMATCHED | 4 checkpoint(s) with content match nowhere, first at 456818.875 ms | 4 punti senza corrispondenza, tutti con il picco proprio a S (da -0,5 a +0,83 ms) con NCC 1 e rapporto 1,05-1,42 contro 1,5: tre in tratti quasi muti (-46/-50 dBFS), uno forte ma ripetitivo (-29 dBFS a 82,6 min); decisione aperta 8 |
| i-am-legend-alternate | ok | LOW_COVERAGE | the common material covers 33.8% of the reference video (minimum 90%) | — |
| housemaid-24fps | ok | FPS_MISMATCH | different frame rates: 24 vs 23.976023976023978 | — |
| housemaid-23976 | ok | FPS_MISMATCH | the files match only at a speed ratio of 0.999 | — |
| rush | ok | FPS_MISMATCH | different frame rates: 24 vs 23.976023976023978 | — |
| source-code | good-refused | NO_MATCH | no anchor finds a sufficiently similar match | audio uguale all'orecchio ma diverso nel segnale: NCC sotto 0,15 con finestre da 1 a 10 s, con la polarita invertita e con velocita da -0,2% a +0,2% (velocita.mjs), mentre lo spostamento grossolano e circa -4,5 s ovunque; probabilmente un audio rielaborato in uno dei due dischi; NO_MATCH prudente |
