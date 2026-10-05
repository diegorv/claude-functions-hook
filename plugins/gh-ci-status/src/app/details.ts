// The failed jobs of the runs the details pane lists: fetched on the first ask
// for a run, once per run and version (its id and updatedAt), so a rerun is
// fetched again and a redraw never is; onChange redraws when one lands.
import { jobFailures, type Job, type JobFailure, type Run } from "../core/workflow-run.ts";

export type Details =
  | { state: "loading" }
  | { state: "failed"; message: string } // kept until the pane opens again or the run changes
  | { state: "loaded"; failures: JobFailure[] };

export type DetailsCache = {
  of: (run: Run) => Details;
  retryFailed: () => void; // the pane opened: a fetch that failed is tried again on its next draw
  keepOnly: (runIds: ReadonlySet<number>) => void; // drops the runs the last poll no longer lists
};

export function createDetails(fetchJobs: (runId: number) => Promise<Job[]>, onChange: () => void): DetailsCache {
  const cache = new Map<string, { runId: number; details: Details }>();
  const drop = (keep: (entry: { runId: number; details: Details }) => boolean) => {
    for (const [key, entry] of cache) if (!keep(entry)) cache.delete(key);
  };
  return {
    of(run) {
      const key = `${run.databaseId}:${run.updatedAt}`;
      const known = cache.get(key);
      if (known) return known.details;
      const loading: Details = { state: "loading" };
      const settle = (details: Details) => cache.get(key) && cache.set(key, { runId: run.databaseId, details });
      cache.set(key, { runId: run.databaseId, details: loading });
      void fetchJobs(run.databaseId)
        .then(
          (jobs) => settle({ state: "loaded", failures: jobFailures(run, jobs) }),
          (error: unknown) =>
            settle({ state: "failed", message: error instanceof Error ? error.message : String(error) }),
        )
        .then(onChange);
      return loading;
    },
    retryFailed: () => drop((entry) => entry.details.state !== "failed"),
    keepOnly: (runIds) => drop((entry) => runIds.has(entry.runId)),
  };
}
