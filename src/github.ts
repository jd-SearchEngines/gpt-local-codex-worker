import { Octokit } from '@octokit/rest';

export const STATUS_LABELS = ['codex-ready', 'codex-running', 'codex-done', 'codex-blocked', 'codex-failed'] as const;
export type StatusLabel = typeof STATUS_LABELS[number];

export type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  labels: Array<{ name?: string | null }>;
};

export class TaskBusClient {
  readonly octokit: Octokit;

  constructor(readonly owner: string, readonly repo: string, token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async checkConnection(): Promise<void> {
    await this.octokit.repos.get({ owner: this.owner, repo: this.repo });
  }

  async ensureLabels(): Promise<void> {
    const existing = await this.octokit.issues.listLabelsForRepo({ owner: this.owner, repo: this.repo, per_page: 100 });
    const names = new Set(existing.data.map((label) => label.name));
    for (const name of STATUS_LABELS) {
      if (names.has(name)) continue;
      await this.octokit.issues.createLabel({ owner: this.owner, repo: this.repo, name, color: colorFor(name), description: `GPT local worker status: ${name}` });
    }
  }

  async listReady(): Promise<GitHubIssue[]> {
    const response = await this.octokit.issues.listForRepo({ owner: this.owner, repo: this.repo, state: 'open', labels: 'codex-ready', sort: 'created', direction: 'asc', per_page: 100 });
    return response.data.filter((issue) => !('pull_request' in issue)).map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      user: issue.user ? { login: issue.user.login } : null,
      labels: issue.labels.map((label) => typeof label === 'string' ? { name: label } : { name: label.name }),
    }));
  }

  async setStatus(issueNumber: number, status: StatusLabel): Promise<void> {
    const issue = await this.octokit.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber });
    const preserved = issue.data.labels.map((label) => typeof label === 'string' ? label : label.name).filter((name): name is string => Boolean(name) && !STATUS_LABELS.includes(name as StatusLabel));
    await this.octokit.issues.setLabels({ owner: this.owner, repo: this.repo, issue_number: issueNumber, labels: [...preserved, status] });
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ owner: this.owner, repo: this.repo, issue_number: issueNumber, body });
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const response = await this.octokit.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber });
    const issue = response.data;
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      user: issue.user ? { login: issue.user.login } : null,
      labels: issue.labels.map((label) => typeof label === 'string' ? { name: label } : { name: label.name }),
    };
  }
}

function colorFor(name: string): string {
  return ({
    'codex-ready': '1d76db',
    'codex-running': 'fbca04',
    'codex-done': '0e8a16',
    'codex-blocked': 'b60205',
    'codex-failed': '5319e7',
  } as Record<string, string>)[name] ?? 'ededed';
}
