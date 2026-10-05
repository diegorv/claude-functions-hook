import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetails } from "./details.ts";
import { run } from "../core/fixtures.ts";
import type { Job } from "../core/workflow-run.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const failedJob: Job = {
  databaseId: 9,
  name: "test",
  conclusion: "failure",
  steps: [{ name: "Run npm test", conclusion: "failure" }],
  url: "https://github.com/a/b/actions/runs/1/job/9",
};

test("one fetch per run and version; loading until it lands, then a redraw", async () => {
  const fetched: number[] = [];
  let redraws = 0;
  const details = createDetails(
    async (runId) => (fetched.push(runId), [failedJob]),
    () => redraws++,
  );
  const failed = run({ conclusion: "failure" });
  assert.deepEqual(details.of(failed), { state: "loading" });
  assert.deepEqual(details.of(failed), { state: "loading" });
  await settle();
  assert.equal(redraws, 1);
  assert.deepEqual(details.of(failed), {
    state: "loaded",
    failures: [{ job: "test", step: "Run npm test", url: "https://github.com/a/b/actions/runs/1/job/9" }],
  });
  assert.deepEqual(fetched, [1], "a redraw never fetches again");
  details.of({ ...failed, updatedAt: "2026-09-09T13:00:00.000Z" });
  assert.deepEqual(fetched, [1, 1], "a rerun, with a new updatedAt, does");
});

test("a failed fetch is kept across redraws, and tried again once the pane opens", async () => {
  let calls = 0;
  const details = createDetails(
    () => (calls++, Promise.reject(new Error("gh: offline"))),
    () => {},
  );
  details.of(run());
  await settle();
  assert.deepEqual(details.of(run()), { state: "failed", message: "gh: offline" });
  assert.equal(calls, 1, "no fetch per redraw");
  details.retryFailed();
  assert.deepEqual(details.of(run()), { state: "loading" });
  assert.equal(calls, 2);
});

test("retryFailed keeps what loaded; keepOnly drops the runs no longer listed", async () => {
  let calls = 0;
  const details = createDetails(
    async () => (calls++, [failedJob]),
    () => {},
  );
  details.of(run({ databaseId: 1 }));
  details.of(run({ databaseId: 2 }));
  await settle();
  details.retryFailed();
  details.of(run({ databaseId: 1 }));
  assert.equal(calls, 2, "a loaded run is not fetched again on open");
  details.keepOnly(new Set([2]));
  details.of(run({ databaseId: 1 }));
  details.of(run({ databaseId: 2 }));
  assert.equal(calls, 3, "only the dropped run is fetched again");
});

test("a fetch that lands after its run was dropped is not kept", async () => {
  let land: (jobs: Job[]) => void = () => {};
  const details = createDetails(
    () => new Promise((resolve) => (land = resolve)),
    () => {},
  );
  details.of(run());
  details.keepOnly(new Set());
  land([failedJob]);
  await settle();
  assert.deepEqual(details.of(run()), { state: "loading" }, "dropped: asked again, it fetches anew");
});
