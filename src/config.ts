import os from 'node:os';
import path from 'node:path';

export type WorkerConfig = {
  githubToken: string;
  taskBusOwner: string;
  taskBusRepo: string;
  allowedAuthors: Set<string>;
  reposFile: string;
  workerHome: string;
  pollIntervalMs: number;
  model?: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function splitRepo(value: string): { owner: string; repo: string } {
  const match = /^([^/]+)\/([^/]+)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid CODEX_TASK_BUS_REPO: ${value}`);
  return { owner: match[1]!, repo: match[2]! };
}

export function loadConfig(): WorkerConfig {
  const taskBus = splitRepo(required('CODEX_TASK_BUS_REPO'));
  const workerHome = process.env.WORKER_HOME ?? path.join(os.homedir(), '.gpt-local-codex-worker');
  const authors = (process.env.ALLOWED_TASK_AUTHORS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (authors.length === 0) throw new Error('ALLOWED_TASK_AUTHORS must contain at least one GitHub login');
  return {
    githubToken: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? required('GITHUB_TOKEN'),
    taskBusOwner: taskBus.owner,
    taskBusRepo: taskBus.repo,
    allowedAuthors: new Set(authors),
    reposFile: process.env.REPOS_FILE ?? path.join(workerHome, 'repos.json'),
    workerHome,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 10_000),
    model: process.env.CODEX_MODEL || undefined,
  };
}
