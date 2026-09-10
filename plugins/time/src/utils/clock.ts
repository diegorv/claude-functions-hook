// Wall-clock time as `HH:MM:SS` in the local time zone.
export function formatTime(epochMs: number): string {
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  const date = new Date(epochMs);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(twoDigits).join(":");
}
