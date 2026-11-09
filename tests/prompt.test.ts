import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/prompt.js';

test('prompt contains task policy without accepting a local path from the issue', () => {
  const prompt = buildPrompt({
    taskId: 'demo',
    targetRepo: 'demo',
    baseBranch: 'main',
    goal: 'Fix it',
    acceptance: ['tests pass'],
    constraints: ['do not commit secrets'],
    decisionRequired: ['paid resource'],
  }, 'demo');
  assert.match(prompt, /Do not modify files outside this repository/);
  assert.match(prompt, /STATUS: BLOCKED/);
  assert.doesNotMatch(prompt, /\/Users\//);
});
