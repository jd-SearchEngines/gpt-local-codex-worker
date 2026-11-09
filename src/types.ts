export type TaskStatus = 'RUNNING' | 'DONE' | 'BLOCKED' | 'FAILED';

export type TaskSpec = {
  taskId: string;
  targetRepo: string;
  baseBranch: string;
  goal: string;
  acceptance: string[];
  constraints: string[];
  decisionRequired: string[];
};

export type RepoConfig = {
  path: string;
  remote: string;
  networkAccess?: boolean;
};

export type RunState = {
  currentTask: string;
  issueNumber: number;
  repo: string;
  task: TaskSpec;
  threadId?: string;
  status: TaskStatus;
  startedAt: string;
  updatedAt: string;
};

export type RunResult = {
  status: 'DONE' | 'BLOCKED' | 'FAILED';
  threadId: string;
  finalResponse: string;
};
