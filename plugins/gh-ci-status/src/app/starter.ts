// Starting the watch: find the repo, then start on it. A find that fails is
// not retried on a timer; the next call tries again, so a session started
// before `gh auth login` or offline recovers at the next push.
export type Starter = () => void;

// A call while a find is running, or once the start went through, does nothing.
export function createStarter(
  find: () => Promise<string>,
  start: (repo: string) => Promise<void>,
  log: (text: string) => void,
): Starter {
  let state: "idle" | "finding" | "started" = "idle";
  return () => {
    if (state !== "idle") return;
    state = "finding";
    void find()
      .then(start)
      .then(
        () => (state = "started"),
        (error: unknown) => {
          state = "idle";
          log(`${error instanceof Error ? error.message : String(error)}; staying quiet until the next push or merge`);
        },
      );
  };
}
