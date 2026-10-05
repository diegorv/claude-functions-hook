import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "./register.ts";

type Handler = (...args: any[]) => any;
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const ENGINE = { plugin: "engine", tier: "core" };

// The hooks register() subscribes, and a fake $ whose process.run keeps each file's appends.
function setup() {
  const handlers = new Map<string, Handler>();
  register(
    ((event: string, ...rest: unknown[]) => {
      handlers.set(event, rest.at(-1) as Handler);
      return { catch: () => {} };
    }) as never,
    {} as never,
  );

  const files = new Map<string, string>();
  const timers: (() => void)[] = [];
  const state = { sessionId: "s1" };
  const $ = {
    plugin: { name: "activity-log" },
    process: {
      run: async (argv: readonly string[], init?: { stdin?: string }) => {
        const path = argv.at(-1)!;
        files.set(path, (files.get(path) ?? "") + (init?.stdin ?? ""));
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
    clock: { after: (_ms: number, fn: () => void) => void timers.push(fn), sleep: async () => {} },
    env: { get: async () => "/home/me" },
    session: { id: async () => state.sessionId },
    ui: { log: () => {} },
  };

  const nextFor = (event: string, impl: (e: unknown) => unknown, origin = ENGINE) =>
    Object.assign((e: unknown) => impl(e), { event, origin, signal: new AbortController().signal });
  // Runs one event through the `*` hook, `impl` standing for the chain beneath.
  const dispatch = (event: string, e: unknown, impl: (e: unknown) => unknown, origin = ENGINE, dollar: unknown = $) =>
    handlers.get("*")!(dollar, e, nextFor(event, impl, origin));
  const stream = (event: string, e: unknown, source: AsyncGenerator, origin = ENGINE) =>
    handlers.get(event)!(
      $,
      e,
      nextFor(event, () => source, origin),
    ) as AsyncGenerator;
  const flushTimers = async () => {
    await settle();
    timers.splice(0).forEach((fn) => fn());
    await settle();
  };
  const records = (path: string) =>
    (files.get(path) ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { handlers, files, timers, state, dispatch, stream, flushTimers, records };
}

const today = () => {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};
const pathOf = (id: string) => `/home/me/.claude/activity-log/${today()}-${id}.jsonl`;

test("registers `*`, telemetry.log (which `*` does not select) and the two streaming events", () => {
  assert.deepEqual([...setup().handlers.keys()], ["*", "telemetry.log", "turn.step", "process.spawn"]);
});

test("a telemetry event is recorded like any other", async () => {
  const engine = setup();
  await engine.dispatch("session.start", {}, () => Promise.resolve({}));
  const e = { name: "tengu_x" };
  const result = { ok: true };
  const telemetry = engine.handlers.get("telemetry.log")!;
  const next = Object.assign(() => Promise.resolve(result), { event: "telemetry.log", origin: ENGINE });
  assert.equal(await telemetry({}, e, next), result);
  await engine.flushTimers();
  assert.deepEqual(
    engine.records(pathOf("s1")).map((record) => `${record.seq} ${record.phase} ${record.event}`),
    ["0 start session.start", "0 end session.start", "1 start telemetry.log", "1 end telemetry.log"],
  );
});

test("a call: e passed unchanged, the same result back, a start and an end line on the timer", async () => {
  const engine = setup();
  const e = { tool: "Bash", command: "echo hi", agentId: "a1" };
  const result = { text: "hi" };
  let seen: unknown;
  const answer = await engine.dispatch("tool.call", e, (passed) => {
    seen = passed;
    return Promise.resolve(result);
  });
  assert.equal(seen, e);
  assert.equal(answer, result);
  assert.equal(engine.files.size, 0, "nothing written before the timer");
  await engine.flushTimers();
  const [start, end] = engine.records(pathOf("s1"));
  assert.deepEqual(
    { ...start, ts: undefined },
    { ts: undefined, seq: 0, phase: "start", event: "tool.call", origin: ENGINE, agentId: "a1", input: e },
  );
  assert.equal(end.seq, 0);
  assert.equal(end.phase, "end");
  assert.deepEqual(end.result, result);
  assert.equal(typeof end.durationMs, "number");
});

test("a rejection is rethrown as is and written as an error line", async () => {
  const engine = setup();
  const error = new Error("denied");
  await assert.rejects(
    engine.dispatch("tool.call", {}, () => Promise.reject(error)),
    (thrown) => thrown === error,
  );
  await engine.flushTimers();
  const [, failed] = engine.records(pathOf("s1"));
  assert.equal(failed.phase, "error");
  assert.equal(failed.error.message, "denied");
});

test("a synchronous throw from next is rethrown as is and written as an error line", async () => {
  const engine = setup();
  const error = new Error("sync");
  assert.throws(
    () =>
      engine.dispatch("tool.check", {}, () => {
        throw error;
      }),
    (thrown) => thrown === error,
  );
  await engine.flushTimers();
  const [start, failed] = engine.records(pathOf("s1"));
  assert.equal(start.phase, "start");
  assert.equal(failed.phase, "error");
  assert.equal(failed.error.message, "sync");
});

test("ui.render, ui.resolve, this plugin's own calls and the streams' `*` runs are passed on unwritten", async () => {
  const engine = setup();
  const pass = (value: unknown) => Promise.resolve(value);
  await engine.dispatch("session.cwd", {}, pass); // a first line, so a file exists
  for (const event of ["ui.render", "ui.resolve", "turn.step", "process.spawn"]) {
    assert.deepEqual(await engine.dispatch(event, { event }, pass), { event });
  }
  await engine.dispatch("process.run", { argv: ["sh"] }, pass, { plugin: "activity-log", tier: "user" });
  await engine.flushTimers();
  assert.deepEqual(
    engine.records(pathOf("s1")).map((record) => record.event),
    ["session.cwd", "session.cwd"],
  );
});

test("engine.create's empty $ is written once a real $ arrives", async () => {
  const engine = setup();
  await engine.dispatch("engine.create", {}, () => Promise.resolve({}), ENGINE, {});
  await engine.dispatch("session.start", { cwd: "/" }, () => Promise.resolve({ cwd: "/" }));
  await engine.flushTimers();
  assert.deepEqual(
    engine.records(pathOf("s1")).map((record) => `${record.seq} ${record.phase} ${record.event}`),
    ["0 start engine.create", "0 end engine.create", "1 start session.start", "1 end session.start"],
  );
});

test("turn.step: chunks relayed as they come, unchanged, the result returned; the end line lists them", async () => {
  const engine = setup();
  const chunks = [
    { kind: "text", text: "a" },
    { kind: "text", text: "b" },
  ];
  let pulled = 0;
  async function* beneath() {
    for (const chunk of chunks) {
      pulled++;
      yield chunk;
    }
    return { answer: "ab" };
  }
  await engine.dispatch("session.start", {}, () => Promise.resolve({})); // a stream never comes first
  const relayed = engine.stream("turn.step", { turnId: "t" }, beneath());
  const first = await relayed.next();
  assert.equal(first.value, chunks[0], "the same chunk object");
  assert.equal(pulled, 1, "not read ahead of the reader");
  assert.equal((await relayed.next()).value, chunks[1]);
  assert.deepEqual(await relayed.next(), { done: true, value: { answer: "ab" } });
  await engine.flushTimers();
  const [, , start, end] = engine.records(pathOf("s1"));
  assert.equal(start.event, "turn.step");
  assert.deepEqual(end.chunks, chunks);
  assert.deepEqual(end.result, { answer: "ab" });
});

test("a stream the reader leaves early is closed beneath and marked cancelled", async () => {
  const engine = setup();
  let closed = false;
  async function* beneath() {
    try {
      yield 1;
      yield 2;
    } finally {
      closed = true;
    }
  }
  await engine.dispatch("session.start", {}, () => Promise.resolve({}));
  const relayed = engine.stream("process.spawn", { argv: ["ls"] }, beneath());
  await relayed.next();
  await relayed.return(undefined);
  assert.ok(closed);
  await engine.flushTimers();
  const end = engine.records(pathOf("s1")).at(-1);
  assert.equal(end.cancelled, true);
  assert.deepEqual(end.chunks, [1]);
});

test("session.end writes what waits before it returns; after a /clear the lines go to the new session's file", async () => {
  const engine = setup();
  await engine.dispatch("session.cwd", {}, () => Promise.resolve("/"));
  const ended = { sessionId: "s1" };
  const answer = await engine.dispatch("session.end", { reason: "clear", sessionId: "s1" }, () =>
    Promise.resolve(ended),
  );
  assert.equal(answer, ended);
  assert.deepEqual(
    engine.records(pathOf("s1")).map((record) => `${record.seq} ${record.phase} ${record.event}`),
    ["0 start session.cwd", "0 end session.cwd", "1 start session.end", "1 end session.end"],
    "written without waiting for the timer",
  );
  engine.state.sessionId = "s2";
  await engine.dispatch("session.cwd", {}, () => Promise.resolve("/"));
  await engine.flushTimers();
  assert.deepEqual(
    engine.records(pathOf("s2")).map((record) => `${record.seq} ${record.phase}`),
    ["0 start", "0 end"],
  );
});

test("a stream that rejects mid-way: the same error to the reader, an error line with the chunks so far", async () => {
  const engine = setup();
  const error = new Error("broken");
  async function* beneath() {
    yield "a";
    throw error;
  }
  await engine.dispatch("session.start", {}, () => Promise.resolve({}));
  const relayed = engine.stream("turn.step", {}, beneath());
  assert.equal((await relayed.next()).value, "a");
  await assert.rejects(relayed.next(), (thrown) => thrown === error);
  await engine.flushTimers();
  const end = engine.records(pathOf("s1")).at(-1);
  assert.equal(end.phase, "error");
  assert.equal(end.error.message, "broken");
  assert.deepEqual(end.chunks, ["a"]);
});

test("a reader's throw() reaches the stream beneath, which may go on", async () => {
  const engine = setup();
  const sent = new Error("from the reader");
  let caught: unknown;
  async function* beneath() {
    try {
      yield 1;
    } catch (error) {
      caught = error;
      yield 2;
    }
    return "done";
  }
  await engine.dispatch("session.start", {}, () => Promise.resolve({}));
  const relayed = engine.stream("process.spawn", {}, beneath());
  await relayed.next();
  assert.deepEqual(await relayed.throw(sent), { done: false, value: 2 });
  assert.equal(caught, sent);
  assert.deepEqual(await relayed.next(), { done: true, value: "done" });
  await engine.flushTimers();
  const end = engine.records(pathOf("s1")).at(-1);
  assert.equal(end.phase, "end");
  assert.deepEqual(end.chunks, [1, 2]);
});

test("after a /clear, session.id is polled while it still gives the ended id; the lines land in the new file", async () => {
  const engine = setup();
  await engine.dispatch("session.cwd", {}, () => Promise.resolve("/"));
  await engine.dispatch("session.end", { reason: "clear", sessionId: "s1" }, () => Promise.resolve({}));
  let polls = 0;
  engine.state.sessionId = "s1";
  Object.defineProperty(engine.state, "sessionId", {
    get: () => (++polls <= 3 ? "s1" : "s2"),
  });
  await engine.dispatch("session.cwd", {}, () => Promise.resolve("/"));
  await engine.flushTimers();
  assert.equal(polls, 4);
  assert.deepEqual(
    engine.records(pathOf("s2")).map((record) => `${record.seq} ${record.phase}`),
    ["0 start", "0 end"],
  );
  assert.equal(engine.records(pathOf("s1")).length, 4, "the ended file kept only its own lines");
});
