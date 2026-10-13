import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { CodexRpc } from './rpc.mjs';
import { TOOL_DIR, SUPPORTED_VERSION, policyOverrides, configArgs, selectedImage, taskEnvironment } from './policy.mjs';
import { installWebSocketCapture } from './websocket-capture.mjs';
import { taskSandbox, instructionDenials } from './sandbox.mjs';
import { inspectRequest as auditRequest, requestBlockers } from './audit.mjs';

const exec = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
async function main() {
const { stdout: binaryPath } = await exec('/usr/bin/which', [process.env.FRAMERONIN_CODEX_BINARY || 'codex']);
const binary = binaryPath.trim();
const work = resolve(TOOL_DIR, 'work');
await mkdir(work, { recursive: true });
// A task must also live outside the repository: Git discovery is not task input.
// Keep the native IPC socket pathname below macOS's Unix socket length limit.
const taskDir = await mkdtemp('/private/tmp/fr-');
for (const folder of ['inputs', 'outputs', 'tmp', '.agents/skills/canary', '.codex']) {
  await mkdir(resolve(taskDir, folder), { recursive: true });
}
const markers = ['FR_TASK_AGENT_CANARY_83471', 'FR_TASK_SKILL_CANARY_46327'];
await writeFile(resolve(taskDir, 'AGENTS.md'), markers[0]);
await writeFile(resolve(taskDir, '.agents/skills/canary/SKILL.md'),
  `---\nname: canary\ndescription: ${markers[1]}\n---\n${markers[1]}\n`);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}
