// Sottotitoli PGS di prova: ffmpeg non sa codificarli, quindi si scrive a mano
// un file .sup (il flusso dei Blu-ray), che mkvmerge sa leggere. Ogni
// sottotitolo è una composizione che mostra un piccolo rettangolo e una che
// toglie tutto.
import { writeFileSync } from 'node:fs';

const WIDTH = 1920;
const HEIGHT = 1080;
const OBJECT = { width: 8, height: 2, x: 100, y: 900 };

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

/** Un file .sup con un sottotitolo per ogni intervallo [inizio, fine] in secondi. */
export function writeSup(path: string, subtitles: readonly (readonly [number, number])[]): string {
  const segments: Buffer[] = [];
  const segment = (seconds: number, type: number, data: Buffer) => {
    const header = Buffer.alloc(13);
    header.write('PG', 0, 'latin1');
    header.writeUInt32BE(Math.round(seconds * 90_000), 2);
    header.writeUInt32BE(0, 6);
    header[10] = type;
    header.writeUInt16BE(data.length, 11);
    segments.push(header, data);
  };
  const window = () => Buffer.concat([Buffer.from([1, 0]), u16(OBJECT.x), u16(OBJECT.y), u16(OBJECT.width), u16(OBJECT.height)]);
  const composition = (number: number, state: number, objects: number) => Buffer.concat([
    u16(WIDTH), u16(HEIGHT), Buffer.from([0x10]), u16(number), Buffer.from([state, 0, 0, objects]),
    ...(objects > 0 ? [u16(0), Buffer.from([0, 0]), u16(OBJECT.x), u16(OBJECT.y)] : []),
  ]);
  // Una riga di pixel del colore 1, poi la fine della riga (RLE dei PGS).
  const line = Buffer.concat([Buffer.alloc(OBJECT.width, 1), Buffer.from([0, 0])]);
  const rle = Buffer.concat(Array.from({ length: OBJECT.height }, () => line));
  const length = rle.length + 4;

  let number = 0;
  for (const [start, end] of subtitles) {
    segment(start, 0x16, composition(number++, 0x80, 1));
    segment(start, 0x17, window());
    segment(start, 0x14, Buffer.from([0, 0, 1, 235, 128, 128, 255]));
    segment(start, 0x15, Buffer.concat([
      u16(0), Buffer.from([0, 0xc0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]),
      u16(OBJECT.width), u16(OBJECT.height), rle,
    ]));
    segment(start, 0x80, Buffer.alloc(0));
    segment(end, 0x16, composition(number++, 0x00, 0));
    segment(end, 0x17, window());
    segment(end, 0x80, Buffer.alloc(0));
  }
  writeFileSync(path, Buffer.concat(segments));
  return path;
}
