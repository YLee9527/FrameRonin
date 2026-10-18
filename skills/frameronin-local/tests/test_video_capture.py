import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
import json
from unittest.mock import patch
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from frameronin_engine.project import Project,identifier,now
from frameronin_engine.errors import RoninError,Cancelled
from frameronin_engine.operations import preview
from frameronin_engine.tasks import submit
from frameronin_engine.video_capture import review,validate_result
from frameronin_engine import browser_tasks

FIXTURE=Path(__file__).resolve().parents[1]/'assets/fixtures/video-capture'
class VideoCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='ronin-video-capture-');self.root=Path(self.temp.name);self.project=Project.create(self.root/'project')
        self.source=self.project.import_file(FIXTURE/'h264.mp4')
    def tearDown(self):self.temp.cleanup()
    def parameters(self):return {'renderer':'browser-worker','frontendBytes':0,'layout':{'sourceWidth':64,'sourceHeight':48,'start':0,'end':1,'fps':10,'maxFrames':2000,'crop':{'left':0,'top':0,'right':0,'bottom':0}}}
    def payload(self):return {'operation':'video.capture','inputs':[self.source['id']],'parameters':self.parameters()}
    def test_strict_native_capture_review_and_host_boundary(self):
        payload=self.payload();result=preview(self.project,payload);self.assertTrue(result['requiresWorkbench'])
        reviewed=review(self.project.version(self.source['id']),payload['parameters'],2*1024**3);self.assertEqual(reviewed['outputFrames'],11)
        with self.assertRaises(RoninError):submit(self.project,payload)
        for patch in [{'command':'run'},{'sourceWidth':True},{'maxFrames':2001},{'end':3},{'fps':float('nan')},{'crop':{'left':64,'top':0,'right':0,'bottom':0}}]:
            p=self.payload();p['parameters']['layout'].update(patch)
            with self.assertRaises(RoninError):preview(self.project,p)
        p=self.payload();p['parameters']['frontendBytes']=2*1024**3
        with self.assertRaises(RoninError):preview(self.project,p)
        p=self.payload();p['parameters']['renderer']='native'
        with self.assertRaises(RoninError):preview(self.project,p)
        with self.project.connection() as db:self.assertEqual(db.execute('SELECT count(*) FROM tasks').fetchone()[0],0)
    def output(self,count=11,size=(64,48),extra=None):
        png=io.BytesIO();Image.new('RGBA',size,(20,190,42,255)).save(png,format='PNG');path=self.root/'frames.zip'
        with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
            for index in range(count):z.writestr(f'frame_{index:03d}.png',png.getvalue())
            if extra:z.writestr(*extra)
        return path
    def validate(self,path,check=lambda:None):return validate_result(path,self.project.version(self.source['id']),self.parameters(),2*1024**3,check)
    def test_exact_frame_count_geometry_encoded_limit_and_cancellation(self):
        self.assertEqual(self.validate(self.output())['timestamps'][-1],.9999999999999999)
        for options in [{'count':10},{'size':(63,48)},{'extra':('../outside.png',b'not png')}]:
            with self.assertRaises(RoninError):self.validate(self.output(**options))
        path=self.root/'invalid.zip';path.write_bytes(b'not zip')
        with self.assertRaises(RoninError):self.validate(path)
        path=self.output();calls=[]
        def cancel_check():
            calls.append(True)
            if len(calls)==4:raise Cancelled()
        with self.assertRaises(Cancelled):self.validate(path,cancel_check)
        path=self.output(extra=('large.txt',b'x'*200000))
        with self.assertRaises(RoninError):self.validate(path)
    def test_fractional_and_overlapping_crops_and_physical_decoder_budget(self):
        version=self.project.version(self.source['id']);p=self.parameters();p['layout']['crop']={'left':1.5,'top':2.25,'right':3.75,'bottom':4.5}
        result=review(version,p,2*1024**3);self.assertEqual((result['cropWidth'],result['width']),(58.75,58));self.assertEqual((result['cropHeight'],result['height']),(41.25,41))
        p['layout']['crop']={'left':40,'top':30,'right':40,'bottom':30};result=review(version,p,2*1024**3);self.assertEqual((result['width'],result['height']),(1,1))
        version['metadata']['durationSeconds']=172800;self.assertEqual(review(version,self.parameters(),2*1024**3)['outputFrames'],11)
        # A smaller declared presentation cannot hide a huge physical decoder.
        version['metadata'].update(width=30000,height=30000)
        with self.assertRaises(RoninError):review(version,p,2*1024**3)
    def test_native_input_is_task_scoped_generation_checked_and_cancellable_during_hashing(self):
        def record(payload):
            key=identifier()
            with self.project.writer(),self.project.connection() as db:db.execute('INSERT INTO tasks(id,state,generation,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)',(key,'running',2,json.dumps(payload),now(),now()))
            return key
        key=record(self.payload())
        with self.assertRaises(RoninError):browser_tasks.input_source(self.project,key,2)
        directory=self.project.safe(f'tasks/{key}/output');directory.mkdir(parents=True);(directory/'browser-request.json').write_text('{"generation":2}')
        with self.assertRaises(Cancelled):browser_tasks.input_source(self.project,key,1)
        self.assertEqual(browser_tasks.input_source(self.project,key,2)['id'],self.source['id'])
        from frameronin_engine.server import application
        endpoint=next(route.endpoint for route in application(self.project,8779).routes if route.path=='/api/tasks/{task_id}/browser/input')
        self.assertEqual(endpoint(key,2).headers['cache-control'],'no-store')
        original=browser_tasks.location;calls=[]
        def interrupt(*args,**kwargs):
            calls.append(True)
            if len(calls)==3:
                with self.project.writer(),self.project.connection() as db:db.execute("UPDATE tasks SET state='canceled',generation=3 WHERE id=?",(key,))
            return original(*args,**kwargs)
        with patch.object(browser_tasks,'location',interrupt),self.assertRaises(Cancelled):browser_tasks.input_source(self.project,key,2)
        self.assertEqual(len(calls),3)
        other={'operation':'image.matteTool','inputs':[self.source['id']],'parameters':{'renderer':'browser-worker','frontendBytes':0,'layout':{'mode':'repair'}}}
        other_key=record(other)
        with patch.object(self.project,'version',side_effect=AssertionError('unselected file read')),self.assertRaises(RoninError):browser_tasks.input_source(self.project,other_key,2)

if __name__=='__main__':unittest.main()
