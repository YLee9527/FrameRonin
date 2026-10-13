"""Strict proposals use the same operation schema as the JavaScript runner."""
import json
import math
from pathlib import Path
from .errors import RoninError

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = json.loads((ROOT / 'assets/workflow-operations.json').read_text())['operations']


def fields(value, allowed, required):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise RoninError('WORKFLOW_FIELDS_INVALID', 'A workflow contains missing or unknown fields.')


def validate(graph, count):
    fields(graph, ['version', 'nodes', 'edges', 'presetName'], ['version', 'nodes', 'edges'])
    if graph['version'] != 7 or not isinstance(graph['nodes'], list) or not 1 <= len(graph['nodes']) <= 200 or not isinstance(graph['edges'], list) or len(graph['edges']) > 400:
        raise RoninError('WORKFLOW_SIZE_OR_VERSION', 'Strict proposals require graph version 7 and bounded nodes.')
    if 'presetName' in graph and (not isinstance(graph['presetName'], str) or len(graph['presetName']) > 120):
        raise RoninError('WORKFLOW_NAME_INVALID', 'The preset name is invalid.')
    ids, nodes = set(), {}
    import re
    def unique(value):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) or value in ids:
            raise RoninError('WORKFLOW_ID_INVALID', 'Workflow IDs must be valid and unique.')
        ids.add(value)
    for node in graph['nodes']:
        fields(node, ['id', 'type', 'params', 'x', 'y', 'rearrangeGrid'], ['id', 'type', 'params'])
        unique(node['id'])
        if not isinstance(node['type'], str) or node['type'] not in REGISTRY:
            raise RoninError('WORKFLOW_OPERATION_UNKNOWN', 'Unknown workflow operations are rejected.')
        spec = REGISTRY[node['type']]
        fields(node['params'], spec['parameters'], [])
        parameters = {}
        for key, schema in spec['parameters'].items():
            value = node['params'].get(key, schema['default'])
            if type(value) not in [int, float] or not math.isfinite(value) or not schema['minimum'] <= value <= schema['maximum'] or (schema['type'] == 'integer' and int(value) != value):
                raise RoninError('WORKFLOW_PARAMETER_INVALID', 'A workflow parameter is invalid.', {'parameter': key})
            parameters[key] = value
        for key in ['x', 'y']:
            if key in node and (type(node[key]) not in [int, float] or not math.isfinite(node[key]) or abs(node[key]) > 100000):
                raise RoninError('WORKFLOW_POSITION_INVALID', 'A node position is invalid.')
        if node['type'] == 'workflowInputImage' and parameters['imageIndex'] > count:
            raise RoninError('WORKFLOW_INPUT_MISSING', 'The graph references an unselected input.')
        for key, dimension in [('rowIndex', 'gRows'), ('colIndex', 'gCols'), ('atRow', 'gRows'), ('atCol', 'gCols')]:
            if key in parameters and parameters[key] > parameters[dimension] + int(key.startswith('at')):
                raise RoninError('WORKFLOW_GRID_INDEX_INVALID', 'A grid index exceeds its dimensions.')
        if node['type'] == 'customGridRearrange':
            grid = node.get('rearrangeGrid')
            if not isinstance(grid, list) or len(grid) != parameters['outRows'] or any(
                not isinstance(row, list) or len(row) != parameters['outCols'] or any(
                    type(cell) is not int or abs(cell) > parameters['splitCols'] * parameters['splitRows'] for cell in row) for row in grid):
                raise RoninError('WORKFLOW_REARRANGE_INVALID', 'The rearrangement grid is invalid.')
        elif 'rearrangeGrid' in node:
            raise RoninError('WORKFLOW_REARRANGE_UNEXPECTED', 'This operation does not accept a rearrangement grid.')
        nodes[node['id']] = {**node, 'params': parameters}
    indegree = {key: 0 for key in nodes}
    outgoing = {key: [] for key in nodes}
    ports = set()
    for edge in graph['edges']:
        fields(edge, ['id', 'source', 'target', 'targetPort'], ['id', 'source', 'target'])
        unique(edge['id'])
        source, target = edge['source'], edge['target']
        if not isinstance(source, str) or not isinstance(target, str) or source not in nodes or target not in nodes or source == target:
            raise RoninError('WORKFLOW_EDGE_REFERENCE_INVALID', 'An edge references a missing node.')
        port = edge.get('targetPort', '')
        node = nodes[target]
        if port not in REGISTRY[node['type']]['ports']:
            raise RoninError('WORKFLOW_PORT_INVALID', 'An edge references an invalid input port.')
        if node['type'] == 'simpleStitchVertical' and int(port[2:]) > node['params']['stitchSlotCount']:
            raise RoninError('WORKFLOW_STITCH_PORT_RANGE', 'A stitching port exceeds the configured slot count.')
        if (target, port) in ports:
            raise RoninError('WORKFLOW_PORT_DUPLICATE', 'Two edges target the same input port.')
        ports.add((target, port))
        indegree[target] += 1
        outgoing[source].append(target)
        if len(outgoing[source]) > 1:
            raise RoninError('WORKFLOW_MULTIPLE_OUTPUT', 'The existing graph semantics allow one outgoing edge per node.')
    if any(node['type'] == 'matteDoubleBackground' and indegree[key] != 2 for key, node in nodes.items()):
        raise RoninError('WORKFLOW_DOUBLE_BG_INCOMPLETE', 'Dual-background nodes need both selected inputs.')
    queue = [key for key, value in indegree.items() if value == 0]
    visited = []
    while queue:
        key = queue.pop()
        visited.append(key)
        for target in outgoing[key]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if len(visited) != len(nodes):
        raise RoninError('WORKFLOW_CYCLE', 'Cycles are not allowed.')
    if len([key for key in nodes if not outgoing[key]]) != 1:
        raise RoninError('WORKFLOW_OUTPUT_INVALID', 'An AI graph needs exactly one connected output.')
    return {'nodes': list(nodes.values()), 'edges': graph['edges'], 'version': 7, **({'presetName': graph['presetName']} if 'presetName' in graph else {})}
