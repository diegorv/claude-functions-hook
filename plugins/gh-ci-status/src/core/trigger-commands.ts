// Shell lines that probably trigger a workflow, so the poller looks right
// after they finish: a push, a merge, a workflow run, a rerun. `git push`
// carries its own flags, so the alternation walks past them. Each segment of
// the line counts on its own, so a dry run only turns off the push it is in.
// Quoted text is dropped first, so a commit message that talks about a push
// does not count as one.
const TRIGGERS =
  /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+(subtree\s+)?push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$)|gh\s+run\s+rerun(\s|$))/;
const DRY_RUN = /push\b.*(--dry-run|\s-n\b)/;

export const triggersWorkflow = (command: string): boolean =>
  command
    .replace(/'[^']*'|"[^"]*"/g, "")
    .split(/&&|\||;/)
    .some((segment) => TRIGGERS.test(segment) && !DRY_RUN.test(segment));
