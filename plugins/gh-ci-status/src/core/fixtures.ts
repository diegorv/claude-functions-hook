// Run factories for tests.
import type { Run } from "./runs.ts";

export const T0 = Date.parse("2026-09-09T12:00:00Z");
const iso = (epochMs: number) => new Date(epochMs).toISOString();

export function run(overrides: Partial<Run> & { databaseId: number }): Run {
  return {
    status: "completed",
    conclusion: "success",
    workflowName: "CI",
    headBranch: "main",
    displayTitle: "Fix login",
    createdAt: iso(T0),
    updatedAt: iso(T0 + 60_000),
    url: "https://github.com/a/b/actions/runs/1",
    ...overrides,
  };
}

export const running = (databaseId: number, overrides: Partial<Run> = {}) =>
  run({ databaseId, status: "in_progress", conclusion: null, ...overrides });
