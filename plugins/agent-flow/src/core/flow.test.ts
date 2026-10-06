import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  onPermission,
  onSpawn,
  onToolEnd,
  onToolStart,
  onTurnComplete,
  onTurnStart,
  reconcile,
  type FlowState,
  type Listed,
} from "./flow.ts";

const T0 = 1_000_000;
const spawn = { subagentType: "Explore", description: "find the bug" };
const started = { model: "haiku", agentId: "a1" };
const withAgent = (): FlowState => onSpawn(initialState(T0), spawn, started, T0);
const withTeammate = (name?: string): FlowState =>
  onSpawn(initialState(T0), { ...spawn, name, isTeammate: true }, started, T0);
const usage = {
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 0,
  model: "m",
};
const listed = (overrides: Partial<Listed> = {}): Listed => ({
  id: "a1",
  type: "Explore",
  description: "find the bug",
  status: "running",
  ...overrides,
});

test("the initial state is the main loop, idle, and no agent", () => {
  const state = initialState(T0);
  assert.equal(state.root.status, "idle");
  assert.deepEqual(state.agents, {});
});

test("a started spawn adds a running node under its parent; a refused one adds none", () => {
  const state = onSpawn(
    withAgent(),
    { ...spawn, name: "scout", parentAgentId: "a1" },
    { model: "x", agentId: "a2" },
    T0,
  );
  assert.equal(state.agents.a1?.parentId, null);
  assert.equal(state.agents.a1?.status, "running");
  assert.equal(state.agents.a2?.parentId, "a1");
  assert.equal(state.agents.a2?.name, "scout");
  const refused = initialState(T0);
  assert.equal(onSpawn(refused, spawn, { deny: "no" }, T0), refused);
});

test("a spawn after the list keeps the list's status and takes the spawn's facts", () => {
  const listedFirst = reconcile(initialState(T0), [listed({ status: "completed", parentId: "p" })], T0);
  const state = onSpawn(listedFirst, { ...spawn, subagentType: "Plan", parentAgentId: "p" }, started, T0 + 5);
  assert.equal(state.agents.a1?.status, "completed");
  assert.equal(state.agents.a1?.type, "Plan");
  assert.equal(state.agents.a1?.parentId, "p");
});

test("calls in flight per loop, counted when they end, the main loop's included", () => {
  let state = onToolStart(withAgent(), { agentId: "a1", tool: "Read", tool_use_id: "t1" }, T0 + 1);
  state = onToolStart(state, { agentId: "a1", tool: "Grep", tool_use_id: "t2" }, T0 + 2);
  state = onToolStart(state, { tool: "Bash", tool_use_id: "t3" }, T0 + 3);
  assert.deepEqual(
    state.agents.a1?.calls.map((call) => call.tool),
    ["Read", "Grep"],
  );
  state = onToolEnd(state, { agentId: "a1", tool_use_id: "t1" }, T0 + 4);
  assert.deepEqual(
    state.agents.a1?.calls.map((call) => call.id),
    ["t2"],
  );
  assert.equal(state.agents.a1?.toolCalls, 1);
  assert.equal(state.agents.a1?.lastEventAt, T0 + 4);
  assert.equal(state.root.calls[0]?.tool, "Bash");
});

test("an event from a loop the tree does not know changes nothing", () => {
  const state = withAgent();
  assert.equal(onToolStart(state, { agentId: "fork", tool: "Read", tool_use_id: "t" }, T0), state);
  assert.equal(onTurnComplete(state, { agentId: "fork", reason: "answer" }, T0), state);
});

test("a call wakes an ended agent and an idle teammate", () => {
  for (const state of [withAgent(), withTeammate()]) {
    const ended = onTurnComplete(state, { agentId: "a1", reason: "answer" }, T0 + 10);
    const woken = onToolStart(ended, { agentId: "a1", tool: "Read", tool_use_id: "t1" }, T0 + 20);
    assert.equal(woken.agents.a1?.status, "running");
    assert.equal(woken.agents.a1?.endedAt, null);
  }
});

test("a main-loop call outside a turn leaves the main loop idle", () => {
  const state = onToolStart(initialState(T0), { tool: "Read", tool_use_id: "t1" }, T0 + 5);
  assert.equal(state.root.status, "idle");
  assert.equal(state.root.endedAt, T0);
  assert.equal(state.root.calls.length, 1);
});

test("a permission prompt marks the oldest call of its tool, once; nothing when none runs", () => {
  let state = onToolStart(withAgent(), { agentId: "a1", tool: "Bash", tool_use_id: "t1" }, T0);
  state = onToolStart(state, { agentId: "a1", tool: "Bash", tool_use_id: "t2" }, T0);
  state = onPermission(state, { agentId: "a1", tool: "Bash" }, T0 + 1);
  state = onPermission(state, { agentId: "a1", tool: "Bash" }, T0 + 2);
  assert.deepEqual(
    state.agents.a1?.calls.map((call) => call.isWaiting),
    [true, true],
  );
  state = onToolEnd(state, { agentId: "a1", tool_use_id: "t1" }, T0 + 3);
  assert.deepEqual(
    state.agents.a1?.calls.map((call) => call.id),
    ["t2"],
  );
  const idle = initialState(T0);
  assert.equal(onPermission(idle, { tool: "Bash" }, T0).root, idle.root);
});

