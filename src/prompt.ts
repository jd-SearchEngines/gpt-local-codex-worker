import type { TaskSpec } from './types.js';

export function buildPrompt(task: TaskSpec, repo: string): string {
  const list = (values: string[]) => values.length ? values.map((value) => `- ${value}`).join('\n') : '- None';
  return `You are executing an engineering task from the GPT task bus.

Repository alias:
${repo}

Goal:
${task.goal}

Acceptance criteria:
${list(task.acceptance)}

Constraints:
${list(task.constraints)}

Decision-required situations:
${list(task.decisionRequired)}

Execution policy:
1. Inspect the repository before modifying anything.
2. Make the smallest reasonable changes.
3. Run relevant tests and report their exact results.
4. Fix ordinary engineering problems yourself.
5. Do not stop for normal implementation decisions.
6. Do not expose or commit secrets.
7. Do not modify files outside this repository.
8. If a decision-required situation is encountered, stop and report concrete options.
9. Do not commit or push; the worker performs the final safety check, commit, and push.
10. End your response with exactly one status line: STATUS: DONE, STATUS: BLOCKED, or STATUS: FAILED.

When complete, provide a concise summary, files changed, tests, remaining risks, and recommended next step.`;
}
