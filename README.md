# gpt-local-codex-worker

Local Mac worker for a trusted GitHub Issue task bus. It polls a private task-bus repository, validates the author and task target against local policy, runs the task in the configured local repository with the official `@openai/codex-sdk`, then reports the result back to GitHub.

This project intentionally does not expose a remote shell, MCP gateway, web server, or arbitrary local path access.

## Quick start

```bash
pnpm install
cp .env.example .env
# edit .env with a GitHub token and local paths
pnpm build
pnpm worker:status
pnpm worker:once
pnpm worker
```

The local Codex CLI must already be installed and authenticated. The SDK runs a local Codex thread with `workspace-write` sandboxing. A task can only select a symbolic repository key from the local registry; it cannot provide a filesystem path.

## Task format

Create an Issue in the configured task bus with the `codex-ready` label:

```yaml
task_id: title-rl-001
target_repo: title-generation
base_branch: main
goal: |
  Inspect and fix the requested engineering issue.
acceptance:
  - relevant tests pass
  - changes are committed and pushed
constraints:
  - do not commit secrets
decision_required:
  - paid resources
```

The worker accepts only issues whose author is listed in `ALLOWED_TASK_AUTHORS`, and only repository aliases in `repos.json`. The worker uses one task at a time and transitions labels through `codex-running`, `codex-done`, `codex-blocked`, and `codex-failed`.

## Local registry

Create `~/.gpt-local-codex-worker/repos.json`:

```json
{
  "title-generation": {
    "path": "/Users/me/Projects/title-generation",
    "remote": "jd-SearchEngines/title-generation",
    "networkAccess": true
  }
}
```

The registry is local policy and is never read from the Issue. `networkAccess` is also local policy.
