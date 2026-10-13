import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { configArgs, taskEnvironment } from './policy.mjs';

export class CodexRpc extends EventEmitter {
  #next = 0;
  #pending = new Map();
  constructor(binary, cwd, overrides, sandboxProfile, childEnvironment) {
    super();
    const command = sandboxProfile ? '/usr/bin/sandbox-exec' : binary;
    const args = sandboxProfile ? ['-p', sandboxProfile, binary] : [];
    this.child = spawn(command, [...args, 'app-server', '--stdio', ...configArgs(overrides)], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: childEnvironment || taskEnvironment(cwd),
    });
    this.stderr = '';
    this.child.stdin.on('error', error => this.#fail(error));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-65536); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { this.emit('invalidJson'); return; }
      if (message.method && message.id !== undefined) {
        // Only use verified response schemas. Unknown requests must not receive
        // an invented response that a future server could treat as approval.
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
          this.child.stdin.write(JSON.stringify({ id: message.id, result: { decision: 'decline' } }) + '\n');
        } else {
          this.#fail(new Error('UNEXPECTED_SERVER_REQUEST'));
          this.#stopGroup('SIGKILL');
        }
        this.emit('deniedRequest', { method: message.method });
      } else if (message.id !== undefined) {
        const request = this.#pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.#pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else this.emit('notification', message);
    });
    this.child.on('error', error => this.#fail(error));
    this.child.on('exit', code => {
      this.#fail(new Error(`CODEX_EXIT_${code}`));
      this.emit('closed', code);
    });
  }
  #fail(error) {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.#pending.clear();
  }
  #stopGroup(signal) {
    try {
      if (process.platform === 'win32') this.child.kill(signal);
      else process.kill(-this.child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') this.#fail(error); }
  }
  request(method, params = {}, timeoutMs = 30000) {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`RPC_TIMEOUT_${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async initialize(experimentalApi = false) {
    const result = await this.request('initialize', {
      clientInfo: { name: 'frameronin-preflight', version: '0.1.0' },
      capabilities: { experimentalApi },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return result;
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.#stopGroup('SIGKILL');
      return;
    }
    await new Promise(resolve => {
      const term = setTimeout(() => this.#stopGroup('SIGTERM'), 2000);
      const kill = setTimeout(() => this.#stopGroup('SIGKILL'), 5000);
      this.child.once('exit', () => { clearTimeout(term); clearTimeout(kill); resolve(); });
      this.child.stdin.end();
    });
  }
}
