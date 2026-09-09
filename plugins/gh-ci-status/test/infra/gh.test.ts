import { test } from "node:test";
import assert from "node:assert/strict";
import { createGhClient, type RunProcess } from "../../src/infra/gh.ts";

const ok = (stdout: string): ReturnType<RunProcess> => Promise.resolve({ exitCode: 0, stdout, stderr: "" });

test("repoName: roda gh repo view no cwd", async () => {
  const calls: (readonly string[])[] = [];
  const gh = createGhClient((argv, init) => {
    calls.push(argv);
    assert.equal(init?.cwd, "/repo");
    return ok("a/b\n");
  }, "/repo");
  assert.equal(await gh.repoName(), "a/b");
  assert.deepEqual(calls[0].slice(0, 3), ["gh", "repo", "view"]);
});

test("repoName: erro do gh vira Error com o stderr; saída vazia também falha", async () => {
  await assert.rejects(
    createGhClient(
      () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "no git remotes found" }),
      "/repo",
    ).repoName(),
    /no git remotes found/,
  );
  await assert.rejects(createGhClient(() => ok(""), "/repo").repoName(), /no GitHub remote/);
});

test("listRuns e listPrs: parse do JSON e limites", async () => {
  const seen: string[][] = [];
  const gh = createGhClient(
    (argv) => {
      seen.push([...argv]);
      return ok("[]");
    },
    "/repo",
    { runs: 3, prs: 7 },
  );
  assert.deepEqual(await gh.listRuns(), []);
  assert.deepEqual(await gh.listPrs(), []);
  assert.deepEqual(seen[0].slice(0, 5), ["gh", "run", "list", "--limit", "3"]);
  assert.deepEqual(seen[1].slice(0, 7), ["gh", "pr", "list", "--state", "all", "--limit", "7"]);
});

test("listRuns: exit != 0 vira Error", async () => {
  const gh = createGhClient(() => Promise.resolve({ exitCode: 4, stdout: "", stderr: "" }), "/repo");
  await assert.rejects(gh.listRuns(), /gh exited 4/);
});
