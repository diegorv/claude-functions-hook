// Linhas de shell que provavelmente disparam um workflow. `git push` carrega
// flags próprias, então a alternância caminha por elas. Dry run não conta.
const WAKES = /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$))/;
const DRY_RUN = /--dry-run/;

export const isWakeCommand = (command: string): boolean => WAKES.test(command) && !DRY_RUN.test(command);
