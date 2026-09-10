import { test } from "node:test";
import assert from "node:assert/strict";
import { cut, elapsed } from "./text.ts";

test("elapsed: fixed width, zero padded", () => {
  assert.equal(elapsed(-5), "0m00s");
  assert.equal(elapsed(9_000), "0m09s");
  assert.equal(elapsed(42_000), "0m42s");
  assert.equal(elapsed(189_000), "3m09s");
  assert.equal(elapsed(3_723_000), "1h02m");
});

test("cut: first line, with an ellipsis", () => {
  assert.equal(cut("abc\ndef", 10), "abc");
  assert.equal(cut("abcdefghij", 5), "abcd…");
});

test("cut: control characters are dropped", () => {
  assert.equal(
    cut("a\x1b[31mb\rc", 10),
    "a[31mbc",
    "the ESC and the CR go; what is left of the sequence is plain text",
  );
});
