// Run factories for tests. `at(offset)` is an ISO timestamp relative to T0.
import type { Run } from "./workflow-run.ts";

export const T0 = Date.parse("2026-09-09T12:00:00Z");
export const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

export function run(overrides: Partial<Run> = {}): Run {
  return {
    databaseId: 1,
    status: "completed",
    conclusion: "success",
    workflowName: "CI",
    headBranch: "main",
    displayTitle: "Fix login",
    createdAt: at(0),
    updatedAt: at(60_000),
    url: "https://github.com/a/b/actions/runs/1",
    ...overrides,
  };
}

export const running = (overrides: Partial<Run> = {}) => run({ status: "in_progress", conclusion: null, ...overrides });
