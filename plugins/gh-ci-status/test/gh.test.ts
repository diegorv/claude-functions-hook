import { test } from "node:test";
import assert from "node:assert/strict";
import { createGhClient, type RunProcess } from "../hooks/gh.ts";

const ok = (stdout: string): ReturnType<RunProcess> => Promise.resolve({ exitCode: 0, stdout, stderr: "" });

test("repoName: usa gh repo view no cwd", async () => {
  const calls: (readonly string[])[] = [];
  const gh = createGhClient((argv, init) => { calls.push(argv); assert.equal(init?.cwd, "/repo"); return ok("a/b\n"); }, "/repo");
  assert.equal(await gh.repoName(), "a/b");
  assert.deepEqual(calls[0].slice(0, 3), ["gh", "repo", "view"]);
});

test("repoName: erro do gh vira Error com o stderr", async () => {
  const gh = createGhClient(() => Promise.resolve({ exitCode: 1, stdout: "", stderr: "no git remotes found" }), "/repo");
  await assert.rejects(gh.repoName(), /no git remotes found/);
});

test("listPrs: parse do JSON", async () => {
  const gh = createGhClient((argv) => { assert.deepEqual(argv.slice(0, 3), ["gh", "pr", "list"]); return ok('[{"number":7,"headRefName":"feat/x"}]'); }, "/repo");
  assert.deepEqual(await gh.listPrs(), [{ number: 7, headRefName: "feat/x" }]);
});

test("listRuns: parse do JSON e limit", async () => {
  const gh = createGhClient((argv) => { assert.ok(argv.includes("--limit") && argv.includes("3")); return ok('[{"databaseId":1,"status":"completed"}]'); }, "/repo", 3);
  const runs = await gh.listRuns();
  assert.equal(runs[0].databaseId, 1);
});
