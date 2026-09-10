import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime } from "./clock.ts";

test("formatTime: local HH:MM:SS, zero padded", () => {
  assert.equal(formatTime(new Date(2026, 0, 1, 19, 4, 5).getTime()), "19:04:05");
  assert.equal(formatTime(new Date(2026, 0, 1, 0, 0, 0).getTime()), "00:00:00");
});
