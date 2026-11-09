import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RepoConfig } from './types.js';

export async function loadRepoRegistry(file: string): Promise<Record<string, RepoConfig>> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const registry: Record<string, RepoConfig> = {};
  for (const [alias, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid registry entry: ${alias}`);
    const entry = value as Record<string, unknown>;
    const repoPath = entry.path;
    const remote = entry.remote;
    if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) throw new Error(`Registry path must be absolute: ${alias}`);
    if (typeof remote !== 'string' || remote.trim() === '') throw new Error(`Registry remote is required: ${alias}`);
    await access(repoPath);
    registry[alias] = { path: repoPath, remote, networkAccess: entry.networkAccess === true };
  }
  return registry;
}

export function resolveRepo(registry: Record<string, RepoConfig>, alias: string): RepoConfig {
  const repo = registry[alias];
  if (!repo) throw new Error(`REPO_NOT_REGISTERED: ${alias}`);
  return repo;
}
