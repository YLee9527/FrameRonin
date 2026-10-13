import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixedInstructions = readFileSync(new URL('./instructions.md', import.meta.url), 'utf8');

const sha = value => createHash('sha256').update(value).digest('hex');

/** Retain digests and classifications, never raw context or request headers. */
export function inspectRequest(body, mode, markers = [], selectedImageUrl) {
  const serialized = JSON.stringify(body);
  const toolNames = (body.tools || []).map(tool => tool.name || tool.type);
  const allowed = mode === 'generation' ? ['image_gen'] : [];
  const inputItems = body.input || [];
  const taskSeen = inputItems.some(item => item.role === 'user' &&
    (item.content || []).some(content => content.text === 'FRAMERONIN_CONTEXT_PROBE'));
  return {
    sha256: sha(serialized),
    baseInstructionsMatch: body.instructions === fixedInstructions,
    inputItems: inputItems.map(item => ({ role: item.role, type: item.type,
      sha256: sha(JSON.stringify(item)), bytes: Buffer.byteLength(JSON.stringify(item)) })),
    toolNames, unexpectedTools: toolNames.filter(name => !allowed.includes(name)),
    canaryLeak: markers.some(marker => serialized.includes(marker)),
    leakedCanaries: markers.filter(marker => serialized.includes(marker)),
    unrelatedContextMarkers: ['MEMORY_SUMMARY', '<oai-mem-citation>', '<skills_instructions>',
      'Global defaults for coding agents', 'User Profile', '.codex/memories/']
      .filter(marker => serialized.includes(marker)),
    nativeImageGeneration: toolNames.includes('image_gen'),
    taskInputCaptured: taskSeen,
    referenceExpected: Boolean(selectedImageUrl),
    selectedImageCaptured: inputItems.some(item => item.role === 'user' &&
      (item.content || []).some(content => content.type === 'input_image' &&
        content.image_url === selectedImageUrl)),
    bodyKeys: Object.keys(body),
    imageToolSpec: (body.tools || []).filter(tool => tool.name === 'image_gen').map(tool => ({
      type: tool.type, name: tool.name,
      schemaSha256: sha(JSON.stringify(tool)),
      tools: (tool.tools || tool.functions || []).map(fn => ({ type: fn.type,
        name: fn.name, parameterNames: Object.keys(fn.parameters?.properties || {}),
        schemaSha256: sha(JSON.stringify(fn)) })),
    })),
    unexpectedUserItems: inputItems.filter(item => item.role === 'user' &&
      ((item.content || []).length === 0 || (item.content || []).some(content => {
        if (content.type === 'input_text') return content.text !== 'FRAMERONIN_CONTEXT_PROBE';
        if (content.type === 'input_image') return content.image_url !== selectedImageUrl;
        return true;
      }))).length,
    unexpectedContextItems: inputItems.filter(item => {
      if (item.type !== 'message' || !['user', 'developer'].includes(item.role)) return true;
      if (item.role === 'user') return false;
      const texts = (item.content || []).map(content => content.text || '').join('\n');
      const plain = texts.replace(/^# Instructions\s*/, '')
        .replace(/<\/?developer_instructions>/g, '').trim();
      return plain !== 'FrameRonin controlled session. Use only current task inputs.';
    }).length,
    unexpectedImageFunctions: (body.tools || []).filter(tool => tool.name === 'image_gen')
      .flatMap(tool => tool.tools || []).filter(tool => tool.type !== 'function' || tool.name !== 'imagegen')
      .map(tool => tool.name || tool.type),
  };
}

export function requestBlockers(request, mode) {
  const blockers = [];
  if (!request.baseInstructionsMatch) blockers.push('UNEXPECTED_BASE_INSTRUCTIONS');
  if (request.unexpectedTools.length) blockers.push('UNEXPECTED_TOOLS');
  if (request.unexpectedImageFunctions.length) blockers.push('UNEXPECTED_IMAGE_FUNCTIONS');
  if (request.canaryLeak || request.unrelatedContextMarkers.length) blockers.push('UNEXPECTED_CONTEXT');
  if (request.unexpectedUserItems) blockers.push('UNSELECTED_USER_CONTEXT');
  if (request.unexpectedContextItems) blockers.push('UNEXPECTED_CONTEXT_ITEM');
  if (!request.taskInputCaptured) blockers.push('TURN_INPUT_NOT_CAPTURED');
  if (request.referenceExpected && !request.selectedImageCaptured) blockers.push('SELECTED_IMAGE_NOT_CAPTURED');
  if (mode === 'generation' && !request.nativeImageGeneration) blockers.push('NATIVE_IMAGE_TOOL_NOT_OBSERVED');
  return blockers;
}
