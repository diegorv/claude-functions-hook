// Cliente do `gh`. Recebe a função que executa processos em vez de `$`, para
// o hook passar `$.process.run` e o teste passar um fake.
import type { Pr, Run } from "./runs.ts";
import { cut } from "./format.ts";

export type RunProcess = (
  argv: readonly string[],
  init?: { cwd?: string; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const FIELDS = "databaseId,status,conclusion,name,workflowName,headBranch,displayTitle,createdAt,updatedAt,url";

export type GhClient = {
  repoName: () => Promise<string>;
  listRuns: () => Promise<Run[]>;
  listPrs: () => Promise<Pr[]>;
};

export function createGhClient(run: RunProcess, cwd: string, limit = 15): GhClient {
  const fail = (r: { exitCode: number; stdout: string; stderr: string }, fallback: string) =>
    new Error(cut(r.stderr || r.stdout || fallback, 120));

  return {
    async repoName() {
      const r = await run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd, timeoutMs: 15_000 });
      const name = r.stdout.trim();
      if (r.exitCode !== 0 || !name) throw fail(r, "no GitHub remote");
      return name;
    },
    async listRuns() {
      const r = await run(["gh", "run", "list", "--limit", String(limit), "--json", FIELDS], { cwd, timeoutMs: 25_000 });
      if (r.exitCode !== 0) throw fail(r, `exit ${r.exitCode}`);
      return JSON.parse(r.stdout) as Run[];
    },
    async listPrs() {
      const r = await run(["gh", "pr", "list", "--state", "all", "--limit", "100", "--json", "number,headRefName"], { cwd, timeoutMs: 25_000 });
      if (r.exitCode !== 0) throw fail(r, `exit ${r.exitCode}`);
      return JSON.parse(r.stdout) as Pr[];
    },
  };
}
