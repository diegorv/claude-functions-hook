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
} from "./flow.ts";
import { countsOf, duration, isBusy, rowsOf, tokens } from "./rows.ts";

const T0 = 1_000_000;
const add = (state: FlowState, agentId: string, parentAgentId?: string, at = T0): FlowState =>
  onSpawn(
    state,
    { subagentType: "Explore", description: `task ${agentId}`, parentAgentId },
    { model: "m", agentId },
    at,
  );

test("durations and token counts, compact", () => {
  assert.equal(duration(12_900), "12s");
  assert.equal(duration(185_000), "3m05s");
  assert.equal(duration(3_720_000), "1h02m");
  assert.equal(duration(-5), "0s");
  assert.equal(tokens(820), "820 tok");
  assert.equal(tokens(4_120), "4.1k tok");
  assert.equal(tokens(1_260_000), "1.3M tok");
});

test("the main loop first, then each agent under its parent in spawn order", () => {
  let state = add(initialState(T0), "a", undefined, T0 + 1);
  state = add(state, "b", undefined, T0 + 2);
  state = add(state, "a1", "a", T0 + 3);
  state = add(state, "orphan", "unknown", T0 + 4);
  const rows = rowsOf(state, T0 + 10);
  assert.deepEqual(
    rows.map((row) => [row.id, row.depth]),
    [
      ["main", 0],
      ["a", 1],
      ["a1", 2],
      ["b", 1],
      ["orphan", 1],
    ],
  );
  assert.equal(rows[1]?.label, "task a");
  assert.equal(rows[1]?.type, "Explore");
});

test("a name wins over the description", () => {
  const state = onSpawn(
    initialState(T0),
    { subagentType: "x", description: "d", name: "scout" },
    { model: "m", agentId: "a" },
    T0,
  );
  assert.equal(rowsOf(state, T0)[1]?.label, "scout");
});

test("elapsed runs until the end; tokens show once ended", () => {
  let state = add(initialState(T0), "a");
  assert.equal(rowsOf(state, T0 + 65_000)[1]?.elapsed, "1m05s");
  assert.equal(rowsOf(state, T0 + 65_000)[1]?.tokens, null);
  const usage = {
    input_tokens: 4000,
    output_tokens: 100,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: "m",
  };
  state = onTurnComplete(state, { agentId: "a", reason: "answer", usage }, T0 + 5_000);
  const row = rowsOf(state, T0 + 65_000)[1];
  assert.equal(row?.elapsed, "5s");
  assert.equal(row?.tokens, "4.1k tok");
});

test("activity: the oldest call and how long it has run, or the prompt waiting; the call count", () => {
  let state = add(initialState(T0), "a");
  state = onToolStart(state, { agentId: "a", tool: "Read", tool_use_id: "t1" }, T0);
  state = onToolEnd(state, { agentId: "a", tool_use_id: "t1" }, T0 + 1);
  state = onToolStart(state, { agentId: "a", tool: "Grep", tool_use_id: "t2" }, T0 + 2_000);
  state = onToolStart(state, { agentId: "a", tool: "Bash", tool_use_id: "t3" }, T0 + 3_000);
  assert.equal(rowsOf(state, T0 + 10_000)[1]?.activity, "Grep 8s");
  assert.equal(rowsOf(state, T0 + 10_000)[1]?.toolCalls, 1);
  state = onPermission(state, { agentId: "a", tool: "Bash" }, T0 + 4_000);
  assert.equal(rowsOf(state, T0 + 10_000)[1]?.activity, "waiting for approval: Bash");
  state = onToolEnd(onToolEnd(state, { agentId: "a", tool_use_id: "t2" }, T0), { agentId: "a", tool_use_id: "t3" }, T0);
  assert.equal(rowsOf(state, T0)[1]?.activity, null);
});

test("signals: approval over a slow call over a stale agent; the main loop is never stale", () => {
  let state = onTurnStart(add(initialState(T0), "a"), T0);
  assert.equal(rowsOf(state, T0 + 120_000)[1]?.signal, null);
  assert.deepEqual(
    rowsOf(state, T0 + 120_001).map((row) => row.signal),
    [null, "stale"],
  );
  state = onToolStart(state, { agentId: "a", tool: "Bash", tool_use_id: "t1" }, T0);
  state = onToolStart(state, { tool: "Bash", tool_use_id: "t2" }, T0);
  assert.equal(rowsOf(state, T0 + 30_000)[1]?.signal, null);
  assert.deepEqual(
    rowsOf(state, T0 + 30_001).map((row) => row.signal),
    ["slow-tool", "slow-tool"],
  );
  state = onPermission(state, { tool: "Bash" }, T0 + 1);
  assert.equal(rowsOf(state, T0 + 200_000)[0]?.signal, "approval");
});

test("counts: agents alive and not idle, ended, loops waiting for approval, the main one too", () => {
  let state = add(add(add(initialState(T0), "a"), "b"), "c");
  state = onTurnComplete(state, { agentId: "b", reason: "answer" }, T0);
  state = onTurnComplete(state, { agentId: "c", reason: "error" }, T0);
  state = onToolStart(state, { tool: "Bash", tool_use_id: "t" }, T0);
  state = onPermission(state, { tool: "Bash" }, T0);
  assert.deepEqual(countsOf(state), { running: 1, done: 2, waiting: 1 });
  const listed = { type: "Explore", description: "d" };
  state = reconcile(
    state,
    [
      { ...listed, id: "a", status: "running" },
      { ...listed, id: "p", status: "pending" },
      { ...listed, id: "h", status: "waiting" },
      { ...listed, id: "t", status: "idle", teammateId: "t@team" },
    ],
    T0,
  );
  assert.deepEqual(countsOf(state), { running: 3, done: 2, waiting: 1 });
});

test("busy while the main loop runs or an agent is neither ended nor idle", () => {
  const idle = initialState(T0);
  assert.equal(isBusy(idle), false);
  assert.equal(isBusy(onTurnStart(idle, T0)), true);
  const agent = add(idle, "a");
  assert.equal(isBusy(agent), true);
  assert.equal(isBusy(onTurnComplete(agent, { agentId: "a", reason: "answer" }, T0)), false);
  const teammate = onSpawn(
    idle,
    { subagentType: "t", description: "d", isTeammate: true },
    { model: "m", agentId: "t" },
    T0,
  );
  assert.equal(isBusy(onTurnComplete(teammate, { agentId: "t", reason: "answer" }, T0)), false);
});

test("busy while a main-loop call outside a turn runs", () => {
  const calling = onToolStart(initialState(T0), { tool: "Read", tool_use_id: "t1" }, T0);
  assert.equal(calling.root.status, "idle");
  assert.equal(isBusy(calling), true);
  assert.equal(isBusy(onToolEnd(calling, { tool_use_id: "t1" }, T0 + 1)), false);
});
