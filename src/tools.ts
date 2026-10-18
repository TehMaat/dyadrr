import { execFile, spawn } from 'node:child_process';
import { DyadrrError } from './codes.js';

// Programmi esterni (studio §13): mkvmerge, ffprobe e ffmpeg si lanciano come
// processi, mai come librerie. Un programma che manca è `TOOL_MISSING`; un
// mkvmerge più vecchio di v57 o un ffmpeg più vecchio di 6.1 è `TOOL_TOO_OLD`.

export type ToolName = 'mkvmerge' | 'ffprobe' | 'ffmpeg';

/** Percorso o nome di ogni programma; per default si cercano nel PATH. */
export type ToolPaths = Readonly<Record<ToolName, string>>;

export const DEFAULT_TOOLS: ToolPaths = { mkvmerge: 'mkvmerge', ffprobe: 'ffprobe', ffmpeg: 'ffmpeg' };

/** Versione minima di mkvmerge (studio §13–14). */
export const MIN_MKVMERGE_MAJOR = 57;

/**
 * Versione minima di ffmpeg (studio §13): quella su cui è provato il metodo di
 * lettura delle finestre (§4.3, §18). Per le build da git, senza numero di
 * versione, vale la versione di libavformat di ffmpeg 6.1.
 */
export const MIN_FFMPEG_VERSION = { major: 6, minor: 1 } as const;
export const MIN_LIBAVFORMAT_VERSION = { major: 60, minor: 16 } as const;

export interface ToolResult {
  stdout: string;
  stderr: string;
  /** Codice di uscita; `null` se il processo è stato terminato da un segnale. */
  exitCode: number | null;
}

export interface RunOptions {
  /** Interrompe il programma: il processo riceve SIGTERM e la promessa fallisce con l'errore dell'annullamento. */
  signal?: AbortSignal;
}

/**
 * Lancia un programma e ne raccoglie l'uscita. Un codice di uscita diverso da
 * zero non è un'eccezione: lo valuta chi chiama (mkvmerge esce con 1 per gli
 * avvisi e con 2 per gli errori). Un programma che non si può lanciare è
 * `TOOL_MISSING`.
 */
export function runTool(paths: ToolPaths, tool: ToolName, args: readonly string[], options: RunOptions = {}): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    execFile(paths[tool], args, { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', signal: options.signal }, (error, stdout, stderr) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      if (error && typeof error.code === 'string') {
        // ENOENT, EACCES…: il programma non c'è o non si può eseguire.
        reject(spawnError(paths, tool, error.code));
        return;
      }
      const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;
      resolve({ stdout, stderr, exitCode });
    });
  });
}

const spawnError = (paths: ToolPaths, tool: ToolName, code: string) =>
  new DyadrrError('TOOL_MISSING', `${tool} could not be started (${paths[tool]}): ${code}`);

export interface StreamingOptions extends RunOptions {
  /** Ogni riga di stdout, appena arriva (per mkvmerge `--gui-mode`, l'avanzamento). */
  onLine?: (line: string) => void;
  /** Variabili d'ambiente in più. */
  env?: Readonly<Record<string, string>>;
}

/**
 * Come `runTool`, ma legge stdout riga per riga mentre il programma lavora e
 * si può interrompere: serve per mkvmerge e ffmpeg nella costruzione, che
 * durano minuti.
 */
export function runToolStreaming(
  paths: ToolPaths,
  tool: ToolName,
  args: readonly string[],
  options: StreamingOptions = {},
): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(paths[tool], args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ? { ...process.env, ...options.env } : process.env,
      signal: options.signal,
    });
    const stdout: string[] = [];
    const stderr: Buffer[] = [];
    let pending = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      stdout.push(d);
      const lines = (pending + d).split(/\r?\n|\r/);
      pending = lines.pop()!;
      for (const line of lines) options.onLine?.(line);
    });
    child.stderr!.on('data', (d: Buffer) => stderr.push(d));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (options.signal?.aborted) reject(options.signal.reason);
      else reject(spawnError(paths, tool, error.code ?? String(error)));
    });
    child.on('close', (code) => {
      if (options.signal?.aborted) return;
      if (pending !== '') options.onLine?.(pending);
      resolve({ stdout: stdout.join(''), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code });
    });
  });
}

export interface PipedToolResult {
  stderr: string;
  exitCode: number | null;
  /** Quello che il programma ha scritto sui descrittori 3, 4, … */
  outputs: Buffer[];
}

/**
 * Come `runTool`, ma raccoglie anche `outputs` uscite binarie sui descrittori
 * 3, 4, … (per ffmpeg `pipe:3`, `pipe:4`, …): così una sola lettura dà più
 * flussi separati. stdout non si legge. Si può interrompere come `runTool`.
 */
