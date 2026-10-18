import { execFile } from 'node:child_process';
import { DyadrrError } from './codes.js';

// Programmi esterni (studio §13): mkvmerge, ffprobe e ffmpeg si lanciano come
// processi, mai come librerie. Un programma che manca è `TOOL_MISSING`; un
// mkvmerge più vecchio di v57 è `TOOL_TOO_OLD`.

export type ToolName = 'mkvmerge' | 'ffprobe' | 'ffmpeg';

/** Percorso o nome di ogni programma; per default si cercano nel PATH. */
export type ToolPaths = Readonly<Record<ToolName, string>>;

export const DEFAULT_TOOLS: ToolPaths = { mkvmerge: 'mkvmerge', ffprobe: 'ffprobe', ffmpeg: 'ffmpeg' };

/** Versione minima di mkvmerge (studio §13–14). */
export const MIN_MKVMERGE_MAJOR = 57;

export interface ToolResult {
  stdout: string;
  stderr: string;
  /** Codice di uscita; `null` se il processo è stato terminato da un segnale. */
  exitCode: number | null;
}

/**
 * Lancia un programma e ne raccoglie l'uscita. Un codice di uscita diverso da
 * zero non è un'eccezione: lo valuta chi chiama (mkvmerge esce con 1 per gli
 * avvisi e con 2 per gli errori). Un programma che non si può lanciare è
 * `TOOL_MISSING`.
 */
export function runTool(paths: ToolPaths, tool: ToolName, args: readonly string[]): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    execFile(paths[tool], args, { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && typeof error.code === 'string') {
        // ENOENT, EACCES…: il programma non c'è o non si può eseguire.
        reject(new DyadrrError('TOOL_MISSING', `${tool} could not be started (${paths[tool]}): ${error.code}`));
        return;
      }
      const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;
      resolve({ stdout, stderr, exitCode });
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

/** Versioni dei programmi, per l'intestazione del report (§11.2). */
export interface ToolVersions {
  mkvmerge: string;
  ffprobe: string;
  ffmpeg: string;
}

/**
 * Controlla che i programmi ci siano e che mkvmerge sia abbastanza recente.
 * Per ffmpeg non c'è ancora una versione minima: si fissa con la lettura delle
 * finestre audio (§13).
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
    return v;
  };
  return { mkvmerge: mkvmergeVersion, ffprobe: await ffVersion('ffprobe'), ffmpeg: await ffVersion('ffmpeg') };
}
