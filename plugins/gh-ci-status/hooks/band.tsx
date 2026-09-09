/** @jsx h */
// O desenho da faixa acima do prompt. Recebe os elementos e o estado; não
// conhece o engine.
import { inFlight, phase, type Run } from "./runs.ts";
import { clock, cut, elapsed, header } from "./format.ts";

export type BandProps = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // push recente sem run ainda, ou null
  now: number;
  maxRows: number;
};

// Qualquer tabela de elementos com Box e Text serve: a do terminal ou a do desktop.
type Elements = { Box: any; Text: any };

// Regras do JSX deste runtime: array de .map() só dentro de Fragment; Box não aceita key.
export function Band({ Box, Text }: Elements, p: BandProps) {
  const shown = p.rows.slice(0, p.maxRows);
  const hidden = p.rows.length - shown.length;
  const showWaiting = p.waitingSince !== null && !p.rows.some(inFlight);

  return (
    <Box flexDirection="column">
      <Text dimColor>{header(p.repo, p.rows)}</Text>
      {showWaiting ? (
        <Text dimColor>{`◌ waiting for a run   ${elapsed(p.now - p.waitingSince!)}`}</Text>
      ) : (
        <Text>{""}</Text>
      )}
      <>
        {shown.map((r) => {
          const ph = phase(r);
          return (
            <Box gap={2}>
              <Text color={ph.color} dimColor={ph.dim}>{`${ph.dot} ${ph.label.padEnd(9)}`}</Text>
              <Text dimColor>{`${r.name} · ${r.headBranch}`}</Text>
              <Text>{clock(r, p.now)}</Text>
              <Text dimColor wrap="truncate-end">{cut(r.displayTitle, 60)}</Text>
            </Box>
          );
        })}
      </>
      {hidden > 0 ? <Text dimColor>{`  … and ${hidden} more`}</Text> : <Text>{""}</Text>}
    </Box>
  );
}