test("the main loop runs from turn.start to turn.complete, then idles", () => {
  let state = onTurnStart(initialState(T0), T0 + 5);
  assert.equal(state.root.status, "running");
  assert.equal(state.root.startedAt, T0 + 5);
  state = onToolStart(state, { tool: "Bash", tool_use_id: "t1" }, T0 + 6);
  state = onTurnComplete(state, { reason: "aborted" }, T0 + 9);
  assert.equal(state.root.status, "idle");
  assert.equal(state.root.endedAt, T0 + 9);
  assert.deepEqual(state.root.calls, []);
});

test("a subagent's turn ends it by the reason and adds its tokens; a teammate idles", () => {
  const reasons = { answer: "completed", error: "failed", refusal: "failed", aborted: "killed" } as const;
  for (const [reason, status] of Object.entries(reasons)) {
    const turn = { agentId: "a1", reason: reason as keyof typeof reasons };
    assert.equal(onTurnComplete(withAgent(), turn, T0 + 1).agents.a1?.status, status);
  }
  const ended = onTurnComplete(withAgent(), { agentId: "a1", reason: "answer", usage }, T0 + 7);
  assert.equal(ended.agents.a1?.tokens, 120);
  assert.equal(ended.agents.a1?.endedAt, T0 + 7);
  assert.equal(onTurnComplete(withTeammate(), { agentId: "a1", reason: "answer" }, T0 + 1).agents.a1?.status, "idle");
});

test("a teammate's tokens add up over its turns", () => {
  let state = onTurnComplete(withTeammate(), { agentId: "a1", reason: "answer", usage }, T0 + 1);
  state = onToolStart(state, { agentId: "a1", tool: "Read", tool_use_id: "t1" }, T0 + 2);
  state = onTurnComplete(state, { agentId: "a1", reason: "answer", usage }, T0 + 3);
  assert.equal(state.agents.a1?.tokens, 240);
});

test("the list has the last word on status and fills a parent", () => {
  const busy = onToolStart(withAgent(), { agentId: "a1", tool: "Read", tool_use_id: "t1" }, T0 + 1);
  const state = reconcile(busy, [listed({ status: "killed", parentId: "p" })], T0 + 3);
  assert.equal(state.agents.a1?.status, "killed");
  assert.equal(state.agents.a1?.endedAt, T0 + 3);
  assert.deepEqual(state.agents.a1?.calls, []);
  assert.equal(state.agents.a1?.parentId, "p");
  assert.equal(state.agents.a1?.lastEventAt, T0 + 3);
  const same = reconcile(withAgent(), [listed()], T0 + 3);
  assert.equal(same.agents.a1?.lastEventAt, T0, "an unchanged status is no event");
});

test("an agent already ended keeps its end when the list says ended", () => {
  const ended = onTurnComplete(withAgent(), { agentId: "a1", reason: "answer" }, T0 + 2);
  const state = reconcile(ended, [listed({ status: "completed" })], T0 + 9);
  assert.equal(state.agents.a1?.endedAt, T0 + 2);
});

test("the list's name is never an agent's label", () => {
  const state = reconcile(withAgent(), [listed({ name: "bg-1" })], T0);
  assert.equal(state.agents.a1?.name, null);
  const listedFirst = reconcile(initialState(T0), [listed({ name: "bg-1" })], T0);
  assert.equal(onSpawn(listedFirst, spawn, started, T0).agents.a1?.name, null);
});

test("a teammate takes the list's name, which carries the suffix of a taken one", () => {
  const listedName = [listed({ name: "scout-2", teammateId: "scout-2@team" })];
  assert.equal(reconcile(withTeammate("scout"), listedName, T0).agents.a1?.name, "scout-2");
  const listedFirst = reconcile(initialState(T0), listedName, T0);
  const state = onSpawn(listedFirst, { ...spawn, name: "scout", isTeammate: true }, started, T0);
  assert.equal(state.agents.a1?.name, "scout-2");
});

test("the list adds the agents no spawn showed, a teammate by its teammateId", () => {
  const state = reconcile(
    initialState(T0),
    [listed({ id: "t", type: "teammate", status: "idle", teammateId: "x@team" })],
    T0,
  );
  assert.equal(state.agents.t?.status, "idle");
  assert.equal(state.agents.t?.isTeammate, true);
});

test("a live node absent from two lists in a row is gone; an ended one stays", () => {
  let state = onToolStart(withAgent(), { agentId: "a1", tool: "Read", tool_use_id: "t1" }, T0);
  state = onSpawn(state, spawn, { model: "x", agentId: "a2" }, T0);
  state = onTurnComplete(state, { agentId: "a2", reason: "answer" }, T0 + 1);
  state = reconcile(state, [], T0 + 2);
  assert.equal(state.agents.a1?.status, "running");
  state = reconcile(state, [], T0 + 4);
  assert.equal(state.agents.a1?.status, "gone");
  assert.equal(state.agents.a1?.endedAt, T0 + 4);
  assert.deepEqual(state.agents.a1?.calls, []);
  assert.equal(state.agents.a2?.status, "completed");
});

test("being listed again resets the misses", () => {
  let state = reconcile(withAgent(), [], T0 + 2);
  state = reconcile(state, [listed()], T0 + 4);
  state = reconcile(state, [], T0 + 6);
  assert.equal(state.agents.a1?.status, "running");
});
