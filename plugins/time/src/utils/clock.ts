// Wall-clock time as `HH:MM:SS` in the local time zone.
export function formatTime(epochMs: number): string {
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  const date = new Date(epochMs);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(twoDigits).join(":");
}

// The time a message was first drawn, remembered per message id so a redraw keeps it.
export function timeFor(drawnAt: Map<string, string>, id: string, nowMs: number): string {
  const time = drawnAt.get(id) ?? formatTime(nowMs);
  drawnAt.set(id, time);
  return time;
}
