import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoConfig } from './types.js';

const execFileAsync = promisify(execFile);

export async function git(repoPath: string, args: string[], options: { allowFailure?: boolean } = {}): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd: repoPath, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    if (options.allowFailure) {
      const failure = error as { stdout?: string; stderr?: string };
      return `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
    }
    const failure = error as { stderr?: string; message?: string };
    throw new Error(`git ${args.join(' ')} failed: ${failure.stderr?.trim() || failure.message || String(error)}`);
  }
}

export async function assertRepoReady(repo: RepoConfig, branch: string): Promise<void> {
  const status = await git(repo.path, ['status', '--porcelain']);
  if (status) throw new Error('DIRTY_WORKTREE: repository has uncommitted changes');
  const current = await git(repo.path, ['branch', '--show-current']);
  if (current !== branch) throw new Error(`BRANCH_MISMATCH: expected ${branch}, found ${current || '(detached)'}`);
  const remote = await git(repo.path, ['remote', 'get-url', 'origin']);
  if (!sameRemote(remote, repo.remote)) throw new Error(`REMOTE_MISMATCH: expected ${repo.remote}, found ${remote}`);
}

export async function commitAndPush(repo: RepoConfig, branch: string, message: string): Promise<string> {
  const before = await git(repo.path, ['rev-parse', 'HEAD']);
  if (!(await git(repo.path, ['status', '--porcelain']))) return before;
  await git(repo.path, ['add', '--all', '--', '.']);
  const files = await git(repo.path, ['diff', '--cached', '--name-only']);
  assertSafeStagedFiles(files.split('\n').filter(Boolean));
  const stagedDiff = await git(repo.path, ['diff', '--cached', '--', '.']);
  assertNoSecretAssignments(stagedDiff);
  if (!(await git(repo.path, ['diff', '--cached', '--name-only']))) return before;
  await git(repo.path, ['commit', '-m', message]);
  await git(repo.path, ['push', 'origin', branch]);
  return git(repo.path, ['rev-parse', 'HEAD']);
}

function sameRemote(actual: string, expected: string): boolean {
  const normalize = (value: string) => value.trim().replace(/^git@github\.com:/, '').replace(/^ssh:\/\/git@github\.com\//, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
  return normalize(actual) === normalize(expected);
}

function assertSafeStagedFiles(files: string[]): void {
  const unsafe = files.filter((file) => /(^|\/)(\.env($|\.)|id_rsa|.*\.(pem|key|p12|pfx))$/i.test(file) && !file.endsWith('.env.example'));
  if (unsafe.length) throw new Error(`SECRET_FILE_BLOCKED: ${unsafe.join(', ')}`);
}

function assertNoSecretAssignments(diff: string): void {
  const lines = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  const suspicious = lines.some((line) => /(?:OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|API_KEY|ACCESS_TOKEN|DEVICE_TOKEN|MCP_API_TOKEN|SECRET|PASSWORD)\s*[:=]\s*[^\s<>{}`'"\n]+/i.test(line) && !/replace-with|your-|example|changeme/i.test(line));
  if (suspicious) throw new Error('SECRET_CONTENT_BLOCKED: staged diff contains a likely secret assignment');
}
