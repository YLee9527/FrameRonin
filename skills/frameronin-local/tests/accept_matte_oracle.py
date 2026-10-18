"""Publish real standalone matte Worker outputs through the owned queue."""
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
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path);parser.add_argument('--project',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    fixture=SKILL/'assets/fixtures/matte-tool';manifest=json.loads((fixture/'manifest.json').read_text());project=Project.create(args.project,'FrameRonin 独立抠图内核验收')
    imported={};records=[]
    with zipfile.ZipFile(args.archive) as archive,tempfile.TemporaryDirectory(prefix='frameronin-matte-tool-') as temporary,ThreadPoolExecutor(max_workers=1) as pool:
        for entry in manifest['cases']:
            for name in entry['inputs']:
                if name not in imported:imported[name]=project.import_file(fixture/name)['id']
            operation='image.matteTool'
            payload={'operation':operation,'inputs':[imported[name] for name in entry['inputs']],'parameters':{'layout':entry['layout'],'renderer':'browser-worker','frontendBytes':0}}
            created=submit(project,payload,browser_client=True);deadline=time.monotonic()+20
            while not ready(project,created['id'])['ready']:
                if time.monotonic()>deadline:raise RuntimeError('No owned matte browser request')
                time.sleep(.05)
            ext='png';data=archive.read(f'{entry["id"]}/actual.{ext}')
            output=Path(temporary)/f'{entry["id"]}.{ext}';output.write_bytes(data)
            # A real workbench keeps heartbeating while output verification runs.
            pending=pool.submit(accept,project,created['id'],0,output)
            while True:
                try:pending.result(timeout=1);break
                except TimeoutError:
                    if task(project,created['id'])['state']=='running':
                        try:heartbeat(project,created['id'],0)
                        except Cancelled:
                            if task(project,created['id'])['state'] not in ['succeeded','failed','canceled']:raise
            final=wait(project,created['id'],20)
            if final['state']!='succeeded':raise RuntimeError(f'Matte publication failed: {final}')
            version=project.version(final['results'][0]);assert version['sha256']==hashlib.sha256(data).hexdigest()
            report=json.loads(Path(project.version(final['results'][1])['absolutePath']).read_text())
            records.append({'sample':entry['id'],'operation':operation,'taskId':created['id'],'state':final['state'],'inputs':payload['inputs'],'results':final['results'],'encodedOutputPreserved':True,'report':report})
    verified=project.verify();result={'projectId':project.manifest['id'],'tasks':records,'verification':{'valid':verified['valid'],'database':verified['database'],'versionCount':len(verified['versions'])}}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'tasks':len(records),'verification':result['verification']}))
    if not verified['valid']:raise SystemExit(1)


if __name__=='__main__':main()