export function runToolPiped(
  paths: ToolPaths,
  tool: ToolName,
  args: readonly string[],
  outputs: number,
  options: RunOptions = {},
): Promise<PipedToolResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(paths[tool], args, {
      stdio: ['ignore', 'ignore', 'pipe', ...Array.from({ length: outputs }, () => 'pipe' as const)],
      signal: options.signal,
    });
    const stderr: Buffer[] = [];
    const chunks: Buffer[][] = Array.from({ length: outputs }, () => []);
    child.stderr!.on('data', (d: Buffer) => stderr.push(d));
    chunks.forEach((list, i) => child.stdio[3 + i]!.on('data', (d: Buffer) => list.push(d)));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (options.signal?.aborted) reject(options.signal.reason);
      else reject(spawnError(paths, tool, error.code ?? String(error)));
    });
    child.on('close', (code) => {
      if (options.signal?.aborted) return;
      resolve({
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code,
        outputs: chunks.map((list) => Buffer.concat(list)),
      });
    });
  });
}

export interface MkvmergeVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Legge la versione da `mkvmerge --version` ("mkvmerge v82.0 ('…') 64-bit"). */
export function parseMkvmergeVersion(text: string): MkvmergeVersion | null {
  const m = /\bmkvmerge v(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

/** Prima riga di `ffmpeg -version` o `ffprobe -version`, senza il copyright. */
export function parseFfmpegVersion(tool: 'ffmpeg' | 'ffprobe', text: string): string | null {
  const m = new RegExp(`^${tool} version (\\S+)`, 'm').exec(text);
  return m?.[1] ?? null;
}

export interface FfmpegRelease {
  major: number;
  minor: number;
}

/**
 * Versione di ffmpeg confrontabile con il minimo: dal numero di versione
 * ("6.1.1-3ubuntu5", "n7.0.2", "7.0.2-static"), oppure, per le build da git
 * ("N-112345-g…"), da libavformat. `null` se non si legge né l'uno né l'altra.
 */
export function ffmpegRelease(text: string): { release: FfmpegRelease; from: 'version' | 'libavformat' } | null {
  const version = /^ffmpeg version n?(\d+)\.(\d+)/m.exec(text);
  if (version) return { release: { major: Number(version[1]), minor: Number(version[2]) }, from: 'version' };
  const lavf = /^\s*libavformat\s+(\d+)\.\s*(\d+)\./m.exec(text);
  if (lavf) return { release: { major: Number(lavf[1]), minor: Number(lavf[2]) }, from: 'libavformat' };
  return null;
}

const atLeast = (v: FfmpegRelease, min: FfmpegRelease) => v.major > min.major || (v.major === min.major && v.minor >= min.minor);

/** Versioni dei programmi, per l'intestazione del report (§11.2). */
export interface ToolVersions {
  mkvmerge: string;
  ffprobe: string;
  ffmpeg: string;
}

/**
 * Controlla che i programmi ci siano e che mkvmerge (almeno v57) e ffmpeg
 * (almeno 6.1) siano abbastanza recenti (§13). Per ffprobe basta che ci sia.
 */
export async function checkTools(paths: ToolPaths = DEFAULT_TOOLS): Promise<ToolVersions> {
  const mkvmerge = await runTool(paths, 'mkvmerge', ['--version']);
  const version = parseMkvmergeVersion(mkvmerge.stdout);
  if (mkvmerge.exitCode !== 0 || version === null) {
    throw new DyadrrError('TOOL_MISSING', `${paths.mkvmerge} --version did not identify itself as mkvmerge`);
  }
  const mkvmergeVersion = `${version.major}.${version.minor}.${version.patch}`;
  if (version.major < MIN_MKVMERGE_MAJOR) {
    throw new DyadrrError(
      'TOOL_TOO_OLD',
      `mkvmerge v${mkvmergeVersion} is too old: at least v${MIN_MKVMERGE_MAJOR} is required`,
    );
  }

  const ffVersion = async (tool: 'ffmpeg' | 'ffprobe') => {
    const result = await runTool(paths, tool, ['-version']);
    const v = parseFfmpegVersion(tool, result.stdout);
    if (result.exitCode !== 0 || v === null) {
      throw new DyadrrError('TOOL_MISSING', `${paths[tool]} -version did not identify itself as ${tool}`);
    }
    return { version: v, text: result.stdout };
  };
  const ffprobe = await ffVersion('ffprobe');
  const ffmpeg = await ffVersion('ffmpeg');
  const release = ffmpegRelease(ffmpeg.text);
  const min = release?.from === 'libavformat' ? MIN_LIBAVFORMAT_VERSION : MIN_FFMPEG_VERSION;
  if (release === null || !atLeast(release.release, min)) {
    const found = release === null
      ? `ffmpeg ${ffmpeg.version}: cannot determine its version`
      : `ffmpeg ${ffmpeg.version} is too old`;
    throw new DyadrrError(
      'TOOL_TOO_OLD',
      `${found}: at least ${MIN_FFMPEG_VERSION.major}.${MIN_FFMPEG_VERSION.minor} is required`,
    );
  }
  return { mkvmerge: mkvmergeVersion, ffprobe: ffprobe.version, ffmpeg: ffmpeg.version };
}
