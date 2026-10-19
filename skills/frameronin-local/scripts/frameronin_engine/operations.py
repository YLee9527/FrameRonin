"""Local operation registry shared by previews, validation and workers."""
import math
from .errors import RoninError
from .project import checked_id, memory_budget
from .scatter import DETECT_DEFAULTS


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
    'video.capture': operation(['video'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'png_zip_report','original_browser_video_capture',overhead=256),
    'video.frameTools': operation(['archive|image+'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','original_video_frame_tools',overhead=256),
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
        'maxMotionRelative': number(0.35,0.05,0.95),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_sequence_report', 'full_frame_pair', overhead=384),
    'image.flowSplit': operation(['image'], {'columns': integer(4,1,64), 'rows': integer(1,1,64),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_sequence_report', 'original_proportional_grid', overhead=256),
    'sequence.flowExport': operation(['image+'], {'format': choice('zip',['zip','sheet']),
        'columns': integer(1,1,1000), 'frontendBytes': integer(0,0,2*1024**3)},
        'png_or_zip_report', 'original_optical_flow_export', overhead=256),
    'image.slice': operation(['image'], {'columns': integer(4, 1, 128), 'rows': integer(4, 1, 128)},
                             'png_zip_index', 'stream'),
    'image.sliceBrowser': operation(['image'], {'columns': integer(2,1,128),'rows': integer(2,1,128),
        'frontendBytes': integer(0,0,2*1024**3)}, 'png_sequence_report', 'floor_cells_discard_remainder', overhead=256),
    'image.superSlice': operation(['image'], {'frontendBytes': integer(0,0,2*1024**3)},
        'png_sequence_report', 'transparent_global_rows_columns', overhead=256),
    'image.blank': operation(['image'], {'frontendBytes': integer(0,0,2*1024**3)}, 'png_report', overhead=256),
    'image.customScale': operation(['image'],{'width':integer(256,1,4096),'height':integer(256,1,4096),
        'keepAspect':{'type':'boolean','default':True},'pixelated':{'type':'boolean','default':True},
        'mode':choice('resize',['resize','ffff','fffb','fbfb','fbff','c0c0','c0be','bebe','bec0']),
        'renderer':choice('native',['native','browser-worker']),
        'matteAlgorithm':choice('contiguous',['contiguous','chromaKey','chromaKeyAdaptive']),
        'nonContiguousTolerance':number(5,0,100),'frontendBytes':integer(0,0,2*1024**3)},'png_report','original_resize_and_matte_presets',overhead=256),
    'image.normal': operation(['image'],{'mode':choice('apply',['apply','mattePreview','extendBottom','rpgMaker','allActions','ancientCostume']),
        'renderer':choice('native',['native','browser-worker']),
        'cropLeft':integer(0,0,30000),'cropTop':integer(0,0,30000),'cropRight':integer(0,0,30000),'cropBottom':integer(0,0,30000),
        'width':integer(256,1,30000),'height':integer(256,1,30000),'keepAspect':{'type':'boolean','default':True},
        'pixelated':{'type':'boolean','default':True},'enableMatte':{'type':'boolean','default':False},
        'background':{'type':'color','default':'#ffffff'},'tolerance':number(40,1,100),'feather':number(5,0,30),
        'strokeWidth':integer(0,0,20),'strokeColor':{'type':'color','default':'#000000'},
        'frontendBytes':integer(0,0,2*1024**3)},'png_report','original_normal_image_recipes',overhead=256),
    'image.expandShrink': operation(['image'],{'columns':integer(4,1,64),'rows':integer(4,1,64),
        'cellWidth':integer(32,1,512),'cellHeight':integer(32,1,512),
        'renderer':choice('browser-worker',['browser-worker']),
        'frontendBytes':integer(0,0,2*1024**3)},'png_report','original_fractional_grid_crop_pad',overhead=256),
    'image.visibleWatermark': operation(['image'],{'sizeMode':choice('auto',['auto','48','96']),
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'png_report','original_reverse_alpha_standalone',overhead=256),
    'image.spriteGifs': operation(['image'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','original_sprite_sheet_row_gifs',overhead=256),
    'image.sheetCompose': operation(['archive'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'png_report','original_sheet_adjust_compose',overhead=256),
    'image.sheetGif': operation(['archive'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'gif_report','original_sheet_adjust_gif',overhead=256),
    'image.sheetFix': operation(['archive'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','original_sheet_adjust_pixel_fix',overhead=256),
    'image.sheetFrames': operation(['archive'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','original_sheet_adjust_frame_archive',overhead=256),
    'image.matteTool': operation(['image+'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'png_report','original_standalone_matte',overhead=256),
    'image.sheetPreprocess': operation(['image'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'png_report','original_sheet_pro_preprocess',overhead=256),
    'image.sheetPrepare': operation(['image'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','original_sheet_adjust_preparation',overhead=256),
    'image.scatterDetect': operation(['image'],{'detect':{'type':'object','default':DETECT_DEFAULTS},
        'order':choice('row-major',['row-major','column-major']),'renderer':choice('browser-worker',['browser-worker']),
        'frontendBytes':integer(0,0,2*1024**3)},'json_report','original_connected_components',overhead=256),
    'image.scatterExport': operation(['image'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','reviewed_fractional_slices',overhead=256),
    'image.customSlicePlan': operation(['image'],{'mode':choice('grid',['grid','auto']),
        'columns':integer(8,1,64),'rows':integer(4,1,64),'refine':choice('l7',['l7','uniform']),
        'bandPercent':integer(25,10,50),'renderer':choice('browser-worker',['browser-worker']),
        'frontendBytes':integer(0,0,2*1024**3)},'json_report','original_alpha_seams',overhead=256),
    'image.customSlice': operation(['image'],{'layout':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'zip_report','reviewed_grid_regions_or_seams',overhead=256),
    'image.customCompose': operation(['archive'],{'composition':{'type':'object','default':{}},
        'renderer':choice('browser-worker',['browser-worker']),'frontendBytes':integer(0,0,2*1024**3)},
        'png_report','original_signed_frame_composition',overhead=256),
    'sequence.unifySize': operation(['image+'],{'columns':integer(4,1,64),
        'horizontal':choice('center',['left','center','right']),'vertical':choice('bottom',['top','center','bottom']),
        'frontendBytes':integer(0,0,2*1024**3)},'png_report','original_integer_alignment',overhead=256),
    'image.findDuplicates': operation(['image'],{'columns':integer(8,1,64),'rows':integer(4,1,64),
        'frontendBytes':integer(0,0,2*1024**3)},'png_sequence_report','dimension_and_exact_rgba_groups',overhead=256),
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
    if name in ['image.scatterDetect','image.scatterExport']:
        from .scatter import estimate as scatter_estimate
        estimate=scatter_estimate(versions[0]['metadata'],values,name=='image.scatterExport')
    if name in ['image.customSlicePlan','image.customSlice','image.customCompose']:
        from .custom_slice import estimate as custom_estimate
        estimate=custom_estimate(versions[0],name,values,memory_budget())
    if name=='image.expandShrink':
        source=versions[0]['metadata'];width,height=values['columns']*values['cellWidth'],values['rows']*values['cellHeight']
        if max(width,height,source['width'],source['height'])>30000:raise RoninError('GRID_DIMENSION_LIMIT','Input and output sides must be at most 30000 pixels.')
        if source['bytes']>20*1024**2 or source.get('containerFormat') not in ['PNG','JPEG','WEBP']:
            raise RoninError('GRID_SOURCE_LIMIT','Select a static PNG, JPEG or WebP up to 20 MiB.')
        estimate=spec['runtimeOverheadMiB']*1024**2+max(pixels)*40+width*height*40+source['bytes']*8+values['frontendBytes']
    if name=='image.visibleWatermark':
        source=versions[0]['metadata']
        if source['bytes']>20*1024**2 or source.get('containerFormat') not in ['PNG','JPEG','WEBP'] or source.get('frames',1)!=1 or max(source['width'],source['height'])>30000:
            raise RoninError('WATERMARK_SOURCE_LIMIT','Select one static PNG, JPEG or WebP up to 20 MiB and 30000 pixels per side.')
        estimate=256*1024**2+max(pixels)*40+source['bytes']*8+values['frontendBytes']
    if name=='image.spriteGifs':
        from .sprite_gif import estimate as sprite_estimate
        estimate=sprite_estimate(versions[0],values)
    if name in ['image.sheetCompose','image.sheetGif','image.sheetFix','image.sheetFrames']:
        from .sheet_adjust import review
        estimate,_,_=review(versions[0],values,{'image.sheetCompose':'compose','image.sheetGif':'gif','image.sheetFix':'fix','image.sheetFrames':'frames'}[name],memory_budget())
    if name=='video.capture':
        from .video_capture import review
        estimate=review(versions[0],values,memory_budget())['estimatedBytes']
    if name=='video.frameTools':
        from .video_frames import review
        estimate,_,_=review(versions,values,memory_budget())
    if name=='image.matteTool':
        from .matte_tool import review
        estimate,_=review(versions,values,memory_budget())
    if name in ['image.sheetPreprocess','image.sheetPrepare']:
        from .sheet_prepare import review
        estimate,_=review(versions[0],values,'preprocess' if name=='image.sheetPreprocess' else 'prepare',memory_budget())
    if name=='image.normal':
        source=versions[0]['metadata'];width,height=normal_output_dimensions(source,values)
        if values['renderer']=='native':
            from PIL import Image
            try:
                with Image.open(versions[0]['absolutePath']) as image:
                    needs_host=image.format!='PNG' or bool(image.info.get('icc_profile'))
            except (OSError,ValueError,Image.DecompressionBombError) as error:
                raise RoninError('NORMAL_SOURCE_INVALID','The selected source image header cannot be decoded.') from error
            if needs_host:raise RoninError('BROWSER_RENDERER_REQUIRED','Normal-image recipes with photographic formats or color profiles use the original host Canvas Worker; no native decoder is substituted.')
        if values['mode']=='apply' and not values['pixelated'] and values['renderer']!='browser-worker':
            raise RoninError('BROWSER_RENDERER_REQUIRED','Smooth normal-image processing requires the original host Canvas Worker; no native filter is substituted.')
        if max(width,height)>30000:raise RoninError('NORMAL_DIMENSION_LIMIT','The output must be at most 30000 pixels per side.')
        estimate+=max(max(pixels),width*height)*64+values['frontendBytes']+source['bytes']*8
    if name in ['image.customScale','sequence.unifySize','image.findDuplicates']:
        if name=='image.customScale':
            if values['mode']=='resize' and not values['pixelated'] and values['renderer']!='browser-worker':
                raise RoninError('BROWSER_RENDERER_REQUIRED','Smooth scaling uses the original Canvas filter in the workbench Worker. Open Custom scale; no native filter is substituted.')
            if values['renderer']=='browser-worker' and (values['mode']!='resize' or values['pixelated']):
                raise RoninError('BROWSER_OPERATION_UNSUPPORTED','The browser Worker is limited to smooth custom scaling.')
            side=256 if values['mode'] in ['ffff','fffb','fbfb','fbff'] else 190 if values['mode']=='bebe' else 192
            width,height=(values['width'],values['height']) if values['mode']=='resize' else (side,side)
            output_pixels=width*height;surfaces=64
        elif name=='sequence.unifySize':
            width=values['columns']*max(v['metadata']['width'] for v in versions)
            height=math.ceil(len(versions)/values['columns'])*max(v['metadata']['height'] for v in versions)
            output_pixels=width*height;surfaces=16
        else:
            width,height=versions[0]['metadata']['width'],versions[0]['metadata']['height']
            output_pixels=max(width,values['columns'])*max(height,values['rows']);surfaces=48
            estimate+=values['columns']*values['rows']*96*1024
        if max(width,height)>30000:
            raise RoninError('RONIN_DIMENSION_LIMIT','The operation supports at most 30000 pixels per side.')
        estimate+=sum(pixels)*32+output_pixels*surfaces+values['frontendBytes']+sum(v['metadata']['bytes'] for v in versions)*4
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
        estimate += values['frontendBytes'] + sum(v['metadata']['bytes'] for v in versions)*4
    if name in ['image.flowSplit','sequence.flowExport']:
        if any(v['metadata'].get('frames',1)!=1 or v['metadata'].get('containerFormat') not in ['PNG','JPEG','WEBP'] or v['metadata']['bytes']>20*1024**2 or max(v['metadata']['width'],v['metadata']['height'])>30000 for v in versions):
            raise RoninError('FLOW_SOURCE_FORMAT','Select static PNG, JPEG or WebP frames up to 20 MiB and 30000 pixels per side.')
        if name=='sequence.flowExport' and values['format']=='zip' and any(v['metadata'].get('containerFormat')!='PNG' for v in versions):
            raise RoninError('FLOW_EXPORT_FORMAT','Frame ZIP export requires the processed PNG versions; source JPEG/WebP files must not be renamed as PNG.')
        output_pixels=0
        if name=='image.flowSplit':
            m=versions[0]['metadata'];cols,rows=values['columns'],values['rows']
            output_pixels=max(1,math.ceil(m['width']/cols))*max(1,math.ceil(m['height']/rows))*cols*rows
        elif values['format']=='sheet':
            sizes={(v['metadata']['width'],v['metadata']['height']) for v in versions}
            if len(sizes)!=1:raise RoninError('FLOW_EXPORT_DIMENSIONS','Sprite sheet frames must have identical dimensions.')
            width,height=next(iter(sizes));cols=min(len(versions),values['columns'])
            width*=cols;height*=math.ceil(len(versions)/cols)
            if max(width,height)>30000:raise RoninError('FLOW_EXPORT_DIMENSIONS','The composed sheet may not exceed 30000 pixels per side.')
            output_pixels=width*height
        estimate=256*1024**2+values['frontendBytes']+sum(v['metadata']['bytes'] for v in versions)*8+sum(pixels)*32+output_pixels*32
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
    requires_workbench=name in ['video.capture','video.frameTools','image.matteTool','image.sheetCompose','image.sheetGif','image.sheetFix','image.sheetFrames','image.sheetPreprocess','image.sheetPrepare','image.spriteGifs','image.visibleWatermark','image.customScale','image.normal','image.expandShrink','image.scatterDetect','image.scatterExport','image.customSlicePlan','image.customSlice','image.customCompose'] and values['renderer']=='browser-worker'
    if requires_workbench:processing_mode='original_host_canvas_worker'
    return {'operation': name, 'inputs': inputs, 'parameters': values, 'versions': versions,
            'estimatedBytes': estimate, 'budgetBytes': budget, 'processingMode': processing_mode,
            'output': spec['output'], 'assetId': payload.get('assetId'),'requiresWorkbench':requires_workbench}


def normal_output_dimensions(source,values):
    width,height=source.get('displayWidth',source['width']),source.get('displayHeight',source['height'])
    if source.get('containerFormat')=='WEBP':width,height=source['width'],source['height']
    if values['mode'] in ['apply','mattePreview']:
        width-=values['cropLeft']+values['cropRight'];height-=values['cropTop']+values['cropBottom']
        if min(width,height)<1:raise RoninError('CROP_OUTSIDE_IMAGE','The crop must retain at least one source pixel in each dimension.')
    if values['mode']=='apply':width,height=values['width'],values['height']
    elif values['mode']=='extendBottom':height+=height//3
    elif values['mode']=='rpgMaker':width,height=144,192
    elif values['mode']=='allActions':width,height=252,252
    elif values['mode']=='ancientCostume':width,height=1024,896
    return width,height
