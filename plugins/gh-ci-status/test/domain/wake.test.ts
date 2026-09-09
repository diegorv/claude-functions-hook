import { test } from "node:test";
import assert from "node:assert/strict";
import { isWakeCommand } from "../../src/domain/wake.ts";

test("acorda em push, merge e workflow run", () => {
  for (const c of [
    "git push",
    "git push -u origin main",
    "git -C /x push --force-with-lease",
    "cd app && git push",
    "gh pr merge 12 --squash",
    "gh workflow run ci.yml",
  ]) {
    assert.equal(isWakeCommand(c), true, c);
  }
});

test("não acorda em outros comandos nem em dry run", () => {
  for (const c of ["git pull", "git status", "npm run pushdb", "git push --dry-run", "gh pr view"]) {
    assert.equal(isWakeCommand(c), false, c);
  }
});
