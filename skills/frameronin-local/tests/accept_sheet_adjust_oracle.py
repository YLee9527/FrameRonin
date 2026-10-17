"""Publish actual adjustment Worker outputs through the formal project queue."""
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
    fixture=SKILL/'assets/fixtures/sheet-adjust';manifest=json.loads((fixture/'manifest.json').read_text())
    project=Project.create(args.project,'FrameRonin 精灵表调整内核验收');source=project.import_file(fixture/'frames.zip');records=[]
    with zipfile.ZipFile(args.archive) as archive,tempfile.TemporaryDirectory(prefix='frameronin-sheet-adjust-') as temporary:
        for entry in manifest['cases']:
            action=entry['action'];operation={'compose':'image.sheetCompose','gif':'image.sheetGif','fix':'image.sheetFix'}[action];ext={'compose':'png','gif':'gif','fix':'zip'}[action]
            payload={'operation':operation,'inputs':[source['id']],'parameters':{'layout':entry['layout'],'renderer':'browser-worker','frontendBytes':0}}
            created=submit(project,payload,browser_client=True);deadline=time.monotonic()+20
            while not ready(project,created['id'])['ready']:
                if time.monotonic()>deadline:raise RuntimeError('No owned adjustment browser request')
                time.sleep(.05)
            data=archive.read(f'{entry["id"]}/actual.{ext}')
            # Each accepted path gets its own inode: accept links the bytes into
            # the task directory, so a later case must never overwrite that file.
            output=Path(temporary)/f'{entry["id"]}.{ext}';output.write_bytes(data);accept(project,created['id'],0,output)
            final=wait(project,created['id'],20)
            if final['state']!='succeeded':raise RuntimeError(f'Adjustment publication failed: {final}')
            version=project.version(final['results'][0]);assert version['sha256']==hashlib.sha256(data).hexdigest()
            report=json.loads(Path(project.version(final['results'][1])['absolutePath']).read_text())
            records.append({'sample':entry['id'],'action':action,'taskId':created['id'],'state':final['state'],'results':final['results'],'encodedOutputPreserved':True,'report':report})
    verified=project.verify();result={'projectId':project.manifest['id'],'tasks':records,'verification':{'valid':verified['valid'],'database':verified['database'],'versionCount':len(verified['versions'])}}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'tasks':len(records),'verification':result['verification']}))
    if not verified['valid']:raise SystemExit(1)


if __name__=='__main__':main()
