// Shell lines that probably trigger a workflow. `git push` carries its own
// flags, so the alternation walks past them. A dry run does not count.
const WAKES = /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$))/;
const DRY_RUN = /--dry-run/;

export const isWakeCommand = (command: string): boolean => WAKES.test(command) && !DRY_RUN.test(command);
