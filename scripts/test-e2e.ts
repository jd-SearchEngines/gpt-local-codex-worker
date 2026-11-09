import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TaskBusClient } from '../src/github.js';
import { loadConfig } from '../src/config.js';

const execFileAsync = promisify(execFile);
const config = loadConfig();
const bus = new TaskBusClient(config.taskBusOwner, config.taskBusRepo, config.githubToken);
const taskId = `worker-e2e-${Date.now()}`;
const body = `task_id: ${taskId}\ntarget_repo: codex-worker-e2e\nbase_branch: main\ngoal: |\n  Inspect the repository and fix the intentional bug in src/add.js so add(2, 3) returns 5. Run the project test after the fix.\nacceptance:\n  - add(2, 3) returns 5\n  - pnpm test passes\n  - the change is committed and pushed\nconstraints:\n  - do not modify files outside this repository\n  - do not commit secrets\ndecision_required: []`;

await bus.ensureLabels();
const created = await bus.octokit.issues.create({ owner: config.taskBusOwner, repo: config.taskBusRepo, title: `[Codex Task] ${taskId}`, body, labels: ['codex-ready'] });
console.log(`Created task issue #${created.data.number}`);
try {
  const issue = await runWorkerUntilTerminal(created.data.number);
  const labels = issue.labels.map((label) => label.name ?? '').join(', ');
  if (!issue.labels.some((label) => label.name === 'codex-done')) throw new Error(`E2E failed; labels: ${labels}`);
  console.log(`Issue #${issue.number}: codex-done`);
  console.log(`E2E PASS: ${taskId}`);
} catch (error) {
  throw new Error(`E2E failed: ${error instanceof Error ? error.message : String(error)}`);
}

async function waitForTerminal(issueNumber: number): Promise<{ number: number; labels: Array<{ name?: string | null }> }> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const issue = await bus.getIssue(issueNumber);
    if (issue.labels.some((label) => ['codex-done', 'codex-blocked', 'codex-failed'].includes(label.name ?? ''))) return issue;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Timed out waiting for issue #${issueNumber}`);
}

async function runWorkerUntilTerminal(issueNumber: number): Promise<{ number: number; labels: Array<{ name?: string | null }> }> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const worker = await execFileAsync('pnpm', ['worker:once'], { cwd: process.cwd(), env: process.env, maxBuffer: 2 * 1024 * 1024 });
    process.stdout.write(worker.stdout);
    process.stderr.write(worker.stderr);
    const issue = await bus.getIssue(issueNumber);
    if (issue.labels.some((label) => ['codex-done', 'codex-blocked', 'codex-failed'].includes(label.name ?? ''))) return issue;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return waitForTerminal(issueNumber);
}
