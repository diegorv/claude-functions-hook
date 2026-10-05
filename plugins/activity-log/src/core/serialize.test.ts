import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlain } from "./serialize.ts";

test("plain data comes back whole, undefined fields left out", () => {
  const value = { a: 1, b: "x", c: [true, null], d: { e: undefined, f: 2 } };
  assert.deepEqual(toPlain(value), { a: 1, b: "x", c: [true, null], d: { f: 2 } });
  assert.equal(toPlain(undefined), undefined);
});

test("a cycle is [Circular]; the same object twice side by side is kept twice", () => {
  const shared = { n: 1 };
  const loop: Record<string, unknown> = { shared, again: shared };
  loop.self = loop;
  assert.deepEqual(toPlain(loop), { shared: { n: 1 }, again: { n: 1 }, self: "[Circular]" });
});

test("what JSON cannot hold gets a stand-in", () => {
  function named() {}
  async function* stream() {}
  assert.deepEqual(
    toPlain({
      fn: named,
      big: 12345678901234567890n,
      nan: Number.NaN,
      signal: new AbortController().signal,
      promise: Promise.resolve(1),
      stream: stream(),
      symbol: Symbol("s"),
    }),
    {
      fn: "[Function named]",
      big: "12345678901234567890",
      nan: "NaN",
      signal: "[AbortSignal]",
      promise: "[Promise]",
      stream: "[AsyncGenerator]",
      symbol: "Symbol(s)",
    },
  );
});

test("errors, bytes, maps, sets and dates", () => {
  const error = new TypeError("bad");
  const out = toPlain({
    error,
    bytes: new Uint8Array([104, 105]),
    buffer: new Uint8Array([0, 255]).buffer,
    map: new Map([["k", 1]]),
    set: new Set(["a"]),
    date: new Date("2026-10-05T12:00:00.000Z"),
  }) as Record<string, unknown>;
  assert.deepEqual(out.error, { name: "TypeError", message: "bad", stack: error.stack });
  const cause = new Error("inner");
  const coded = Object.assign(new Error("outer", { cause }), { code: "ENOENT" });
  assert.deepEqual(toPlain(coded), {
    name: "Error",
    message: "outer",
    stack: coded.stack,
    cause: { name: "Error", message: "inner", stack: cause.stack },
    code: "ENOENT",
  });
  assert.deepEqual(out.bytes, { base64: "aGk=" });
  assert.deepEqual(out.buffer, { base64: "AP8=" });
  assert.deepEqual(out.map, [["k", 1]]);
  assert.deepEqual(out.set, ["a"]);
  assert.equal(out.date, "2026-10-05T12:00:00.000Z");
});

test("a getter that throws does not throw", () => {
  const value = {
    ok: 1,
    get broken() {
      throw new Error("nope");
    },
  };
  assert.deepEqual(toPlain(value), { ok: 1, broken: "[Thrown: nope]" });
});
