import { test } from "node:test";
import assert from "node:assert/strict";
import { cells, cut, elapsed } from "./text.ts";

test("elapsed: fixed width, zero padded", () => {
  assert.equal(elapsed(-5), "0m00s");
  assert.equal(elapsed(9_000), "0m09s");
  assert.equal(elapsed(42_000), "0m42s");
  assert.equal(elapsed(189_000), "3m09s");
  assert.equal(elapsed(3_723_000), "1h02m");
  assert.equal(elapsed(NaN), "0m00s", "an unparsable date must not print NaNmNaNs");
});

test("cut: first line, with an ellipsis", () => {
  assert.equal(cut("abc\ndef", 10), "abc");
  assert.equal(cut("abcdefghij", 5), "abcd…");
});

test("cells: wide characters take two, combining marks none, ambiguous glyphs one", () => {
  assert.equal(cells("abc"), 3);
  assert.equal(cells("🚀"), 2);
  assert.equal(cells("修正"), 4);
  assert.equal(cells("e\u0301"), 1);
  assert.equal(cells("◐ ✗ ⊘ ● ○ ·"), 11);
  assert.equal(cells("✔️"), 2, "a base and VS16");
});

test("cut: counts terminal cells, not code units", () => {
  assert.equal(cut("🚀🚀🚀🚀🚀", 6), "🚀🚀…");
  assert.equal(cut("修正ログイン", 7), "修正ロ…");
  assert.equal(cut("🚀🚀", 4), "🚀🚀");
});

test("cut: control characters are dropped", () => {
  assert.equal(
    cut("a\x1b[31mb\rc", 10),
    "a[31mbc",
    "the ESC and the CR go; what is left of the sequence is plain text",
  );
  assert.equal(cut("a\u202eb\x85cd", 10), "abcd", "a bidi override and a C1 control go too");
});
