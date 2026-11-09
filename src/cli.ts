import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import { TaskBusClient } from './github.js';
import { RunStore } from './run-store.js';
import { Worker } from './worker.js';

const execFileAsync = promisify(execFile);
const command = process.argv[2] ?? 'worker';
const config = loadConfig();

if (command === 'worker' || command === 'once') {
  const worker = new Worker(config);
  if (command === 'once') {
    const processed = await worker.once();
    console.log(processed ? 'Worker: processed one task' : 'Worker: no ready task');
  } else {
    await worker.run();
  }
} else if (command === 'status') {
  const store = new RunStore(config.workerHome);
  const state = await store.readState();
  let github = 'DISCONNECTED';
  try {
    await new TaskBusClient(config.taskBusOwner, config.taskBusRepo, config.githubToken).checkConnection();
    github = 'CONNECTED';
  } catch {
    // Status remains useful when GitHub is temporarily unavailable.
  }
  let codex = 'UNAVAILABLE';
  try {
    await execFileAsync('codex', ['--version']);
    codex = 'AVAILABLE';
  } catch {
    // Keep the explicit unavailable state.
  }
  console.log(`Worker: ONLINE\nGitHub: ${github}\nCodex: ${codex}\nCurrent task: ${state?.currentTask ?? 'none'}\nRepository: ${state?.repo ?? 'none'}\nStatus: ${state?.status ?? 'IDLE'}`);
} else {
  throw new Error(`Unknown command: ${command}`);
}
