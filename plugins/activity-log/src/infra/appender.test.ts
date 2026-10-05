import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFile, createAppender } from "./appender.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// $.process.run's contract, served by a real child.
const runProcess = async (argv: readonly string[], init?: { stdin?: string }) => {
  const child = spawnSync(argv[0]!, argv.slice(1), { input: init?.stdin, encoding: "utf8" });
  return { exitCode: child.status ?? 1, stdout: child.stdout, stderr: child.stderr };
};

test("appendFile: makes the folder 700 and the file 600, and appends", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "activity-log-")), "nested", "log.jsonl");
  await appendFile(runProcess, path, "one\n");
  await appendFile(runProcess, path, "two\n");
  assert.equal(readFileSync(path, "utf8"), "one\ntwo\n");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700);
});

test("appendFile: a failing sh rejects with its stderr", async () => {
  await assert.rejects(appendFile(runProcess, "/dev/null/x/y", "z"), /dev\/null/);
});

function setup() {
  const appends: [string, string][] = [];
  const timers: (() => void)[] = [];
  const errors: unknown[] = [];
  let failNext = false;
  const appender = createAppender(
    async (path, text) => {
      if (failNext) {
        failNext = false;
        throw new Error("disk full");
      }
      appends.push([path, text]);
    },
    (_ms, fn) => void timers.push(fn),
    (error) => errors.push(error),
  );
  return { appender, appends, timers, errors, failOnce: () => (failNext = true) };
}

test("one timer per batch; its firing writes the batch, one append per run of a path", async () => {
  const { appender, appends, timers } = setup();
  const a = Promise.resolve("a");
  const b = Promise.resolve("b");
  appender.add(a, "1\n");
  appender.add(a, "2\n");
  appender.add(b, "3\n");
  appender.add(a, "4\n");
  assert.equal(timers.length, 1);
  timers[0]!();
  await appender.flush();
  assert.deepEqual(appends, [
    ["a", "1\n2\n"],
    ["b", "3\n"],
    ["a", "4\n"],
  ]);
  appender.add(a, "5\n");
  assert.equal(timers.length, 2, "armed again after it fired");
});

test("lines stay in order behind a path still resolving", async () => {
  const { appender, appends } = setup();
  let resolvePath: (path: string) => void = () => {};
  const slow = new Promise<string>((resolve) => (resolvePath = resolve));
  appender.add(slow, "1\n");
  const first = appender.flush();
  appender.add(Promise.resolve("fast"), "2\n");
  const second = appender.flush();
  await settle();
  assert.deepEqual(appends, []);
  resolvePath("slow");
  await Promise.all([first, second]);
  assert.deepEqual(appends, [
    ["slow", "1\n"],
    ["fast", "2\n"],
  ]);
});

test("a failed append is reported and the next one still goes out", async () => {
  const { appender, appends, errors, failOnce } = setup();
  failOnce();
  appender.add(Promise.resolve("a"), "lost\n");
  await appender.flush();
  appender.add(Promise.resolve("a"), "kept\n");
  await appender.flush();
  assert.deepEqual(appends, [["a", "kept\n"]]);
  assert.equal((errors[0] as Error).message, "disk full");
});

test("a timer that cannot be armed yet is armed by the next add", () => {
  const timers: (() => void)[] = [];
  let ready = false;
  const appender = createAppender(
    async () => {},
    (_ms, fn) => {
      if (!ready) throw new Error("no clock");
      timers.push(fn);
    },
    () => {},
  );
  appender.add(Promise.resolve("a"), "1\n");
  ready = true;
  appender.add(Promise.resolve("a"), "2\n");
  assert.equal(timers.length, 1);
});

test("a timer that never fires (refused) is dropped after 5 delays: the next add flushes and arms anew", async () => {
  const appends: string[] = [];
  const timers: (() => void)[] = [];
  let clock = 0;
  const a = Promise.resolve("a");
  const appender = createAppender(
    async (_path, text) => void appends.push(text),
    (_ms, fn) => void timers.push(fn),
    () => {},
    1000,
    () => clock,
  );
  appender.add(a, "1\n");
  clock = 5000;
  appender.add(a, "2\n");
  assert.equal(timers.length, 1, "still within 5 delays");
  clock = 5001;
  appender.add(a, "3\n");
  assert.equal(timers.length, 2, "armed anew");
  await settle();
  assert.deepEqual(appends, ["1\n2\n3\n"]);
  timers[0]!(); // the dead one firing late leaves the new one armed
  appender.add(a, "4\n");
  assert.equal(timers.length, 2);
});
