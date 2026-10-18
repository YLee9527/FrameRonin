"""Publish actual video-frame Worker ZIPs through a fresh owned project queue."""
import argparse
from concurrent.futures import ThreadPoolExecutor,TimeoutError
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import zipfile

SKILL=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SKILL/'scripts'))
from frameronin_engine.project import Project
from frameronin_engine.tasks import submit,wait,task
from frameronin_engine.browser_tasks import ready,accept,heartbeat
from frameronin_engine.errors import Cancelled

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--project',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--selection',action='store_true');args=parser.parse_args()
    fixture=SKILL/'assets/fixtures/video-frames';manifest=json.loads((fixture/'manifest.json').read_text());project=Project.create(args.project,'FrameRonin 视频逐帧内核验收')
    if args.selection:manifest['cases'].extend(json.loads((fixture/'selection.json').read_text())['cases'])
    frames=project.import_file(fixture/'frames.zip')['id'];brush=project.import_file(fixture/'brush.png')['id'];records=[]
    with zipfile.ZipFile(args.archive) as archive,tempfile.TemporaryDirectory(prefix='ronin-video-frame-output-') as temporary,ThreadPoolExecutor(max_workers=1) as pool:
        for entry in manifest['cases']:
            payload={'operation':'video.frameTools','inputs':[frames]+([brush] if entry['layout'].get('mask') else []),'parameters':{'renderer':'browser-worker','frontendBytes':0,'layout':entry['layout']}}
            created=submit(project,payload,browser_client=True);deadline=time.monotonic()+30
            while not ready(project,created['id'])['ready']:
                if time.monotonic()>deadline:raise RuntimeError('The owned browser task did not become ready; inspect its existing state before any retry.')
                time.sleep(.05)
            data=archive.read(entry['id']+'/actual.zip');source=Path(temporary)/(entry['id']+'.zip');source.write_bytes(data)
            pending=pool.submit(accept,project,created['id'],0,source)
            while True:
                try:pending.result(timeout=1);break
                except TimeoutError:
                    if task(project,created['id'])['state']=='running':
                        try:heartbeat(project,created['id'],0)
                        except Cancelled:
                            if task(project,created['id'])['state'] not in ['succeeded','failed','canceled']:raise
            final=wait(project,created['id'],30)
            if final['state']!='succeeded':raise RuntimeError(f'Video frame publication failed: {final}')
            assert project.version(final['results'][0])['sha256']==hashlib.sha256(data).hexdigest()
            report=json.loads(Path(project.version(final['results'][1])['absolutePath']).read_text())
            records.append({'sample':entry['id'],'taskId':created['id'],'state':final['state'],'inputs':payload['inputs'],'results':final['results'],'encodedOutputPreserved':True,'report':report})
    verified=project.verify();result={'projectId':project.manifest['id'],'tasks':records,'verification':{'valid':verified['valid'],'database':verified['database'],'versionCount':len(verified['versions'])}}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'tasks':len(records),'verification':result['verification']}))
    if not verified['valid']:raise SystemExit(1)

if __name__=='__main__':main()
