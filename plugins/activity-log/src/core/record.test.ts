import { test } from "node:test";
import assert from "node:assert/strict";
import { agentIdOf, localDate, logPath, outcomeLine, startLine } from "./record.ts";

const AT = new Date(2026, 9, 5, 23, 59); // local time, as the file's date is

test("the file is named by the local date and the session id", () => {
  assert.equal(localDate(AT), "2026-10-05");
  assert.equal(logPath("/Users/me/", AT, "abc"), "/Users/me/.claude/activity-log/2026-10-05-abc.jsonl");
});

test("agentId only when the event carries a string one", () => {
  assert.equal(agentIdOf({ agentId: "a1" }), "a1");
  assert.equal(agentIdOf({ agentId: 3 }), undefined);
  assert.equal(agentIdOf("text"), undefined);
});

test("a start line: one JSON object and a newline, origin and agentId when given", () => {
  const line = startLine(AT, 7, {
    event: "tool.call",
    origin: { plugin: "engine", tier: "core" },
    agentId: "a1",
    input: { tool: "Bash" },
  });
  assert.ok(line.endsWith("}\n"));
  assert.deepEqual(JSON.parse(line), {
    ts: AT.toISOString(),
    seq: 7,
    phase: "start",
    event: "tool.call",
    origin: { plugin: "engine", tier: "core" },
    agentId: "a1",
    input: { tool: "Bash" },
  });
  assert.deepEqual(Object.keys(JSON.parse(startLine(AT, 1, { event: "x", input: 1 }))), [
    "ts",
    "seq",
    "phase",
    "event",
    "input",
  ]);
});

test("end and error lines share the start's seq", () => {
  assert.deepEqual(
    JSON.parse(outcomeLine(AT, 7, "turn.step", { phase: "end", durationMs: 2, result: 1, chunks: [1] })),
    {
      ts: AT.toISOString(),
      seq: 7,
      phase: "end",
      event: "turn.step",
      durationMs: 2,
      result: 1,
      chunks: [1],
    },
  );
  const error = new Error("boom");
  assert.deepEqual(JSON.parse(outcomeLine(AT, 7, "tool.call", { phase: "error", durationMs: 1, error })), {
    ts: AT.toISOString(),
    seq: 7,
    phase: "error",
    event: "tool.call",
    durationMs: 1,
    error: { name: "Error", message: "boom", stack: error.stack },
  });
});
