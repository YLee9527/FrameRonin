"""Publish real sprite browser-oracle ZIPs through an owned project queue."""
import argparse
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
from frameronin_engine.tasks import submit,wait
from frameronin_engine.browser_tasks import ready,accept


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path);parser.add_argument('--project',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    fixture=SKILL/'assets/fixtures/sprite-sheet';manifest=json.loads((fixture/'manifest.json').read_text());project=Project.create(args.project,'FrameRonin 精灵表引擎验收')
    imported={};records=[]
    with zipfile.ZipFile(args.archive) as archive,tempfile.TemporaryDirectory(prefix='frameronin-sprite-') as temporary:
        output=Path(temporary)/'output.zip'
        for kind in ['split','gif']:
            for entry in manifest[kind]:
                source=fixture/entry['input'];sha=hashlib.sha256(source.read_bytes()).hexdigest()
                if sha not in imported:imported[sha]=project.import_file(source)['id']
                layout={'mode':'grid','columns':entry['columns'],'rows':entry['rows']} if kind=='split' else entry['layout']
                payload={'operation':'image.customSlice' if kind=='split' else 'image.spriteGifs','inputs':[imported[sha]],'parameters':{'layout':layout,'renderer':'browser-worker','frontendBytes':0}}
                created=submit(project,payload,browser_client=True);deadline=time.monotonic()+20
                while not ready(project,created['id'])['ready']:
                    if time.monotonic()>deadline:raise RuntimeError('No owned browser request')
                    time.sleep(.05)
                data=archive.read(f'{kind}/{entry["id"]}/actual.zip');output.write_bytes(data);accept(project,created['id'],0,output)
                final=wait(project,created['id'],20)
                if final['state']!='succeeded':raise RuntimeError(f'Publication failed: {final}')
                version=project.version(final['results'][0]);assert version['sha256']==hashlib.sha256(data).hexdigest()
                report=json.loads(Path(project.version(final['results'][1])['absolutePath']).read_text())
                records.append({'kind':kind,'sample':entry['id'],'taskId':created['id'],'state':final['state'],'inputSha256':sha,'results':final['results'],'encodedOutputPreserved':True,'report':report})
    verified=project.verify();result={'projectId':project.manifest['id'],'tasks':records,'verification':{'valid':verified['valid'],'database':verified['database'],'versionCount':len(verified['versions'])}}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'tasks':len(records),'verification':result['verification']}))
    if not verified['valid']:raise SystemExit(1)


if __name__=='__main__':main()
