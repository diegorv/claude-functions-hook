// Maps the band's view model to elements. No decisions here: see band-model.ts.
//
// A .map() array goes inside a Fragment, and a bare Fragment lays out as a row
// Box, so it lives inside a column Box. A line that is not drawn is a null
// child, which the element factory drops (RenderChildren), so it takes no row.
import type { Elements as EngineElements, RenderChildren } from "claude-code";
import type { BandModel, Cell, RowModel } from "./band-model.ts";

// The surface's element table; the band draws on the terminal.
type RowElements = Pick<EngineElements["terminal"], "Box" | "Text" | "Link">;
type Elements = RowElements & Pick<EngineElements["terminal"], "Button">;

const anchorOf =
  ({ Text, Link }: RowElements) =>
  (cell: Cell) =>
    cell.href ? <Link href={cell.href}>{cell.text}</Link> : <Text dimColor>{cell.text}</Text>;

// One run's row: the band's and the details pane's.
export function RunRow(elements: RowElements, row: RowModel) {
  const { Box, Text, Link } = elements;
  const anchor = anchorOf(elements);
  const column = (child: RenderChildren) => <Box flexShrink={0}>{child}</Box>;
  return (
    <Box gap={2} flexWrap="nowrap">
      {column(
        <Text>
          {anchor(row.ref)}
          {row.ref.pad}
        </Text>,
      )}
      {column(
        <Text color={row.phase.color}>
          {row.phase.href ? (
            <Link href={row.phase.href}>{`${row.phase.dot} ${row.phase.label}`}</Link>
          ) : (
            `${row.phase.dot} ${row.phase.label}`
          )}
        </Text>,
      )}
      {row.workflow
        ? column(
            <Text dimColor>
              {anchor(row.workflow)}
              {row.workflow.pad}
            </Text>,
          )
        : null}
      {column(<Text>{row.clock}</Text>)}
      {row.title ? (
        <Text dimColor wrap="truncate-end">
          {row.title.href ? anchor(row.title) : row.title.text}
        </Text>
      ) : null}
    </Box>
  );
}

// `onDetails` runs when the header's "details" Button is pressed (a click, Enter, or d while the band
// has the focus); it opens the details pane, or closes it when open. Only the header text truncates.
export function Band(elements: Elements, model: BandModel, onDetails: () => void) {
  const { Box, Text, Button } = elements;
  const anchor = anchorOf(elements);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={1}>
        <Text dimColor wrap="truncate-end">
          {"⚙ "}
          {anchor(model.repo)}
          {" · "}
          {anchor(model.actions)}
          {model.stale ? ` · ${model.stale}` : ""}
          {model.counts ? ` · ${model.counts}` : ""}
        </Text>
        <Box flexGrow={1} />
        <Box flexShrink={0}>
          <Button key="details" plain hotkey="d" dimColor onPress={onDetails}>
            details
          </Button>
        </Box>
      </Box>
      {model.waitingFor !== null ? (
        <Text dimColor wrap="truncate-end">{`◌ waiting for a run   ${model.waitingFor}`}</Text>
      ) : null}
      <Box flexDirection="column">
        <>{model.rows.map((row) => RunRow(elements, row))}</>
      </Box>
      {model.hiddenCount > 0 ? <Text dimColor wrap="truncate-end">{`  … and ${model.hiddenCount} more`}</Text> : null}
    </Box>
  );
}
