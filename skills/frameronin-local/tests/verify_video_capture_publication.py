"""Reconcile downloaded native capture evidence with its existing project.

Read-only: never creates, retries or republishes tasks. The browser sample page
must already have finished; a cancellation archive is optional.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

SKILL=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SKILL/'scripts'))
from frameronin_engine.project import Project
from frameronin_engine.tasks import task

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path)
    parser.add_argument('--project',type=Path,required=True)
    parser.add_argument('--cancellation',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();project=Project(args.project)
    manifest=json.loads((SKILL/'assets/fixtures/video-capture/manifest.json').read_text())
    rows=[]
    with zipfile.ZipFile(args.archive) as archive:
        records=json.loads(archive.read('tasks.json'))
        assert [r['sample'] for r in records]==[c['id'] for c in manifest['cases']], 'Missing/reordered sample records'
        for record,case in zip(records,manifest['cases']):
            assert record['source']==case['source']
            if record.get('rejected'):
                assert record['taskCreated'] is False and record['mediaCode'] in [3,4]
                source=project.version(record['sourceVersion'])
                assert source['sha256']==manifest['sources'][record['source']]
                with project.connection() as db:
                    tasks=[json.loads(row[0]) for row in db.execute('SELECT payload FROM tasks')]
                assert not any(source['id'] in p['inputs'] for p in tasks), 'Rejected source unexpectedly executed'
                rows.append(record);continue
            final=task(project,record['taskId'])
            assert final['state']=='succeeded' and final['results']==record['results'] and len(final['results'])==2
            payload=final['payload'];assert payload['operation']=='video.capture' and len(payload['inputs'])==1
            source=project.version(payload['inputs'][0]);assert source['sha256']==manifest['sources'][record['source']]
            parameters=payload['parameters'];assert parameters['renderer']=='browser-worker'
            assert all(parameters['layout'][k]==v for k,v in case['parameters'].items())
            content=archive.read(record['sample']+'/actual.zip')
            output=project.version(final['results'][0]);report=json.loads(Path(project.version(final['results'][1])['absolutePath']).read_text())
            assert output['sha256']==hashlib.sha256(content).hexdigest(), 'Published ZIP differs from downloaded capture'
            assert report['outputFrames']==record['frames']
            rows.append({**record,'state':final['state'],'input':source['id'],'encodedOutputPreserved':True,'report':report})
    cancellation=None
    if args.cancellation:
        with zipfile.ZipFile(args.cancellation) as archive:cancellation=json.loads(archive.read('cancellation.json'))
        key=cancellation['taskId'];final=task(project,key)
        assert cancellation['feedbackMs']<=1000 and cancellation['ownedDecoders']==0
        assert final['state']=='canceled' and final['generation']==1 and final['results']==[]
        assert final['payload']['operation']=='video.capture'
        directory=project.safe(f'tasks/{key}')
        assert not (directory/'output/browser-result.zip').exists(), 'Canceled output unexpectedly landed'
        stop=json.loads((directory/'cancellation.json').read_text())
        assert stop['processStopConfirmed'] and stop['scope']=='local_owned_processes' and stop['cancelElapsedSeconds']<=5
        cancellation={**cancellation,'finalState':final['state'],'lateResultAbsent':True,'backendStop':stop}
    verification=project.verify()
    with project.connection() as db:
        active=db.execute("SELECT count(*) FROM tasks WHERE state IN ('queued','running')").fetchone()[0]
        task_count=db.execute('SELECT count(*) FROM tasks').fetchone()[0]
    assert verification['valid'] and active==0, 'Project verification failed or tasks still active'
    result={'projectId':project.manifest['id'],'samples':rows,'cancellation':cancellation,'verification':{'valid':verification['valid'],'database':verification['database'],'versionCount':len(verification['versions']),'taskCount':task_count,'activeTasks':active}}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'samples':len(rows),'verification':result['verification'],'canceled':bool(cancellation)}))

if __name__=='__main__':main()
