import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_VERSION = '0.154.0';
export const TOOL_DIR = dirname(fileURLToPath(import.meta.url));

export function taskEnvironment(taskDir) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'HOME', 'CODEX_HOME', 'CODEX_CLI_PATH', 'LANG', 'LC_ALL', 'LC_CTYPE',
      'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].includes(key))),
    TMPDIR: resolve(taskDir, 'tmp') };
}

const disabledFeatures = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'browser_use',
  'browser_use_external', 'browser_use_full_cdp_access', 'computer_use',
  'in_app_browser', 'in_app_local_automation', 'code_mode', 'code_mode_host',
  'workspace_dependencies', 'multi_agent', 'multi_agent_v2', 'memories',
  'sleep_tool', 'tool_suggest', 'view_image', 'skill_search',
];

/** Process-local overrides; never write the user's Codex config or auth files. */
export function policyOverrides(taskDir, mode, mcpNames = [], executablePath) {
  if (!['proposal', 'generation'].includes(mode)) throw new Error('INVALID_MODE');
  const fsRules = {
    ':root': 'deny',
    ':minimal': 'read',
    [resolve(taskDir, 'inputs')]: 'read',
    [resolve(taskDir, 'outputs')]: mode === 'generation' ? 'write' : 'deny',
    [resolve(TOOL_DIR, 'instructions.md')]: 'read',
    [resolve(taskDir, 'tmp')]: 'write',
  };
  if (executablePath) fsRules[executablePath] = 'read';
  const values = {
    model_provider: 'openai',
    model_instructions_file: resolve(TOOL_DIR, 'instructions.md'),
    experimental_compact_prompt_file: resolve(TOOL_DIR, 'instructions.md'),
    developer_instructions: 'FrameRonin controlled session. Use only the current task inputs.',
    project_doc_max_bytes: 0,
    project_doc_fallback_filenames: [],
    'memories.use_memories': false,
    'memories.generate_memories': false,
    'features.skip_host_skill_discovery': true,
    'features.image_generation': mode === 'generation',
    'skills.include_instructions': false,
    'skills.bundled.enabled': false,
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    include_environment_context: false,
    include_permissions_instructions: false,
    'tools.experimental_request_user_input.enabled': false,
    'tools.update_plan.enabled': false,
    web_search: 'disabled',
    notify: [],
    default_permissions: 'frameronin-preflight',
    'permissions.frameronin-preflight.filesystem': fsRules,
    'permissions.frameronin-preflight.network.enabled': false,
  };
  for (const name of disabledFeatures) values[`features.${name}`] = false;
  // Codex 0.154.0 splits override paths on dots without unquoting TOML keys.
  // Quoted names would create new, incomplete MCP entries, rather than disable
  // the configured server. Reject unsupported keys instead of weakening isolation.
  for (const name of mcpNames) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('UNSUPPORTED_MCP_KEY');
    values[`mcp_servers.${name}.enabled`] = false;
  }
  return values;
}

function tomlValue(value) {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, v]) => `${JSON.stringify(key)}=${tomlValue(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function configArgs(values) {
  return Object.entries(values).flatMap(([key, value]) => ['-c', `${key}=${tomlValue(value)}`]);
}

/** Only registered input copies can become reference images; symlinks cannot escape. */
export async function selectedImage(taskDir, relativePath) {
  const inputs = await realpath(resolve(taskDir, 'inputs'));
  const file = await realpath(resolve(inputs, relativePath));
  if (!file.startsWith(inputs + sep)) throw new Error('INPUT_OUTSIDE_TASK');
  const bytes = await readFile(file);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!png || bytes.length < 33) throw new Error('INVALID_PNG');
  return { type: 'image', url: `data:image/png;base64,${bytes.toString('base64')}` };
}
