// The log's lines and where they go: one JSON object per line, two per event
// (start, then end or error) sharing a `seq`, in a file per session.
import { errorData, toPlain } from "./serialize.ts";

export type Start = { event: string; origin?: unknown; agentId?: string; input: unknown };
// How a call settled: `chunks` for a stream, `cancelled` when its reader stopped early.
export type Settled =
  | { phase: "end"; result: unknown; chunks?: unknown[]; cancelled?: boolean }
  | { phase: "error"; error: unknown; chunks?: unknown[] };
export type Outcome = Settled & { durationMs: number };

const twoDigits = (value: number) => String(value).padStart(2, "0");

// The local date the file is named by: YYYY-MM-DD.
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function logPath(home: string, date: Date, sessionId: string): string {
  return `${home.replace(/\/+$/, "")}/.claude/activity-log/${localDate(date)}-${sessionId}.jsonl`;
}

// The loop an event ran in, when it names one (`agentId` on tool.call, session.append, ...).
export function agentIdOf(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const agentId = (e as { agentId?: unknown }).agentId;
  return typeof agentId === "string" ? agentId : undefined;
}

export function startLine(ts: Date, seq: number, start: Start): string {
  const { event, origin, agentId, input } = start;
  return `${JSON.stringify({
    ts: ts.toISOString(),
    seq,
    phase: "start",
    event,
    ...(origin !== undefined && { origin: toPlain(origin) }),
    ...(agentId !== undefined && { agentId }),
    input: toPlain(input),
  })}\n`;
}

export function outcomeLine(ts: Date, seq: number, event: string, outcome: Outcome): string {
  const record =
    outcome.phase === "end"
      ? {
          phase: "end",
          event,
          durationMs: outcome.durationMs,
          result: toPlain(outcome.result),
          ...(outcome.chunks && { chunks: toPlain(outcome.chunks) }),
          ...(outcome.cancelled && { cancelled: true }),
        }
      : {
          phase: "error",
          event,
          durationMs: outcome.durationMs,
          error: toPlain(outcome.error instanceof Error ? outcome.error : errorData(outcome.error)),
          ...(outcome.chunks && { chunks: toPlain(outcome.chunks) }),
        };
  return `${JSON.stringify({ ts: ts.toISOString(), seq, ...record })}\n`;
}
