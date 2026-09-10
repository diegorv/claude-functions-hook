import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, timeFor } from "./clock.ts";

test("formatTime: local HH:MM:SS, zero padded", () => {
  assert.equal(formatTime(new Date(2026, 0, 1, 19, 4, 5).getTime()), "19:04:05");
  assert.equal(formatTime(new Date(2026, 0, 1, 0, 0, 0).getTime()), "00:00:00");
});

test("timeFor: keeps the first time per message, across redraws", () => {
  const drawnAt = new Map<string, string>();
  const first = timeFor(drawnAt, "m1", new Date(2026, 0, 1, 10, 0, 0).getTime());
  assert.equal(timeFor(drawnAt, "m1", new Date(2026, 0, 1, 11, 0, 0).getTime()), first, "a redraw keeps it");
  assert.equal(
    timeFor(drawnAt, "m2", new Date(2026, 0, 1, 11, 0, 0).getTime()),
    "11:00:00",
    "another message is its own",
  );
});
