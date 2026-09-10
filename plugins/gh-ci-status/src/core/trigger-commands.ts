// Shell lines that probably trigger a workflow, so the poller looks right
// after they finish: a push, a merge, a workflow run, a rerun. `git push`
// carries its own flags, so the alternation walks past them. A dry run counts
// only when it belongs to the push itself.
const TRIGGERS =
  /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+(subtree\s+)?push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$)|gh\s+run\s+rerun(\s|$))/;
const DRY_RUN = /push[^&|;]*--dry-run/;

export const triggersWorkflow = (command: string): boolean => TRIGGERS.test(command) && !DRY_RUN.test(command);
