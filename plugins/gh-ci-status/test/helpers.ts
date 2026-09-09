import type { Run } from "../hooks/runs.ts";

export const T0 = Date.parse("2026-09-09T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

export function run(over: Partial<Run> & { databaseId: number }): Run {
  return {
    status: "completed",
    conclusion: "success",
    name: "CI",
    headBranch: "main",
    displayTitle: "Fix login",
    createdAt: iso(T0),
    updatedAt: iso(T0 + 60_000),
    ...over,
  };
}

export const running = (id: number, over: Partial<Run> = {}) =>
  run({ databaseId: id, status: "in_progress", conclusion: null, ...over });
