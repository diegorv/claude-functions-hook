/** @jsx h */
// Maps the band's view model to elements. No decisions here: see band-model.ts.
//
// JSX rules of this runtime: a .map() array only inside a Fragment, and a bare
// Fragment lays out as a row Box, so it lives inside a column Box; Box takes
// no key; an empty conditional branch draws an empty Text.
import type { BandModel, Cell } from "./band-model.ts";

// The surface's element table (terminal or desktop); only these three are used.
type Elements = { Box: any; Text: any; Link: any };

export function Band({ Box, Text, Link }: Elements, model: BandModel) {
  const blank = () => <Text>{""}</Text>;
  const column = (child: unknown) => <Box flexShrink={0}>{child}</Box>;
  const anchor = (cell: Cell) =>
    cell.href ? <Link href={cell.href}>{cell.text}</Link> : <Text dimColor>{cell.text}</Text>;

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {"⚙ "}
        {anchor(model.repo)}
        {" · "}
        {anchor(model.actions)}
        {model.counts ? ` · ${model.counts}` : ""}
      </Text>
      {model.waitingFor !== null ? <Text dimColor>{`◌ waiting for a run   ${model.waitingFor}`}</Text> : blank()}
      <Box flexDirection="column">
        <>
          {model.rows.map((row) => (
            <Box gap={2} flexWrap="nowrap">
              {column(
                <Text>
                  {anchor(row.ref)}
                  {row.ref.pad}
                </Text>,
              )}
              {column(
                <Text color={row.phase.color} dimColor={row.phase.dim}>{`${row.phase.dot} ${row.phase.label}`}</Text>,
              )}
              {column(
                <Text dimColor>
                  {anchor(row.workflow)}
                  {row.workflow.pad}
                </Text>,
              )}
              {column(<Text>{row.clock}</Text>)}
              {row.title ? (
                <Text dimColor wrap="truncate-end">
                  {row.title.href ? anchor(row.title) : row.title.text}
                </Text>
              ) : (
                blank()
              )}
            </Box>
          ))}
        </>
      </Box>
      {model.hiddenCount > 0 ? <Text dimColor>{`  … and ${model.hiddenCount} more`}</Text> : blank()}
    </Box>
  );
}
