import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from PIL import Image
from PIL.PngImagePlugin import PngImageFile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from frameronin_engine.project import Project
from frameronin_engine.errors import RoninError,Cancelled
from frameronin_engine.operations import preview
from frameronin_engine.tasks import submit
from frameronin_engine.video_frames import review,validate_result,sprite_index,duplicates

FIXTURE=Path(__file__).resolve().parents[1]/'assets/fixtures/video-frames'
class VideoFrameTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='ronin-video-frames-');self.root=Path(self.temp.name)
        self.project=Project.create(self.root/'project');self.frames=self.project.import_file(FIXTURE/'frames.zip');self.brush=self.project.import_file(FIXTURE/'brush.png')
        self.cases=json.loads((FIXTURE/'manifest.json').read_text())['cases']
    def tearDown(self):self.temp.cleanup()
    def payload(self,case):
        p=case['layout'];return {'operation':'video.frameTools','inputs':[self.frames['id']]+([self.brush['id']] if p.get('mask') else []),'parameters':{'renderer':'browser-worker','frontendBytes':0,'layout':p}}
    def test_strict_recipe_review_and_host_execution_boundary(self):
        for case in self.cases:
            p=self.payload(case);result=preview(self.project,p);self.assertTrue(result['requiresWorkbench']);self.assertLess(result['estimatedBytes'],result['budgetBytes'])
            with self.assertRaises(RoninError):submit(self.project,p)
        with self.project.connection() as db:self.assertEqual(db.execute('SELECT count(*) FROM tasks').fetchone()[0],0)
        for change in [lambda p:p['parameters']['layout'].update(command='run'),lambda p:p['parameters'].update(renderer='native'),lambda p:p['inputs'].append(self.brush['id']),lambda p:p['parameters'].update(frontendBytes=2*1024**3)]:
            p=self.payload(self.cases[0]);change(p)
            with self.assertRaises(RoninError):preview(self.project,p)
        for patch in [{'selected':[2,0]},{'selected':[0,0]},{'mask':True},{'tolerance':False},{'feather':float('nan')},{'background':'../secret'}]:
            p=self.payload(self.cases[1]);p['parameters']['layout'].update(patch)
            with self.assertRaises(RoninError):preview(self.project,p)
    def output(self,members):
        path=self.root/'output.zip'
        with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
            for name,data in members.items():z.writestr(name,data)
        return path
    def validate(self,path,case,check=lambda:None):
        payload=self.payload(case);return validate_result(path,[self.project.version(i) for i in payload['inputs']],payload['parameters'],2*1024**3,check)
    def test_duplicate_group_index_and_exact_output_members_are_checked(self):
        case=self.cases[0];hashes=['1_0','2_0','1_0','3_0','4_0','5_0','6_0'];data={'hashes':hashes,'duplicates':duplicates(hashes),'frameCount':7}
        path=self.output({'analysis.json':json.dumps(data)});self.assertEqual(self.validate(path,case)['duplicates'][0]['totalInGroup'],2)
        data['duplicates'][0]['index']=6
        with self.assertRaises(RoninError):self.validate(self.output({'analysis.json':json.dumps(data)}),case)
        data['duplicates']=duplicates(hashes);data['duplicates'][0]['index']=False
        with self.assertRaises(RoninError):self.validate(self.output({'analysis.json':json.dumps(data)}),case)
        with self.assertRaises(RoninError):self.validate(self.output({'../analysis.json':'{}'}),case)
        case=next(c for c in self.cases if c['id']=='compose-default');p=self.payload(case)['parameters'];versions=[self.project.version(self.frames['id'])];_,plan,sizes=review(versions,p,2*1024**3)
        png=io.BytesIO();Image.new('RGBA',(plan['width'],plan['height'])).save(png,format='PNG');index=sprite_index(p['layout'],plan,len(sizes))
        good={'sprite.png':png.getvalue(),'index.json':json.dumps(index)};self.assertEqual(self.validate(self.output(good),case)['index'],index)
        index['frames'][0]['t']=.5
        with self.assertRaises(RoninError):self.validate(self.output({**good,'index.json':json.dumps(index)}),case)
        index['frames'][0]['t']=False
        with self.assertRaises(RoninError):self.validate(self.output({**good,'index.json':json.dumps(index)}),case)
        with self.assertRaises(RoninError):self.validate(self.output({**good,'sprite.png':b'not png'}),case)
        fractional=next(c for c in self.cases if c['id']=='compose-fractional');fp=self.payload(fractional)['parameters'];_,fplan,fsizes=review(versions,fp,2*1024**3)
        self.assertEqual(fplan['height'],66);self.assertEqual(sprite_index(fp['layout'],fplan,len(fsizes))['sheet_size']['h'],66.25)
    def test_archive_copies_and_cancellation_during_verification(self):
        case=next(c for c in self.cases if c['id']=='archive-extracted')
        members={'frames/':b''}
        with zipfile.ZipFile(FIXTURE/'frames.zip') as z:
            for i,n in enumerate(case['layout']['selected']):members[f'frames/frame_{i+1:05d}.png']=z.read(f'frame_{n:03d}.png')
        path=self.output(members);self.assertEqual(self.validate(path,case)['outputFrames'],4)
        calls=[]
        def cancel_check():
            calls.append(True)
            if len(calls)==4:raise Cancelled()
        with self.assertRaises(Cancelled):self.validate(path,case,cancel_check)
        members['frames/frame_00001.png']=(FIXTURE/'frame_002.png').read_bytes()
        with self.assertRaises(RoninError):self.validate(self.output(members),case)
    def test_matte_output_dimensions_and_cancellation_after_last_decode(self):
        case=self.cases[1]
        with zipfile.ZipFile(FIXTURE/'frames.zip') as source:
            members={f'frame_{i:03d}.png':source.read(f'frame_{index:03d}.png') for i,index in enumerate(case['layout']['selected'])}
        path=self.output(members);self.assertEqual(self.validate(path,case)['outputFrames'],6)
        decoded=False;last_decodes=0;native=PngImageFile.load
        def load(image,*args,**kwargs):
            nonlocal decoded,last_decodes
            result=native(image,*args,**kwargs)
            if image.size==(31,9):
                last_decodes+=1;decoded=last_decodes==2
            return result
        def canceled():
            if decoded:raise Cancelled()
        with patch.object(PngImageFile,'load',load),self.assertRaises(Cancelled):self.validate(path,case,canceled)
        members['frame_005.png']=(FIXTURE/'frame_003.png').read_bytes()
        with self.assertRaises(RoninError):self.validate(self.output(members),case)

if __name__=='__main__':unittest.main()
