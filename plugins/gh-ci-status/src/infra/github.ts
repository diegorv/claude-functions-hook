// GitHub client on top of the `gh` CLI. Takes the function that runs processes
// instead of `$`, so the hook passes `$.process.run` and tests pass a fake.
import type { Pr, Run } from "../core/workflow-run.ts";
import { cut } from "../utils/text.ts";

export type ProcessResult = { exitCode: number; stdout: string; stderr: string };
export type RunProcess = (
  argv: readonly string[],
  init?: { cwd?: string; timeoutMs?: number },
) => Promise<ProcessResult>;

export type GitHubLimits = { runs: number; prs: number };
export const DEFAULT_LIMITS: GitHubLimits = { runs: 15, prs: 100 };

const RUN_FIELDS =
  "databaseId,status,conclusion,workflowName,headBranch,displayTitle,createdAt,startedAt,updatedAt,url";
const PR_FIELDS = "number,headRefName,isCrossRepository";

export type GitHubClient = {
  repoName: () => Promise<string>;
  listRuns: () => Promise<Run[]>;
  listPrs: () => Promise<Pr[]>;
};

export function createGitHubClient(
  runProcess: RunProcess,
  cwd: string,
  limits: GitHubLimits = DEFAULT_LIMITS,
): GitHubClient {
  const failure = (result: ProcessResult, fallback: string) =>
    new Error(cut(result.stderr || result.stdout || fallback, 120));

  const runGh = async (args: string[], timeoutMs: number): Promise<ProcessResult> => {
    const result = await runProcess(["gh", ...args], { cwd, timeoutMs });
    if (result.exitCode !== 0) throw failure(result, `gh exited ${result.exitCode}`);
    return result;
  };

  const runGhJson = async <Parsed>(args: string[]): Promise<Parsed> =>
    JSON.parse((await runGh(args, 25_000)).stdout) as Parsed;

  return {
    async repoName() {
      const result = await runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], 15_000);
      const name = result.stdout.trim();
      if (!name) throw failure(result, "no GitHub remote");
      return name;
    },
    listRuns: () => runGhJson<Run[]>(["run", "list", "--limit", String(limits.runs), "--json", RUN_FIELDS]),
    listPrs: () =>
      runGhJson<Pr[]>(["pr", "list", "--state", "all", "--limit", String(limits.prs), "--json", PR_FIELDS]),
  };
}
