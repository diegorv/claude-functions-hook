/** @jsx h */
// Wires the piece to the engine: one hook.
//
//   ui.render on UserMessage  draws the time above the message
//
// The time is the one of the message's first drawing, which is when it was
// sent, and it is kept per message, so a resize or a redraw does not move it;
// a resumed session, or a reload of the plugin, draws old messages with the
// current time.
import type { Register } from "claude-code";
import { formatTime } from "../utils/clock.ts";
import { Timestamp } from "../components/timestamp.tsx";

export const register: Register = (on) => {
  const drawnAt = new Map<string, string>(); // message id -> the time of its first drawing
  on("ui.render", { component: "UserMessage" }, async ($, event, next) => {
    const time = drawnAt.get(event.requestId) ?? formatTime($.clock.now());
    drawnAt.set(event.requestId, time);
    return Timestamp($.ui.resolve(event), time, await next(event));
  });
};
