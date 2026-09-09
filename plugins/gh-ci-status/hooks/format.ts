// Formatação de texto da faixa. Importa só o tipo Run.
import { inFlight, prNumber, type Run } from "./runs.ts";

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// Primeira linha, cortada com reticências.
export function cut(text: string, max: number): string {
  const one = text.split("\n")[0].trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// Coluna de tempo: há quanto tempo roda, ou quanto levou e há quanto terminou.
export function clock(r: Run, now: number): string {
  const started = Date.parse(r.createdAt);
  const ended = Date.parse(r.updatedAt);
  if (inFlight(r)) return elapsed(now - started);
  return `took ${elapsed(ended - started)} · ${elapsed(now - ended)} ago`;
}

// `refs/pull/167/head` vira `#167`; qualquer outra branch fica como está.
export function branchLabel(r: Run): string {
  const n = prNumber(r);
  return n === null ? r.headBranch : `#${n}`;
}

// Para onde o título da linha leva: o PR quando se conhece, senão o run.
export function linkOf(repo: string, r: Run): string {
  const n = prNumber(r);
  return n === null ? r.url : `https://github.com/${repo}/pull/${n}`;
}

export function header(repo: string, rows: Run[]): string {
  const running = rows.filter(inFlight).length;
  const done = rows.length - running;
  return [`⚙ https://github.com/${repo}/actions`, running ? `${running} running` : "", done ? `${done} finished` : ""]
    .filter(Boolean)
    .join(" · ");
}
