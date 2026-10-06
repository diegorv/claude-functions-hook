// The tree's state and how each engine event changes it: the main loop at the
// root, every subagent and teammate under the loop that spawned it. Plain data
// (no Map, no class), every reducer returning a new state and taking `now`.
import type { AgentInfo, AgentSpawnInput, AgentSpawnResult, AgentStatus, TurnCompleteInput } from "claude-code";

// `gone`: a loop that left `$.agent.list()` while it still looked alive.
export type Status = AgentStatus | "gone";

// A tool call in flight; `isWaiting` while its permission prompt is open.
export type Call = { id: string; tool: string; since: number; isWaiting: boolean };

export type FlowNode = {
  id: string;
  parentId: string | null; // null: spawned by the main loop, or a parent the tree does not know
  type: string;
  description: string;
  name: string | null;
  isTeammate: boolean;
  status: Status;
  startedAt: number;
  endedAt: number | null;
  lastEventAt: number;
  calls: Call[]; // oldest first
  toolCalls: number; // ended calls
  tokens: number; // input + output, summed over the loop's turns
  isListed: boolean; // some list named it: only such a node can be judged gone
};

export type FlowState = { root: FlowNode; agents: Record<string, FlowNode> };

export type SpawnFacts = Pick<
  AgentSpawnInput,
  "subagentType" | "description" | "name" | "parentAgentId" | "isTeammate"
>;
export type ToolStart = { agentId?: string; tool: string; tool_use_id: string };
export type ToolEnd = { agentId?: string; tool_use_id: string };
// From `classic.PermissionRequest`: `agent_id` and `tool_name` under these names.
export type PermissionAsk = { agentId?: string; tool: string };
export type TurnEnd = Pick<TurnCompleteInput, "agentId" | "reason" | "usage">;
export type Listed = Pick<AgentInfo, "id" | "type" | "description" | "status" | "parentId" | "name" | "teammateId">;

const ENDED: readonly Status[] = ["completed", "failed", "killed", "gone"];

export const isEnded = (status: Status): boolean => ENDED.includes(status);

function node(id: string, now: number, facts: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    parentId: null,
    type: "",
    description: "",
    name: null,
    isTeammate: false,
    status: "running",
    startedAt: now,
    endedAt: null,
    lastEventAt: now,
    calls: [],
    toolCalls: 0,
    tokens: 0,
    isListed: false,
    ...facts,
  };
}

// Also what `/clear` and `/resume` leave: the main loop, idle, and no agent.
export function initialState(now: number): FlowState {
  return { root: node("main", now, { type: "main", status: "idle", endedAt: now }), agents: {} };
}

// Applies `change` to the loop an event names (absent: the main loop); an id
// the tree does not know (a workflow's agent, a compaction fork) is ignored.
function updateLoop(state: FlowState, agentId: string | undefined, change: (node: FlowNode) => FlowNode): FlowState {
  if (agentId === undefined) return { ...state, root: change(state.root) };
  const current = state.agents[agentId];
  if (!current) return state;
  return { ...state, agents: { ...state.agents, [agentId]: change(current) } };
}

// A started spawn adds a running node under its parent; one the list added
// first keeps its status and takes the spawn's facts. A refused one adds none.
export function onSpawn(state: FlowState, spawn: SpawnFacts, result: AgentSpawnResult, now: number): FlowState {
  if (result.agentId === undefined) return state;
  const existing = state.agents[result.agentId];
  const facts = {
    type: spawn.subagentType,
    description: spawn.description,
    // A teammate's listed name carries the suffix added when the requested one was taken.
    name: (spawn.isTeammate === true ? existing?.name : null) ?? spawn.name ?? null,
    isTeammate: spawn.isTeammate === true,
    parentId: spawn.parentAgentId ?? existing?.parentId ?? null,
    lastEventAt: now,
  };
  const next = existing ? { ...existing, ...facts } : node(result.agentId, now, facts);
  return { ...state, agents: { ...state.agents, [next.id]: next } };
}

