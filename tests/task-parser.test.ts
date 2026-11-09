import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskBody } from '../src/task-parser.js';

test('parses the fixed GitHub task format', () => {
  const task = parseTaskBody('task_id: demo-001\ntarget_repo: demo\nbase_branch: main\ngoal: |\n  Fix the bug and run tests.\nacceptance:\n  - tests pass\nconstraints:\n  - no secrets\ndecision_required:\n  - paid resources\n');
  assert.deepEqual(task, {
    taskId: 'demo-001',
    targetRepo: 'demo',
    baseBranch: 'main',
    goal: 'Fix the bug and run tests.',
    acceptance: ['tests pass'],
    constraints: ['no secrets'],
    decisionRequired: ['paid resources'],
  });
});

test('accepts fenced YAML and rejects missing registry target fields', () => {
  assert.equal(parseTaskBody('```yaml\ntask_id: x\ntarget_repo: demo\ngoal: test\n```').taskId, 'x');
  assert.throws(() => parseTaskBody('task_id: x\ngoal: test\n'), /target_repo/);
});
