/** @jsx h */
// O desenho da faixa acima do prompt. Recebe os elementos e o estado; não
// conhece o engine.
import { inFlight, phase, prNumber, type Run } from "./runs.ts";
import { branchLabel, clock, counts, cut, elapsed, linkOf, titleOf } from "./format.ts";

export type BandProps = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // push recente sem run ainda, ou null
  now: number;
  maxRows: number;
};

// Qualquer tabela de elementos com Box e Text serve: a do terminal ou a do desktop.
type Elements = { Box: any; Text: any; Link: any };

// Regras do JSX deste runtime: array de .map() só dentro de Fragment, e o Fragment
// sozinho vira uma Box em linha, então ele mora numa Box em coluna; Box não aceita key.
// Link é inline (OSC 8 no terminal): o #N da branch e o título apontam para o PR ou o run.
export function Band({ Box, Text, Link }: Elements, p: BandProps) {
  const shown = p.rows.slice(0, p.maxRows);
  const hidden = p.rows.length - shown.length;
  const showWaiting = p.waitingSince !== null && !p.rows.some(inFlight);

  // Larguras das duas primeiras colunas: o maior valor entre as linhas
  // visíveis, para os status alinharem; a branch tem um teto.
  const refs = shown.map((r) => cut(branchLabel(r), 24));
  const refWidth = Math.max(4, ...refs.map((t) => t.length));
  const wfWidth = Math.max(2, ...shown.map((r) => cut(r.workflowName, 20).length));
  const pad = (n: number) => " ".repeat(Math.max(0, n));

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {"⚙ "}
        <Link href={`https://github.com/${p.repo}`}>{p.repo}</Link>
        {" · "}
        <Link href={`https://github.com/${p.repo}/actions`}>Actions</Link>
        {counts(p.rows) ? ` · ${counts(p.rows)}` : ""}
      </Text>
      {showWaiting ? (
        <Text dimColor>{`◌ waiting for a run   ${elapsed(p.now - p.waitingSince!)}`}</Text>
      ) : (
        <Text>{""}</Text>
      )}
      <Box flexDirection="column">
        <>
          {shown.map((r, i) => {
            const ph = phase(r);
            const ref = refs[i];
            return (
              <Box gap={2} flexWrap="nowrap">
                <Box flexShrink={0}>
                  <Text>
                    {prNumber(r) !== null ? <Link href={linkOf(p.repo, r)}>{ref}</Link> : <Text dimColor>{ref}</Text>}
                    {pad(refWidth - ref.length)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text color={ph.color} dimColor={ph.dim}>{`${ph.dot} ${ph.label.padEnd(9)}`}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor>{cut(r.workflowName, 20).padEnd(wfWidth)}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text>{clock(r, p.now)}</Text>
                </Box>
                {titleOf(r) ? (
                  <Text dimColor wrap="truncate-end">
                    {/* o link fica no #N; sem PR, o título leva ao run */}
                    {prNumber(r) !== null ? cut(titleOf(r), 60) : <Link href={linkOf(p.repo, r)}>{cut(titleOf(r), 60)}</Link>}
                  </Text>
                ) : (
                  <Text>{""}</Text>
                )}
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
