# Contribuire a Dyadrr

## Sviluppo

Requisiti: Node 22, ffmpeg (almeno 6.1) con ffprobe e mkvtoolnix (almeno
v57). Servono anche per `npm test`: i test degli ingressi, delle finestre
audio, della misura e della costruzione generano piccoli MKV veri (la
costruzione usa anche mkvinfo, che è in mkvtoolnix).

```bash
sudo apt-get install ffmpeg mkvtoolnix   # Debian e Ubuntu
```

```bash
npm ci          # dipendenze
npm test        # compila e lancia tutti i test, compresi quelli sulla documentazione
npm run build   # compila la libreria in dist/
```

La struttura del codice è in [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md).

**Lingue:** documentazione e commenti in italiano; codici, messaggi d'errore e
valori del report in inglese, come Wayfinderr.

**Messaggi di commit:** prima riga all'imperativo e al massimo 72 caratteri,
poi un elenco puntato se serve:

```
Aggiungi la scelta della lingua di misura

- Lingua originale, poi inglese, poi un'altra lingua in comune
- Avviso ORIGINAL_LANGUAGE_NOT_COMMON
```

## Versioning

Dyadrr usa il [semantic versioning](https://semver.org), con le stesse regole
di Wayfinderr. La versione sta in `package.json` (e `package-lock.json`, che
`npm version` aggiorna insieme).

**Ogni pull request verso `main` alza la versione**, mai la abbassa:

- **patch** (`0.1.0` → `0.1.1`): solo correzioni;
- **minor** (`0.1.1` → `0.2.0`): nuove funzioni o comportamenti diversi;
- **major** (`0.x` → `1.0.0`): solo quando lo decide il maintainer. Il
  candidato naturale per la 1.0.0 è la chiusura della fase 1, con il
  contratto del report stabile.

```bash
npm version <nuova-versione> --no-git-tag-version
```

Nella stessa PR si aggiunge in cima a [docs/CHANGELOG.md](docs/CHANGELOG.md)
la sezione della nuova versione:

```markdown
## [0.2.0] - AAAA-MM-GG

### Aggiunto
### Modificato
### Corretto
### Rimosso
```

(solo le sottosezioni che servono, con voci scritte per chi usa Dyadrr).

**Controlli automatici**
- In ogni PR la CI verifica che la versione sia più alta di quella di `main`,
  che `package-lock.json` sia allineato e che il CHANGELOG abbia la sezione
  della versione (`npm run check:version -- origin/main` la lancia in locale).
- Al merge su `main` il workflow **Release** crea il tag `vX.Y.Z` e la release
  GitHub, con le note prese dalla sezione del CHANGELOG. Non serve creare il
  tag a mano.

**Versione del formato del report.** È separata dalla versione di Dyadrr ed è
un intero: si alza solo con modifiche incompatibili del report (un campo tolto
o cambiato di significato). Wayfinderr la controlla prima di leggere un
report. Nasce insieme al report (studio §11).

## Documentazione

La documentazione descrive sempre il codice di `main`: **ogni PR aggiorna i
documenti che tocca**, nella stessa PR.

| Cosa cambia | Cosa aggiornare |
|---|---|
| Qualsiasi PR | versione e [docs/CHANGELOG.md](docs/CHANGELOG.md) |
| Comandi, opzioni, variabili d'ambiente, scelte | [docs/CLI.md](docs/CLI.md), e il [README](README.md) se è nell'uso rapido |
| Codici di rifiuto, errore o avviso, codici di uscita | [docs/CODICI.md](docs/CODICI.md) |
| Un codice che un test produce per la prima volta | la sezione **Test** di [docs/CODICI.md](docs/CODICI.md) |
| Valori o limiti di taratura (`src/calibration.json`, `src/calibration.ts`) | [docs/TARATURA.md](docs/TARATURA.md); per i limiti e per i valori che smettono di essere provvisori anche lo studio (§9.2) |
| File in `src/` aggiunti, rinominati o tolti | [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md) |
| Una voce passa da "previsto" a implementata | la colonna o la riga **Stato** in [docs/CLI.md](docs/CLI.md) |
| Una decisione di progetto o una regola del metodo | [docs/STUDIO-DI-FATTIBILITA.md](docs/STUDIO-DI-FATTIBILITA.md), con una voce nella cronologia (§20) |

Lo studio di fattibilità è la fonte delle decisioni: se il codice deve
scostarsene, si aggiorna prima lo studio.

`test/docs.test.ts` fa fallire `npm test` se:
- [docs/CODICI.md](docs/CODICI.md) non elenca esattamente i codici di
  `src/codes.ts`, con i codici di uscita giusti;
- [docs/CLI.md](docs/CLI.md) non riporta ogni scelta con la sua opzione, la
  sua variabile d'ambiente e i suoi valori, o cita una variabile `DYADRR_*`
  che non esiste;
- la sezione **Test** di [docs/CODICI.md](docs/CODICI.md) non collega ogni
  codice a un test che esiste e usa quel codice, o a un modulo previsto;
- [docs/TARATURA.md](docs/TARATURA.md) non riporta ogni parametro di taratura
  con il valore del file, i limiti del codice e lo stato (provvisorio o no);
- [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md) non elenca esattamente i file
  `.ts` e `.json` di `src/`;
- [docs/CHANGELOG.md](docs/CHANGELOG.md) non ha la sezione della versione di
  `package.json`.

## Pull request

1. Un branch per modifica, PR verso `main`.
2. Versione alzata e CHANGELOG aggiornato.
3. Documentazione aggiornata (tabella sopra).
4. Test per il codice nuovo; `npm test` verde.
