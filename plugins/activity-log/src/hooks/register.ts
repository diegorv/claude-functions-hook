// Records every event of the session to ~/.claude/activity-log/<date>-<session>.jsonl:
// one `*` hook (telemetry.log has its own) that writes a start line, calls next with `e`
// untouched, then writes the end (or error) line and hands back what next gave, the same
// value or error.
//
//   telemetry.log          hooked by name, its collector stream: `*` selects no telemetry event
//   ui.render, ui.resolve  passed on unrecorded: one per component per redraw
//   prompt.edit            passed on unrecorded: one per keystroke, drafts included;
//                          prompt.submit keeps the text sent
//   this plugin's own $    passed on unrecorded (next.origin), or appending would log itself
//   turn.step, a spawn     hooked on their own, as generators: the stream is relayed chunk
//                          by chunk as it comes, and the end line lists the chunks
//   session.end            flushes what is waiting; after a /clear the next lines go to
//                          the new session's file
import type { Register, StarNext } from "claude-code";
import { agentIdOf, logPath, outcomeLine, startLine, type Settled } from "../core/record.ts";
import { errorData } from "../core/serialize.ts";
import { appendFile, createAppender, type ProcessResult } from "../infra/appender.ts";

const FLUSH_MS = 1000;
const NEW_ID_TRIES = 20; // after a /clear, how many times locate waits for the new session id
const NEW_ID_WAIT_MS = 250;

type Session = {
  seq: number;
  firstAt: Date | null; // the first line's time: the file's date
  path: Promise<string>; // settled by locate
  settle: (path: Promise<string>) => void;
  located: boolean;
  endedId: string | null; // the session a /clear ended, whose id this one must not take
};