// A call starts: an agent runs (a message may wake an ended agent or an idle
// teammate). The main loop's status is its turn's: a call outside one (a
// plugin's `$.tool.call`) leaves it idle.
export function onToolStart(state: FlowState, call: ToolStart, now: number): FlowState {
  const isAgent = call.agentId !== undefined;
  return updateLoop(state, call.agentId, (loop) => ({
    ...loop,
    status: isAgent ? "running" : loop.status,
    endedAt: isAgent ? null : loop.endedAt,
    lastEventAt: now,
    calls: [...loop.calls, { id: call.tool_use_id, tool: call.tool, since: now, isWaiting: false }],
  }));
}

// A call ends, answered, denied or failed: it is counted, even one whose start
// came before its loop's spawn resolved.
export function onToolEnd(state: FlowState, call: ToolEnd, now: number): FlowState {
  return updateLoop(state, call.agentId, (loop) => ({
    ...loop,
    lastEventAt: now,
    calls: loop.calls.filter((inFlight) => inFlight.id !== call.tool_use_id),
    toolCalls: loop.toolCalls + 1,
  }));
}

// A permission prompt opens: the request names no call, so it marks the
// loop's oldest call of that tool not already waiting. The call's end clears it.
export function onPermission(state: FlowState, ask: PermissionAsk, now: number): FlowState {
  return updateLoop(state, ask.agentId, (loop) => {
    const index = loop.calls.findIndex((call) => call.tool === ask.tool && !call.isWaiting);
    if (index === -1) return loop;
    const calls = loop.calls.map((call, at) => (at === index ? { ...call, isWaiting: true } : call));
    return { ...loop, calls, lastEventAt: now };
  });
}

// The main loop starts a turn; a subagent's run raises no `turn.start`.
export function onTurnStart(state: FlowState, now: number): FlowState {
  return { ...state, root: { ...state.root, status: "running", startedAt: now, endedAt: null, lastEventAt: now } };
}

const STATUS_OF_REASON: Record<TurnEnd["reason"], Status> = {
  answer: "completed",
  error: "failed",
  refusal: "failed",
  aborted: "killed",
};

// A loop's turn ends: the main loop and a teammate go idle, a subagent ends by
// the reason. Calls still in flight ended with the turn; its tokens are added.
export function onTurnComplete(state: FlowState, turn: TurnEnd, now: number): FlowState {
  return updateLoop(state, turn.agentId, (loop) => ({
    ...loop,
    status: turn.agentId === undefined || loop.isTeammate ? "idle" : STATUS_OF_REASON[turn.reason],
    endedAt: now,
    lastEventAt: now,
    calls: [],
    tokens: loop.tokens + (turn.usage ? turn.usage.input_tokens + turn.usage.output_tokens : 0),
  }));
}

// What `$.agent.list()` answers has the last word on status and fills a
// parent the events never gave. Its name is taken for a teammate only (for
// another agent it is the engine's handle, not a label). A node alive by the events
// that a list named and the next one leaves out is gone; one no list ever named
// (a loop the list may not cover, or a spawn the list was read before) is left to its events.
export function reconcile(state: FlowState, listed: readonly Listed[], now: number): FlowState {
  const agents: Record<string, FlowNode> = {};
  const seen = new Set(listed.map((info) => info.id));
  for (const loop of Object.values(state.agents)) {
    if (seen.has(loop.id) || isEnded(loop.status) || !loop.isListed) agents[loop.id] = loop;
    else agents[loop.id] = { ...loop, status: "gone", endedAt: now, lastEventAt: now, calls: [] };
  }
  for (const info of listed) {
    const existing = agents[info.id];
    const base =
      existing ??
      node(info.id, now, { type: info.type, description: info.description, isTeammate: info.teammateId !== undefined });
    const isChanged = existing !== undefined && existing.status !== info.status;
    agents[info.id] = {
      ...base,
      status: info.status,
      endedAt: isEnded(info.status) ? (base.endedAt ?? now) : null,
      lastEventAt: isChanged ? now : base.lastEventAt,
      calls: isEnded(info.status) ? [] : base.calls,
      parentId: base.parentId ?? info.parentId ?? null,
      name: info.teammateId !== undefined ? (info.name ?? base.name) : base.name,
      isListed: true,
    };
  }
  return { ...state, agents };
}
