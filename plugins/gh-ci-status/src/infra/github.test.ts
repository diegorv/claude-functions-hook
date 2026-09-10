import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitHubClient, type ProcessResult } from "./github.ts";
import { run } from "../core/fixtures.ts";

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
});
