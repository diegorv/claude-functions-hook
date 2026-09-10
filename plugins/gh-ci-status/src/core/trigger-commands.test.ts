import { test } from "node:test";
import assert from "node:assert/strict";
import { triggersWorkflow } from "./trigger-commands.ts";

test("push, merge and workflow run trigger a workflow", () => {
  const commands = [
    "git push",
    "git push -u origin main",
    "git -C /x push --force-with-lease",
    "cd app && git push",
    "gh pr merge 12 --squash",
    "gh workflow run ci.yml",
  ];
  for (const command of commands) assert.equal(triggersWorkflow(command), true, command);
});

test("other commands and dry runs do not", () => {
  const commands = ["git pull", "git status", "npm run pushdb", "git push --dry-run", "gh pr view"];
  for (const command of commands) assert.equal(triggersWorkflow(command), false, command);
});
