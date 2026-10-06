// Maps the pane's view model to elements. No decisions here: see pane-model.ts.
//
// A .map() array goes inside a Fragment, and a bare Fragment lays out as a row
// Box, so it lives inside a column Box.
import type { Elements as EngineElements } from "claude-code";
import type { PaneModel } from "./pane-model.ts";

type Elements = Pick<EngineElements["terminal"], "Box" | "Text">;

export function Pane({ Box, Text }: Elements, model: PaneModel) {
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {model.header}
      </Text>
      <Box flexDirection="column">
        <>
          {model.lines.map((line) => (
            <Text
              {...(line.color ? { color: line.color } : {})}
              dimColor={line.isDim}
              bold={line.isBold}
              wrap="truncate-end"
            >
              {line.text}
            </Text>
          ))}
        </>
      </Box>
      {model.note ? <Text dimColor>{model.note}</Text> : null}
    </Box>
  );
}
