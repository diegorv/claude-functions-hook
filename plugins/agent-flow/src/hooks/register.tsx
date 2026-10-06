// Wires the model to the engine: its hooks, no logic of its own.
//
//   session.start               registers /flow, in an interactive session only
//   session.end                 /clear and /resume forget the tree
//   agent.spawn                 a started agent joins the tree under its parent
//   tool.call                   a call is in flight from its start until next settles
//   classic.PermissionRequest   a prompt no settings hook decided marks the call waiting
//   turn.start, turn.complete   the main loop's turns; a subagent's run ends at its turn.complete
//   ui.render                   draws the pane from the tree
//   ui.close                    notes that the pane is gone, so the next /flow opens it
//   command.run                 /flow opens or closes the pane
//
// While isBusy and the pane is drawn, the tree is reconciled with $.agent.list()
// every 2 s and the pane redrawn every 1 s, so the clocks move; both timers stop
// once all is idle or the pane closes. Events update the tree either way.
import type { EngineInterface, Register, Timer } from "claude-code";
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
} from "../core/flow.ts";
import { isBusy } from "../core/rows.ts";
import { Pane } from "../components/pane.tsx";
import { paneModel } from "../components/pane-model.ts";

const PANE_ID = "flow";
const TICK_MS = 1000;
const LIST_MS = 2000;

const logFailure = ($: EngineInterface) => (error: unknown) =>
  $.ui.log(error instanceof Error ? error.message : String(error), { to: "debug" });

// What the module keeps between hooks; a reload starts it over.
type Flow = {
  isActive: boolean; // an interactive session: -p and the SDK draw nowhere, so nothing is tracked
  state: FlowState;
  timers: Timer[];
  paneDrawn: boolean; // this module drew the pane since it last opened; cleared when it closes
};

// Starts or stops the timers by whether anything runs in a drawn pane.
function syncTimers($: EngineInterface, flow: Flow) {
  const busy = isBusy(flow.state) && flow.paneDrawn;
  if (busy && flow.timers.length === 0) {
    flow.timers = [
      $.clock.every(TICK_MS, () => $.ui.invalidate("ui.render")),
      $.clock.every(LIST_MS, () => void readList($, flow).catch(logFailure($))),
    ];
  } else if (!busy && flow.timers.length > 0) {
    for (const timer of flow.timers) timer.cancel();
    flow.timers = [];
  }
}

// Changes the tree, redraws, and starts or stops the timers.
async function apply($: EngineInterface, flow: Flow, change: (state: FlowState, now: number) => FlowState) {
  flow.state = change(flow.state, await $.clock.now());
  $.ui.invalidate("ui.render");
  syncTimers($, flow);
}

async function readList($: EngineInterface, flow: Flow) {
  const listed = await $.agent.list();
  await apply($, flow, (state, now) => reconcile(state, listed, now));
}

// Opened by the person, so it is placed at any width; it does not take the keyboard, being a view to glance at.
async function togglePane($: EngineInterface, flow: Flow): Promise<string | undefined> {
  const listed = (await $.ui.panes()).find((pane) => pane.id === PANE_ID);
  if (listed?.isShown && flow.paneDrawn) {
    await $.ui.close({ id: PANE_ID });
    return "Closed the agent flow pane.";
  }
  // Listed but not drawn here is what a reload leaves, and opening that again does not draw it: close it first.
  if (listed && !flow.paneDrawn) await $.ui.close({ id: PANE_ID });
  const opened = await $.ui.open({ id: PANE_ID, title: "Agent flow" });
  return opened.isPlaced ? undefined : `The agent flow pane did not open: ${opened.reason}`;
}

export const register: Register = (on) => {
  const flow: Flow = { isActive: false, state: initialState(0), timers: [], paneDrawn: false };

  on("session.start", ($, event, next) => {
    flow.isActive = event.isInteractive;
    if (flow.isActive) {
      void $.command
        .register({ name: "flow", description: "Show or hide the tree of this session's subagents and teammates" })
        .catch(logFailure($));
    }
    return next(event);
  });

  on("session.end", async ($, event, next) => {
    if (flow.isActive && (event.reason === "clear" || event.reason === "resume")) {
      await apply($, flow, (_, now) => initialState(now));
    }
    return next(event);
  });

  on("agent.spawn", async ($, event, next) => {
    const result = await next(event);
    if (flow.isActive) await apply($, flow, (current, now) => onSpawn(current, event, result, now));
    return result;
  });

  on("tool.call", async ($, event, next) => {
    if (!flow.isActive) return next(event);
    await apply($, flow, (current, now) => onToolStart(current, event, now));
    try {
      return await next(event);
    } finally {
      await apply($, flow, (current, now) => onToolEnd(current, event, now));
    }
  });

  // The chain beneath is the settings hooks: a decision of theirs means no prompt is shown.
  on("classic.PermissionRequest", async ($, event, next) => {
    const result = await next(event);
    if (flow.isActive && !result.decision && !result.block) {
      await apply($, flow, (current, now) =>
        onPermission(current, { agentId: event.agent_id, tool: event.tool_name }, now),
      );
    }
    return result;
  });

  on("turn.start", async ($, event, next) => {
    if (flow.isActive) await apply($, flow, (current, now) => onTurnStart(current, now));
    return next(event);
  });

  on("turn.complete", async ($, event, next) => {
    if (flow.isActive) await apply($, flow, (current, now) => onTurnComplete(current, event, now));
    return next(event);
  });

  // Registered only in an interactive session (session.start), where the pane can draw.
  on("command.run", { command: "flow" }, async ($) => {
    const text = await togglePane($, flow);
    return text ? { text } : {};
  });

  on("ui.render", { component: "Pane", surface: "terminal" }, async ($, event, next) => {
    if (event.requestId !== PANE_ID) return next(event);
    if (!flow.paneDrawn) {
      flow.paneDrawn = true;
      syncTimers($, flow);
    }
    return Pane($.ui.resolve(event), paneModel(flow.state, await $.clock.now()));
  });

  // The person's close or ours ends the drawing; the close goes on.
  on("ui.close", { id: PANE_ID }, ($, event, next) => {
    flow.paneDrawn = false;
    syncTimers($, flow);
    return next(event);
  });
};
