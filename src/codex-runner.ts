import { Codex, type Thread, type ThreadEvent, type ThreadItem } from '@openai/codex-sdk';
import type { RepoConfig, RunResult, TaskSpec } from './types.js';
import { buildPrompt } from './prompt.js';
import { RunStore } from './run-store.js';

export async function runCodexTask(options: {
  task: TaskSpec;
  repoAlias: string;
  repo: RepoConfig;
  store: RunStore;
  resumeThreadId?: string;
  model?: string;
}): Promise<RunResult> {
  const codex = new Codex();
  const threadOptions = {
    model: options.model,
    threadSource: 'gpt-local-codex-worker',
    sandboxMode: 'workspace-write' as const,
    workingDirectory: options.repo.path,
    networkAccessEnabled: options.repo.networkAccess === true,
    approvalPolicy: 'never' as const,
    webSearchMode: 'disabled' as const,
  };
  const thread = options.resumeThreadId ? codex.resumeThread(options.resumeThreadId, threadOptions) : codex.startThread(threadOptions);
  const streamed = await thread.runStreamed(buildPrompt(options.task, options.repoAlias));
  let finalResponse = '';
  let threadId = options.resumeThreadId ?? '';
  let failed = '';

  for await (const event of streamed.events) {
    if (event.type === 'thread.started') threadId = event.thread_id;
    await options.store.event(options.task.taskId, summarizeEvent(event));
    if (event.type === 'item.completed' || event.type === 'item.updated') {
      if (event.item.type === 'agent_message') finalResponse = event.item.text;
      logItem(event.item);
    }
    if (event.type === 'turn.failed' || event.type === 'error') failed = event.type === 'error' ? event.message : event.error.message;
  }

  if (!threadId) threadId = thread.id ?? '';
  if (!threadId) throw new Error('Codex did not return a thread id');
  if (failed) return { status: 'FAILED', threadId, finalResponse: `${finalResponse}\n${failed}`.trim() };
  const status = classify(finalResponse);
  return { status, threadId, finalResponse };
}

function classify(response: string): RunResult['status'] {
  const status = response.match(/STATUS:\s*(DONE|BLOCKED|FAILED)\b/i)?.[1]?.toUpperCase();
  if (status === 'BLOCKED' || status === 'FAILED') return status;
  return 'DONE';
}

function logItem(item: ThreadItem): void {
  if (item.type === 'command_execution') console.log(`[codex] command ${item.status}: ${item.command}`);
  if (item.type === 'file_change') console.log(`[codex] file change ${item.status}: ${item.changes.map((change) => change.path).join(', ')}`);
  if (item.type === 'mcp_tool_call') console.log(`[codex] MCP ${item.status}: ${item.server}/${item.tool}`);
}

function summarizeEvent(event: ThreadEvent): Record<string, unknown> {
  if (event.type === 'thread.started') return { type: event.type, threadId: event.thread_id };
  if (event.type === 'turn.started') return { type: event.type };
  if (event.type === 'turn.completed') return { type: event.type, usage: event.usage };
  if (event.type === 'turn.failed') return { type: event.type, error: event.error.message };
  if (event.type === 'error') return { type: event.type, message: event.message };
  const item = event.item;
  if (item.type === 'command_execution') return { type: event.type, item: { type: item.type, id: item.id, status: item.status, command: item.command, exitCode: item.exit_code, output: tail(item.aggregated_output) } };
  if (item.type === 'file_change') return { type: event.type, item: { type: item.type, id: item.id, status: item.status, changes: item.changes } };
  if (item.type === 'agent_message') return { type: event.type, item: { type: item.type, id: item.id, text: tail(item.text, 8000) } };
  if (item.type === 'mcp_tool_call') return { type: event.type, item: { type: item.type, id: item.id, server: item.server, tool: item.tool, status: item.status, error: item.error?.message } };
  return { type: event.type, item: { type: item.type, id: item.id } };
}

function tail(value: string, limit = 4000): string {
  return value.length > limit ? `[truncated]\n${value.slice(-limit)}` : value;
}
