import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

// Node strips types from .ts but does not load .tsx. register.tsx has no JSX, so its
// types are stripped here; pane.tsx has JSX, so it loads as a stub that hands back
// the model it was given. node --test runs each file in its own process, so these
// hooks reach no other test file.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const source = url.endsWith("/components/pane.tsx")
      ? "export const Pane = (elements, model) => ({ Pane: model });"
      : stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
    return { format: "module", source, shortCircuit: true };
  },
});
const { register } = await import("./register.tsx");

type Handler = (...args: any[]) => any;
type Timer = { ms: number; fn: () => void; cancelled: boolean };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const T0 = 1_000_000;

// The handlers register() subscribes, by event, and a fake $ that records what the hooks
// did to the engine: timers, list reads, pane opens and closes, logs. placed: false makes
// the pane fail to open; `listed` is what $.agent.list() answers, or its rejection's message.
function setup(options: { placed?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  register(
    ((event: string, matcher: object | Handler, handler?: Handler) => {
      handlers.set(event, handler ?? (matcher as Handler));
      return { catch: () => {} };
    }) as never,
    {} as never,
  );

  let time = T0;
  const timers: Timer[] = [];
  const registered: unknown[] = [];
  const ops: string[] = []; // the pane's opens and closes, in order
  let panes: { id: string; isShown: boolean }[] = [];
  let listed: unknown[] | string = [];
  let listReads = 0;
  const logs: string[] = [];
  const $ = {
    clock: {
      now: async () => time,
      every: (ms: number, fn: () => void) => {
        const timer = { ms, fn, cancelled: false };
        timers.push(timer);
        return { cancel: () => void (timer.cancelled = true) };
      },
    },
    agent: {
      list: async () => {
        listReads += 1;
        if (typeof listed === "string") throw new Error(listed);
        return listed;
      },
    },
    ui: {
      invalidate: () => {},
      log: async (text: string) => void logs.push(text),
      resolve: () => ({}),
      panes: async () => panes,
      open: async ({ id }: { id: string }) => {
        ops.push("open");
        if (options.placed === false) return { isPlaced: false, reason: "no room" };
        panes = [{ id, isShown: true }];
        return { isPlaced: true };
      },
      close: async () => {
        ops.push("close");
        panes = [];
      },
    },
    command: { register: async (spec: unknown) => void registered.push(spec) },
  };

  const next = async (event: unknown) => ({ next: event });
  const call = (key: string, event: unknown, nextOf: Handler = next) => handlers.get(key)!($, event, nextOf);
  const live = () => timers.filter((timer) => !timer.cancelled);
  return {
    registered,
    ops,
    logs,
    live,
    call,
    listReads: () => listReads,
    setListed: (agents: unknown[] | string) => (listed = agents),
    setTime: (ms: number) => (time = ms),
    listPane: (isShown: boolean) => (panes = [{ id: "flow", isShown }]),
    start: (isInteractive = true) => call("session.start", { isInteractive, cwd: "/repo", surface: "terminal" }),
    end: (reason: string) => call("session.end", { reason }),
    spawn: (agentId: string, facts: object = {}) =>
      call("agent.spawn", { subagentType: "Explore", description: "find the bug", ...facts }, async () => ({
        model: "m",
        agentId,
      })),
    // A tool call whose next waits for `done`, so a test sees it in flight.
    tool: (event: object, nextOf?: Handler) => {
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => (finish = resolve));
      const ran = call("tool.call", event, nextOf ?? (async (e: unknown) => (await done, { result: e })));
      return { ran, finish };
    },
    permission: (event: object, result: object = {}) => call("classic.PermissionRequest", event, async () => result),
    turnStart: () => call("turn.start", { text: "hi", turnId: "u" }),
    turnComplete: (event: object = {}) => call("turn.complete", { reason: "answer", ...event }),
    pane: async () => (await call("ui.render", { requestId: "flow", props: { bodyColumns: 120 } })).Pane,
    closed: () => call("ui.close", { id: "flow", origin: { kind: "person" } }),
    command: () => call("command.run", { command: "flow", args: "" }),
  };
}

