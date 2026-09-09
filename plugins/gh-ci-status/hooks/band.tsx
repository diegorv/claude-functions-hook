/** @jsx h */
// O desenho da faixa acima do prompt. Recebe os elementos e o estado; não
// conhece o engine.
import { inFlight, phase, type Run } from "./runs.ts";
import { branchLabel, clock, cut, elapsed, header, linkOf } from "./format.ts";

export type BandProps = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // push recente sem run ainda, ou null
  now: number;
  maxRows: number;
};

// Qualquer tabela de elementos com Box e Text serve: a do terminal ou a do desktop.
type Elements = { Box: any; Text: any };

// Regras do JSX deste runtime: array de .map() só dentro de Fragment, e o Fragment
// sozinho vira uma Box em linha, então ele mora numa Box em coluna; Box não aceita key.
// Links: o terminal não desenha OSC 8, então a URL vai em texto e o terminal a detecta.
export function Band({ Box, Text }: Elements, p: BandProps) {
  const shown = p.rows.slice(0, p.maxRows);
  const hidden = p.rows.length - shown.length;
  const showWaiting = p.waitingSince !== null && !p.rows.some(inFlight);

  return (
    <Box flexDirection="column">
      <Text dimColor>{header(p.repo, p.rows)}</Text>
      {showWaiting ? (
        <Text
          dimColor
        >{`◌ waiting for a run   ${elapsed(p.now - p.waitingSince!)}`}</Text>
      ) : (
        <Text>{""}</Text>
      )}
      <Box flexDirection="column">
        <>
          {shown.map((r) => {
            const ph = phase(r);
            return (
              <Box gap={2} flexWrap="nowrap">
                <Box flexShrink={0}>
                  <Text
                    color={ph.color}
                    dimColor={ph.dim}
                  >{`${ph.dot} ${ph.label.padEnd(9)}`}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor>
                    {cut(`${r.name} · ${branchLabel(r)}`, 36)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text>{clock(r, p.now)}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor>{cut(r.displayTitle, 40)}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {linkOf(p.repo, r)}
                </Text>
              </Box>
            );
          })}
        </>
      </Box>
      {hidden > 0 ? (
        <Text dimColor>{`  … and ${hidden} more`}</Text>
      ) : (
        <Text>{""}</Text>
      )}
    </Box>
  );
}
