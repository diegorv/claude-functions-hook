// Formatação de texto da faixa. Só funções puras sobre Run.
import { inFlight, prNumber, type Run } from "./runs.ts";

// Largura fixa até 1h (`0m10s`, `3m09s`), para as colunas alinharem.
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h${two(m % 60)}m`;
  return `${m}m${two(s % 60)}s`;
}

// Primeira linha, cortada com reticências.
export function cut(text: string, max: number): string {
  const one = text.split("\n")[0].trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// Coluna de tempo: há quanto tempo roda, ou quanto levou.
export function clock(r: Run, now: number): string {
  const started = Date.parse(r.createdAt);
  return elapsed((inFlight(r) ? now : Date.parse(r.updatedAt)) - started);
}

// `#167` quando o run tem PR; senão o nome da branch.
export function branchLabel(r: Run): string {
  const n = prNumber(r);
  return n === null ? r.headBranch : `#${n}`;
}

// O título da linha, ou vazio quando ele só repete o #N da primeira coluna
// (um `run-name: PR #N` no workflow faz isso).
export function titleOf(r: Run): string {
  const n = prNumber(r);
  const bare = r.displayTitle.trim().replace(/^PR\s*/i, "");
  return n !== null && bare === `#${n}` ? "" : r.displayTitle;
}

// Para onde a linha leva: o PR quando se conhece, senão o run.
export function linkOf(repo: string, r: Run): string {
  const n = prNumber(r);
  return n === null ? r.url : `https://github.com/${repo}/pull/${n}`;
}

// "1 running · 2 finished", só o que não é zero; vazio sem nada.
export function counts(rows: Run[]): string {
  const running = rows.filter(inFlight).length;
  const done = rows.length - running;
  return [running ? `${running} running` : "", done ? `${done} finished` : ""].filter(Boolean).join(" · ");
}
