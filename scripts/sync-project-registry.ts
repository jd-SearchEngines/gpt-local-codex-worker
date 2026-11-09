import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type Project = {
  alias: string;
  remote: string;
  pathHints?: string[];
};

type Manifest = {
  version: number;
  projects: Project[];
};

type RepoEntry = {
  path: string;
  remote: string;
  networkAccess: boolean;
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = path.join(root, 'project-registry.manifest.json');
const workerHome = process.env.WORKER_HOME ?? path.join(os.homedir(), '.gpt-local-codex-worker');
const reposFile = process.env.REPOS_FILE ?? path.join(workerHome, 'repos.json');
const cloneMissing = process.argv.includes('--clone-missing');
const searchRoots = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Projects'),
];

function canonicalRemote(value: string): string {
  return value
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/^https:\/\/github\.com\//, '');
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function originRemote(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'remote', 'get-url', 'origin']);
    return canonicalRemote(stdout);
  } catch {
    return null;
  }
}

async function findByRemote(expected: string, project: Project): Promise<string | null> {
  for (const hint of project.pathHints ?? []) {
    if (!(await exists(hint))) continue;
    const remote = await originRemote(hint);
    if (remote === expected) return hint;
  }

  const queue = searchRoots.map((dir) => ({ dir, depth: 0 }));
  const visited = new Set<string>();
  while (queue.length) {
    const next = queue.shift()!;
    if (next.depth > 3 || visited.has(next.dir) || !(await exists(next.dir))) continue;
    visited.add(next.dir);

    const remote = await originRemote(next.dir);
    if (remote === expected) return next.dir;

    let entries;
    try {
      entries = await readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['node_modules', '.git', '.cache', 'Library'].includes(entry.name)) continue;
      queue.push({ dir: path.join(next.dir, entry.name), depth: next.depth + 1 });
    }
  }
  return null;
}

async function loadExisting(): Promise<Record<string, RepoEntry>> {
  try {
    return JSON.parse(await readFile(reposFile, 'utf8')) as Record<string, RepoEntry>;
  } catch {
    return {};
  }
}

async function cloneProject(project: Project): Promise<string> {
  const targetRoot = path.join(os.homedir(), 'Projects');
  await mkdir(targetRoot, { recursive: true });
  const target = path.join(targetRoot, project.alias);
  if (await exists(target)) {
    const remote = await originRemote(target);
    if (remote === canonicalRemote(project.remote)) return target;
    throw new Error(`Clone target exists with unexpected remote: ${target}`);
  }
  await execFileAsync('git', ['clone', `https://github.com/${project.remote}.git`, target], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return target;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const registry = await loadExisting();
  const results: Array<Record<string, unknown>> = [];

  for (const project of manifest.projects) {
    const expected = canonicalRemote(project.remote);
    let repoPath = await findByRemote(expected, project);
    let source = 'existing';

    if (!repoPath && cloneMissing) {
      repoPath = await cloneProject(project);
      source = 'cloned';
    }

    if (!repoPath) {
      results.push({ alias: project.alias, status: 'MISSING', remote: project.remote });
      continue;
    }

    registry[project.alias] = {
      path: repoPath,
      remote: project.remote,
      networkAccess: true,
    };
    results.push({ alias: project.alias, status: 'REGISTERED', path: repoPath, source });
  }

  await mkdir(workerHome, { recursive: true });
  await writeFile(reposFile, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });

  console.log(JSON.stringify({
    reposFile,
    cloneMissing,
    results,
  }, null, 2));

  const missing = results.filter((result) => result.status === 'MISSING');
  if (missing.length) {
    console.error(`Registry sync incomplete: ${missing.length} project(s) missing. Re-run with --clone-missing to clone them into ~/Projects.`);
    process.exitCode = 2;
  }
}

await main();
