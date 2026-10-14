"""Strict map export layout checks and aggregate resource forecasts."""
import math
import re
from .errors import RoninError


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise RoninError('MAP_FIELDS_INVALID', 'Map exports require exactly the documented fields.')


def finite(value, low, high):
    return type(value) in [int, float] and math.isfinite(value) and low <= value <= high


def tile(value):
    fields(value, ['x', 'y', 'w', 'h'])
    if not all(finite(value[k], -1000, 1000) for k in ['x', 'y']) or not all(finite(value[k], .001, 100) for k in ['w', 'h']):
        raise RoninError('MAP_TILE_INVALID', 'Map tile coordinates or dimensions are outside the supported range.')


def estimate(parameters, versions, template=False):
    layout = parameters['layout']
    fields(layout, ['sourceName', 'width', 'height', 'horizontalOverlapPercent', 'verticalOverlapPercent', 'layers'])
    if not isinstance(layout['sourceName'], str) or not 1 <= len(layout['sourceName']) <= 255 or re.search(r'[\\/\x00-\x1f]', layout['sourceName']):
        raise RoninError('MAP_NAME_INVALID', 'The map source name must be a plain filename.')
    source = versions[0]['metadata']
    if layout['width'] != source['width'] or layout['height'] != source['height'] or any(type(layout[k]) is not int for k in ['width', 'height']):
        raise RoninError('MAP_SOURCE_DIMENSIONS', 'Map dimensions must match the selected source version.')
    if not all(finite(layout[k], 0, 50) for k in ['horizontalOverlapPercent', 'verticalOverlapPercent']):
        raise RoninError('MAP_OVERLAP_INVALID', 'Map overlaps must be between zero and fifty percent.')
    layers = layout['layers']
    if not isinstance(layers, list) or not 1 <= len(layers) <= 1000:
        raise RoninError('MAP_LAYER_LIMIT', 'A map export supports one to one thousand completed tiles.')
    keys, indices = set(), set()
    for index, layer in enumerate(layers):
        fields(layer, ['inputIndex', 'key', 'tile', 'feather'])
        tile(layer['tile'])
        key = layer['key']
        if not isinstance(key, str) or not re.fullmatch(r'-?\d+(?:\.\d{1,4})?,-?\d+(?:\.\d{1,4})?', key) or key in keys:
            raise RoninError('MAP_KEY_INVALID', 'Map tiles require unique coordinate keys.')
        coordinates = [float(value) for value in key.split(',')]
        canonical = ','.join('0' if value == 0 else format(value, '.4f').rstrip('0').rstrip('.') for value in coordinates)
        if key != canonical:
            raise RoninError('MAP_KEY_INVALID', 'Map coordinate keys must use canonical four-digit decimals.')
        if any(abs(coordinates[i] - layer['tile'][axis]) > .000051 for i, axis in enumerate(['x', 'y'])):
            raise RoninError('MAP_KEY_INVALID', 'A tile key does not match its coordinates.')
        input_index = layer['inputIndex']
        if type(input_index) is not int or not 0 <= input_index < len(versions) or input_index in indices:
            raise RoninError('MAP_INPUT_INVALID', 'Map layers must reference selected inputs exactly once.')
        if index == 0 and (key != '0,0' or input_index != 0 or layer['tile'] != {'x': 0, 'y': 0, 'w': 1, 'h': 1}):
            raise RoninError('MAP_CENTER_INVALID', 'The first map layer must be its unchanged source rectangle.')
        fields(layer['feather'], ['top', 'right', 'bottom', 'left'])
        if not all(finite(value, 0, 50) for value in layer['feather'].values()):
            raise RoninError('MAP_FEATHER_INVALID', 'Feather percentages must be between zero and fifty.')
        keys.add(key); indices.add(input_index)
    if indices != set(range(len(versions))):
        raise RoninError('MAP_INPUT_UNUSED', 'Every selected image must have one map layer.')
    tiles = [layer['tile'] for layer in layers]
    if template:
        target = parameters['target']; tile(target)
        span_x, span_y = target['w'], target['h']
    else:
        span_x = max(t['x'] + t['w'] for t in tiles) - min(t['x'] for t in tiles)
        span_y = max(t['y'] + t['h'] for t in tiles) - min(t['y'] for t in tiles)
    width, height = max(1, math.floor(span_x * layout['width'] + .5)), max(1, math.floor(span_y * layout['height'] + .5))
    if parameters.get('format') != 'godot' and (width > 30000 or height > 30000):
        raise RoninError('MAP_EXPORT_DIMENSION_LIMIT', 'Reduce the map export area to at most 30000 pixels per side.')
    if any(t['w'] * layout['width'] > 30000 or t['h'] * layout['height'] > 30000 for t in tiles):
        raise RoninError('MAP_LAYER_DIMENSION_LIMIT', 'Each rendered map tile must be at most 30000 pixels per side.')
    rendered = sum(max(1, math.floor(t['w'] * layout['width'] + .5)) * max(1, math.floor(t['h'] * layout['height'] + .5)) for t in tiles)
    # Include all native image decodes, PSD channels/ZIP buffers, composite and
    # frontend image/history copies reserved by the workbench. Never tile a global blend independently.
    decoded = sum(v['metadata']['width'] * v['metadata']['height'] for v in versions)
    composite = 0 if parameters.get('format') == 'godot' else width * height
    return 256 * 1024**2 + parameters['frontendBytes'] + decoded * 32 + rendered * 32 + composite * 32
