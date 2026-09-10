/** @jsx h */
// The band drawn above the prompt. Takes the elements and the state; knows
// nothing about the engine.
//
//   ⚙ owner/repo · Actions · 1 running · 2 finished
//   #167  ◐ Running    PR       0m37s  chore(ci): smoke-test PR
//   main  ● Success    Deploy   2m15s  Release 1.4.0
//
// Column 1: #N (a link to the PR) or the branch. Column 3: the workflow, a link
// to the run. The title links to the run only when the row has no PR.
//
// JSX rules of this runtime: a .map() array only inside a Fragment, and a bare
// Fragment lays out as a row Box, so it lives inside a column Box; Box takes
// no key; an empty conditional branch draws `<Text>{""}</Text>`.
import { inFlight, phase, prNumber, LABEL_WIDTH, type Run } from "../core/runs.ts";
import { branchLabel, clock, counts, cut, elapsed, linkOf, titleOf } from "../core/format.ts";

export type BandProps = {
  repo: string;
  rows: Run[];
  waitingSince: number | null; // a recent push with no run yet, or null
  now: number;
  maxRows: number;
};

// The surface's element table (terminal or desktop); only these three are used.
type Elements = { Box: any; Text: any; Link: any };

const REF_MAX = 24;
const WORKFLOW_MAX = 20;
const TITLE_MAX = 60;

const spaces = (count: number) => " ".repeat(Math.max(0, count));

export function Band({ Box, Text, Link }: Elements, props: BandProps) {
  const shown = props.rows.slice(0, props.maxRows);
  const hiddenCount = props.rows.length - shown.length;
  const waitingFor = props.waitingSince !== null && !props.rows.some(inFlight) ? props.now - props.waitingSince : null;

  // The first two text columns align to the widest row.
  const refs = shown.map((run) => cut(branchLabel(run), REF_MAX));
  const workflows = shown.map((run) => cut(run.workflowName, WORKFLOW_MAX));
  const refWidth = Math.max(0, ...refs.map((ref) => ref.length));
  const workflowWidth = Math.max(0, ...workflows.map((workflow) => workflow.length));

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {"⚙ "}
        <Link href={`https://github.com/${props.repo}`}>{props.repo}</Link>
        {" · "}
        <Link href={`https://github.com/${props.repo}/actions`}>Actions</Link>
        {counts(props.rows) ? ` · ${counts(props.rows)}` : ""}
      </Text>
      {waitingFor !== null ? <Text dimColor>{`◌ waiting for a run   ${elapsed(waitingFor)}`}</Text> : <Text>{""}</Text>}
      <Box flexDirection="column">
        <>
          {shown.map((run, index) => {
            const runPhase = phase(run);
            const number = prNumber(run);
            const title = cut(titleOf(run), TITLE_MAX);
            const ref = refs[index];
            const workflow = workflows[index];
            return (
              <Box gap={2} flexWrap="nowrap">
                <Box flexShrink={0}>
                  <Text>
                    {number !== null ? <Link href={linkOf(props.repo, run)}>{ref}</Link> : <Text dimColor>{ref}</Text>}
                    {spaces(refWidth - ref.length)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text color={runPhase.color} dimColor={runPhase.dim}>
                    {`${runPhase.dot} ${runPhase.label.padEnd(LABEL_WIDTH)}`}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor>
                    <Link href={run.url}>{workflow}</Link>
                    {spaces(workflowWidth - workflow.length)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text>{clock(run, props.now)}</Text>
                </Box>
                {title ? (
                  <Text dimColor wrap="truncate-end">
                    {number !== null ? title : <Link href={run.url}>{title}</Link>}
                  </Text>
                ) : (
                  <Text>{""}</Text>
                )}
              </Box>
            );
          })}
        </>
      </Box>
      {hiddenCount > 0 ? <Text dimColor>{`  … and ${hiddenCount} more`}</Text> : <Text>{""}</Text>}
    </Box>
  );
}
