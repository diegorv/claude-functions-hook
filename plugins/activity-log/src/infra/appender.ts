// Appends lines to files, in the order they were added: the plugin API writes
// whole files only, so each batch goes to `sh -c 'cat >> file'` on its stdin.
// Lines wait in memory until `flush`, or until the timer `add` arms fires.
export type ProcessResult = { exitCode: number; stdout: string; stderr: string };
type RunProcess = (argv: readonly string[], init?: { stdin?: string; timeoutMs?: number }) => Promise<ProcessResult>;

// Creates the file's folder on the way, as `$.fs.write` would. The file holds whatever the
// session saw, secrets included: the folder is made 700 and a new file 600 (umask).
export const APPEND = 'umask 077 && mkdir -p -m 700 "$(dirname "$1")" && cat >> "$1"';

export async function appendFile(runProcess: RunProcess, path: string, text: string): Promise<void> {
  const result = await runProcess(["sh", "-c", APPEND, "sh", path], { stdin: text, timeoutMs: 10_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `sh exited ${result.exitCode}`);
}

const DEAD_AFTER = 5;

export type Appender = {
  // `path` may still be resolving; lines for one path stay in order behind it.
  add: (path: Promise<string>, line: string) => void;
  // Writes everything added so far; resolves once it and every earlier flush are written.
  flush: () => Promise<void>;
};

export function createAppender(
  append: (path: string, text: string) => Promise<void>,
  // Arms a one-shot timer; may throw (no engine to ask yet), and the next `add` tries again.
  // A hook may refuse it and `fn` never runs: one armed for over DEAD_AFTER delays is dead.
  after: (ms: number, fn: () => void) => void,
  report: (error: unknown) => void,
  delayMs = 1000,
  now = Date.now,
): Appender {
  let pending: { path: Promise<string>; line: string }[] = [];
  let written: Promise<void> = Promise.resolve();
  let armedAt: number | null = null; // when the timer waiting now was armed

  // A batch's runs of one path go out as one append each, one after the other.
  const write = async (batch: typeof pending) => {
    for (let at = 0; at < batch.length;) {
      const path = batch[at]!.path;
      let text = "";
      for (; at < batch.length && batch[at]!.path === path; at++) text += batch[at]!.line;
      try {
        await append(await path, text);
      } catch (error) {
        report(error);
      }
    }
  };

  const flush = () => {
    const batch = pending;
    pending = [];
    if (batch.length > 0) written = written.then(() => write(batch));
    return written;
  };

  return {
    add(path, line) {
      pending.push({ path, line });
      if (armedAt !== null) {
        if (now() - armedAt <= DEAD_AFTER * delayMs) return;
        armedAt = null;
        void flush(); // the timer never fired: its lines go now, and a new one is armed
      }
      try {
        const at = now();
        after(delayMs, () => {
          if (armedAt === at) armedAt = null; // a late dead timer leaves the new one armed
          void flush();
        });
        armedAt = at;
      } catch {
        // retried by the next add
      }
    },
    flush,
  };
}
