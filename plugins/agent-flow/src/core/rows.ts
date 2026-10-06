// The tree as the pane draws it: one row per loop in depth-first order, the
// header's counts, and whether anything runs (the timers' condition).
import { isEnded, type Call, type FlowNode, type FlowState, type Status } from "./flow.ts";

const SLOW_TOOL_MS = 30_000;
const STALE_MS = 120_000;

// What makes a row stand out, strongest first.
export type Signal = "approval" | "slow-tool" | "stale" | null;

export type Row = {
  id: string;
  depth: number; // 0 for the main loop
  status: Status;
  type: string;
  label: string; // name, or else description
  elapsed: string;
  activity: string | null; // the oldest call, or the prompt waiting
  toolCalls: number;
  tokens: string | null; // once ended
  signal: Signal;
};

export type Counts = { running: number; done: number; waiting: number };

// `12s`, `3m05s`, `1h02m`.
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${twoDigits(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h${twoDigits(Math.floor(seconds / 60) % 60)}m`;
}

// `820 tok`, `4.1k tok`, `1.2M tok`.
export function tokens(count: number): string {
  if (count < 1000) return `${count} tok`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k tok`;
  return `${(count / 1_000_000).toFixed(1)}M tok`;
}

const waitingCall = (loop: FlowNode): Call | undefined => loop.calls.find((call) => call.isWaiting);

function signalOf(loop: FlowNode, isRoot: boolean, now: number): Signal {
  if (waitingCall(loop)) return "approval";
  const oldest = loop.calls[0];
  if (oldest && now - oldest.since > SLOW_TOOL_MS) return "slow-tool";
  if (!isRoot && loop.status === "running" && now - loop.lastEventAt > STALE_MS) return "stale";
  return null;
}

function activityOf(loop: FlowNode, now: number): string | null {
  const waiting = waitingCall(loop);
  if (waiting) return `waiting for approval: ${waiting.tool}`;
  const oldest = loop.calls[0];
  return oldest ? `${oldest.tool} ${duration(now - oldest.since)}` : null;
}

function rowOf(loop: FlowNode, depth: number, now: number): Row {
  return {
    id: loop.id,
    depth,
    status: loop.status,
    type: loop.type,
    label: loop.name ?? loop.description,
    elapsed: duration((loop.endedAt ?? now) - loop.startedAt),
    activity: activityOf(loop, now),
    toolCalls: loop.toolCalls,
    tokens: isEnded(loop.status) && loop.tokens > 0 ? tokens(loop.tokens) : null,
    signal: signalOf(loop, depth === 0, now),
  };
}

// The main loop, then each agent under its parent, siblings in spawn order; an
// agent whose parent the tree does not know sits under the main loop.
export function rowsOf(state: FlowState, now: number): Row[] {
  const agents = Object.values(state.agents).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const parentOf = (loop: FlowNode) => (loop.parentId !== null && state.agents[loop.parentId] ? loop.parentId : null);
  const rows: Row[] = [rowOf(state.root, 0, now)];
  const walk = (parentId: string | null, depth: number) => {
    for (const loop of agents) {
      if (parentOf(loop) !== parentId) continue;
      rows.push(rowOf(loop, depth, now));
      walk(loop.id, depth + 1);
    }
  };
  walk(null, 1);
  return rows;
}

// The header: agents alive and not idle (pending and held ones too), agents
// ended, and the loops (the main one too) waiting for approval.
export function countsOf(state: FlowState): Counts {
  const agents = Object.values(state.agents);
  return {
    running: agents.filter((loop) => !isEnded(loop.status) && loop.status !== "idle").length,
    done: agents.filter((loop) => isEnded(loop.status)).length,
    waiting: [state.root, ...agents].filter((loop) => waitingCall(loop)).length,
  };
}

// Whether the clock and the list are worth reading: a turn or a call of the
// main loop, or an agent neither ended nor idle.
export function isBusy(state: FlowState): boolean {
  if (state.root.status === "running" || state.root.calls.length > 0) return true;
  return Object.values(state.agents).some((loop) => !isEnded(loop.status) && loop.status !== "idle");
}
