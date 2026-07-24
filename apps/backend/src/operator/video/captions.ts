import type { BrandStyle } from '../graphics/slide-templates';

/**
 * Burned-in captions, as an ASS subtitle file.
 *
 * Captions are the single biggest quality lever the reel pipeline has: about a
 * third of people watch short video on mute, and the platforms index caption
 * text for search. A reel without words on screen is a reel most of its
 * audience cannot understand.
 *
 * Why ASS rather than more `drawtext` filters: drawtext draws ONE fixed string
 * over a time range, so captioning a 30-second reel means one filter node per
 * phrase — a filtergraph with hundreds of nodes, each one carrying the same
 * escaping hazards that made a percent sign silently erase the hook (see
 * reel.service.ts). libass reads a single file, so the caption text never
 * touches the filtergraph at all, and it gives us per-word colour, outlines and
 * safe-zone positioning for free. The bundled ffmpeg-static is built with
 * libass — verified before this was written, since without it none of this
 * renders.
 *
 * This module is deliberately pure: transcript in, ASS text out. No ffmpeg, no
 * I/O, no network. Video output cannot be eyeballed in CI, so the craft rules
 * live here where they can be asserted on directly.
 */

/** One word with the timing the transcriber measured, in seconds. */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionStyle {
  /** Brand accent used to highlight the keyword in a line, e.g. "#C9A227". */
  accentHex?: string;
  /** Type personality, mapped to the same faces the graphics engine uses. */
  brandStyle?: BrandStyle;
}

/** Words per caption line. The playbook calls for 2–4 at a time. */
const MAX_WORDS_PER_LINE = 4;
/**
 * Longest a single line may hold the screen. A line that outlives its own
 * speech stops reading as "synced to speech" and starts reading as a slideshow,
 * which is the exact failure the caption work exists to fix.
 */
const MAX_LINE_SECS = 2.5;
/**
 * Shortest a line may show. Whisper occasionally returns near-zero durations
 * for clipped words; without a floor those lines flash for a single frame and
 * read as a glitch rather than a caption.
 */
const MIN_LINE_SECS = 0.5;

/**
 * 1080×1920 is the reel canvas; 700px down puts the text in the upper-middle
 * third — clear of Instagram's bottom UI (username, caption, action buttons)
 * and clear of the top corners where the platform draws its own chrome.
 */
const CANVAS_W = 1080;
const CANVAS_H = 1920;
const MARGIN_V = 700;

/** libass needs the font's family name; the file lives in graphics/fonts. */
function captionFont(style: BrandStyle | undefined): string {
  switch (style) {
    case 'editorial':
      return 'Playfair Display';
    case 'luxe':
      return 'Marcellus';
    case 'bold':
      return 'Anton';
    // 'modern' and unset both get the workhorse sans, matching typeSet().
    default:
      return 'Poppins';
  }
}

/**
 * ASS colours are &HAABBGGRR — alpha first, then BLUE, green, red. Getting the
 * byte order wrong does not error, it just renders the brand accent as some
 * unrelated colour, so the channel swap is the whole point of this function.
 */
export function hexToAssColor(hex: string | undefined, fallback = '&H00FFFFFF'): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return fallback;
  const [r, g, b] = [0, 2, 4].map((i) => m[1].slice(i, i + 2).toUpperCase());
  return `&H00${b}${g}${r}`;
}

