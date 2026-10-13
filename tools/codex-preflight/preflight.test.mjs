import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectRequest, requestBlockers } from './audit.mjs';
import { policyOverrides, configArgs, selectedImage } from './policy.mjs';
import { taskSandbox } from './sandbox.mjs';
import { CodexRpc } from './rpc.mjs';
import { createServer } from 'node:http';
import { installWebSocketCapture } from './websocket-capture.mjs';

const run = promisify(execFile);
const taskText = 'FRAMERONIN_CONTEXT_PROBE';
const imageUrl = 'data:image/png;base64,selected';
const taskMessage = { role: 'user', type: 'message', content: [
  { type: 'input_text', text: taskText }, { type: 'input_image', image_url: imageUrl }] };
const goodBody = { input: [taskMessage], tools: [],
  instructions: await readFile(new URL('./instructions.md', import.meta.url), 'utf8') };

test('unknown base instructions fail closed independently of message markers', () => {
  assert.ok(requestBlockers(inspectRequest({ ...goodBody, instructions: 'unselected' },
    'proposal', [], imageUrl), 'proposal').includes('UNEXPECTED_BASE_INSTRUCTIONS'));
});

test('selected task-only proposal passes the request audit', () => {
  const audit = inspectRequest(goodBody, 'proposal', [], imageUrl);
  assert.deepEqual(requestBlockers(audit, 'proposal'), []);
});
test('unrelated user context is rejected even without recognizable markers', () => {
  const body = { ...goodBody, input: [{ role: 'user', content: [
    { type: 'input_text', text: 'private instruction without a known marker' }] }, taskMessage] };
  assert.ok(requestBlockers(inspectRequest(body, 'proposal', [], imageUrl), 'proposal')
    .includes('UNSELECTED_USER_CONTEXT'));
});
test('merging private text into the task message does not bypass validation', () => {
  const body = { ...goodBody, input: [{ ...taskMessage, content: [...taskMessage.content,
    { type: 'input_text', text: 'unselected context' }] }] };
  assert.ok(requestBlockers(inspectRequest(body, 'proposal', [], imageUrl), 'proposal')
    .includes('UNSELECTED_USER_CONTEXT'));
});
test('unsolicited assistant history and unrelated developer instructions are rejected', () => {
  for (const role of ['assistant', 'developer']) {
    const body = { ...goodBody, input: [taskMessage, { type: 'message', role,
      content: [{ type: 'input_text', text: 'unselected previous context' }] }] };
    assert.ok(requestBlockers(inspectRequest(body, 'proposal', [], imageUrl), 'proposal')
      .includes('UNEXPECTED_CONTEXT_ITEM'));
  }
});
test('a substituted reference image is rejected', () => {
  const body = { ...goodBody, input: [{ ...taskMessage, content: [taskMessage.content[0],
    { type: 'input_image', image_url: 'data:image/png;base64,not-selected' }] }] };
  assert.ok(requestBlockers(inspectRequest(body, 'proposal', [], imageUrl), 'proposal')
    .includes('UNSELECTED_USER_CONTEXT'));
});
test('omitting an expected selected image cannot pass the capture gate', () => {
  const body = { ...goodBody, input: [{ ...taskMessage, content: [taskMessage.content[0]] }] };
  assert.ok(requestBlockers(inspectRequest(body, 'proposal', [], imageUrl), 'proposal')
    .includes('SELECTED_IMAGE_NOT_CAPTURED'));
});
test('native tool bootstrap alone cannot pass the turn-input gate', () => {
  const body = { input: [], tools: [{ type: 'namespace', name: 'image_gen', tools: [
    { type: 'function', name: 'imagegen' }] }] };
  const audit = inspectRequest(body, 'generation');
  assert.equal(audit.nativeImageGeneration, true);
  assert.ok(requestBlockers(audit, 'generation').includes('TURN_INPUT_NOT_CAPTURED'));
});
test('unexpected tools and unexpected functions within the image namespace are rejected', () => {
  const body = { ...goodBody, tools: [{ type: 'function', name: 'shell' },
    { type: 'namespace', name: 'image_gen', tools: [{ type: 'function', name: 'execute' }] }] };
  const blockers = requestBlockers(inspectRequest(body, 'generation', [], imageUrl), 'generation');
  assert.ok(blockers.includes('UNEXPECTED_TOOLS'));
  assert.ok(blockers.includes('UNEXPECTED_IMAGE_FUNCTIONS'));
});
test('report never retains input text, image bytes or credential headers', () => {
  const secret = 'fixture-secret-not-a-real-credential';
  const audit = inspectRequest({ ...goodBody, headers: { authorization: secret },
    input: [{ role: 'user', content: [{ type: 'input_text', text: secret }] }] }, 'proposal');
  assert.equal(JSON.stringify(audit).includes(secret), false);
  assert.equal(JSON.stringify(audit).includes(imageUrl), false);
});