test("session.start registers /flow in an interactive session; elsewhere nothing is tracked", async () => {
  const engine = setup();
  await engine.start();
  assert.deepEqual(engine.registered, [
    { name: "flow", description: "Show or hide the tree of this session's subagents and teammates" },
  ]);
  const quiet = setup();
  await quiet.start(false);
  await quiet.spawn("a1");
  await quiet.turnStart();
  assert.deepEqual(quiet.registered, []);
  assert.deepEqual(quiet.live(), []);
  assert.equal((await quiet.pane()).note, "No subagent or teammate yet.");
});

test("a spawn and its calls draw in the pane; a call counts once next settles", async () => {
  const engine = setup();
  await engine.start();
  assert.deepEqual(await engine.spawn("a1"), { model: "m", agentId: "a1" });
  const call = engine.tool({ agentId: "a1", tool: "Grep", tool_use_id: "t1" });
  await settle();
  engine.setTime(T0 + 3_000);
  assert.deepEqual(
    (await engine.pane()).lines.map((line: { text: string }) => line.text),
    ["○ main · idle", "  ● Explore: find the bug · running 3s · Grep 3s"],
  );
  call.finish();
  assert.deepEqual(await call.ran, { result: { agentId: "a1", tool: "Grep", tool_use_id: "t1" } });
  assert.equal((await engine.pane()).lines[1].text, "  ● Explore: find the bug · running 3s · 1 call");
});

test("a call whose next rejects still ends", async () => {
  const engine = setup();
  await engine.start();
  await engine.spawn("a1");
  const { ran } = engine.tool({ agentId: "a1", tool: "Bash", tool_use_id: "t1" }, async () => {
    throw new Error("aborted");
  });
  await assert.rejects(ran, /aborted/);
  assert.equal((await engine.pane()).lines[1].text, "  ● Explore: find the bug · running 0s · 1 call");
});

test("a permission prompt marks the call waiting, unless a settings hook decided or blocked it", async () => {
  const engine = setup();
  await engine.start();
  const call = engine.tool({ tool: "Bash", tool_use_id: "t1" });
  await settle();
  await engine.permission({ tool_name: "Bash" }, { decision: { behavior: "allow" } });
  await engine.permission({ tool_name: "Bash" }, { block: "no" });
  assert.equal((await engine.pane()).header, "0 running · 0 done · 0 waiting");
  assert.deepEqual(await engine.permission({ tool_name: "Bash" }), {});
  const model = await engine.pane();
  assert.equal(model.header, "0 running · 0 done · 1 waiting");
  assert.equal(model.lines[0].text, "○ main · idle · waiting for approval: Bash");
  call.finish();
  await call.ran;
});

test("a subagent's permission prompt marks its own call", async () => {
  const engine = setup();
  await engine.start();
  await engine.spawn("a1");
  const call = engine.tool({ agentId: "a1", tool: "Bash", tool_use_id: "t1" });
  await settle();
  await engine.permission({ agent_id: "a1", tool_name: "Bash" });
  const model = await engine.pane();
  assert.equal(model.lines[0].text, "○ main · idle");
  assert.equal(model.lines[1].text, "  ● Explore: find the bug · running 0s · waiting for approval: Bash");
  call.finish();
  await call.ran;
});

test("a refused spawn adds no row and its result passes through", async () => {
  const engine = setup();
  await engine.start();
  const refused = await engine.call("agent.spawn", { subagentType: "Explore", description: "d" }, async () => ({
    deny: "no",
  }));
  assert.deepEqual(refused, { deny: "no" });
  assert.equal((await engine.pane()).lines.length, 1);
});