/** Seconds → ASS's H:MM:SS.cc timestamp (centiseconds, single-digit hour). */
export function assTime(secs: number): string {
  const t = Math.max(0, secs);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  // Rounding centiseconds can carry to 100; letting that print as ".100" makes
  // libass drop the whole event, so normalise the carry rather than clamp it.
  const [ss, ccs] = cs === 100 ? [s + 1, 0] : [s, cs];
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h}:${pad(m)}:${pad(ss)}.${pad(ccs)}`;
}

/**
 * Neutralise the three characters that mean something to libass. Braces open an
 * override block and a backslash escapes — an owner's transcript containing
 * either would otherwise be interpreted as formatting instructions, which at
 * best mangles the line and at worst blanks it.
 */
function escapeAssText(s: string): string {
  return s.replace(/\\/g, '／').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

/** A caption line: the words that show together, and which one is emphasised. */
export interface CaptionLine {
  text: string;
  start: number;
  end: number;
  /** Index within this line's words to highlight in the brand accent. */
  emphasisIndex?: number;
}

/**
 * Group timed words into caption lines. Breaks on sentence-ending punctuation
 * as well as on the word/duration caps, because a line that runs across a full
 * stop reads as two unrelated thoughts stuck together.
 */
export function groupWordsIntoLines(words: TranscriptWord[]): CaptionLine[] {
  const usable = words.filter((w) => w.text.trim().length > 0 && w.end > w.start);
  const lines: CaptionLine[] = [];
  let buf: TranscriptWord[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const start = buf[0].start;
    const spoken = buf[buf.length - 1].end;
    lines.push({
      text: buf.map((w) => w.text.trim()).join(' '),
      start,
      end: Math.max(spoken, start + MIN_LINE_SECS),
      // Emphasise the longest word: the keyword in a phrase is almost always
      // the longest one, and it needs no model call to find.
      emphasisIndex: buf.reduce(
        (best, w, i) => (w.text.trim().length > buf[best].text.trim().length ? i : best),
        0,
      ),
    });
    buf = [];
  };

  for (const w of usable) {
    buf.push(w);
    const spans = w.end - buf[0].start;
    const endsSentence = /[.!?]$/.test(w.text.trim());
    if (buf.length >= MAX_WORDS_PER_LINE || spans >= MAX_LINE_SECS || endsSentence) flush();
  }
  flush();

  // A line must never outlive the next one's entrance: overlapping events stack
  // on screen in libass, printing two captions at once.
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].end > lines[i + 1].start) lines[i].end = lines[i + 1].start;
  }
  return lines.filter((l) => l.end > l.start);
}

/**
 * Render caption lines as a complete ASS file.
 *
 * Outline and shadow are not decoration: footage from a phone is unpredictable,
 * and white text with no outline vanishes the moment the owner films something
 * pale. The outline is what makes captions legible over any frame.
 */
export function buildAssFile(lines: CaptionLine[], style: CaptionStyle = {}): string {
  const font = captionFont(style.brandStyle);
  const accent = hexToAssColor(style.accentHex, '&H0000D7FF');

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${CANVAS_W}`,
    `PlayResY: ${CANVAS_H}`,
    // WrapStyle 2 = no automatic wrapping. Lines are already capped at four
    // words; letting libass re-wrap them would undo the timing-to-speech.
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,' +
      ' BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,' +
      ' BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 8 = top-centre, so MarginV measures down from the top edge and
    // the caption block sits where the playbook wants it regardless of length.
    `Style: Cap,${font},96,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,` +
      `-1,0,0,0,100,100,0,0,1,6,3,8,80,80,${MARGIN_V},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = lines.map((line) => {
    const words = escapeAssText(line.text).split(/\s+/).filter(Boolean);
    const painted = words
      .map((w, i) =>
        i === line.emphasisIndex
          ? // Recolour for the keyword, then hand the line back to the style's
            // white via \r so the emphasis cannot bleed into later words.
            `{\\c${accent}}${w}{\\r}`
          : w,
      )
      .join(' ');
    return `Dialogue: 0,${assTime(line.start)},${assTime(line.end)},Cap,,0,0,0,,${painted}`;
  });

  return [...header, ...events, ''].join('\n');
}

/** Convenience: timed words straight to an ASS file. */
export function captionsToAss(words: TranscriptWord[], style: CaptionStyle = {}): string {
  return buildAssFile(groupWordsIntoLines(words), style);
}
