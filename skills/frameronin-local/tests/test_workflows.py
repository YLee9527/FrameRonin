import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from frameronin_engine.workflows import validate
from frameronin_engine.errors import RoninError


class StrictWorkflowTests(unittest.TestCase):
    def graph(self):
        return {'version': 7, 'nodes': [
            {'id': 'input', 'type': 'workflowInputImage', 'params': {'imageIndex': 1}},
            {'id': 'resize', 'type': 'resize', 'params': {'w': 64, 'h': 64}}],
            'edges': [{'id': 'edge', 'source': 'input', 'target': 'resize'}]}

    def test_valid_defaults_and_selected_input(self):
        graph = validate(self.graph(), 1)
        self.assertEqual(graph['nodes'][1]['params']['pixelated'], 1)
        with self.assertRaises(RoninError):
            validate(self.graph(), 0)

    def test_malformed_graph_never_silently_drops_content(self):
        base = self.graph()
        cases = []
        graph = copy.deepcopy(base); graph['nodes'][1]['type'] = 'runCommand'; cases.append(graph)
        graph = copy.deepcopy(base); graph['nodes'][1]['params']['shell'] = 1; cases.append(graph)
        graph = copy.deepcopy(base); graph['nodes'][1]['id'] = 'input'; cases.append(graph)
        graph = copy.deepcopy(base); graph['edges'][0]['source'] = 'missing'; cases.append(graph)
        graph = copy.deepcopy(base); graph['edges'][0]['targetPort'] = 'inA'; cases.append(graph)
        graph = copy.deepcopy(base); graph['nodes'][1]['params']['w'] = float('nan'); cases.append(graph)
        graph = copy.deepcopy(base); graph['nodes'][1]['params']['w'] = 8193; cases.append(graph)
        graph = copy.deepcopy(base); graph['nodes'][1]['params']['w'] = True; cases.append(graph)
        graph = copy.deepcopy(base); graph['edges'].append(dict(graph['edges'][0], id='edge2')); cases.append(graph)
        graph = copy.deepcopy(base); graph['nodes'].append({'id':'disconnected','type':'crop','params':{}}); cases.append(graph)
        for graph in cases:
            with self.subTest(graph=graph), self.assertRaises(RoninError):
                validate(graph, 1)

    def test_cycles_and_required_dual_ports(self):
        graph = {'version': 7, 'nodes': [{'id':'a','type':'crop','params':{}},{'id':'b','type':'crop','params':{}}],
                 'edges': [{'id':'ab','source':'a','target':'b'},{'id':'ba','source':'b','target':'a'}]}
        with self.assertRaises(RoninError): validate(graph, 1)

    def test_stitch_shared_and_named_ports(self):
        graph = {'version': 7, 'nodes': [
            {'id':'a','type':'workflowInputImage','params':{'imageIndex':1}},
            {'id':'b','type':'workflowInputImage','params':{'imageIndex':2}},
            {'id':'s','type':'simpleStitchVertical','params':{'stitchMode':2}}],
            'edges':[{'id':'a-s','source':'a','target':'s'},{'id':'b-s','source':'b','target':'s'}]}
        validate(graph, 2)
        graph['edges'][0]['targetPort'] = 'in1'; graph['edges'][1]['targetPort'] = 'in2'
        validate(graph, 2)
        del graph['edges'][0]['targetPort']
        with self.assertRaises(RoninError): validate(graph, 2)
        graph = self.graph(); graph['nodes'][1] = {'id':'resize','type':'matteDoubleBackground','params':{}}
        graph['edges'][0]['targetPort'] = 'inA'
        with self.assertRaises(RoninError): validate(graph, 1)


if __name__ == '__main__': unittest.main()
