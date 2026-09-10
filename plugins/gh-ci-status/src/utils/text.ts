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

// The first line, truncated with an ellipsis, without the control characters
// the engine rejects or the bidi overrides that reorder what follows them.
export function cut(text: string, maxLength: number): string {
  const firstLine = text
    .split("\n")[0]
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  const chars = Array.from(firstLine);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("")}…` : firstLine;
}
