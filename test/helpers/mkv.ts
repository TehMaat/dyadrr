// Piccoli MKV generati al volo con ffmpeg e mkvmerge per i test degli ingressi.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const tempDir = () => mkdtempSync(join(tmpdir(), 'dyadrr-test-'));

export function run(cmd: string, args: readonly string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface SourceAudio {
  frequency: number;
  channels: number;
  /** Secondi; per default quanto il video. */
  seconds?: number;
}

/** Un MKV con video di prova e toni sinusoidali in AC3, scritto da ffmpeg. */
export function ffmpegSource(
  path: string,
  video: { size: string; seconds: number; lossless?: boolean; hevcHdr10?: boolean },
  audio: readonly SourceAudio[],
): string {
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${video.size}:rate=24000/1001`];
  for (const a of audio) {
    const duration = a.seconds === undefined ? '' : `:duration=${a.seconds}`;
    args.push('-f', 'lavfi', '-i', `sine=f=${a.frequency}:sample_rate=48000${duration}`);
  }
  args.push('-t', String(video.seconds), '-map', '0');
  audio.forEach((a, i) => args.push('-map', String(i + 1), `-ac:a:${i}`, String(a.channels)));
  if (video.hevcHdr10) {
    args.push(
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      '-x265-params', 'hdr10=1:max-cll=1000,400:log-level=error',
    );
  } else {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', ...(video.lossless ? ['-qp', '0'] : []));
  }
  args.push('-c:a', 'ac3', path);
  run('ffmpeg', args);
  return path;
}

export function mkvmerge(out: string, args: readonly string[]): string {
  run('mkvmerge', ['-q', '-o', out, ...args]);
  return out;
}

/** Porta la data di modifica a un'ora fa: un file appena scritto è `INPUT_BUSY`. */
export function settle(path: string): string {
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(path, past, past);
  return path;
}
