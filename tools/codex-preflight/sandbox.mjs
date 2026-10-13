import { homedir } from 'node:os';
import { realpath, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { TOOL_DIR } from './policy.mjs';

export async function instructionDenials() {
  const paths = new Set();
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
    const path = resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'), name);
    paths.add(path);
    try { paths.add(await realpath(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...paths].map(path => `(deny file-read* (literal ${JSON.stringify(path)}))`).join(' ');
}

/** Kernel restriction for the entire Codex process tree, beyond command-only permissions. */
export async function taskSandbox(taskDir, binary, mode) {
  if (process.platform !== 'darwin') throw new Error('UNVERIFIED_SANDBOX_PLATFORM');
  const taskRoot = await realpath(taskDir);
  const codexRoot = process.env.CODEX_HOME || resolve(homedir(), '.codex');
  await mkdir(resolve(taskRoot, 'tmp'), { recursive: true });
  const rules = ['(version 1)', '(allow default)'];
  const readFilters = [];
  const writeFilters = [];
  const allow = (access, kind, path) => {
    const filter = `(${kind} ${JSON.stringify(path)})`;
    if (access === 'file-read*') readFilters.push(filter);
    if (access === 'file-write*') writeFilters.push(filter);
  };
  // dyld reads the filesystem root itself while initializing; this does not
  // grant access to the contents of child directories.
  allow('file-read*', 'literal', '/');
  for (const path of ['/System', '/usr', '/bin', '/dev', '/Library/Apple',
    '/Library/Fonts', '/private/var/db', '/private/var/run', '/private/etc']) {
    allow('file-read*', 'subpath', path);
  }
  allow('file-write*', 'subpath', '/dev');
  for (const path of [binary, await realpath(binary), resolve(TOOL_DIR, 'instructions.md'), codexRoot, taskRoot]) {
    allow('file-read*', 'literal', path);
  }
  for (const path of [dirname(binary), dirname(await realpath(binary))]) {
    allow('file-read*', 'literal', path);
  }
  allow('file-read*', 'literal', resolve(homedir(), '.CFUserTextEncoding'));
  for (const name of ['config.toml', 'auth.json', 'models_cache.json',
    '.sqlite-maintenance.lock', '.personality_migration', '.sandbox_migration',
    'state_5.sqlite', 'state_5.sqlite-wal', 'state_5.sqlite-shm',
    'state_6.sqlite', 'state_6.sqlite-wal', 'state_6.sqlite-shm']) {
    const path = resolve(codexRoot, name);
    allow('file-read*', 'literal', path);
    if (name.startsWith('state_') || name.endsWith('.lock')) allow('file-write*', 'literal', path);
    try { allow('file-read*', 'literal', await realpath(path)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const base of ['logs_2', 'goals_1', 'memories_1', 'queue_1', 'thread_history_1']) {
    for (const suffix of ['.sqlite', '.sqlite-wal', '.sqlite-shm']) {
      const path = resolve(codexRoot, base + suffix);
      allow('file-read*', 'literal', path);
      allow('file-write*', 'literal', path);
    }
  }
  for (const name of ['log', 'tmp']) {
    allow('file-read*', 'subpath', resolve(codexRoot, name));
    allow('file-write*', 'subpath', resolve(codexRoot, name));
  }
  allow('file-read*', 'subpath', resolve(taskRoot, 'inputs'));
  allow('file-read*', 'subpath', taskRoot);
  allow('file-read*', 'subpath', resolve(taskRoot, 'tmp'));
  allow('file-write*', 'subpath', resolve(taskRoot, 'tmp'));
  if (mode === 'generation') {
    allow('file-read*', 'subpath', resolve(taskRoot, 'outputs'));
    allow('file-write*', 'subpath', resolve(taskRoot, 'outputs'));
  }
  // Deny outside the allowed set in one rule. Seatbelt denies take precedence;
  // a broad deny followed by narrower allow rules would also deny the runtime.
  rules.push(`(deny file-read-data (require-all (subpath "/") (require-not (require-any ${readFilters.join(' ')}))))`);
  rules.push(`(deny file-write* (require-all (subpath "/") (require-not (require-any ${writeFilters.join(' ')}))))`);
  rules.push(await instructionDenials());
  return rules.join('\n');
}
