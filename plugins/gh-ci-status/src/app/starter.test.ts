import { test } from "node:test";
import assert from "node:assert/strict";
import { createStarter } from "./starter.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a failed find is logged and tried again by the next call", async () => {
  const answers = [Promise.reject(new Error("no remote")), Promise.resolve("a/b")];
  const started: string[] = [];
  const logs: string[] = [];
  const startWatch = createStarter(
    () => answers.shift()!,
    async (repo) => void started.push(repo),
    (text) => logs.push(text),
  );
  startWatch();
  await settle();
  assert.deepEqual(started, []);
  assert.deepEqual(logs, ["no remote; staying quiet until the next push or merge"]);
  startWatch();
  await settle();
  assert.deepEqual(started, ["a/b"]);
});

test("one find at a time, and none once started", async () => {
  let finds = 0;
  let resolveFind: (repo: string) => void = () => {};
  const startWatch = createStarter(
    () => {
      finds++;
      return new Promise((resolve) => (resolveFind = resolve));
    },
    async () => {},
    () => {},
  );
  startWatch();
  startWatch();
  assert.equal(finds, 1, "a call during the find does nothing");
  resolveFind("a/b");
  await settle();
  startWatch();
  assert.equal(finds, 1, "started: later calls do nothing");
});

test("a start that fails counts as not started", async () => {
  let finds = 0;
  const logs: string[] = [];
  const startWatch = createStarter(
    async () => (finds++, "a/b"),
    () => Promise.reject(new Error("clock refused")),
    (text) => logs.push(text),
  );
  startWatch();
  await settle();
  startWatch();
  await settle();
  assert.equal(finds, 2);
  assert.equal(logs.length, 2);
});
