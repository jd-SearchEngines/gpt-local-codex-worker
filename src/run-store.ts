import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunState } from './types.js';

export class RunStore {
  readonly statePath: string;
  readonly runsPath: string;

  constructor(private readonly home: string) {
    this.statePath = path.join(home, 'state.json');
    this.runsPath = path.join(home, 'runs');
  }

  async initialize(): Promise<void> {
    await mkdir(this.runsPath, { recursive: true });
  }

  async readState(): Promise<RunState | undefined> {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf8')) as RunState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async writeState(state: RunState): Promise<void> {
    await mkdir(this.home, { recursive: true });
    const temp = `${this.statePath}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.statePath);
  }

  async event(taskId: string, event: Record<string, unknown>): Promise<void> {
    const directory = path.join(this.runsPath, taskId);
    await mkdir(directory, { recursive: true });
    await appendFile(path.join(directory, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  }

  async task(taskId: string, value: unknown): Promise<void> {
    const directory = path.join(this.runsPath, taskId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'task.json'), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }

  async final(taskId: string, value: unknown): Promise<void> {
    const directory = path.join(this.runsPath, taskId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'final.json'), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
}
