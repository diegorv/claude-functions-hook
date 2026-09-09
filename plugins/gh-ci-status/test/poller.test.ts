import { test } from "node:test";
import assert from "node:assert/strict";
import { createPoller, type PollerDeps } from "../hooks/poller.ts";
import { run, running, T0 } from "./helpers.ts";

// Relógio falso: `after` guarda o callback, `tick` avança o tempo e dispara.
function fakeDeps(lists: (() => Promise<any[]>)[]) {
  let now = T0;
  let pending: { at: number; fn: () => void } | null = null;
  const toasts: string[] = [];
  const logs: string[] = [];
  let changes = 0;
  let i = 0;
  const deps: PollerDeps = {
    listRuns: () => lists[Math.min(i++, lists.length - 1)](),
    now: () => now,
    after: (ms, fn) => { pending = { at: now + ms, fn }; return { cancel: () => { pending = null; } }; },
    onChange: () => { changes++; },
    toast: (t) => { toasts.push(t); },
    log: (t) => { logs.push(t); },
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    deps, toasts, logs,
    changes: () => changes,
    nextDelay: () => (pending ? pending.at - now : null),
    async tick() { const p = pending; pending = null; if (p) { now = p.at; p.fn(); } await flush(); },
    flush,
    setNow(t: number) { now = t; },
  };
}

test("primeiro poll aprende sem avisar; ritmo rápido com run em andamento", async () => {
  const f = fakeDeps([() => Promise.resolve([running(1)])]);
  const p = createPoller("a/b", f.deps);
  p.start();
  await f.flush();
  assert.deepEqual(f.toasts, []);
  assert.equal(p.rows().length, 1);
  assert.equal(f.nextDelay(), 15_000);
  assert.equal(f.changes(), 1);
});

test("run que termina vira toast e ritmo cai para idle", async () => {
  const f = fakeDeps([
    () => Promise.resolve([running(1)]),
    () => Promise.resolve([run({ databaseId: 1, updatedAt: new Date(T0 + 90_000).toISOString() })]),
  ]);
  const p = createPoller("a/b", f.deps);
  p.start();
  await f.flush();
  await f.tick();
  assert.deepEqual(f.toasts, ["⚙ a/b: CI Success after 1m 30s"]);
  assert.equal(f.nextDelay(), 60_000);
  assert.equal(p.rows().length, 1, "terminado fica na faixa dentro do hold");
});

test("wake: cancela o timer, entra em waiting, e o run novo limpa o waiting", async () => {
  const f = fakeDeps([
    () => Promise.resolve([]),
    () => Promise.resolve([]),
    () => Promise.resolve([running(7)]),
  ]);
  const p = createPoller("a/b", f.deps);
  p.start();
  await f.flush();
  assert.equal(p.waiting(), false);
  p.wake();
  await f.flush();
  assert.equal(p.waiting(), true);
  assert.equal(f.nextDelay(), 15_000, "waiting mantém o ritmo rápido");
  await f.tick();
  assert.equal(p.waiting(), false, "o run apareceu");
  assert.deepEqual(f.toasts, ["⚙ a/b: CI started (main)"]);
});

test("erro do gh: loga uma vez por pane e continua", async () => {
  const f = fakeDeps([() => Promise.reject(new Error("boom")), () => Promise.reject(new Error("boom")), () => Promise.resolve([])]);
  const p = createPoller("a/b", f.deps);
  p.start();
  await f.flush();
  await f.tick();
  await f.tick();
  assert.deepEqual(f.logs, ["boom"]);
  assert.equal(p.rows().length, 0);
});
