import { setTimeout as delay } from 'node:timers/promises';
import type { WorkerConfig } from './config.js';
import { TaskBusClient, type GitHubIssue, type StatusLabel } from './github.js';
import { assertRepoReady, commitAndPush } from './git.js';
import { runCodexTask } from './codex-runner.js';
import { loadRepoRegistry, resolveRepo } from './repo-registry.js';
import { RunStore } from './run-store.js';
import { parseTaskBody } from './task-parser.js';
import type { RunState, TaskSpec } from './types.js';

export class Worker {
  readonly store: RunStore;

  constructor(readonly config: WorkerConfig) {
    this.store = new RunStore(config.workerHome);
  }

  async once(): Promise<boolean> {
    await this.store.initialize();
    const bus = new TaskBusClient(this.config.taskBusOwner, this.config.taskBusRepo, this.config.githubToken);
    await bus.ensureLabels();
    const state = await this.store.readState();
    if (state?.status === 'RUNNING') {
      console.log(`Recovering task ${state.currentTask} from thread ${state.threadId ?? '(unknown)'}`);
      const issue = await bus.getIssue(state.issueNumber);
      const terminalLabel = issue.labels.map((label) => label.name).find((label): label is StatusLabel => label === 'codex-done' || label === 'codex-blocked' || label === 'codex-failed');
      if (terminalLabel) {
        state.status = terminalLabel.replace('codex-', '').toUpperCase() as RunState['status'];
        state.updatedAt = new Date().toISOString();
        await this.store.writeState(state);
        console.log(`Recovered terminal status ${terminalLabel} for ${state.currentTask}`);
        return true;
      }
      await this.execute(bus, issue, state.task, state.repo, true, state.threadId);
      return true;
    }
    const issues = await bus.listReady();
    for (const issue of issues) {
      if (!issue.user || !this.config.allowedAuthors.has(issue.user.login)) {
        console.log(`Skipping issue #${issue.number}: author is not allowed`);
        continue;
      }
      let task: TaskSpec;
      try {
        task = parseTaskBody(issue.body ?? '');
      } catch (error) {
        await bus.setStatus(issue.number, 'codex-blocked');
        await bus.comment(issue.number, decisionComment('INVALID_TASK_FORMAT', error instanceof Error ? error.message : String(error)));
        continue;
      }
      try {
        const registry = await loadRepoRegistry(this.config.reposFile);
        resolveRepo(registry, task.targetRepo);
      } catch (error) {
        await bus.setStatus(issue.number, 'codex-blocked');
        await bus.comment(issue.number, decisionComment('REPO_NOT_REGISTERED', error instanceof Error ? error.message : String(error)));
        continue;
      }
      await bus.setStatus(issue.number, 'codex-running');
      await bus.comment(issue.number, `## Codex Worker\n\nStatus: RUNNING\n\nTask claimed by the local worker for repository alias \`${task.targetRepo}\`.`);
      await this.execute(bus, issue, task, task.targetRepo, false);
      return true;
    }
    return false;
  }

  async run(): Promise<void> {
    console.log(`Worker polling ${this.config.taskBusOwner}/${this.config.taskBusRepo} every ${this.config.pollIntervalMs}ms`);
    while (true) {
      try {
        await this.once();
      } catch (error) {
        console.error(`[worker] ${error instanceof Error ? error.message : String(error)}`);
      }
      await delay(this.config.pollIntervalMs);
    }
  }

  private async execute(bus: TaskBusClient, issue: GitHubIssue, task: TaskSpec, repoAlias: string, recovery: boolean, resumeThreadId?: string): Promise<void> {
    const registry = await loadRepoRegistry(this.config.reposFile);
    const repo = resolveRepo(registry, repoAlias);
    const startedAt = new Date().toISOString();
    const state: RunState = {
      currentTask: task.taskId,
      issueNumber: issue.number,
      repo: repoAlias,
      task,
      threadId: resumeThreadId,
      status: 'RUNNING',
      startedAt,
      updatedAt: startedAt,
    };
    await this.store.writeState(state);
    await this.store.task(task.taskId, { issueNumber: issue.number, title: issue.title, task, repo: repoAlias, recovery });
    try {
      await assertRepoReady(repo, task.baseBranch);
      const result = await runCodexTask({ task, repoAlias, repo, store: this.store, resumeThreadId, model: this.config.model });
      state.threadId = result.threadId;
      state.updatedAt = new Date().toISOString();
      await this.store.writeState(state);
      await this.store.final(task.taskId, result);
      if (result.status === 'BLOCKED') {
        await this.finish(bus, issue.number, state, 'codex-blocked', decisionComment('CODEX_BLOCKED', result.finalResponse));
        return;
      }
      if (result.status === 'FAILED') {
        await this.finish(bus, issue.number, state, 'codex-failed', failureComment(result.finalResponse));
        return;
      }
      const commit = await commitAndPush(repo, task.baseBranch, commitMessage(task));
      await this.finish(bus, issue.number, state, 'codex-done', doneComment(commit, result.finalResponse));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = /DIRTY_WORKTREE|BRANCH_MISMATCH|REMOTE_MISMATCH|REPO_NOT_REGISTERED|SECRET_(FILE|CONTENT)_BLOCKED/.test(message);
      await this.finish(bus, issue.number, state, blocked ? 'codex-blocked' : 'codex-failed', blocked ? decisionComment(message.split(':', 1)[0] ?? 'BLOCKED', message) : failureComment(message));
    }
  }

  private async finish(bus: TaskBusClient, issueNumber: number, state: RunState, label: StatusLabel, comment: string): Promise<void> {
    state.status = label.replace('codex-', '').toUpperCase() as RunState['status'];
    state.updatedAt = new Date().toISOString();
    await this.store.writeState(state);
    await bus.setStatus(issueNumber, label);
    await bus.comment(issueNumber, comment);
  }
}

function commitMessage(task: TaskSpec): string {
  const summary = task.goal.replace(/\s+/g, ' ').trim().slice(0, 72);
  return `codex: ${task.taskId} ${summary}`;
}

function decisionComment(problem: string, detail: string): string {
  return `## Decision Required\n\nStatus: BLOCKED\n\nProblem: ${problem}\n\nWhat I verified:\n\n${safe(detail)}\n\nNeed user decision or local cleanup before this task can continue.`;
}

function failureComment(detail: string): string {
  return `## Codex Result\n\nStatus: FAILED\n\n${safe(detail)}`;
}

function doneComment(commit: string, detail: string): string {
  return `## Codex Result\n\nStatus: DONE\n\nCommit:\n\`${commit}\`\n\nSummary:\n\n${safe(detail)}`;
}

function safe(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/g, '[REDACTED_TOKEN]')
    .replace(/((?:API_KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\/(?:Users|private\/var|tmp)\/[^\s)`]+/g, '[REDACTED_LOCAL_PATH]');
}
