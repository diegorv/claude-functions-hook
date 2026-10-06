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
  type FlowState,
} from "../core/flow.ts";
import { paneModel } from "./pane-model.ts";

const T0 = 1_000_000;
const add = (state: FlowState, agentId: string, facts: object = {}): FlowState =>
  onSpawn(state, { subagentType: "Explore", description: "find the bug", ...facts }, { model: "m", agentId }, T0);

test("with no agent: the main loop alone and a note", () => {
  const model = paneModel(initialState(T0), T0);
  assert.equal(model.header, "0 running · 0 done · 0 waiting");
  assert.deepEqual(model.lines, [{ text: "○ main · idle", color: null, isDim: false, isBold: false }]);
  assert.equal(model.note, "No subagent or teammate yet.");
});

test("each line: indent by depth, glyph, type and label, status and elapsed, activity, calls, tokens", () => {
  let state = onTurnStart(initialState(T0), T0);
  state = add(state, "a", { name: "scout" });
  state = add(state, "b", { parentAgentId: "a" });
  state = onToolStart(state, { agentId: "a", tool: "Read", tool_use_id: "t1" }, T0);
  state = onToolEnd(state, { agentId: "a", tool_use_id: "t1" }, T0);
  state = onToolStart(state, { agentId: "a", tool: "Grep", tool_use_id: "t2" }, T0 + 1_000);
  const usage = { input_tokens: 4000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  state = onTurnComplete(state, { agentId: "b", reason: "answer", usage: { ...usage, model: "m" } }, T0 + 2_000);
  const model = paneModel(state, T0 + 5_000);
  assert.deepEqual(
    model.lines.map((line) => line.text),
    [
      "● main · running 5s",
      "  ● Explore: scout · running 5s · Grep 4s · 1 call",
      "    ✓ Explore: find the bug · completed 2s · 4.1k tok",
    ],
  );
  assert.equal(model.header, "1 running · 1 done · 0 waiting");
  assert.equal(model.note, null);
  assert.deepEqual(
    model.lines.map((line) => [line.color, line.isDim]),
    [
      [null, false],
      [null, false],
      ["success", true],
    ],
  );
});

test("a row needing attention takes its signal's color and bold; an ended one is dimmed", () => {
  let state = add(initialState(T0), "a");
  state = onToolStart(state, { agentId: "a", tool: "Bash", tool_use_id: "t" }, T0);
  assert.deepEqual(paneModel(state, T0 + 31_000).lines[1], {
    text: "  ● Explore: find the bug · running 31s · Bash 31s",
    color: "warning",
    isDim: false,
    isBold: true,
  });
  state = onPermission(state, { agentId: "a", tool: "Bash" }, T0);
  assert.equal(paneModel(state, T0).lines[1]?.color, "permission");
  const failed = onTurnComplete(add(initialState(T0), "a"), { agentId: "a", reason: "error" }, T0);
  assert.deepEqual(paneModel(failed, T0).lines[1], {
    text: "  ✗ Explore: find the bug · failed 0s",
    color: "red",
    isDim: true,
    isBold: false,
  });
  const killed = onTurnComplete(add(initialState(T0), "a"), { agentId: "a", reason: "aborted" }, T0);
  assert.deepEqual(paneModel(killed, T0).lines[1], {
    text: "  ⊘ Explore: find the bug · killed 0s",
    color: null,
    isDim: true,
    isBold: false,
  });
});

test("with no description, the type alone", () => {
  const state = add(initialState(T0), "a", { description: "" });
  assert.equal(paneModel(state, T0).lines[1]?.text, "  ● Explore · running 0s");
});
