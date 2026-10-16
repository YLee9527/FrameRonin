"""Publish real browser-oracle outputs through an owned local project queue."""
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
    parser.add_argument('archive',type=Path)
    parser.add_argument('--project',required=True,type=Path,help='A new, empty acceptance project')
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    manifest=json.loads((SKILL/'assets/fixtures/custom-slice/manifest.json').read_text())
    project=Project.create(args.project,'FrameRonin 自定义切片引擎验收')
    imported={};rows=[]
    with tempfile.TemporaryDirectory(prefix='frameronin-custom-oracle-') as temporary,zipfile.ZipFile(args.archive) as archive:
        directory=Path(temporary)
        for kind in ['plan','slice','compose']:
            suffix={'plan':'json','slice':'zip','compose':'png'}[kind]
            operation={'plan':'image.customSlicePlan','slice':'image.customSlice','compose':'image.customCompose'}[kind]
            for case in manifest[kind]:
                if kind=='compose':
                    source=directory/'slices.zip';source.write_bytes(archive.read(f'{kind}/{case["id"]}/input.zip'))
                else:source=SKILL/'assets/fixtures'/case['input']
                sha=hashlib.sha256(source.read_bytes()).hexdigest()
                if sha not in imported:imported[sha]=project.import_file(source)['id']
                payload={'operation':operation,'inputs':[imported[sha]],'parameters':{**case['parameters'],'renderer':'browser-worker','frontendBytes':0}}
                record=submit(project,payload,browser_client=True);deadline=time.monotonic()+15
                while not ready(project,record['id'])['ready']:
                    if time.monotonic()>deadline:raise RuntimeError(f'Queue did not request browser output: {record["id"]}')
                    time.sleep(.05)
                data=archive.read(f'{kind}/{case["id"]}/actual.{suffix}');result=directory/f'result.{suffix}';result.write_bytes(data)
                accept(project,record['id'],0,result)
                final=wait(project,record['id'],15)
                if final['state']!='succeeded':raise RuntimeError(f'Browser publication failed: {final}')
                version=project.version(final['results'][0])
                if version['sha256']!=hashlib.sha256(data).hexdigest():raise RuntimeError('Publication changed encoded browser output')
                report=json.loads(Path(project.version(final['results'][1])['absolutePath']).read_text())
                rows.append({'kind':kind,'sample':case['id'],'taskId':record['id'],'state':final['state'],'inputSha256':sha,'results':final['results'],'encodedOutputPreserved':True,'report':report})
    verified=project.verify()
    output={'projectId':project.manifest['id'],'tasks':rows,'verification':{'valid':verified['valid'],'database':verified['database'],'versionCount':len(verified['versions'])}}
    args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'tasks':len(rows),'verification':output['verification']}))
    if not verified['valid']:raise SystemExit(1)


if __name__=='__main__':main()
