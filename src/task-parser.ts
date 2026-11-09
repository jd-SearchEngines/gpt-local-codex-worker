import { parse } from 'yaml';
import type { TaskSpec } from './types.js';

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value.flat(Infinity) : [value];
  return values.filter((item) => item !== null && item !== undefined && item !== '').map((item) => requiredString(item, name));
}

function yamlSource(body: string): string {
  const fenced = body.match(/```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i);
  return fenced?.[1] ?? body;
}

export function parseTaskBody(body: string): TaskSpec {
  const raw = parse(yamlSource(body)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Issue body must contain a YAML mapping');
  const taskId = requiredString(raw.task_id, 'task_id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) throw new Error('task_id contains unsupported characters');
  return {
    taskId,
    targetRepo: requiredString(raw.target_repo, 'target_repo'),
    baseBranch: requiredString(raw.base_branch ?? 'main', 'base_branch'),
    goal: requiredString(raw.goal, 'goal'),
    acceptance: stringList(raw.acceptance, 'acceptance'),
    constraints: stringList(raw.constraints, 'constraints'),
    decisionRequired: stringList(raw.decision_required, 'decision_required'),
  };
}