function fixturePng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(8 * (1 + 8 * 4));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = y * 33 + 1 + x * 4;
    rows[i] = x < 4 ? 220 : 30; rows[i + 1] = 80; rows[i + 2] = 40; rows[i + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
await writeFile(resolve(taskDir, 'inputs/reference.png'), fixturePng());

const { stdout: versionText } = await exec(binary, ['--version']);
const version = versionText.trim().split(' ').at(-1);
if (version !== SUPPORTED_VERSION) throw new Error(`UNSUPPORTED_CODEX_VERSION_${version}`);
// Only names are returned; values/headers/auth material never leave the parser.
const { stdout: namesJson } = await exec('python3', ['-c',
  'import os,tomllib,json;from pathlib import Path;p=Path(os.environ.get("CODEX_HOME",str(Path.home()/".codex")))/"config.toml";d=tomllib.loads(p.read_text()) if p.is_file() else {};print(json.dumps(list(d.get("mcp_servers",{}))))']);
const names = JSON.parse(namesJson);
const mode = process.argv.includes('--generation') ? 'generation' : 'proposal';
let sandboxProfile;
if (process.argv.includes('--deny-instructions')) {
  sandboxProfile = '(version 1) (allow default) ' + await instructionDenials();
}
if (process.argv.includes('--strong-sandbox')) sandboxProfile = await taskSandbox(taskDir, binary, mode);
const overrides = policyOverrides(taskDir, mode, names, await realpath(binary));
if (process.argv.includes('--native-host')) overrides['features.code_mode_host'] = true;
const report = { version, mode, status: 'unverified',
  validationScope: 'local_request_capture_only', milestonePassed: false,
  restrictions: { instructionDenials: Boolean(sandboxProfile),
    taskFilesystem: process.argv.includes('--strong-sandbox') }, checks: {}, blockers: [] };
const inheritHost = process.argv.includes('--inherit-host');
const childEnvironment = inheritHost ? { ...process.env } : taskEnvironment(taskDir);
report.environment = inheritHost ? 'host_diagnostic_only' : 'isolated_candidate';

const reference = await selectedImage(taskDir, 'reference.png');
const inspectRequest = body => auditRequest(body, mode, markers, reference.url);

let rpc;
let server;
let stage = 'prompt_debug';
try {
  if (!process.argv.includes('--skip-prompt-debug')) {
  const { stdout: prompt } = await exec(sandboxProfile ? '/usr/bin/sandbox-exec' : binary,
    [...(sandboxProfile ? ['-p', sandboxProfile, binary] : []),
      'debug', 'prompt-input', ...configArgs(overrides), 'FRAMERONIN_CONTEXT_PROBE'],
    { cwd: taskDir, maxBuffer: 8 * 1024 * 1024, env: childEnvironment });
  stage = 'prompt_parse';
  report.checks.promptEnvelope = { bytes: Buffer.byteLength(prompt),
    startsWithJson: /^[\s]*[\[{]/.test(prompt) };
  const context = JSON.parse(prompt);
  const serialized = JSON.stringify(context);
  report.checks.promptInput = {
    sha256: sha(serialized), bytes: Buffer.byteLength(serialized),
    canaryLeak: markers.some(marker => serialized.includes(marker)),
    leakedCanaries: markers.filter(marker => serialized.includes(marker)),
    unrelatedMarkers: ['MEMORY_SUMMARY', '<skills_instructions>', 'Global defaults for coding agents',
      '.codex/memories/'].filter(marker => serialized.includes(marker)),
  };
  if (report.checks.promptInput.canaryLeak || report.checks.promptInput.unrelatedMarkers.length) {
    report.blockers.push('UNEXPECTED_CONTEXT');
  }
  } else report.checks.promptDebug = 'not_run';
  let resolveCapture;
  const captured = new Promise(resolve => { resolveCapture = resolve; });
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const piece of request) chunks.push(piece);
    if (!request.url.includes('responses')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [] })); return;
    }
    if (!chunks.length) { response.writeHead(400); response.end(); return; }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); }
    catch { response.writeHead(400); response.end(); return; }
    resolveCapture(inspectRequest(body));
    // No external service or real credentials: terminate immediately after capture.
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'FRAMERONIN_LOCAL_CAPTURE_COMPLETE', type: 'invalid_request_error' } }));
  });
  installWebSocketCapture(server, inspectRequest, resolveCapture,
    audit => { report.checks.nativeBootstrap = audit; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockOverrides = { ...overrides, model_provider: 'frameronin-proof',
    'model_providers.frameronin-proof': { name: 'Local isolation proof',
      base_url: `http://127.0.0.1:${port}/v1`, wire_api: 'responses',
      requires_openai_auth: false, request_max_retries: 0,
      stream_max_retries: 0 } };
  const nativeProvider = process.argv.includes('--native-provider');
  if (nativeProvider) {
    mockOverrides.model_provider = 'openai';
    mockOverrides.openai_base_url = `http://127.0.0.1:${port}/v1`;
    mockOverrides.chatgpt_base_url = `http://127.0.0.1:${port}/`;
    mockOverrides['features.enable_request_compression'] = false;
  }
  rpc = new CodexRpc(binary, taskDir, mockOverrides, sandboxProfile, childEnvironment);
  stage = 'initialize';
  const noEnvironments = process.argv.includes('--no-environments');
  const initialize = await rpc.initialize(noEnvironments);
  report.checks.initialize = { userAgent: initialize.userAgent };
  stage = 'thread_start';
  const started = await rpc.request('thread/start', {
    cwd: taskDir, ephemeral: true, modelProvider: nativeProvider ? 'openai' : 'frameronin-proof',
    model: 'gpt-6.1-sol',
    baseInstructions: await readFile(resolve(TOOL_DIR, 'instructions.md'), 'utf8'),
    developerInstructions: 'FrameRonin controlled session. Use only current task inputs.',
    ...(noEnvironments ? { environments: [], selectedCapabilityRoots: [],
      permissions: 'frameronin-preflight' } : {}),
  });
  report.checks.threadStarted = Boolean(started.thread?.id);
  stage = 'turn_start';
  await rpc.request('turn/start', { threadId: started.thread.id,
    input: [{ type: 'text', text: 'FRAMERONIN_CONTEXT_PROBE' },
      reference],
    ...(mode === 'proposal' ? { outputSchema: { type: 'object', properties: {
      proposal: { type: 'string' } }, required: ['proposal'], additionalProperties: false } } : {}),
  });
  let timer;
  try {
    stage = 'request_capture';
    report.checks.request = await Promise.race([captured,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CAPTURE_TIMEOUT')), 45000); })]);
  } finally { clearTimeout(timer); }
  const request = report.checks.request;
  report.blockers.push(...requestBlockers(request, mode));
  if (inheritHost) report.blockers.push('HOST_ENVIRONMENT_DEPENDENCY_UNVERIFIED');
  report.blockers = [...new Set(report.blockers)];
  report.status = report.blockers.length ? 'blocked' : 'capture_passed';
} catch (error) {
  // No stderr/config/request bodies: those may contain personal context or secrets.
  report.status = 'blocked';
  report.blockers.push('PROBE_ERROR');
  const diagnostic = error.stderr || rpc?.stderr || '';
  report.error = { stage, name: error.name, code: error.code || 'REQUEST_FAILED',
    signal: error.signal || null, stderrBytes: Buffer.byteLength(diagnostic),
    stderrCategoryWords: diagnostic.match(/\b(?:failed|create|open|write|read|default|environment|permission|denied|not|permitted|directory|file|found|executable|thread|context|bootstrap|transport|port|worker|model|initialization|database|socket)\b/gi),
    permissionDenied: /Permission denied|Operation not permitted/.test(diagnostic),
    configLoadFailed: /loading config|load config/i.test(diagnostic) };
} finally {
  if (rpc) await rpc.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(taskDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ version, mode, status: report.status,
  validationScope: report.validationScope, milestonePassed: false,
  toolNames: report.checks.request?.toolNames, taskInputCaptured: report.checks.request?.taskInputCaptured,
  blockers: report.blockers, error: report.error,
  reportPath: resolve(taskDir, 'report.json') }, null, 2));
process.exitCode = report.status === 'capture_passed' ? 0 : 1;
}

main().catch(error => {
  // Bootstrap/config errors can also contain private paths or configuration values.
  console.log(JSON.stringify({ status: 'blocked', milestonePassed: false,
    blockers: ['BOOTSTRAP_FAILED'], error: { stage: 'bootstrap', name: error.name,
      code: error.code || 'CONFIG_OR_VERSION_UNSUPPORTED' } }, null, 2));
  process.exitCode = 1;
});
