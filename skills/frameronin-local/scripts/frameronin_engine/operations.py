"""Local operation registry shared by previews, validation and workers."""
import math
from .errors import RoninError
from .project import memory_budget


def integer(default, low, high):
    return {'type': 'integer', 'default': default, 'minimum': low, 'maximum': high}


def number(default, low, high):
    return {'type': 'number', 'default': default, 'minimum': low, 'maximum': high}


def choice(default, values):
    return {'type': 'string', 'default': default, 'enum': values}


def operation(inputs, parameters, output, mode='original_resolution', overhead=128):
    return {'inputs': inputs, 'parameters': parameters, 'output': output,
            'processingMode': mode, 'runtimeOverheadMiB': overhead}


REGISTRY = {
    'image.resize': operation(['image'], {'width': integer(256, 1, 8192), 'height': integer(256, 1, 8192),
                                          'filter': choice('nearest', ['nearest', 'lanczos'])}, 'png'),
    'image.crop': operation(['image'], {'x': integer(0, 0, 8191), 'y': integer(0, 0, 8191),
                                      'width': integer(256, 1, 8192), 'height': integer(256, 1, 8192)}, 'png'),
    'image.flip': operation(['image'], {'axis': choice('horizontal', ['horizontal', 'vertical', 'both'])}, 'png'),
    'image.stroke': operation(['image'], {'radius': integer(1, 1, 32), 'color': {'type': 'color', 'default': '#000000'},
                                        'inside': {'type': 'boolean', 'default': False}}, 'png'),
    'image.matte': operation(['image'], {'strength': number(1, 0, 1)}, 'png', overhead=768),
    'video.extract': operation(['video'], {
        'fps': number(12, 0.1, 60), 'start': number(0, 0, 86400), 'end': number(5, 0.01, 86400),
        'maxFrames': integer(300, 1, 1000), 'width': integer(256, 1, 4096), 'height': integer(256, 1, 4096),
        'transparent': {'type': 'boolean', 'default': False}, 'padding': integer(0, 0, 512),
        'spacing': integer(0, 0, 512), 'columns': integer(4, 1, 128),
        'crop': choice('tight_bbox', ['none', 'tight_bbox', 'safe_bbox']),
        'layout': choice('fixed_columns', ['fixed_columns', 'auto_square']),
        'matteStrength': number(0.6, 0, 1), 'background': {'type': 'color', 'default': '#000000'}},
        'sheet_png_zip_index', 'bounded_frames', overhead=768),
    'video.watermark': operation(['video'], {}, 'mp4', 'global_temporal', overhead=256),
    'audio.compress': operation(['audio+'], {'bitrate': integer(128, 32, 320)}, 'mp3_zip', 'stream', overhead=128),
    'gif.split': operation(['animation'], {}, 'png_zip_index', 'stream'),
    'sequence.zip': operation(['image+'], {'duration': integer(100, 10, 60000)}, 'png_zip_index', 'stream'),
    'sequence.sheet': operation(['image+'], {'columns': integer(4, 1, 128), 'padding': integer(0, 0, 512),
                                          'spacing': integer(0, 0, 512)}, 'png_index', 'bounded_frames'),
    'sequence.gif': operation(['image+'], {'duration': integer(100, 10, 60000), 'loop': integer(0, 0, 65535)},
                              'gif', 'global_palette'),
    'image.slice': operation(['image'], {'columns': integer(4, 1, 128), 'rows': integer(4, 1, 128)},
                             'png_zip_index', 'stream'),
    'image.perfectPixel': operation(['image'], {'sampleMethod': choice('center', ['center', 'median', 'majority']),
        'gridCols': integer(0, 0, 2048), 'gridRows': integer(0, 0, 2048), 'minSize': integer(4, 2, 32),
        'peakWidth': number(6, 3, 20), 'refineIntensity': number(0.25, 0, 1),
        'fixSquare': {'type': 'boolean', 'default': True}}, 'png', 'legacy_prescale_2048', overhead=256),
    'workflow.strict': operation(['image+'], {'graph': {'type': 'object', 'default': {}}}, 'png_report', 'global_graph', overhead=256),
    'workflow.legacy': operation(['image+'], {'graph': {'type': 'object', 'default': {}}}, 'png_report', 'compatibility_graph', overhead=256),
}


def parameters(name, supplied):
    if name not in REGISTRY:
        raise RoninError('OPERATION_UNKNOWN', 'The proposal contains an unknown operation.', {'operation': name})
    if not isinstance(supplied, dict):
        raise RoninError('PARAMETERS_INVALID', 'Parameters must be an object.')
    schemas = REGISTRY[name]['parameters']
    unknown = set(supplied) - schemas.keys()
    if unknown:
        raise RoninError('PARAMETER_UNKNOWN', 'Unknown parameters are rejected.', {'fields': sorted(unknown)})
    result = {}
    for key, schema in schemas.items():
        value = supplied.get(key, schema['default'])
        kind = schema['type']
        valid = (type(value) is int if kind == 'integer' else
                 type(value) in [int, float] and math.isfinite(value) if kind == 'number' else
                 type(value) is bool if kind == 'boolean' else
                 isinstance(value, dict) if kind == 'object' else isinstance(value, str))
        if not valid:
            raise RoninError('PARAMETER_TYPE', 'A parameter has the wrong type.', {'parameter': key})
        if kind in ['integer', 'number'] and not schema['minimum'] <= value <= schema['maximum']:
            raise RoninError('PARAMETER_RANGE', 'A parameter is outside the allowed range.', {'parameter': key})
        if 'enum' in schema and value not in schema['enum']:
            raise RoninError('PARAMETER_VALUE', 'Unsupported parameter value.', {'parameter': key})
        if kind == 'color':
            import re
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
                raise RoninError('PARAMETER_COLOR', 'Colors must use six-digit hexadecimal notation.')
        result[key] = value
    return result


