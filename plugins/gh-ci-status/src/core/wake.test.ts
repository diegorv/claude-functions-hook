import { test } from "node:test";
import assert from "node:assert/strict";
import { isWakeCommand } from "./wake.ts";

test("wakes on push, merge and workflow run", () => {
  const commands = [
    "git push",
    "git push -u origin main",
    "git -C /x push --force-with-lease",
    "cd app && git push",
    "gh pr merge 12 --squash",
    "gh workflow run ci.yml",
  ];
  for (const command of commands) assert.equal(isWakeCommand(command), true, command);
});

test("does not wake on other commands or on a dry run", () => {
  const commands = ["git pull", "git status", "npm run pushdb", "git push --dry-run", "gh pr view"];
  for (const command of commands) assert.equal(isWakeCommand(command), false, command);
});
