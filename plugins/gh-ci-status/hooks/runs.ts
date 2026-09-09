// Domínio: o que um run do GitHub Actions é, em que fase está, quais ficam na
// faixa e o que mudou entre um poll e o próximo. Importa nada.

export type Run = {
  databaseId: number;
  status: string; // queued | in_progress | waiting | pending | requested | completed
  conclusion: string | null; // success | failure | cancelled | skipped | timed_out | ...
  name: string; // nome do run: o `run-name` do workflow, quando ele define um
  workflowName: string;
  headBranch: string;
  displayTitle: string;
  createdAt: string;
  updatedAt: string;
  url: string; // página do run no GitHub
};

export type Phase = { dot: string; label: string; color?: string; dim?: boolean };

export const inFlight = (r: Run): boolean => r.status !== "completed";

// O número do PR, quando o run foi disparado por um: o GitHub usa
// `refs/pull/N/head` como branch nesses casos. Null quando não dá para saber.
export function prNumber(r: Run): number | null {
  const m = /^refs\/pull\/(\d+)\//.exec(r.headBranch);
  return m ? Number(m[1]) : null;
}

export function phase(r: Run): Phase {
  if (r.status === "in_progress") return { dot: "◐", label: "Running", color: "yellow" };
  if (inFlight(r)) return { dot: "○", label: "Queued", color: "yellow" };
  switch (r.conclusion) {
    case "success":
      return { dot: "●", label: "Success", color: "green" };
    case "failure":
      return { dot: "✗", label: "Failed", color: "red" };
    case "timed_out":
    case "startup_failure":
      return { dot: "✗", label: r.conclusion, color: "red" };
    case "cancelled":
      return { dot: "⊘", label: "Cancelled", color: "red" };
    default:
      return { dot: "·", label: r.conclusion ?? "Done", dim: true };
  }
}

// Fica na faixa: tudo em andamento, e o que terminou há menos de holdMs.
export function visible(list: Run[], now: number, holdMs: number): Run[] {
  return list.filter((r) => inFlight(r) || now - Date.parse(r.updatedAt) < holdMs);
}

export type Transitions = {
  seen: ReadonlySet<number>; // ids em andamento depois deste poll
  started: Run[]; // entraram em andamento agora
  finished: Run[]; // estavam em andamento e saíram
};

// Compara o que estava em andamento com a lista nova. Puro: devolve o novo
// conjunto em vez de mexer no antigo.
export function transitions(seen: ReadonlySet<number>, list: Run[]): Transitions {
  const next = new Set<number>();
  const started: Run[] = [];
  const finished: Run[] = [];
  for (const r of list) {
    if (inFlight(r)) {
      next.add(r.databaseId);
      if (!seen.has(r.databaseId)) started.push(r);
    } else if (seen.has(r.databaseId)) {
      finished.push(r);
    }
  }
  return { seen: next, started, finished };
}
