/** @jsx h */
// Wires the piece to the engine: one hook.
//
//   ui.render on UserMessage  draws the current time above the message
//
// The time is taken when the message is drawn, which is when it was sent;
// a resumed session redraws old messages with the current time.
import type { Register } from "claude-code";
import { formatTime } from "../utils/clock.ts";
import { Timestamp } from "../components/timestamp.tsx";

export const register: Register = (on) => {
  on("ui.render", { component: "UserMessage" }, async ($, event, next) =>
    Timestamp($.ui.resolve(event), formatTime($.clock.now()), await next(event)),
  );
};