def preview(project, payload):
    if not isinstance(payload, dict) or set(payload) - {'operation', 'inputs', 'parameters', 'assetId'}:
        raise RoninError('TASK_FIELDS_INVALID', 'Unexpected task fields.')
    name = payload.get('operation')
    values = parameters(name, payload.get('parameters', {}))
    inputs = payload.get('inputs')
    spec = REGISTRY[name]
    multiple = spec['inputs'][0].endswith('+')
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= (1000 if multiple else 1):
        raise RoninError('INPUT_COUNT', 'The operation has an invalid input count.')
    versions = [project.version(version) for version in inputs]
    expected = spec['inputs'][0].rstrip('+')
    if any(item['metadata']['kind'] != expected for item in versions):
        raise RoninError('INPUT_KIND', 'A selected asset has an incompatible media kind.')
    pixels = [v['metadata'].get('width', 0) * v['metadata'].get('height', 0) for v in versions]
    estimate = spec['runtimeOverheadMiB'] * 1024**2 + max(pixels, default=0) * 4 * 4
    if name == 'image.resize':
        estimate += values['width'] * values['height'] * 4 * 2
    if name == 'image.crop':
        dimensions = versions[0]['metadata']
        if values['x'] + values['width'] > dimensions['width'] or values['y'] + values['height'] > dimensions['height']:
            raise RoninError('CROP_OUTSIDE_IMAGE', 'The crop rectangle exceeds the selected image.')
    if name == 'video.extract':
        if values['end'] <= values['start']:
            raise RoninError('FRAME_RANGE', 'The end time must be after the start time.')
        frames = min(values['maxFrames'], math.ceil((values['end'] - values['start']) * values['fps']))
        estimate += frames * (values['width'] + 2 * values['padding'] + values['spacing']) * \
                    (values['height'] + 2 * values['padding'] + values['spacing']) * 4 * 3
    if name == 'video.watermark':
        from .legacy.processor import get_video_info
        from pathlib import Path
        info = get_video_info(Path(versions[0]['absolutePath']))
        estimate += info['width'] * info['height'] * 3 * 61 * 8
    if name == 'sequence.sheet':
        w = max(v['metadata']['width'] for v in versions) + 2 * values['padding'] + values['spacing']
        h = max(v['metadata']['height'] for v in versions) + 2 * values['padding'] + values['spacing']
        estimate += values['columns'] * w * math.ceil(len(versions) / values['columns']) * h * 8
    if name == 'sequence.gif':
        estimate += sum(pixels) * 5
    if name == 'image.perfectPixel':
        if bool(values['gridCols']) != bool(values['gridRows']):
            raise RoninError('GRID_DIMENSIONS', 'Provide both manual grid dimensions, or neither.')
        estimate += min(2048**2, max(pixels)) * 64
    if name in ['workflow.strict', 'workflow.legacy']:
        graph = values['graph']
        if name == 'workflow.strict':
            from .workflows import validate
            values['graph'] = validate(graph, len(inputs))
        elif not isinstance(graph.get('nodes'), list) or len(graph['nodes']) > 200 or graph.get('version') not in [1, 5, 6, 7]:
            raise RoninError('LEGACY_WORKFLOW_INVALID', 'Unsupported historical workflow format.')
        estimate += sum(pixels) * 4
        # Keep a conservative live decode/intermediate estimate for every graph stage.
        sizes = []
        for node in graph['nodes']:
            params = node.get('params', {})
            width = max(v['metadata']['width'] for v in versions)
            height = max(v['metadata']['height'] for v in versions)
            if node.get('type') in ['resize', 'resizeHard']:
                width, height = params.get('w', width), params.get('h', height)
            width += params.get('padLeft', 0) + params.get('padRight', 0)
            height += params.get('padTop', 0) + params.get('padBottom', 0)
            if type(width) not in [int, float] or type(height) not in [int, float] or not math.isfinite(width * height) or width < 1 or height < 1:
                raise RoninError('WORKFLOW_SIZE_INVALID', 'A workflow stage has invalid dimensions.')
            sizes.append(width * height)
        estimate += sum(sizes) * 8 + max(sizes, default=0) * 32
    budget = memory_budget()
    if estimate > budget:
        raise RoninError('RESOURCE_LIMIT', 'The operation exceeds the memory budget; adjust its parameters.',
                         {'estimatedBytes': estimate, 'budgetBytes': budget})
    return {'operation': name, 'inputs': inputs, 'parameters': values, 'versions': versions,
            'estimatedBytes': estimate, 'budgetBytes': budget, 'processingMode': spec['processingMode'],
            'output': spec['output'], 'assetId': payload.get('assetId')}
