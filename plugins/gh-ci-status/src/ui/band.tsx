/** @jsx h */
// O desenho da faixa acima do prompt. Recebe os elementos e o estado; não
// conhece o engine.
//
//   ⚙ owner/repo · Actions · 1 running · 2 finished
//   #167  ◐ Running    PR       0m37s  chore(ci): smoke-test PR
//   main  ● Success    Deploy   2m15s  Release 1.4.0
//
// Coluna 1: #N (link para o PR) ou a branch. Coluna 3: o workflow, link para o
// run. O título é link para o run só quando a linha não tem PR.
//
// Regras do JSX deste runtime: um array de .map() só dentro de Fragment, e o
// Fragment sozinho vira uma Box em linha, então ele mora numa Box em coluna;
// Box não aceita key; um ramo condicional vazio desenha `<Text>{""}</Text>`.
import { inFlight, phase, prNumber, LABEL_WIDTH, type Run } from "../domain/runs.ts";
import { branchLabel, clock, counts, cut, elapsed, linkOf, titleOf } from "../domain/format.ts";

export type BandProps = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // push recente sem run ainda, ou null
  now: number;
  maxRows: number;
};

// A tabela de elementos do surface (terminal ou desktop); só estes três são usados.
type Elements = { Box: any; Text: any; Link: any };

const REF_MAX = 24;
const WORKFLOW_MAX = 20;
const TITLE_MAX = 60;

const pad = (n: number) => " ".repeat(Math.max(0, n));

export function Band({ Box, Text, Link }: Elements, p: BandProps) {
  const shown = p.rows.slice(0, p.maxRows);
  const hidden = p.rows.length - shown.length;
  const waitingFor = p.waitingSince !== null && !p.rows.some(inFlight) ? p.now - p.waitingSince : null;

  // As duas primeiras colunas de texto alinham pela linha mais larga.
  const refs = shown.map((r) => cut(branchLabel(r), REF_MAX));
  const workflows = shown.map((r) => cut(r.workflowName, WORKFLOW_MAX));
  const refWidth = Math.max(0, ...refs.map((t) => t.length));
  const workflowWidth = Math.max(0, ...workflows.map((t) => t.length));

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {"⚙ "}
        <Link href={`https://github.com/${p.repo}`}>{p.repo}</Link>
        {" · "}
        <Link href={`https://github.com/${p.repo}/actions`}>Actions</Link>
        {counts(p.rows) ? ` · ${counts(p.rows)}` : ""}
      </Text>
      {waitingFor !== null ? <Text dimColor>{`◌ waiting for a run   ${elapsed(waitingFor)}`}</Text> : <Text>{""}</Text>}
      <Box flexDirection="column">
        <>
          {shown.map((r, i) => {
            const ph = phase(r);
            const pr = prNumber(r);
            const title = cut(titleOf(r), TITLE_MAX);
            return (
              <Box gap={2} flexWrap="nowrap">
                <Box flexShrink={0}>
                  <Text>
                    {pr !== null ? <Link href={linkOf(p.repo, r)}>{refs[i]}</Link> : <Text dimColor>{refs[i]}</Text>}
                    {pad(refWidth - refs[i].length)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text color={ph.color} dimColor={ph.dim}>{`${ph.dot} ${ph.label.padEnd(LABEL_WIDTH)}`}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor>
                    <Link href={r.url}>{workflows[i]}</Link>
                    {pad(workflowWidth - workflows[i].length)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text>{clock(r, p.now)}</Text>
                </Box>
                {title ? (
                  <Text dimColor wrap="truncate-end">
                    {pr !== null ? title : <Link href={r.url}>{title}</Link>}
                  </Text>
                ) : (
                  <Text>{""}</Text>
                )}
              </Box>
            );
          })}
        </>
      </Box>
      {hidden > 0 ? <Text dimColor>{`  … and ${hidden} more`}</Text> : <Text>{""}</Text>}
    </Box>
  );
}
