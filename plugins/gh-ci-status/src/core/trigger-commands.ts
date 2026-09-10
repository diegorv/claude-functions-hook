// Shell lines that probably trigger a workflow, so the poller looks right
// after they finish. `git push` carries its own flags, so the alternation
// walks past them. A dry run does not count.
const TRIGGERS = /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$))/;
const DRY_RUN = /--dry-run/;

export const triggersWorkflow = (command: string): boolean => TRIGGERS.test(command) && !DRY_RUN.test(command);
