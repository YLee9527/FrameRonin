"""Deterministic media processing; filenames stay inside the owned task directory."""
import json
import math
import shutil
from pathlib import Path
import subprocess
import zipfile
from PIL import Image, ImageFilter, ImageChops
from .errors import RoninError


def run(preview, directory, progress):
    directory = Path(directory)
    directory.mkdir(exist_ok=True)
    name = preview['operation']
    parameters = preview['parameters']
    if name=='image.customScale' and parameters['renderer']=='browser-worker':
        from .browser_tasks import wait_for_result
        return wait_for_result(preview,directory,progress)
    paths = [Path(v['absolutePath']) for v in preview['versions']]
    output = directory / 'result.png'
    browser_gif = name in ['gif.split', 'sequence.gif'] and parameters['renderer'] == 'browser'
    sequence_canvas = name in ['sequence.combine','sequence.stitch','image.sliceBrowser','image.superSlice','image.blank']
    pixel_canvas = name in ['image.pixelate','image.mergeNearby','image.palette16','image.pixellise']
    ronin_tools = name in ['image.customScale','sequence.unifySize','image.findDuplicates']
    if name in ['image.perfectPixel', 'workflow.strict', 'workflow.legacy', 'sequence.opticalFlow', 'map.export', 'map.template'] or browser_gif or sequence_canvas or pixel_canvas or ronin_tools:
        from .workflows import ROOT
        node = shutil.which('node')
        compiled = ROOT / '.runtime/js/algorithms.mjs'
        if not node or not compiled.is_file():
            raise RoninError('JS_RUNTIME_MISSING', 'Install and build the private JavaScript algorithm runtime.')
        inputs = directory / 'inputs'
        inputs.mkdir()
        selected = []
        for index, path in enumerate(paths):
            relative = f'inputs/{index:04d}{path.suffix}'
            shutil.copy2(path, directory / relative)
            selected.append(relative)
        values = dict(parameters)
        request = {'operation': name if browser_gif or sequence_canvas or pixel_canvas or ronin_tools else 'map' if name.startswith('map.') else 'workflow' if name.startswith('workflow.') else 'opticalFlow' if name == 'sequence.opticalFlow' else 'perfectPixel',
                   'inputs': selected, 'parameters': values, 'budgetBytes': preview['budgetBytes']}
        if name.startswith('workflow.'):
            request['graph'] = values.pop('graph')
            request['compatibility'] = name == 'workflow.legacy'
        elif name == 'image.perfectPixel':
            cols, rows = values.pop('gridCols'), values.pop('gridRows')
            values['gridSize'] = {'cols': cols, 'rows': rows} if cols else None
        elif name == 'map.template':
            values['format'] = 'template'
        request_path = directory / 'request.json'
        request_path.write_text(json.dumps(request))
        process = subprocess.Popen([node, str(ROOT / 'scripts/js-runtime/run.mjs'), str(request_path)],
                                   stdout=subprocess.PIPE, text=True)
        try:
            for line in process.stdout:
                if len(line) > 1024**2:
                    raise RoninError('WORKER_EVENT_INVALID', 'A runtime event exceeded its size limit.')
                event = json.loads(line)
                if 'progress' in event:
                    if type(event['progress']) not in [int, float] or not 0 <= event['progress'] <= 1:
                        raise RoninError('WORKER_EVENT_INVALID', 'Invalid runtime progress.')
                    progress(event['progress'])
            if process.wait() != 0:
                raise subprocess.CalledProcessError(process.returncode, process.args)
        finally:
            if process.stdout:
                process.stdout.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=1)
        report_path = directory / 'output/report.json'
        report = json.loads(report_path.read_text())
        return [directory / file for file in report['files']] + [report_path]
    if name.startswith('image.') and name not in ['image.slice', 'image.matte']:
        with Image.open(paths[0]) as original:
            image = original.convert('RGBA')
        if name == 'image.resize':
            image = image.resize((parameters['width'], parameters['height']),
                                 Image.Resampling.NEAREST if parameters['filter'] == 'nearest' else Image.Resampling.LANCZOS)
        elif name == 'image.crop':
            x, y = parameters['x'], parameters['y']
            image = image.crop((x, y, x + parameters['width'], y + parameters['height']))
        elif name == 'image.flip':
            if parameters['axis'] in ['horizontal', 'both']:
                image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if parameters['axis'] in ['vertical', 'both']:
                image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        elif name == 'image.stroke':
            alpha = image.getchannel('A')
            radius = parameters['radius']
            outer = alpha.filter(ImageFilter.MaxFilter(2 * radius + 1))
            if parameters['inside']:
                edge = ImageChops.subtract(alpha, alpha.filter(ImageFilter.MinFilter(2 * radius + 1)))
                stroke = Image.new('RGBA', image.size, parameters['color'])
                stroke.putalpha(edge)
                image = Image.alpha_composite(image, stroke)
            else:
                stroke = Image.new('RGBA', image.size, parameters['color'])
                stroke.putalpha(outer)
                image = Image.alpha_composite(stroke, image)
        image.save(output)
        return [output]
    if name == 'image.matte':
        from .legacy.processor import process_matte
        process_matte(paths[0], output, alpha_matting=parameters['strength'] > 0.5)
        return [output]
    if name == 'video.extract':
        from .legacy.processor import run_pipeline
        original = {'fps': parameters['fps'], 'frame_range': {'start_sec': parameters['start'], 'end_sec': parameters['end']},
                    'max_frames': parameters['maxFrames'], 'target_size': {'w': parameters['width'], 'h': parameters['height']},
                    'transparent': parameters['transparent'], 'padding': parameters['padding'], 'spacing': parameters['spacing'],
                    'columns': parameters['columns'], 'crop_mode': parameters['crop'], 'layout_mode': parameters['layout'],
                    'matte_strength': parameters['matteStrength'], 'bg_color': parameters['background']}
        result = run_pipeline('media', str(paths[0]), str(directory), str(directory / 'temp'), original)
        return [Path(result[key]) for key in ['sprite_sheet_path', 'zip_path', 'index_path']]
    if name == 'video.watermark':
        from .legacy.watermark_remover import remove_watermark
        output = directory / 'clean.mp4'
        if not remove_watermark(str(paths[0]), str(output), on_progress=lambda current, total: progress(current / max(total, 1))):
            raise RoninError('WATERMARK_NOT_DETECTED', 'No removable watermark was detected in this video.')
        return [output]
    if name == 'audio.compress':
        archive = directory / 'audio.zip'
        outputs = []
        records = []
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            for index, path in enumerate(paths):
                import re
                version = preview['versions'][index]
                base = re.sub(r'[\\/:\x00-\x1f]', '_', Path(version.get('name', path.name)).stem).strip(' .')[:120] or 'audio'
                target = directory / f'{index + 1:04d}-{base}_{parameters["bitrate"]}kbps.mp3'
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(path), '-b:a',
                                f"{parameters['bitrate']}k", str(target)], check=True, capture_output=True)
                bundle.write(target, target.name)
                outputs.append(target)
                records.append({'inputVersion': version['id'], 'file': target.name, 'bitrateKbps': parameters['bitrate']})
                progress((index + 1) / len(paths))
        report = directory / 'audio-report.json'
        report.write_text(json.dumps({'encoder': 'ffmpeg-libmp3lame', 'files': records}))
        return outputs + [archive, report]
    if name in ['gif.split', 'image.slice', 'sequence.zip']:
        frames = directory / 'frames'
        frames.mkdir()
        records = []
        archive = directory / 'frames.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            def add(image, duration):
                target = frames / f'{len(records):04d}.png'
                image.save(target)
                bundle.write(target, target.name)
                records.append({'file': target.name, 'durationMs': duration, 'width': image.width, 'height': image.height})
            if name == 'gif.split':
                with Image.open(paths[0]) as image:
                    for index in range(image.n_frames):
                        image.seek(index)
                        add(image.convert('RGBA'), int(image.info.get('duration', 100)))
                        progress((index + 1) / image.n_frames)
            elif name == 'image.slice':
                with Image.open(paths[0]) as image:
                    for row in range(parameters['rows']):
                        for col in range(parameters['columns']):
                            bounds = (col * image.width // parameters['columns'], row * image.height // parameters['rows'],
                                      (col + 1) * image.width // parameters['columns'], (row + 1) * image.height // parameters['rows'])
                            if bounds[2] == bounds[0] or bounds[3] == bounds[1]:
                                raise RoninError('SLICE_EMPTY', 'The grid creates an empty slice.')
                            add(image.crop(bounds).convert('RGBA'), 100)
            else:
                for index, path in enumerate(paths):
                    with Image.open(path) as image:
                        add(image.convert('RGBA'), parameters['duration'])
                    progress((index + 1) / len(paths))
            bundle.writestr('index.json', json.dumps({'frames': records}))
        index_path = directory / 'index.json'
        index_path.write_text(json.dumps({'frames': records}, indent=2))
        return [archive, index_path]
    if name == 'sequence.sheet':
        width = max(v['metadata']['width'] for v in preview['versions']) + parameters['padding'] * 2
        height = max(v['metadata']['height'] for v in preview['versions']) + parameters['padding'] * 2
        cols, spacing = parameters['columns'], parameters['spacing']
        rows = math.ceil(len(paths) / cols)
        sheet = Image.new('RGBA', (cols * (width + spacing) - spacing, rows * (height + spacing) - spacing))
        records = []
        for index, path in enumerate(paths):
            with Image.open(path) as source:
                image = source.convert('RGBA')
                x = index % cols * (width + spacing) + (width - image.width) // 2
                y = index // cols * (height + spacing) + (height - image.height) // 2
                sheet.alpha_composite(image, (x, y))
                records.append({'index': index, 'x': x, 'y': y, 'width': image.width, 'height': image.height})
            progress((index + 1) / len(paths))
        sheet.save(output)
        index_path = directory / 'index.json'
        index_path.write_text(json.dumps({'frames': records}, indent=2))
        return [output, index_path]
    if name == 'sequence.gif':
        # A single fixed palette, including a reserved transparent slot, keeps frame colors stable.
        images = []
        size = preview['versions'][0]['metadata']['width'], preview['versions'][0]['metadata']['height']
        for path in paths:
            with Image.open(path) as source:
                if source.size != size:
                    raise RoninError('FRAME_SIZE_MISMATCH', 'GIF frames must have identical dimensions.')
                images.append(source.convert('RGBA'))
        palette_source = Image.new('RGB', (size[0], size[1] * len(images)))
        for index, image in enumerate(images):
            palette_source.paste(image.convert('RGB'), (0, index * size[1]))
        palette = palette_source.quantize(colors=255)
        data = palette.getpalette()[:765] + [0, 0, 0]
        palette.putpalette(data)
        converted = []
        for image in images:
            frame = image.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE)
            frame.paste(255, mask=image.getchannel('A').point(lambda alpha: 255 if alpha < 128 else 0))
            frame.info['transparency'] = 255
            converted.append(frame)
        output = directory / 'result.gif'
        converted[0].save(output, save_all=True, append_images=converted[1:], duration=parameters['duration'],
                          loop=parameters['loop'], transparency=255, disposal=2, optimize=False)
        return [output]
    raise RoninError('OPERATION_UNIMPLEMENTED', 'The selected operation is not implemented.')
