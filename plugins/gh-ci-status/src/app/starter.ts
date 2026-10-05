// Starting the watch: find the repo, then start on it. A find that fails is
// not retried on a timer; the next call tries again, so a session started
// before `gh auth login` or offline recovers at the next push.
// `lastError` is why the last try failed, kept through the next try; null
// before any failure and once the start went through.
export type Starter = (() => void) & { lastError: () => string | null };

// A call while a find is running, or once the start went through, does nothing.
export function createStarter(
  find: () => Promise<string>,
  start: (repo: string) => Promise<void>,
  log: (text: string) => void,
): Starter {
  let state: "idle" | "finding" | "started" = "idle";
  let lastError: string | null = null;
  const startWatch = () => {
    if (state !== "idle") return;
    state = "finding";
    void find()
      .then(start)
      .then(
        () => {
          state = "started";
          lastError = null;
        },
        (error: unknown) => {
          state = "idle";
          lastError = error instanceof Error ? error.message : String(error);
          log(`${lastError}; staying quiet until the next push or merge`);
        },
      );
  };
  return Object.assign(startWatch, { lastError: () => lastError });
}
