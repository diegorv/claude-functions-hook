// Generic text helpers; nothing here knows what a run is.

// Fixed width below one hour (`0m10s`, `3m09s`) so columns line up.
export function elapsed(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}h${twoDigits(totalMinutes % 60)}m`;
  return `${totalMinutes}m${twoDigits(totalSeconds % 60)}s`;
}

const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}]/u; // combining marks, joiners, variation selectors
const WIDE =
  /[\p{Emoji_Presentation}\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;

// The cells one character adds after one that took `previous`: VS16 (U+FE0F)
// turns a one-cell base into a two-cell emoji, so it adds one there.
const charCells = (char: string, previous: number) =>
  char === "\ufe0f" ? (previous === 1 ? 1 : 0) : ZERO_WIDTH.test(char) ? 0 : WIDE.test(char) ? 2 : 1;

// The terminal cells a line takes: two for an emoji or an East Asian wide
// character, none for a combining mark or a joiner, one for the rest. The
// ambiguous-width glyphs (◐ ● ⊘) count one, as terminals draw them outside
// East Asian locales.
export function cells(text: string): number {
  let width = 0;
  let previous = 0;
  for (const char of text) {
    previous = charCells(char, previous);
    width += previous;
  }
  return width;
}

// The first line, cut to `maxCells` terminal cells with an ellipsis, without
// the control characters the engine rejects or the bidi overrides that reorder
// what follows them.
export function cut(text: string, maxCells: number): string {
  const firstLine = text
    .split("\n")[0]
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (cells(firstLine) <= maxCells) return firstLine;
  let kept = "";
  let width = 0;
  let previous = 0;
  for (const char of firstLine) {
    previous = charCells(char, previous);
    if (width + previous + 1 > maxCells) break;
    kept += char;
    width += previous;
  }
  return `${kept}…`;
}
