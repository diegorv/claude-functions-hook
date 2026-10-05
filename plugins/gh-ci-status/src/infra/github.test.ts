import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGitHubClient, type ProcessResult } from "./github.ts";
import { run } from "../core/fixtures.ts";
import { jobFailures } from "../core/workflow-run.ts";

const succeeded = (stdout: string): Promise<ProcessResult> => Promise.resolve({ exitCode: 0, stdout, stderr: "" });
const failed = (exitCode: number, stderr = ""): Promise<ProcessResult> =>
  Promise.resolve({ exitCode, stdout: "", stderr });

test("repoName: runs gh repo view in the cwd", async () => {
  const calls: (readonly string[])[] = [];
  const github = createGitHubClient((argv, init) => {
    calls.push(argv);
    assert.equal(init?.cwd, "/repo");
    return succeeded("a/b\n");
  }, "/repo");
  assert.equal(await github.repoName(), "a/b");
  assert.deepEqual(calls[0].slice(0, 3), ["gh", "repo", "view"]);
});

test("repoName: a gh error becomes an Error with the stderr; empty output fails too", async () => {
  await assert.rejects(
    createGitHubClient(() => failed(1, "no git remotes found"), "/repo").repoName(),
    /no git remotes found/,
  );
  await assert.rejects(createGitHubClient(() => succeeded(""), "/repo").repoName(), /no GitHub remote/);
});

test("listRuns and listPrs: JSON parsing and limits", async () => {
  const calls: string[][] = [];
  const github = createGitHubClient(
    (argv) => {
      calls.push([...argv]);
      return succeeded("[]");
    },
    "/repo",
    { runs: 3, prs: 7 },
  );
  assert.deepEqual(await github.listRuns(), []);
  assert.deepEqual(await github.listPrs(), []);
  assert.deepEqual(calls[0].slice(0, 5), ["gh", "run", "list", "--limit", "3"]);
  assert.deepEqual(calls[1].slice(0, 7), ["gh", "pr", "list", "--state", "all", "--limit", "7"]);
  assert.deepEqual(calls[0].at(-1)!.split(",").sort(), Object.keys(run()).sort(), "asks for every field a Run has");
  assert.equal(calls[1].at(-1), "number,headRefName,isCrossRepository");
});

test("listRuns: a non-zero exit becomes an Error", async () => {
  await assert.rejects(createGitHubClient(() => failed(4), "/repo").listRuns(), /gh exited 4/);
  await assert.rejects(createGitHubClient(() => failed(1, "\n"), "/repo").listRuns(), /gh exited 1/);
});

// fixtures/run-view-jobs.json is real `gh run view 37353310727 -R Homebrew/brew --json jobs`
// output, captured 2026-10-05 from a failed CI run of a pull request. Trimmed to the
// fields a Job has and to 3 of its 31 jobs: the failed one and two that passed.
const RUN_VIEW_JOBS = readFileSync(new URL("./fixtures/run-view-jobs.json", import.meta.url), "utf8");
const BREW_RUN = "https://github.com/Homebrew/brew/actions/runs/37353310727";

test("runJobs: runs gh run view --json jobs and returns its .jobs", async () => {
  const calls: (readonly string[])[] = [];
  const github = createGitHubClient((argv) => {
    calls.push(argv);
    return succeeded(RUN_VIEW_JOBS);
  }, "/repo");
  const jobs = await github.runJobs(37353310727);
  assert.deepEqual(calls, [["gh", "run", "view", "37353310727", "--json", "jobs"]]);
  assert.deepEqual(
    jobs.map((job) => job.name),
    ["syntax", "tests (generic OS, 2/2)", "tests (generic OS, 1/2)"],
  );
});

test("jobFailures on a real gh payload: the failed job, its first failed step, and gh's own job url", async () => {
  const jobs = await createGitHubClient(() => succeeded(RUN_VIEW_JOBS), "/repo").runJobs(37353310727);
  assert.deepEqual(jobFailures(run({ url: "https://example.invalid/run" }), jobs), [
    { job: "tests (generic OS, 2/2)", step: "Run brew tests", url: `${BREW_RUN}/job/111909993692` },
  ]);
});
