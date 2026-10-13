import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TOOL_DIR, SUPPORTED_VERSION } from './policy.mjs';

const exec = promisify(execFile);
const binary = process.env.FRAMERONIN_CODEX_BINARY || 'codex';
const { stdout } = await exec(binary, ['--version']);
if (stdout.trim() !== `codex-cli ${SUPPORTED_VERSION}`) throw new Error('UNSUPPORTED_CODEX_VERSION');
const work = resolve(TOOL_DIR, 'work');
await mkdir(work, { recursive: true });
const scratch = await mkdtemp(resolve(work, 'schema-'));
const target = resolve(TOOL_DIR, 'protocol', SUPPORTED_VERSION);
await mkdir(target, { recursive: true });
const manifest = { version: SUPPORTED_VERSION, files: {} };
for (const experimental of [false, true]) {
  const out = resolve(scratch, experimental ? 'experimental' : 'standard');
  await exec(binary, ['app-server', 'generate-json-schema', '--out', out,
    ...(experimental ? ['--experimental'] : [])]);
  const bytes = await readFile(resolve(out, 'codex_app_server_protocol.schemas.json'));
  JSON.parse(bytes);
  const filename = experimental ? 'experimental.json' : 'standard.json';
  await writeFile(resolve(target, filename), bytes);
  manifest.files[filename] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
await writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