function newSession(endedId: string | null): Session {
  let settle: (path: Promise<string>) => void = () => {};
  const path = new Promise<string>((resolve) => (settle = resolve));
  path.catch(() => {}); // a failure is reported where the lines are written
  return { seq: 0, firstAt: null, path, settle, located: false, endedId };
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
const since = (startedAt: number) => Math.round((performance.now() - startedAt) * 10) / 10;

// What the log needs of `$`, outside the hook that built it: the engine refuses a module
// that keeps `$` itself, so these closures call it as `$.noun.event(...)`.
type Host = {
  name: string;
  run: (argv: readonly string[], init?: { stdin?: string; timeoutMs?: number }) => Promise<ProcessResult>;
  after: (ms: number, fn: () => void) => void;
  sleep: (ms: number) => Promise<void>;
  home: () => Promise<string | undefined>;
  sessionId: () => Promise<string>;
  log: (text: string) => void;
};

export const register: Register = (on) => {
  // Built by the `*` hook at the first event with a real `$` (engine.create's is an empty
  // table); plugin.register and session.start come before any stream.
  let host: Host | null = null;
  let session = newSession(null);
  let reported = false;

  // Once per module: the log failing never fails the session, it says so in the debug log.
  const report = (error: unknown) => {
    if (reported) return;
    reported = true;
    try {
      host?.log(`activity-log: not written: ${errorData(error).message}`);
    } catch {
      // nothing left to tell
    }
  };

  const appender = createAppender(
    (path, text) => {
      if (!host) return Promise.reject(new Error("no engine to append with"));
      return appendFile(host.run, path, text);
    },
    (ms, fn) => {
      if (!host) throw new Error("no clock yet");
      host.after(ms, fn);
    },
    report,
    FLUSH_MS,
  );

  // Settles the session's file path, once, as soon as a real `$` and its first line exist.
  const locate = (target: Session, knownId?: string) => {
    if (target.located || !host || !target.firstAt) return;
    target.located = true;
    const $ = host;
    const firstAt = target.firstAt;
    const sessionId = async () => {
      if (knownId) return knownId;
      let id = await $.sessionId();
      for (let tries = 0; id === target.endedId && tries < NEW_ID_TRIES; tries++) {
        await $.sleep(NEW_ID_WAIT_MS);
        id = await $.sessionId();
      }
      return id;
    };
    target.settle(
      (async () => {
        const [home, id] = await Promise.all([$.home(), sessionId()]);
        if (!home) throw new Error("HOME is not set");
        return logPath(home, firstAt, id);
      })(),
    );
  };

  const write = (target: Session, line: () => string) => {
    try {
      appender.add(target.path, line());
    } catch (error) {
      report(error);
    }
  };

  // Writes the start line and answers the function that writes the end or error line.
  const begin = (event: string, origin: unknown, e: unknown) => {
    const target = session;
    const seq = target.seq++;
    const now = new Date();
    target.firstAt ??= now;
    locate(target);
    write(target, () => startLine(now, seq, { event, origin, agentId: agentIdOf(e), input: e }));
    const startedAt = performance.now();
    return (outcome: Settled) =>
      write(target, () => outcomeLine(new Date(), seq, event, { ...outcome, durationMs: since(startedAt) }));
  };

  // The stream as it comes, chunk by chunk and unchanged, `yield*` by hand: what the
  // reader sends, throws or returns reaches the stream beneath.
  async function* relay<C, R>(stream: AsyncGenerator<C, R>, finish: (outcome: Settled) => void): AsyncGenerator<C, R> {
    const chunks: C[] = [];
    let settled = false;
    try {
      let step = await stream.next();
      while (!step.done) {
        chunks.push(step.value);
        let sent: unknown;
        try {
          sent = yield step.value;
        } catch (thrown) {
          step = await stream.throw(thrown);
          continue;
        }
        step = await stream.next(sent);
      }
      settled = true;
      finish({ phase: "end", result: step.value, chunks });
      return step.value;
    } catch (error) {
      settled = true;
      finish({ phase: "error", error, chunks });
      throw error;
    } finally {
      if (!settled) {
        // The reader stopped early: the stream beneath is closed as `yield*` would.
        finish({ phase: "end", result: undefined, chunks, cancelled: true });
        await stream.return(undefined as R);
      }
    }
  }

  // Writes what waits, within session.end's short bound: the signal ends the wait, not the write.
  const flushBefore = (signal: AbortSignal) =>
    Promise.race([
      appender.flush(),
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);

  const isOwn = (origin: { plugin: string } | undefined) => host !== null && origin?.plugin === host.name;

  // One call, recorded: what the `*` and telemetry.log hooks share once `$` is taken care of.
  const record = (e: unknown, next: StarNext) => {
    const event = next.event;
    if (isOwn(next.origin)) return next(e);

    const finish = begin(event, next.origin, e);
    // session.end: its lines are the ending session's last; what follows (after a /clear) is the next one's.
    const ended = () => {
      if (event !== "session.end") return null;
      const target = session;
      const sessionId = (e as { sessionId?: unknown }).sessionId;
      const endedId = typeof sessionId === "string" ? sessionId : null;
      locate(target, endedId ?? undefined);
      session = newSession(endedId);
      return flushBefore(next.signal);
    };

    let result: unknown;
    try {
      result = next(e);
    } catch (error) {
      finish({ phase: "error", error });
      throw error;
    }
    if (!isThenable(result)) {
      finish({ phase: "end", result });
      return result;
    }
    return result.then(
      async (value) => {
        finish({ phase: "end", result: value });
        await ended();
        return value;
      },
      async (error: unknown) => {
        finish({ phase: "error", error });
        await ended();
        throw error;
      },
    );
  };

  on("*", ($, e, next) => {
    const event = next.event;
    if (event === "ui.render" || event === "ui.resolve" || event === "prompt.edit") return next(e);
    if (event !== "engine.create") {
      host ??= {
        name: $.plugin.name,
        run: (argv, init) => $.process.run(argv, init),
        after: (ms, fn) => void $.clock.after(ms, fn),
        sleep: (ms) => $.clock.sleep(ms),
        home: () => $.env.get("HOME"),
        sessionId: () => $.session.id(),
        log: (text) => $.ui.log(text, { to: "debug" }),
      };
    }
    // A `*` hook sees a stream only as its result: the two hooks below relay its chunks.
    if (event === "turn.step" || event === "process.spawn") return next(e);
    return record(e, next);
  });

  // `*` selects no telemetry event for a plugin, and a plugin may hook only the operator's
  // collector stream (`anthropic` is the built-ins'). This hook keeps no `$`: its lines wait
  // until the `*` hook has.
  on("telemetry.log", { to: "collector" }, ($, e, next) => record(e, next as unknown as StarNext) as never);

  on("turn.step", async function* ($, e, next) {
    if (isOwn(next.origin)) return yield* next(e);
    const finish = begin(next.event, next.origin, e);
    return yield* relay(next(e), finish);
  });

  on("process.spawn", async function* ($, e, next) {
    if (isOwn(next.origin)) return yield* next(e);
    const finish = begin(next.event, next.origin, e);
    return yield* relay(next(e), finish);
  });
};