test('native local handshake captures the task after bootstrap and never treats bootstrap as a turn',
  { timeout: 5000 }, async () => {
    const server = createServer();
    let bootstraps = 0;
    let capture;
    const captured = new Promise(resolve => { capture = resolve; });
    installWebSocketCapture(server, body => inspectRequest(body, 'generation', [], imageUrl),
      capture, () => { bootstraps++; });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/responses`);
    try {
      await new Promise((resolve, reject) => {
        client.addEventListener('open', resolve, { once: true });
        client.addEventListener('error', reject, { once: true });
      });
      client.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'response.completed') {
          client.send(JSON.stringify({ type: 'response.create', input: goodBody.input,
            previous_response_id: 'frameronin_local_bootstrap', generate: true }));
        }
      });
      client.send(JSON.stringify({ ...goodBody, input: [], generate: false,
        tools: [{ type: 'namespace', name: 'image_gen', tools: [{ type: 'function', name: 'imagegen' }] }] }));
      const audit = await captured;
      assert.equal(bootstraps, 1);
      assert.equal(audit.taskInputCaptured, true);
      assert.equal(audit.selectedImageCaptured, true);
      assert.deepEqual(requestBlockers(audit, 'generation'), []);
    } finally {
      client.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
test('MCP keys use the CLI path grammar and unsupported names fail closed', () => {
  const values = policyOverrides('/tmp/owned-task', 'proposal', ['computer-use']);
  assert.equal(values['mcp_servers.computer-use.enabled'], false);
  assert.equal(values['features.shell_tool'], false);
  assert.equal(values['memories.use_memories'], false);
  assert.equal(values['features.image_generation'], false);
  assert.ok(configArgs(values).some(arg => arg === 'mcp_servers.computer-use.enabled=false'));
  assert.throws(() => policyOverrides('/tmp/owned-task', 'proposal', ['server.with.dots']), /UNSUPPORTED_MCP_KEY/);
  assert.throws(() => policyOverrides('/tmp/task', 'unknown'), /INVALID_MODE/);
});

test('reference path traversal and escaping symlinks are rejected', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'frameronin-path-test-'));
  await mkdir(resolve(root, 'inputs'));
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(40)]);
  await writeFile(resolve(root, 'outside.png'), png);
  await writeFile(resolve(root, 'inputs/selected.png'), png);
  await symlink(resolve(root, 'outside.png'), resolve(root, 'inputs/escape.png'));
  assert.equal((await selectedImage(root, 'selected.png')).type, 'image');
  await assert.rejects(selectedImage(root, '../outside.png'), /INPUT_OUTSIDE_TASK/);
  await assert.rejects(selectedImage(root, 'escape.png'), /INPUT_OUTSIDE_TASK/);
  await writeFile(resolve(root, 'inputs/invalid.png'), 'not an image');
  await assert.rejects(selectedImage(root, 'invalid.png'), /INVALID_PNG/);
});

test('macOS process restriction permits selected input and denies foreign file contents',
  { skip: process.platform !== 'darwin' }, async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'frameronin-sandbox-test-'));
    for (const dir of ['inputs', 'outputs']) await mkdir(resolve(root, dir));
    const foreignRoot = await mkdtemp(resolve(tmpdir(), 'frameronin-foreign-test-'));
    await writeFile(resolve(root, 'inputs/selected.txt'), 'selected');
    await writeFile(resolve(foreignRoot, 'foreign.txt'), 'unselected fixture');
    const profile = await taskSandbox(root, '/bin/cat', 'proposal');
    const allowed = await run('/usr/bin/sandbox-exec', ['-p', profile, '/bin/cat', resolve(root, 'inputs/selected.txt')]);
    assert.equal(allowed.stdout, 'selected');
    await assert.rejects(run('/usr/bin/sandbox-exec', ['-p', profile, '/bin/cat', resolve(foreignRoot, 'foreign.txt')]));
    await assert.rejects(run('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c',
      'printf x > "$1"', 'probe', resolve(root, 'outputs/forbidden.txt')]));
  });

test('RPC client declines command approval requests', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'frameronin-rpc-test-'));
  const binary = resolve(root, 'fake-codex');
  await writeFile(binary, `#!/usr/bin/env node\nconst readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize'){
  console.log(JSON.stringify({id:m.id,result:{userAgent:'fixture'}}));
  console.log(JSON.stringify({id:900,method:'item/commandExecution/requestApproval',params:{}}));
 } else if(m.id===900){console.log(JSON.stringify({method:'fixture/decision',params:m.result}));}
});\n`, { mode: 0o755 });
  const rpc = new CodexRpc(binary, root, {});
  const decision = new Promise(resolve => rpc.on('notification', message => {
    if (message.method === 'fixture/decision') resolve(message.params.decision);
  }));
  try { await rpc.initialize(); assert.equal(await decision, 'decline'); }
  finally { await rpc.close(); }
});

test('unrecognized server requests stop the probe instead of inventing approval responses',
  { timeout: 5000 }, async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'frameronin-rpc-unknown-'));
    const binary = resolve(root, 'fake-codex');
    await writeFile(binary, `#!/usr/bin/env node\nconst readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',()=>{
 console.log(JSON.stringify({id:901,method:'fixture/unknownApproval',params:{}}));
});\n`, { mode: 0o755 });
    const rpc = new CodexRpc(binary, root, {});
    try { await assert.rejects(rpc.initialize(), /UNEXPECTED_SERVER_REQUEST/); }
    finally { await rpc.close(); }
  });
