import { test } from "node:test";
import assert from "node:assert/strict";
import { createPoller, DEFAULT_CONFIG, type PollerDeps } from "./poller.ts";
import type { Run } from "../core/workflow-run.ts";
import { at, run, running, T0 } from "../core/fixtures.ts";

// Fake engine: `after` adds a timer to the list, `tick` moves the clock to the
// oldest live one and fires it; each listRuns call consumes the next response
// in the list.
function fakeEngine(responses: (() => Promise<Run[]>)[]) {
  let now = T0;
  const timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
  let responseIndex = 0;
  const toasts: string[] = [];
  const logs: string[] = [];
  let changeCount = 0;

  const deps: PollerDeps = {
    listRuns: () => responses[Math.min(responseIndex++, responses.length - 1)](),
    listPrs: () => Promise.reject(new Error("prs off")), // a failure here must not break the poll
    now: () => now,
    after: (ms, callback) => {
      const timer = { at: now + ms, callback, cancelled: false };
      timers.push(timer);
      return { cancel: () => (timer.cancelled = true) };
    },
    onChange: () => changeCount++,
    toast: (text) => toasts.push(text),
    log: (text) => logs.push(text),
  };

  const live = () => timers.filter((timer) => !timer.cancelled); // armed and not fired yet
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    deps,
    toasts,
    logs,
    changeCount: () => changeCount,
    calls: () => responseIndex,
    liveTimers: () => live().length,
    nextDelay: () => {
      const last = live().at(-1);
      return last ? last.at - now : null;
    },
    setNow: (epochMs: number) => (now = epochMs),
    settle,
    async tick() {
      const due = live().sort((a, b) => a.at - b.at)[0];
      if (due) {
        timers.splice(timers.indexOf(due), 1);
        now = Math.max(now, due.at); // the clock never goes backwards
        due.callback();
      }
      await settle();
    },
  };
}

test("the first poll learns without notifying; active pace with a run in flight", async () => {
  const engine = fakeEngine([() => Promise.resolve([running()])]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  assert.deepEqual(engine.toasts, []);
  assert.equal(poller.rows().length, 1);
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.activeMs);
  assert.equal(engine.changeCount(), 1);
});

test("a run that finishes becomes a toast and the pace drops to idle", async () => {
  const engine = fakeEngine([
    () => Promise.resolve([running()]),
    () => Promise.resolve([run({ updatedAt: at(90_000) })]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  await engine.tick();
  assert.deepEqual(engine.toasts, ["⚙ a/b: CI Success after 1m30s"]);
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.idleMs);
  assert.equal(poller.rows().length, 1, "a finished run stays on the band within the hold");
});

test("wake: cancels the timer, enters waiting, and a new run clears the waiting", async () => {
  const engine = fakeEngine([
    () => Promise.resolve([]),
    () => Promise.resolve([]),
    () => Promise.resolve([running({ databaseId: 7 })]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  assert.equal(poller.waitingSince(), null);
  poller.wake();
  await engine.settle();
  assert.equal(poller.waitingSince(), T0);
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.activeMs, "waiting keeps the active pace");
  await engine.tick();
  assert.equal(poller.waitingSince(), null, "the run showed up");
  assert.deepEqual(engine.toasts, ["⚙ a/b: CI started (main)"]);
});

test("wake during an in-flight poll keeps a single timer chain", async () => {
  let answerSecondPoll: (runs: Run[]) => void = () => {};
  const engine = fakeEngine([
    () => Promise.resolve([]),
    () => new Promise<Run[]>((resolve) => (answerSecondPoll = resolve)),
    () => Promise.resolve([]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  await engine.tick(); // the second poll is in flight: gh has not answered yet
  poller.wake();
  await engine.settle();
  answerSecondPoll([]);
  await engine.settle();
  assert.equal(engine.liveTimers(), 1, "one timer chain, not two");
  const before = engine.calls();
  await engine.tick();
  assert.equal(engine.calls() - before, 1, "one poll per tick");
});

test("waiting expires after watchMs and the pace goes back to idle", async () => {
  const engine = fakeEngine([() => Promise.resolve([])]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  poller.wake();
  await engine.settle();
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.activeMs);
  engine.setNow(T0 + DEFAULT_CONFIG.watchMs);
  assert.equal(poller.waitingSince(), null);
  await engine.tick();
  assert.equal(engine.nextDelay(), DEFAULT_CONFIG.idleMs);
});

test("a gh error is logged once per outage and polling continues", async () => {
  const engine = fakeEngine([
    () => Promise.reject(new Error("boom")),
    () => Promise.reject(new Error("boom")),
    () => Promise.resolve([]),
  ]);
  const poller = createPoller("a/b", engine.deps);
  poller.start();
  await engine.settle();
  await engine.tick();
  await engine.tick();
  assert.deepEqual(engine.logs, ["boom"]);
  assert.equal(poller.rows().length, 0);
});
