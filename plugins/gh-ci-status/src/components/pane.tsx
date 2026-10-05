// Maps the details pane's view model to elements. No decisions here: see pane-model.ts.
import type { Elements as EngineElements } from "claude-code";
import type { PaneModel } from "./pane-model.ts";
import { RunRow } from "./band.tsx";

type Elements = Pick<EngineElements["terminal"], "Box" | "Text" | "Link" | "Button">;

// `onClose` runs on the header's "close" Button: d while the pane has the focus, as d on the band opened it.
export function Pane(elements: Elements, model: PaneModel, onClose: () => void) {
  const { Box, Text, Link, Button } = elements;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={1}>
        <Text dimColor wrap="truncate-end">
          {model.header}
        </Text>
        <Box flexGrow={1} />
        <Box flexShrink={0}>
          <Button key="close" plain hotkey="d" dimColor onPress={onClose}>
            close
          </Button>
        </Box>
      </Box>
      {model.note ? <Text dimColor>{model.note}</Text> : null}
      <Box flexDirection="column">
        <>
          {model.rows.map(({ row, lines }) => (
            <Box flexDirection="column">
              {RunRow(elements, row)}
              <Box flexDirection="column">
                <>
                  {lines.map((line) => (
                    <Text dimColor wrap="truncate-end">
                      {line.href ? <Link href={line.href}>{line.text}</Link> : line.text}
                    </Text>
                  ))}
                </>
              </Box>
            </Box>
          ))}
        </>
      </Box>
    </Box>
  );
}