test("ui.render of another request goes to next", async () => {
  const engine = setup();
  await engine.start();
  await engine.turnStart();
  const event = { requestId: "other", props: {} };
  assert.deepEqual(await engine.call("ui.render", event), { next: event });
  assert.deepEqual(engine.live(), [], "not this pane: no timers");
});

test("timers run while something does in a drawn pane: a redraw every 1 s, a list read every 2 s", async () => {
  const engine = setup();
  await engine.start();
  assert.deepEqual(engine.live(), []);
  await engine.turnStart();
  assert.deepEqual(engine.live(), [], "busy, but no pane");
  await engine.pane();
  assert.deepEqual(
    engine.live().map((timer) => timer.ms),
    [1000, 2000],
  );
  await engine.spawn("a1");
  assert.equal(engine.live().length, 2, "started once");
  engine.setListed([{ id: "a1", type: "Explore", description: "find the bug", status: "completed" }]);
  engine.live()[1]!.fn();
  await settle();
  await settle();
  assert.equal(engine.listReads(), 1);
  assert.equal((await engine.pane()).header, "0 running · 1 done · 0 waiting");
  await engine.turnComplete();
  assert.deepEqual(engine.live(), [], "all idle: both stop");
});

test("closing the pane stops the timers; events still update the tree", async () => {
  const engine = setup();
  await engine.start();
  await engine.turnStart();
  await engine.pane();
  assert.equal(engine.live().length, 2);
  await engine.closed();
  assert.deepEqual(engine.live(), []);
  await engine.spawn("a1");
  assert.deepEqual(engine.live(), [], "still closed");
  assert.equal((await engine.pane()).lines.length, 2);
  assert.equal(engine.live().length, 2, "drawn again: they start");
});

test("a list read that fails on a timer is only logged", async () => {
  const engine = setup();
  await engine.start();
  await engine.turnStart();
  await engine.pane();
  engine.setListed("list failed");
  engine.live()[1]!.fn();
  await settle();
  assert.deepEqual(engine.logs, ["list failed"]);
  assert.equal((await engine.pane()).lines[0].text, "● main · running 0s");
});

test("a subagent's turn.complete ends it; the main loop's idles it", async () => {
  const engine = setup();
  await engine.start();
  await engine.turnStart();
  await engine.spawn("a1");
  await engine.turnComplete({ agentId: "a1", reason: "error" });
  const model = await engine.pane();
  assert.equal(model.lines[0].text, "● main · running 0s");
  assert.equal(model.lines[1].text, "  ✗ Explore: find the bug · failed 0s");
});

test("/clear and /resume forget the tree; another end keeps it", async () => {
  for (const reason of ["clear", "resume"]) {
    const engine = setup();
    await engine.start();
    await engine.spawn("a1");
    await engine.end(reason);
    assert.equal((await engine.pane()).lines.length, 1, reason);
    assert.deepEqual(engine.live(), []);
  }
  const engine = setup();
  await engine.start();
  await engine.spawn("a1");
  await engine.end("prompt_input_exit");
  assert.equal((await engine.pane()).lines.length, 2);
});

test("/flow opens the pane, closes the one it drew; after ui.close it opens again", async () => {
  const engine = setup();
  await engine.start();
  assert.deepEqual(await engine.command(), {});
  await engine.pane();
  assert.deepEqual(await engine.command(), { text: "Closed the agent flow pane." });
  await engine.command();
  await engine.pane();
  engine.closed(); // the person closed it, but the engine still lists it shown
  engine.listPane(true);
  engine.ops.length = 0;
  assert.deepEqual(await engine.command(), {});
  assert.deepEqual(engine.ops, ["close", "open"], "not drawn here any more: opened again, not closed");
});

test("/flow: a pane the engine could not place says why", async () => {
  const engine = setup({ placed: false });
  await engine.start();
  assert.deepEqual(await engine.command(), { text: "The agent flow pane did not open: no room" });
});
