import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { run, running, T0 } from "../core/fixtures.ts";
import type { Run } from "../core/workflow-run.ts";

// Node strips types from .ts but does not load .tsx. register.tsx has no JSX, so its
// types are stripped here; band.tsx and pane.tsx have JSX, so they load as stubs that
// hand back the model they were given, and the press or close callback.
// registerHooks needs Node >=22.15 and stripTypeScriptTypes >=22.13; node --test runs each
// file in its own process, so these hooks reach no other test file.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const stub = (name: string) =>
      `export const ${name} = (elements, model, callback) => ({ ${name}: model, callback });`;
    const source = url.endsWith("/components/band.tsx")
      ? stub("Band")
      : url.endsWith("/components/pane.tsx")
        ? stub("Pane")
        : stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
    return { format: "module", source, shortCircuit: true };
  },
});
const { register } = await import("./register.tsx");

type Handler = (...args: any[]) => any;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The handlers register() subscribes, by event (ui.render by component too), and a fake $
// that answers gh from `gh` (read on each call, so a test can flip runsFail) and records
// what the hooks did to the engine. placed: false makes the pane fail to open.
function setup(gh: { repo?: () => Promise<string>; runs?: Run[]; runsFail?: boolean; placed?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  register(
    ((event: string, matcher: { component?: string } | Handler, handler?: Handler) => {
      const key = event === "ui.render" ? `${event}:${(matcher as { component: string }).component}` : event;
      handlers.set(key, handler ?? (matcher as Handler));
      return { catch: () => {} };
    }) as never,
    {} as never,
  );

  const calls: string[][] = [];
  const registered: unknown[] = [];
  const ops: string[] = []; // the pane's opens and closes, in order
  let listed: { id: string; isShown: boolean }[] = [];
  const findRepo = gh.repo ?? (() => Promise.resolve("a/b"));
  const out = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
  const $ = {
    process: {
      run: async (argv: readonly string[]) => {
        calls.push([...argv]);
        const [, noun, verb] = argv;
        if (noun === "repo") {
          try {
            return out(`${await findRepo()}\n`);
          } catch (error) {
            return { exitCode: 1, stdout: "", stderr: (error as Error).message };
          }
        }
        if (noun === "run" && verb === "list") {
          return gh.runsFail ? { exitCode: 1, stdout: "", stderr: "HTTP 502" } : out(JSON.stringify(gh.runs ?? []));
        }
        if (noun === "run" && verb === "view") return out('{"jobs":[]}');
        return out("[]");
      },
    },
    clock: {
      now: async () => T0 + 60_000,
      after: () => ({ cancel: () => {} }),
      every: () => ({ cancel: () => {} }),
    },
    ui: {
      invalidate: () => {},
      toast: () => {},
      log: async () => {},
      resolve: () => ({}),
      panes: async () => listed,
      open: async ({ id }: { id: string }) => {
        ops.push("open");
        if (gh.placed === false) return { isPlaced: false, reason: "no room" };
        listed = [{ id, isShown: true }];
        return { isPlaced: true };
      },
      close: async () => {
        ops.push("close");
        listed = [];
      },
    },
    command: { register: async (spec: unknown) => void registered.push(spec) },
  };

  const next = (event: unknown) => ({ next: event });
  const call = (key: string, event: unknown) => handlers.get(key)!($, event, next);
  return {
    calls,
    registered,
    ops,
    listPane: (isShown: boolean) => (listed = [{ id: "ci", isShown }]),
    runListCalls: () => calls.filter(([, noun, verb]) => noun === "run" && verb === "list").length,
    start: async (isInteractive = true) => {
      const result = call("session.start", { isInteractive, cwd: "/repo" });
      await settle();
      await settle();
      return result;
    },
    bash: (command: string) => call("classic.PostToolUse", { tool_input: { command } }),
    band: (props: { hasSurvey?: boolean } = {}) =>
      call("ui.render:AbovePrompt", { props: { maxRows: 6, bodyColumns: 120, hasSurvey: false, ...props } }),
    pane: () => call("ui.render:Pane", { requestId: "ci", props: { bodyColumns: 120 } }),
    closed: () => call("ui.close", { id: "ci" }),
    command: (args = "") => call("command.run", { command: "gh-ci", args }),
  };
}

test("session.start: a non-interactive session only calls next", async () => {
  const engine = setup();
  assert.deepEqual(await engine.start(false), { next: { isInteractive: false, cwd: "/repo" } });
  assert.deepEqual(engine.calls, []);
  assert.deepEqual(engine.registered, []);
});

test("session.start: registers /gh-ci with its arguments, finds the repo and polls", async () => {
  const engine = setup({ runs: [running()] });
  await engine.start();
  assert.deepEqual(engine.registered, [
    {
      name: "gh-ci",
      description: "Show or hide this repo's GitHub Actions runs and their failed jobs",
      argumentHint: "[refresh|status]",
    },
  ]);
  assert.equal(engine.runListCalls(), 1);
  assert.equal((await engine.band()).Band.counts, "1 running");
});

test("a push before the repo is found wakes the poller once it starts", async () => {
  let found = false;
  const engine = setup({ repo: () => (found ? Promise.resolve("a/b") : Promise.reject(new Error("offline"))) });
  await engine.start();
  assert.ok("next" in (await engine.band()), "no repo, no band");
  found = true;
  engine.bash("git push origin main");
  await settle();
  await settle();
  assert.equal((await engine.band()).Band.waitingFor, "0m00s", "waiting for the pushed run");
});

test("ui.render: a survey above the prompt passes through", async () => {
  const engine = setup({ runs: [running()] });
  await engine.start();
  const event = await engine.band({ hasSurvey: true });
  assert.equal(event.Band, undefined);
  assert.equal(event.next.props.hasSurvey, true);
});

test("/gh-ci: a pane a reload left listed is closed before it is opened", async () => {
  const engine = setup();
  await engine.start();
  engine.listPane(true);
  assert.deepEqual(await engine.command(), {});
  assert.deepEqual(engine.ops, ["close", "open"]);
});

test("/gh-ci: closes the pane it drew; after ui.close the next toggle opens it again", async () => {
  const engine = setup();
  await engine.start();
  await engine.command();
  await engine.pane(); // drawn here
  assert.deepEqual(await engine.command(), { text: "Closed the CI pane." });
  engine.ops.length = 0;
  await engine.command();
  await engine.pane();
  engine.closed(); // the person closed it, but the engine still lists it shown
  engine.listPane(true);
  engine.ops.length = 0;
  assert.deepEqual(await engine.command(), {});
  assert.deepEqual(engine.ops, ["close", "open"], "not drawn here any more: opened again, not closed");
});

test("/gh-ci refresh: polls now and says so", async () => {
  const engine = setup();
  await engine.start();
  assert.deepEqual(await engine.command("refresh"), { text: "Refreshing CI runs." });
  await settle();
  assert.equal(engine.runListCalls(), 2);
  assert.ok("next" in (await engine.band()), "no runs and no waiting line, as a push would show: no band");
});

test("/gh-ci status: the repo and the band's counts, or that there are none", async () => {
  const busy = setup({ runs: [running(), run({ databaseId: 2, conclusion: "failure" })] });
  await busy.start();
  assert.deepEqual(await busy.command(" status "), { text: "a/b · 1 running · 1 finished · 1 failed" });
  const quiet = setup();
  await quiet.start();
  assert.deepEqual(await quiet.command("status"), { text: "a/b · no runs on the band" });
});

test("/gh-ci with an unknown argument answers with the usage line, even before a repo is found", async () => {
  const engine = setup({ repo: () => Promise.reject(new Error("offline")) });
  await engine.start();
  assert.deepEqual(await engine.command("nope"), { text: "Usage: /gh-ci [refresh|status]" });
});

test("/gh-ci with no repo found: looks again, and says why the last find failed", async () => {
  const engine = setup({ repo: () => Promise.reject(new Error("gh auth login required")) });
  await engine.start();
  const before = engine.calls.length;
  assert.deepEqual(await engine.command("status"), {
    text: "No GitHub repo found yet (gh repo view); looking again now. Run /gh-ci again in a moment. Last error: gh auth login required",
  });
  assert.equal(engine.calls.length, before + 1, "one more gh repo view");
});

test("/gh-ci status: a gh outage shows before the counts", async () => {
  const gh = { runs: [running()], runsFail: false };
  const engine = setup(gh);
  await engine.start();
  gh.runsFail = true;
  await engine.command("refresh");
  await settle();
  const { text } = await engine.command("status");
  assert.match(text, /^a\/b · gh error for \d+m\d\ds · 1 running$/);
});

test("/gh-ci: a pane the engine could not place says why", async () => {
  const engine = setup({ placed: false });
  await engine.start();
  assert.deepEqual(await engine.command(), { text: "The CI pane did not open: no room" });
});

test("the band's details button opens the pane; the pane's close button closes it", async () => {
  const engine = setup({ runs: [running()] });
  await engine.start();
  (await engine.band()).callback();
  await settle();
  assert.deepEqual(engine.ops, ["open"]);
  (await engine.pane()).callback();
  await settle();
  assert.equal(engine.ops.at(-1), "close");
});
