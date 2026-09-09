// Cliente do `gh`. Recebe a função que executa processos em vez de `$`, para
// o hook passar `$.process.run` e o teste passar um fake.
import type { Pr, Run } from "../domain/runs.ts";
import { cut } from "../domain/format.ts";

export type ProcessResult = { exitCode: number; stdout: string; stderr: string };
export type RunProcess = (
  argv: readonly string[],
  init?: { cwd?: string; timeoutMs?: number },
) => Promise<ProcessResult>;

export type GhLimits = { runs: number; prs: number };
export const DEFAULT_LIMITS: GhLimits = { runs: 15, prs: 100 };

const RUN_FIELDS = "databaseId,status,conclusion,workflowName,headBranch,displayTitle,createdAt,updatedAt,url";
const PR_FIELDS = "number,headRefName";

export type GhClient = {
  repoName: () => Promise<string>;
  listRuns: () => Promise<Run[]>;
  listPrs: () => Promise<Pr[]>;
};

export function createGhClient(run: RunProcess, cwd: string, limits: GhLimits = DEFAULT_LIMITS): GhClient {
  const fail = (r: ProcessResult, fallback: string) => new Error(cut(r.stderr || r.stdout || fallback, 120));

  const gh = async (args: string[], timeoutMs: number): Promise<ProcessResult> => {
    const r = await run(["gh", ...args], { cwd, timeoutMs });
    if (r.exitCode !== 0) throw fail(r, `gh exited ${r.exitCode}`);
    return r;
  };

  const json = async <T>(args: string[]): Promise<T> => JSON.parse((await gh(args, 25_000)).stdout) as T;

  return {
    async repoName() {
      const r = await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], 15_000);
      const name = r.stdout.trim();
      if (!name) throw fail(r, "no GitHub remote");
      return name;
    },
    listRuns: () => json<Run[]>(["run", "list", "--limit", String(limits.runs), "--json", RUN_FIELDS]),
    listPrs: () => json<Pr[]>(["pr", "list", "--state", "all", "--limit", String(limits.prs), "--json", PR_FIELDS]),
  };
}
