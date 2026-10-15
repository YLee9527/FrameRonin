"""Local operation registry shared by previews, validation and workers."""
import math
from .errors import RoninError
from .project import checked_id, memory_budget


def integer(default, low, high):
    return {'type': 'integer', 'default': default, 'minimum': low, 'maximum': high}


def number(default, low, high):
    return {'type': 'number', 'default': default, 'minimum': low, 'maximum': high}


def choice(default, values):
    return {'type': 'string', 'default': default, 'enum': values}


def operation(inputs, parameters, output, mode='original_resolution', overhead=128):
    return {'inputs': inputs, 'parameters': parameters, 'output': output,
            'processingMode': mode, 'runtimeOverheadMiB': overhead}


def pixel_region():
    return {'regionX':integer(0,0,8191),'regionY':integer(0,0,8191),
            'regionWidth':integer(0,0,8192),'regionHeight':integer(0,0,8192),
            'frontendBytes':integer(0,0,2*1024**3)}


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
    'video.watermark': operation(['video'], {'frontendBytes': integer(0,0,2*1024**3)}, 'mp4', 'global_temporal', overhead=256),
    'audio.compress': operation(['audio+'], {'bitrate': integer(128, 32, 320)}, 'mp3_zip', 'stream', overhead=128),
    'gif.split': operation(['animation|image'], {'renderer': choice('pillow',['pillow','browser']),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_zip_index', 'bounded_frames', overhead=256),
    'sequence.zip': operation(['image+'], {'duration': integer(100, 10, 60000)}, 'png_zip_index', 'stream'),
    'sequence.sheet': operation(['image+'], {'columns': integer(4, 1, 128), 'padding': integer(0, 0, 512),
                                          'spacing': integer(0, 0, 512)}, 'png_index', 'bounded_frames'),
    'sequence.gif': operation(['image+'], {'duration': integer(100, 10, 60000), 'loop': integer(0, 0, 65535),
        'renderer': choice('pillow',['pillow','browser']), 'sizePolicy': choice('reject',['reject','first']),
        'frontendBytes': integer(0,0,2*1024**3)},
                              'gif', 'global_palette'),
    'sequence.opticalFlow': operation(['image+'], {'alpha': number(0.5, 0, 1),
        'nearestNeighbor': {'type':'boolean','default':False}, 'bidirectional': {'type':'boolean','default':True},
        'quality': choice('balanced',['fast','balanced','high']), 'smoothFlow': {'type':'boolean','default':True},
        'maxMotionRelative': number(0.35,0.05,0.95)}, 'png_sequence_report', 'full_frame_pair', overhead=384),
    'image.slice': operation(['image'], {'columns': integer(4, 1, 128), 'rows': integer(4, 1, 128)},
                             'png_zip_index', 'stream'),
    'image.sliceBrowser': operation(['image'], {'columns': integer(2,1,128),'rows': integer(2,1,128),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_sequence_report', 'floor_cells_discard_remainder', overhead=256),
    'image.superSlice': operation(['image'], {'frontendBytes': integer(0,0,2*1024**3)},
        'png_sequence_report', 'transparent_global_rows_columns', overhead=256),
    'image.blank': operation(['image'], {'frontendBytes': integer(0,0,2*1024**3)}, 'png_report', overhead=256),
    'sequence.combine': operation(['image+'], {'columns': integer(4,1,128),
        'cropTop': number(0,-8192,8192),'cropBottom': number(0,-8192,8192),
        'cropLeft': number(0,-8192,8192),'cropRight': number(0,-8192,8192),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_report', 'original_crop_expand_center', overhead=256),
    'sequence.stitch': operation(['image+'], {'direction': choice('vertical',['vertical','horizontal','overlay']),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_report', 'original_center_compose', overhead=256),
    'image.perfectPixel': operation(['image'], {'sampleMethod': choice('center', ['center', 'median', 'majority']),
        'gridCols': integer(0, 0, 2048), 'gridRows': integer(0, 0, 2048), 'minSize': integer(4, 2, 32),
        'peakWidth': number(6, 3, 20), 'refineIntensity': number(0.25, 0, 1),
        'fixSquare': {'type': 'boolean', 'default': True}, **pixel_region()}, 'png', 'legacy_prescale_2048', overhead=256),
    'image.pixelate': operation(['image'],{'pixelSize':integer(8,1,128),**pixel_region()},'png_report','original_smoothed_blocks',overhead=256),
    'image.mergeNearby': operation(['image'],{'strength':number(40,0,100),**pixel_region()},'png_report','global_lab_grid',overhead=256),
    'image.palette16': operation(['image'],{'method':choice('lab',['rgb','lab']),
        'dither':{'type':'boolean','default':True},**pixel_region()},'png_report','global_original_median_cut',overhead=256),
    'image.pixellise': operation(['image'],{'upscale':integer(3,1,7),'numColors':integer(64,4,256),
        'scaleResult':integer(1,1,5),'transparentBackground':{'type':'boolean','default':False},
        **pixel_region()},'png_report','global_original_opencv_mesh',overhead=576),
    'workflow.strict': operation(['image+'], {'graph': {'type': 'object', 'default': {}}}, 'png_report', 'global_graph', overhead=256),
    'workflow.legacy': operation(['image+'], {'graph': {'type': 'object', 'default': {}}}, 'png_report', 'compatibility_graph', overhead=256),
    'map.export': operation(['image+'], {'layout': {'type':'object','default':{}},
        'format': choice('png',['png','psd','godot']), 'frontendBytes': integer(0,0,2*1024**3)}, 'map_file_report', 'global_composite', overhead=256),
    'map.template': operation(['image+'], {'layout': {'type':'object','default':{}},
        'target': {'type':'object','default':{}}, 'frontendBytes': integer(0,0,2*1024**3)}, 'png_report', 'overlap_template', overhead=256),
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
    if payload.get('assetId'):
        checked_id(payload['assetId'])
        with project.connection() as db:
            if not db.execute('SELECT id FROM assets WHERE id=?', (payload['assetId'],)).fetchone():
                raise RoninError('OUTPUT_ASSET_MISSING', 'Select an existing output asset, or omit assetId to create one.')
    expected = spec['inputs'][0].rstrip('+')
    if any(item['metadata']['kind'] not in expected.split('|') for item in versions):
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
        if info['width'] < 120 or info['height'] < 60:
            raise RoninError('WATERMARK_DIMENSION_LIMIT','The original corner detector requires a video of at least 120 by 60 pixels.')
        # float32 sample list + stacked copy + variance workspace coexist.
        # Also retain mean/std/mask and inpainting/decoder surfaces.
        estimate += info['width'] * info['height'] * (60*3*4*3+64) + values['frontendBytes']
    if name == 'sequence.sheet':
        w = max(v['metadata']['width'] for v in versions) + 2 * values['padding'] + values['spacing']
        h = max(v['metadata']['height'] for v in versions) + 2 * values['padding'] + values['spacing']
        estimate += values['columns'] * w * math.ceil(len(versions) / values['columns']) * h * 8
    if name == 'sequence.gif':
        if values['sizePolicy'] == 'reject' and len({(v['metadata']['width'], v['metadata']['height']) for v in versions}) != 1:
            raise RoninError('FRAME_SIZE_MISMATCH', 'GIF frames must have identical dimensions.')
        if values['renderer'] == 'pillow' and values['sizePolicy'] != 'reject':
            raise RoninError('GIF_SIZE_POLICY', 'Only the original browser renderer supports first-frame resizing.')
        if values['renderer'] == 'browser' and values['loop'] != 0:
            raise RoninError('GIF_LOOP_POLICY', 'The original browser renderer supports the existing infinite-loop behavior.')
        # RGBA frames, a global RGB palette surface, indexed frames, quantizer and encoder buffers.
        estimate += values['frontendBytes'] + (sum(pixels) * 20 if values['renderer'] == 'pillow' else
            len(versions) * pixels[0] * 8 + max(pixels) * 32)
    if name == 'gif.split':
        from PIL import Image
        metadata = versions[0]['metadata']
        if metadata['extension'] != '.gif' or not 1 <= metadata['frames'] <= 1000:
            raise RoninError('GIF_INPUT_LIMIT', 'Select a GIF with one to one thousand frames.')
        with Image.open(versions[0]['absolutePath']) as image:
            if image.format != 'GIF':
                raise RoninError('GIF_INPUT_FORMAT', 'The selected file is not a GIF container.')
        estimate += values['frontendBytes'] + pixels[0] * metadata['frames'] * (48 if values['renderer'] == 'browser' else 4)
    if name in ['gif.split', 'sequence.gif'] and values['renderer'] == 'browser':
        estimate += sum(version['metadata']['bytes'] for version in versions) * 4
    if name == 'image.perfectPixel':
        if bool(values['gridCols']) != bool(values['gridRows']):
            raise RoninError('GRID_DIMENSIONS', 'Provide both manual grid dimensions, or neither.')
        estimate += min(2048**2, max(pixels)) * 64
    if name in ['image.perfectPixel','image.pixelate','image.mergeNearby','image.palette16','image.pixellise']:
        source=versions[0]['metadata'];width,height=source['width'],source['height']
        if values['regionWidth'] or values['regionHeight'] or values['regionX'] or values['regionY']:
            if not values['regionWidth'] or not values['regionHeight'] or values['regionX']+values['regionWidth']>width or values['regionY']+values['regionHeight']>height:
                raise RoninError('PIXEL_REGION_INVALID','Select a nonempty rectangle within the input version.')
            width,height=values['regionWidth'],values['regionHeight']
        estimate += values['frontendBytes'] + versions[0]['metadata']['bytes']*4
        if name != 'image.perfectPixel':
            estimate += width*height*({'image.pixelate':32,'image.mergeNearby':48,'image.palette16':256,'image.pixellise':128}[name])
        if name == 'image.pixellise':
            maximum=next((u for u in range(7,0,-1) if width*height*u*u<=42_000_000),1)
            used=min(values['upscale'],maximum);scaled=width*height*used*used
            if scaled>42_000_000:
                raise RoninError('PIXELLISE_DIMENSION_LIMIT','The original mesh detector supports at most 42 million scaled pixels.')
            estimate += scaled*(64+values['scaleResult']**2*16)
    if name == 'sequence.opticalFlow':
        if not 2 <= len(versions) <= 500 or len({(v['metadata']['width'],v['metadata']['height']) for v in versions}) != 1:
            raise RoninError('OPTICAL_FLOW_FRAMES', 'Select 2–500 frames with identical dimensions; output is limited to 999 frames.')
        estimate += sum(pixels) * 4 + pixels[0] * (2 * len(versions) - 1) * 4 + max(pixels) * 64
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
    if name in ['map.export', 'map.template']:
        from .maps import estimate as map_estimate
        estimate = map_estimate(values, versions, name == 'map.template')
    if name in ['sequence.combine','sequence.stitch','image.sliceBrowser','image.superSlice','image.blank']:
        dimensions=[(version['metadata']['width'],version['metadata']['height']) for version in versions]
        if name == 'sequence.combine':
            width=max(max(1,w-values['cropLeft']-values['cropRight']) for w,h in dimensions)*values['columns']
            height=max(max(1,h-values['cropTop']-values['cropBottom']) for w,h in dimensions)*math.ceil(len(versions)/values['columns'])
        elif name == 'sequence.stitch':
            width=sum(w for w,h in dimensions) if values['direction']=='horizontal' else max(w for w,h in dimensions)
            height=sum(h for w,h in dimensions) if values['direction']=='vertical' else max(h for w,h in dimensions)
        else:
            width,height=dimensions[0]
        if name == 'image.sliceBrowser' and (values['rows']*values['columns']>1000 or width//values['columns']<1 or height//values['rows']<1):
            raise RoninError('SLICE_LIMIT','Select a nonempty grid with at most one thousand cells.')
        if width>30000 or height>30000:
            raise RoninError('SEQUENCE_DIMENSION_LIMIT','The composed image must be at most 30000 pixels per side.')
        estimate += values['frontendBytes'] + sum(pixels)*24 + width*height*16 + sum(v['metadata']['bytes'] for v in versions)*4
    budget = memory_budget()
    if estimate > budget:
        raise RoninError('RESOURCE_LIMIT', 'The operation exceeds the memory budget; adjust its parameters.',
                         {'estimatedBytes': estimate, 'budgetBytes': budget})
    processing_mode = ('legacy_browser_composite' if name == 'gif.split' else 'per_frame_browser_palette') \
        if name in ['gif.split', 'sequence.gif'] and values['renderer'] == 'browser' else spec['processingMode']
    return {'operation': name, 'inputs': inputs, 'parameters': values, 'versions': versions,
            'estimatedBytes': estimate, 'budgetBytes': budget, 'processingMode': processing_mode,
            'output': spec['output'], 'assetId': payload.get('assetId')}
