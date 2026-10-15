import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
import psutil
import wave
import math
import struct
import subprocess
import hashlib
import zipfile
from unittest.mock import patch, Mock
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from frameronin_engine.project import Project, identifier
from frameronin_engine.errors import RoninError, Cancelled
from frameronin_engine.operations import preview
from frameronin_engine.tasks import submit, task, wait, cancel


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='frameronin-test-')
        self.root = Path(self.directory.name)
        self.project = Project.create(self.root / 'project')
        self.source = self.root / 'source.png'
        image = Image.new('RGBA', (16, 12), (0, 0, 0, 0))
        image.putpixel((2, 3), (255, 30, 20, 255))
        image.save(self.source)
        self.version = self.project.import_file(self.source)

    def tearDown(self):
        # Publication precedes worker exit and dispatcher bookkeeping. Wait for
        # this test project's queue acknowledgments before deleting its database.
        from frameronin_engine.queue import connection as queue_connection
        deadline = time.monotonic() + 10
        while True:
            with queue_connection() as database:
                jobs = database.execute('SELECT task FROM jobs WHERE project=?', (str(self.project.root),)).fetchall()
            if not jobs:
                break
            for job in jobs:
                record = task(self.project, job['task'])
                if record['state'] in ['queued', 'running']:
                    cancel(self.project, job['task'])
            if time.monotonic() >= deadline:
                self.fail('The test project still has unacknowledged dispatcher jobs; retain it for diagnosis')
            time.sleep(.02)
        self.directory.cleanup()

    def test_version_manifest_preserves_order_and_rejects_unscoped_ids(self):
        from frameronin_engine.server import application
        app = application(self.project, 8765)
        manifest = next(route.endpoint for route in app.routes if route.path == '/api/versions/manifest')
        other = self.project.import_file(self.source)
        values = manifest({'versions': [other['id'], self.version['id']]})
        self.assertEqual([value['id'] for value in values], [other['id'], self.version['id']])
        self.assertTrue(all(set(value) == {'id', 'name', 'metadata'} for value in values))
        for payload in [{}, {'versions': []}, {'versions': [self.version['id']]*2},
                        {'versions': ['../source.png']}, {'versions': [identifier()]},
                        {'versions': [self.version['id']], 'path': str(self.source)},
                        {'versions': [1]}, {'versions': [identifier() for _ in range(8193)]}]:
            with self.assertRaises(RoninError):
                manifest(payload)
        with patch('frameronin_engine.server.memory_budget', return_value=16):
            with self.assertRaises(RoninError):
                manifest({'versions': [self.version['id']]})

    def test_map_layout_permissions_resources_and_formal_outputs(self):
        feather = {'top':0,'right':0,'bottom':0,'left':0}
        layout = {'sourceName':'source.png','width':16,'height':12,'horizontalOverlapPercent':15,'verticalOverlapPercent':15,
                  'layers':[{'inputIndex':0,'key':'0,0','tile':{'x':0,'y':0,'w':1,'h':1},'feather':feather}]}
        payload = {'operation':'map.export','inputs':[self.version['id']],'parameters':{'layout':layout,'format':'godot'}}
        preview(self.project,payload)
        changes = [lambda v:v['layers'][0].update(inputIndex=1),lambda v:v['layers'][0].update(command='run'),
                   lambda v:v.update(width=32),lambda v:v.update(sourceName='../secret.png'),
                   lambda v:v['layers'][0]['feather'].update(left=51)]
        for change in changes:
            invalid=json.loads(json.dumps(payload));change(invalid['parameters']['layout'])
            with self.assertRaises(RoninError):preview(self.project,invalid)
        invalid=json.loads(json.dumps(payload));invalid['parameters']['frontendBytes']=2*1024**3
        with self.assertRaises(RoninError):preview(self.project,invalid)
        submitted=submit(self.project,payload);result=wait(self.project,submitted['id'],15)
        self.assertEqual(result['state'],'succeeded',result)
        versions=[self.project.version(version) for version in result['results']]
        archive=next(version for version in versions if version['metadata']['extension']=='.zip')
        with zipfile.ZipFile(archive['absolutePath']) as zip:
            self.assertIn('map_stitch_godot.tscn',zip.namelist())
            self.assertFalse(any(name.endswith(('.gd','.cs','.gdextension')) for name in zip.namelist()))
            manifest=json.loads(zip.read('map_stitch_godot.json'))
            self.assertEqual(manifest['canvas'],{'width':16,'height':12})
        self.assertTrue(self.project.verify()['valid'])

    def test_ronin_document_kinds_reopen_stable_refs_and_keep_revision_conflicts(self):
        before=len(self.project.assets())
        for kind,tool,parameters in [('ronin-scale','customScale',{'width':256,'height':256,'keepAspect':True,'pixelated':True,'matteAlgorithm':'contiguous','nonContiguousTolerance':5}),
            ('ronin-unify','unifySize',{'columns':4,'horizontal':'center','vertical':'bottom'}),('ronin-duplicates','findDuplicates',{'columns':8,'rows':4})]:
            document_id=identifier()
            payload={'formatVersion':1,'tool':tool,'parameters':parameters,'files':[{'versionId':self.version['id'],'name':'source.png','type':'image/png'}],
                'results':[],'reportFile':None,'editedFile':None,'taskId':None}
            saved=self.project.save_document(document_id,kind,payload,0);self.assertEqual(saved['revision'],1)
            reopened=Project(self.project.root).document(document_id);self.assertEqual(reopened['payload'],payload)
            with self.assertRaises(RoninError):self.project.save_document(document_id,kind,payload,0)
            with self.assertRaises(RoninError):self.project.save_document(document_id,'image',payload,1)
        self.assertEqual(len(self.project.assets()),before)

    def test_watermark_keeps_original_decoded_video_audio_and_resource_boundary(self):
        fixtures = Path(__file__).resolve().parents[1] / 'assets/fixtures/watermark'
        source = self.project.import_file(fixtures / 'source.mp4')
        payload = {'operation':'video.watermark','inputs':[source['id']],'parameters':{}}
        estimate=preview(self.project,payload)['estimatedBytes']
        self.assertGreaterEqual(estimate,256*256*(60*3*4*3+64))
        excess = {**payload,'parameters':{'frontendBytes':2*1024**3}}
        with self.assertRaises(RoninError):
            preview(self.project,excess)
        with patch('frameronin_engine.legacy.processor.get_video_info',return_value={'width':64,'height':32}):
            with self.assertRaises(RoninError) as rejected:
                preview(self.project,payload)
            self.assertEqual(rejected.exception.code,'WATERMARK_DIMENSION_LIMIT')
        submitted = submit(self.project,payload)
        result = wait(self.project,submitted['id'],20)
        self.assertEqual(result['state'],'succeeded',result)
        output = self.project.version(result['results'][0])
        def decoded(path,stream):
            options = ['-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24'] if stream=='video' else ['-map','0:a:0','-f','s16le','-acodec','pcm_s16le']
            return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),*options,'pipe:1'])
        self.assertEqual(decoded(output['absolutePath'],'video'),decoded(fixtures/'original-clean.mp4','video'))
        self.assertEqual(decoded(output['absolutePath'],'audio'),decoded(fixtures/'source.mp4','audio'))
        self.assertEqual(output['metadata']['width'],256)
        self.assertEqual(output['metadata']['height'],256)
        self.assertFalse(list(Path(output['absolutePath']).parent.glob('seedance_wm_*')))
        blank=self.root/'no-corner.mp4'
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=0x1e4669:s=256x256:r=8:d=1',
                        '-c:v','libx264','-pix_fmt','yuv420p',str(blank)],check=True)
        blank_version=self.project.import_file(blank)
        rejected=wait(self.project,submit(self.project,{**payload,'inputs':[blank_version['id']]})['id'],15)
        self.assertEqual(rejected['state'],'failed')
        self.assertEqual(rejected['error']['code'],'WATERMARK_NOT_DETECTED')
        self.assertEqual(rejected['results'],[])
        self.assertTrue(self.project.verify()['valid'])

    def test_pixel_operations_keep_original_outputs_regions_and_strict_resource_checks(self):
        fixtures=Path(__file__).resolve().parents[1]/'assets/fixtures/pixel'
        source=self.project.import_file(fixtures/'source.png')
        cases=json.loads((fixtures/'manifest.json').read_text())['cases']
        selected={'block-8','merge-40','palette-lab-true','perfect-region','pixellise-opaque','pixellise-transparent'}
        for case in cases:
            if case['id'] not in selected:continue
            payload={'operation':case['operation'],'parameters':case['parameters'],'inputs':[source['id']]}
            for invalid in [{'regionX':1},{'regionWidth':129,'regionHeight':96},{'frontendBytes':2*1024**3},{'command':'run'}]:
                values={**case['parameters'],**invalid}
                if invalid=={'regionX':1}:values.update(regionWidth=0,regionHeight=0)
                with self.assertRaises(RoninError):preview(self.project,{**payload,'parameters':values})
            result=wait(self.project,submit(self.project,payload)['id'],20)
            self.assertEqual(result['state'],'succeeded',result)
            versions=[self.project.version(v) for v in result['results']]
            output=next(v for v in versions if v['metadata']['extension']=='.png')
            with Image.open(output['absolutePath']) as actual,Image.open(fixtures/('original-'+case['id']+'.png')) as expected:
                self.assertEqual(actual.size,expected.size)
                a,b=actual.convert('RGBA').tobytes(),expected.convert('RGBA').tobytes()
                if case['operation']=='image.pixelate':self.assertLessEqual(max(abs(x-y) for x,y in zip(a,b)),1)
                else:self.assertEqual(a,b)
            report=next(v for v in versions if v['metadata']['extension']=='.json')
            metadata=json.loads(Path(report['absolutePath']).read_text())
            self.assertEqual(metadata['processingDimensions'],{'width':64,'height':48} if case['id']=='perfect-region' else {'width':128,'height':96})

    def test_ronin_native_tools_match_original_presets_alignments_and_duplicate_frames(self):
        import numpy as np
        fixtures=Path(__file__).resolve().parents[1]/'assets/fixtures/ronin'
        manifest=json.loads((fixtures/'manifest.json').read_text());imports={}
        for case in manifest['cases']:
            if case['parameters'].get('pixelated') is False:continue
            inputs=[]
            for name in case['inputs']:
                if name not in imports:imports[name]=self.project.import_file(fixtures/name)
                inputs.append(imports[name]['id'])
            payload={'operation':case['operation'],'inputs':inputs,'parameters':case['parameters']}
            result=wait(self.project,submit(self.project,payload)['id'],20)
            self.assertEqual(result['state'],'succeeded',result)
            versions=[self.project.version(v) for v in result['results']]
            outputs=[v for v in versions if v['metadata']['kind']=='image']
            for index,version in enumerate(outputs):
                with Image.open(version['absolutePath']) as actual,Image.open(fixtures/'original'/case['id']/f'{index}.png') as expected:
                    self.assertEqual(actual.size,expected.size)
                    np.testing.assert_array_equal(np.array(actual.convert('RGBA')),np.array(expected.convert('RGBA')))
            if case['operation']=='image.findDuplicates':
                report=json.loads(Path(next(v for v in versions if v['metadata']['extension']=='.json')['absolutePath']).read_text())
                expected=json.loads((fixtures/'original'/case['id']/'report.json').read_text())
                self.assertEqual({key:report[key] for key in expected},expected)
        for operation,parameters in [('image.customScale',{'pixelated':False}),('image.customScale',{'width':4097}),
            ('image.customScale',{'mode':'unknown'}),('image.customScale',{'mode':'ffff','renderer':'browser-worker'}),
            ('sequence.unifySize',{'horizontal':'middle'}),('image.findDuplicates',{'rows':65}),('image.findDuplicates',{'frontendBytes':2*1024**3})]:
            with self.assertRaises(RoninError):preview(self.project,{'operation':operation,'inputs':[self.version['id']],'parameters':parameters})
        self.assertTrue(self.project.verify()['valid'])

    def test_browser_pixels_use_owned_queue_generation_and_late_results_cannot_publish(self):
        from frameronin_engine.browser_tasks import ready,heartbeat,accept
        payload={'operation':'image.customScale','inputs':[self.version['id']],
            'parameters':{'width':37,'height':29,'pixelated':False,'renderer':'browser-worker'}}
        with self.assertRaises(RoninError):submit(self.project,payload)
        self.assertTrue(preview(self.project,payload)['requiresWorkbench'])
        first=submit(self.project,payload,browser_client=True);deadline=time.monotonic()+10
        while not ready(self.project,first['id'])['ready']:
            self.assertLess(time.monotonic(),deadline);time.sleep(.05)
        heartbeat(self.project,first['id'],0)
        with self.assertRaises(RoninError):accept(self.project,first['id'],0,self.source)
        source=self.root/'browser-output.png';Image.new('RGBA',(37,29),(200,30,60,128)).save(source)
        accept(self.project,first['id'],0,source)
        result=wait(self.project,first['id'],10);self.assertEqual(result['state'],'succeeded',result)
        self.assertEqual(len(result['results']),2)
        with self.assertRaises(Cancelled):accept(self.project,first['id'],0,source)
        second=submit(self.project,payload,browser_client=True);deadline=time.monotonic()+10
        while not ready(self.project,second['id'])['ready']:
            self.assertLess(time.monotonic(),deadline);time.sleep(.05)
        accepted=cancel(self.project,second['id']);self.assertEqual(accepted['generation'],1)
        with self.assertRaises(Cancelled):accept(self.project,second['id'],0,source)
        with self.assertRaises(Cancelled):heartbeat(self.project,second['id'],0)
        self.assertEqual(task(self.project,second['id'])['results'],[])
        with self.assertRaises(RoninError):ready(self.project,'../../outside')
        third=submit(self.project,payload,browser_client=True);deadline=time.monotonic()+10
        while not ready(self.project,third['id'])['ready']:
            self.assertLess(time.monotonic(),deadline);time.sleep(.05)
        import os
        lease=self.project.safe(f"tasks/{third['id']}/output/browser-heartbeat")
        os.utime(lease,(time.time()-30,time.time()-30))
        disconnected=wait(self.project,third['id'],5)
        self.assertEqual(disconnected['state'],'failed');self.assertEqual(disconnected['error']['code'],'BROWSER_WORKER_DISCONNECTED')
        self.assertEqual(disconnected['results'],[])
        self.assertTrue(self.project.verify()['valid'])

    def test_browser_gif_runtime_preserves_frames_delays_and_strict_policies(self):
        second = self.root / 'second.png'
        Image.new('RGBA', (8, 8), (20, 220, 40, 255)).save(second)
        other = self.project.import_file(second)
        payload = {'operation':'sequence.gif','inputs':[self.version['id'],other['id']],
                   'parameters':{'renderer':'browser','duration':120,'sizePolicy':'first'}}
        self.assertEqual(preview(self.project,payload)['processingMode'],'per_frame_browser_palette')
        for change in [{'sizePolicy':'reject'}, {'loop':1}, {'frontendBytes':2*1024**3}]:
            invalid=json.loads(json.dumps(payload));invalid['parameters'].update(change)
            with self.assertRaises(RoninError):preview(self.project,invalid)
        encoded=wait(self.project,submit(self.project,payload)['id'],15)
        self.assertEqual(encoded['state'],'succeeded',encoded)
        gif=next(self.project.version(v) for v in encoded['results'] if self.project.version(v)['metadata']['extension']=='.gif')
        self.assertEqual(gif['metadata']['frames'],2)
        self.assertEqual(gif['metadata']['durationsMs'],[120,120])
        self.assertEqual((gif['metadata']['width'],gif['metadata']['height']),(16,12))
        split=wait(self.project,submit(self.project,{'operation':'gif.split','inputs':[gif['id']],
                   'parameters':{'renderer':'browser'}})['id'],15)
        self.assertEqual(split['state'],'succeeded',split)
        images=[self.project.version(v) for v in split['results'] if self.project.version(v)['metadata']['kind']=='image']
        self.assertEqual(len(images),2)
        archive=next(self.project.version(v) for v in split['results'] if self.project.version(v)['metadata']['extension']=='.zip')
        with zipfile.ZipFile(archive['absolutePath']) as zipped:
            self.assertEqual(zipped.namelist(),['frame_000.png','frame_001.png'])
            self.assertEqual(zipped.read('frame_000.png'),Path(images[0]['absolutePath']).read_bytes())
        static=self.root/'static.gif';Image.new('RGB',(4,4),'red').save(static)
        single=self.project.import_file(static)
        self.assertEqual(single['metadata']['kind'],'image')
        self.assertEqual(preview(self.project,{'operation':'gif.split','inputs':[single['id']],'parameters':{}})['operation'],'gif.split')
        single_split=wait(self.project,submit(self.project,{'operation':'gif.split','inputs':[single['id']],
            'parameters':{'renderer':'browser'}})['id'],15)
        self.assertEqual(single_split['state'],'succeeded',single_split)
        self.assertEqual(sum(self.project.version(v)['metadata']['kind']=='image' for v in single_split['results']),1)
        with self.assertRaises(RoninError):preview(self.project,{'operation':'gif.split','inputs':[self.version['id']],'parameters':{}})
        disguised=self.root/'renamed.gif';disguised.write_bytes(self.source.read_bytes());renamed=self.project.import_file(disguised)
        with self.assertRaises(RoninError):preview(self.project,{'operation':'gif.split','inputs':[renamed['id']],'parameters':{}})
        self.assertTrue(self.project.verify()['valid'])

    def test_browser_gif_matches_original_oracle_at_resized_transparent_edges(self):
        fixtures=Path(__file__).resolve().parents[1]/'assets/fixtures/gif'
        inputs=[self.project.import_file(fixtures/f'frame-{i:03d}.png')['id'] for i in range(3)]
        result=wait(self.project,submit(self.project,{'operation':'sequence.gif','inputs':inputs,
            'parameters':{'renderer':'browser','sizePolicy':'first','duration':120}})['id'],15)
        self.assertEqual(result['state'],'succeeded',result)
        gif=next(self.project.version(v) for v in result['results'] if self.project.version(v)['metadata']['extension']=='.gif')
        self.assertEqual(Path(gif['absolutePath']).read_bytes(),(fixtures/'original-browser-encoded.gif').read_bytes())
        source=self.project.import_file(fixtures/'disposal.gif')
        split=wait(self.project,submit(self.project,{'operation':'gif.split','inputs':[source['id']],
            'parameters':{'renderer':'browser'}})['id'],15)
        self.assertEqual(split['state'],'succeeded',split)
        images=[self.project.version(v) for v in split['results'] if self.project.version(v)['metadata']['kind']=='image']
        self.assertEqual(len(images),4)
        for index,image in enumerate(images):
            with Image.open(image['absolutePath']) as actual,Image.open(fixtures/f'original-decoded-{index:03d}.png') as original:
                self.assertEqual(actual.convert('RGBA').tobytes(),original.convert('RGBA').tobytes())
        report=next(self.project.version(v) for v in split['results'] if self.project.version(v)['metadata']['extension']=='.json')
        frames=json.loads(Path(report['absolutePath']).read_text())['frames']
        self.assertEqual([frame['durationMs'] for frame in frames],[70,120,230,310])
        self.assertEqual([frame['disposalType'] for frame in frames],[1,2,3,1])

    def test_sequence_canvas_tasks_keep_original_floor_cells_blank_and_transparent_regions(self):
        cases=[('image.sliceBrowser',{'columns':3,'rows':2},6,(5,6)),
               ('image.superSlice',{},1,(1,1)),('image.blank',{},1,(16,12)),
               ('sequence.combine',{'columns':2,'cropLeft':-.5},1,(33,12)),
               ('sequence.stitch',{'direction':'horizontal'},1,(16,12))]
        for operation,parameters,count,dimensions in cases:
            result=wait(self.project,submit(self.project,{'operation':operation,'inputs':[self.version['id']],'parameters':parameters})['id'],15)
            self.assertEqual(result['state'],'succeeded',result)
            images=[self.project.version(v) for v in result['results'] if self.project.version(v)['metadata']['kind']=='image']
            self.assertEqual(len(images),count)
            for image in images:self.assertEqual((image['metadata']['width'],image['metadata']['height']),dimensions)
            if operation=='image.blank':
                with Image.open(images[0]['absolutePath']) as image:self.assertEqual(image.getchannel('A').getextrema(),(0,0))
            if operation=='image.superSlice':
                with Image.open(images[0]['absolutePath']) as image:self.assertEqual(image.getpixel((0,0)),(255,30,20,255))
        for parameters in [{'columns':128,'rows':128},{'columns':17,'rows':1},{'rows':0}]:
            with self.assertRaises(RoninError):preview(self.project,{'operation':'image.sliceBrowser','inputs':[self.version['id']],'parameters':parameters})
        with self.assertRaises(RoninError):preview(self.project,{'operation':'sequence.combine','inputs':[self.version['id']],
            'parameters':{'columns':128,'cropLeft':-8192,'cropRight':-8192}})
        with self.assertRaises(RoninError):preview(self.project,{'operation':'image.superSlice','inputs':[self.version['id']],
            'parameters':{'frontendBytes':2*1024**3}})

    def test_half_pixel_stitching_retains_original_alpha_and_fixed_premultiplied_tolerance(self):
        fixtures=Path(__file__).resolve().parents[1]/'assets/fixtures/sequence'
        inputs=[self.project.import_file(fixtures/f'frame-{index:03d}.png')['id'] for index in range(3)]
        for direction in ['vertical','horizontal','overlay']:
            result=wait(self.project,submit(self.project,{'operation':'sequence.stitch','inputs':inputs,
                'parameters':{'direction':direction}})['id'],15)
            self.assertEqual(result['state'],'succeeded',result)
            version=next(self.project.version(v) for v in result['results'] if self.project.version(v)['metadata']['kind']=='image')
            with Image.open(version['absolutePath']) as actual,Image.open(fixtures/f'original-stitch-{direction}.png') as original:
                self.assertEqual(actual.size,original.size)
                for first,second in zip(actual.convert('RGBA').getdata(),original.convert('RGBA').getdata()):
                    self.assertLessEqual(abs(first[3]-second[3]),1)
                    for channel in range(3):self.assertLessEqual(abs(first[channel]*first[3]/255-second[channel]*second[3]/255),1)

    def test_copy_reopen_tamper_and_checkout(self):
        original = self.source.read_bytes()
        second = self.project.import_file(self.source, self.version['asset_id'])
        self.assertEqual(second['parent_id'], self.version['id'])
        reopened = Project(self.project.root)
        reopened.checkout(self.version['asset_id'], self.version['id'])
        self.assertEqual(reopened.assets()[0]['current_version'], self.version['id'])
        self.assertEqual(self.source.read_bytes(), original)
        Path(second['absolutePath']).write_bytes(b'tampered')
        with self.assertRaisesRegex(RoninError, 'content changed'):
            reopened.version(second['id'])
        self.assertFalse(reopened.verify()['valid'])

    def test_paths_and_symlinks_rejected(self):
        with self.assertRaises(RoninError):
            self.project.safe('../outside.png')
        link = self.project.root / 'assets/link'
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(RoninError):
            self.project.safe('assets/link/source.png')
        with self.assertRaises(RoninError):
            self.project.import_file(self.source, 'nested/path')

    def test_interrupted_rename_recovery(self):
        original = self.project._finalize_pending
        with patch.object(self.project, '_finalize_pending', side_effect=OSError('interruption')):
            with self.assertRaises(OSError):
                self.project.import_file(self.source)
        self.assertEqual(self.project.recover()['pending'][0]['state'], 'recovered')
        self.assertTrue(self.project.verify()['valid'])
        self.assertEqual(len(self.project.assets()), 2)

    def test_unknown_fields_ranges_and_stale_versions(self):
        payload = {'operation': 'image.crop', 'inputs': [self.version['id']], 'parameters': {'width': 8, 'height': 8}}
        self.assertEqual(preview(self.project, payload)['processingMode'], 'original_resolution')
        for invalid in [dict(payload, command='whoami'), dict(payload, operation='shell'),
                        dict(payload, parameters={'width': True}), dict(payload, parameters={'width': 8193}),
                        dict(payload, parameters={'anything': 1}), dict(payload, inputs=[identifier()])]:
            with self.assertRaises(RoninError):
                preview(self.project, invalid)

    def test_documents_cas_and_saved_history(self):
        document = identifier()
        self.project.save_document(document, 'rseprite', {'frames': [1]}, 0)
        self.project.save_document(document, 'rseprite', {'frames': [1, 2]}, 1)
        with self.assertRaises(RoninError):
            self.project.save_document(document, 'rseprite', {}, 1)
        with self.assertRaises(RoninError) as changed_kind:
            self.project.save_document(document, 'pixel', {}, 2)
        self.assertEqual(changed_kind.exception.code,'DOCUMENT_KIND_CHANGED')
        pixel_id=identifier()
        self.project.save_document(pixel_id,'pixel',{'formatVersion':1},0)
        self.assertEqual(self.project.document(pixel_id)['kind'],'pixel')
        self.project.restore_document(document, 1, 2)
        self.assertEqual(self.project.document(document)['payload']['frames'], [1])

    def test_ai_unknown_reconciliation_and_retry_limit(self):
        attempt = self.project.begin_ai('sample', 'free-image', 'red character', [self.version['id']])
        self.project.mark_ai(attempt['id'], 'unknown')
        with self.assertRaises(RoninError):
            self.project.begin_ai('sample', 'free-image', 'red character', [])

        self.project.mark_ai(attempt['id'], 'failed')
        for _ in range(2):
            attempt = self.project.begin_ai('sample', 'free-image', 'red character', [])
            self.project.mark_ai(attempt['id'], 'failed')
        with self.assertRaises(RoninError):
            self.project.begin_ai('sample', 'free-image', 'red character', [])

    def test_ai_result_acceptance_obeys_cancel_and_reconciliation(self):
        attempt = self.project.begin_ai('accepted', 'free-image', 'character', [])
        self.project.mark_ai(attempt['id'], 'running')
        result = self.project.accept_ai(attempt['id'], self.source, 'succeeded', {'visual':'synthetic fixture'})
        self.assertEqual(result['attempt']['result_version'], result['version']['id'])
        self.assertEqual(task(self.project, attempt['id'])['state'], 'succeeded')
        self.assertEqual(result['version']['origin'], 'codex-native-imagegen')
        attempt = self.project.begin_ai('unknown', 'free-image', 'character', [])
        self.project.mark_ai(attempt['id'], 'unknown')
        with self.assertRaises(RoninError): self.project.accept_ai(attempt['id'], self.source, 'succeeded', {})
        self.project.accept_ai(attempt['id'], self.source, 'quality_failed', {'reconciled':True,'reason':'fixture only'})
        attempt = self.project.begin_ai('canceled', 'free-image', 'character', [])
        canceled = cancel(self.project, attempt['id'])
        self.assertEqual(canceled['aiState'], 'cancel_requested')
        with self.assertRaises(RoninError): self.project.accept_ai(attempt['id'], self.source, 'succeeded', {})
        self.project.mark_ai(attempt['id'], 'canceled')

    def test_worker_pixels_and_late_completion(self):
        submitted = submit(self.project, {'operation': 'image.flip', 'inputs': [self.version['id']], 'parameters': {}})
        result = wait(self.project, submitted['id'], 15)
        self.assertEqual(result['state'], 'succeeded', result)
        version = self.project.version(result['results'][0])
        with Image.open(version['absolutePath']) as image:
            self.assertEqual(image.getpixel((13, 3)), (255, 30, 20, 255))
        pending = submit(self.project, {'operation': 'sequence.zip', 'inputs': [self.version['id']] * 1000, 'parameters': {}})
        canceled = cancel(self.project, pending['id'])
        self.assertEqual(canceled['state'], 'canceled')
        self.assertLess(canceled['cancelElapsedSeconds'], 5)
        with self.assertRaises(Cancelled):
            self.project.import_file(self.source, task_id=pending['id'], generation=0)

    def test_queue_keeps_later_tasks_without_worker_allocation(self):
        source = self.root / 'larger.png'
        Image.new('RGBA', (512, 512), (255, 40, 80, 255)).save(source)
        version = self.project.import_file(source)
        first = submit(self.project, {'operation':'sequence.zip','inputs':[version['id']] * 1000,'parameters':{}})
        deadline = time.monotonic() + 5
        while task(self.project, first['id'])['state'] == 'queued' and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(task(self.project, first['id'])['state'], 'running')
        second = submit(self.project, {'operation':'image.flip','inputs':[version['id']],'parameters':{}})
        queued = task(self.project, second['id'])
        self.assertEqual(queued['state'], 'queued')
        self.assertIsNone(queued['pid'])
        self.assertEqual(cancel(self.project, first['id'])['state'], 'canceled')
        self.assertEqual(wait(self.project, second['id'], 10)['state'], 'succeeded')

    def test_cancel_stops_nested_media_processes_and_records_confirmation(self):
        source = self.root / 'flow.png'
        Image.new('RGBA', (512, 512), (40, 80, 120, 255)).save(source)
        version = self.project.import_file(source)
        submitted = submit(self.project, {'operation':'sequence.opticalFlow',
            'inputs':[version['id']] * 16, 'parameters':{'quality':'high'}})
        family = []
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            record = task(self.project, submitted['id'])
            if record['pid']:
                try:
                    parent = psutil.Process(record['pid'])
                    family = [parent] + parent.children(recursive=True)
                    if any('run.mjs' in ' '.join(child.cmdline()) for child in family): break
                except psutil.NoSuchProcess:
                    pass
            time.sleep(0.02)
        self.assertGreater(len(family), 1, record)
        result = cancel(self.project, submitted['id'])
        self.assertTrue(result['processStopConfirmed'])
        self.assertLess(result['cancelElapsedSeconds'], 5)
        self.assertEqual(result['results'], [])
        for child in family:
            self.assertFalse(child.is_running() and child.status() != psutil.STATUS_ZOMBIE)
        receipt = json.loads((self.project.root / f'tasks/{submitted["id"]}/cancellation.json').read_text())
        self.assertEqual(receipt['scope'], 'local_owned_processes')
        self.assertGreaterEqual(receipt['ownedProcessCount'], 2)
        with self.assertRaises(Cancelled):
            self.project.import_file(source, task_id=submitted['id'], generation=0)

    def test_cancel_denial_is_recorded_and_never_reported_as_confirmed(self):
        task_id = identifier()
        with self.project.connection() as db:
            db.execute('INSERT INTO tasks(id,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)',
                       (task_id, 'running', '{}', 'now', 'now'))
        process = Mock(pid=999999)
        process.children.return_value = []
        with patch('frameronin_engine.tasks._owned_process', return_value=process), \
             patch('frameronin_engine.tasks.os.getpgid', return_value=process.pid), \
             patch('frameronin_engine.tasks.os.killpg', side_effect=PermissionError('denied')):
            with self.assertRaises(RoninError) as caught:
                cancel(self.project, task_id)
        self.assertEqual(caught.exception.code, 'CANCEL_STOP_UNCONFIRMED')
        record = task(self.project, task_id)
        self.assertEqual(record['state'], 'canceled')
        self.assertEqual(record['results'], [])
        self.assertEqual(record['error']['code'], 'CANCEL_STOP_UNCONFIRMED')
        with self.assertRaises(RoninError): cancel(self.project, task_id)
        receipt = json.loads((self.project.root / f'tasks/{task_id}/cancellation.json').read_text())
        self.assertFalse(receipt['processStopConfirmed'])

    def test_audio_batch_preserves_duplicate_names_metadata_and_decodable_outputs(self):
        inputs = []
        original = []
        for index in range(2):
            directory = self.root / f'audio-{index}'
            directory.mkdir()
            source = directory / 'tone.wav'
            samples = [round(math.sin(2 * math.pi * (440 + index * 220) * i / 44100) * 0.2 * 32767) for i in range(11025)]
            original.append(samples)
            with wave.open(str(source), 'wb') as output:
                output.setparams((2, 2, 44100, 11025, 'NONE', 'not compressed'))
                output.writeframes(b''.join(struct.pack('<hh', value, -value) for value in samples))
            inputs.append(self.project.import_file(source)['id'])
        job = submit(self.project, {'operation':'audio.compress','inputs':inputs,'parameters':{'bitrate':128}})
        result = wait(self.project, job['id'], 15)
        self.assertEqual(result['state'], 'succeeded', result)
        versions = [self.project.version(value) for value in result['results']]
        audio = [value for value in versions if value['metadata']['kind'] == 'audio']
        self.assertEqual(len(audio), 2)
        archive = next(value for value in versions if value['metadata']['kind'] == 'archive')
        with zipfile.ZipFile(archive['absolutePath']) as bundle:
            self.assertEqual(bundle.namelist(), ['0001-tone_128kbps.mp3', '0002-tone_128kbps.mp3'])
            for index, version in enumerate(audio):
                self.assertEqual(version['metadata']['sampleRate'], 44100)
                self.assertEqual(version['metadata']['channels'], 2)
                self.assertLess(abs(version['metadata']['durationSeconds'] - 0.25), 0.08)
                self.assertEqual(hashlib.sha256(bundle.read(bundle.namelist()[index])).hexdigest(), version['sha256'])
                decoded = subprocess.check_output(['ffmpeg','-v','error','-i',version['absolutePath'],'-f','s16le','-'])
                actual = [sample[0] for sample in struct.iter_unpack('<hh', decoded)]
                self.assertEqual(len(actual), len(original[index]))
                # Fixed before running: MP3 is lossy, with LAME's default scaling.
                # Bound decoded tone RMS error to 8%, including codec quantization.
                relative = math.sqrt(sum((a-b)**2 for a,b in zip(actual, original[index])) / sum(b*b for b in original[index]))
                self.assertLess(relative, 0.08)

    def test_cancel_during_output_checksum_rejects_publication(self):
        task_id = identifier()
        with self.project.connection() as db:
            db.execute('INSERT INTO tasks(id,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)',
                       (task_id, 'running', '{}', 'now', 'now'))
        staged = self.project.import_file(self.source, task_id=task_id, generation=0, defer=True)
        original = self.project._validate_pending
        def validate_then_cancel(record):
            fingerprint = original(record)
            cancel(self.project, task_id)
            return fingerprint
        with patch.object(self.project, '_validate_pending', side_effect=validate_then_cancel), self.assertRaises(Cancelled):
            self.project.finish_task(task_id, 0, [staged['id']])
        with self.project.connection() as db:
            self.assertIsNone(db.execute('SELECT id FROM versions WHERE id=?', (staged['id'],)).fetchone())
        self.assertEqual(task(self.project, task_id)['state'], 'canceled')

    def test_revisioned_proposals_do_not_execute_on_preview(self):
        from frameronin_engine.proposals import save, execute
        payload = {'operation':'image.flip','inputs':[self.version['id']],'parameters':{}}
        selected = [self.version['id']]
        proposal = save(self.project, payload, selected)
        other = self.project.import_file(self.source)
        with self.assertRaises(RoninError): save(self.project, dict(payload, assetId=other['asset_id']), selected)
        with self.project.connection() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM tasks').fetchone()[0], 0)
        revised = save(self.project, payload, selected, proposal['id'], 1)
        with self.assertRaises(RoninError): execute(self.project, proposal['id'], 1)
        replacement = self.project.import_file(self.source, self.version['asset_id'])
        with self.assertRaises(RoninError): execute(self.project, proposal['id'], 2)
        with self.assertRaises(RoninError): save(self.project, dict(payload, inputs=[replacement['id']]), selected)
        refreshed = save(self.project, payload, selected, revised['id'], 2)
        submitted = execute(self.project, refreshed['id'], 3)
        with self.assertRaises(RoninError): execute(self.project, refreshed['id'], 3)
        self.assertEqual(wait(self.project, submitted['id'], 10)['state'], 'succeeded')
        with self.assertRaises(RoninError): save(self.project, {'operation':'workflow.legacy','inputs':[self.version['id']],'parameters':{}}, selected)


if __name__ == '__main__':
    unittest.main()
