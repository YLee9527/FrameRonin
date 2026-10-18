"""Read-only reconciliation of actual browser document evidence and SQLite."""
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
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--project',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    project=Project(args.project);rows=[];task_ids=set()
    with zipfile.ZipFile(args.archive) as archive:
        records=json.loads(archive.read('documents.json'));assert len(records)==2
        assert [r['masked'] for r in records]==[False,True]
        for record in records:
            stored=json.loads(archive.read(f"{'masked' if record['masked'] else 'skip'}/document.json"))
            assert record['revision']==1 and record['conflictStatus']==400 and record['reopenedReferencesEqual'] and record['noAdditionalTasksOrAssets']
            for key in ['documentId','copyDocumentId']:
                document=project.document(record[key]);assert document['kind']=='video' and document['revision']==1 and document['payload']==stored
            stages=[]
            for key in ['capture','analysis','processed','rawSheet','styledSheet','rawDownload','processedDownload']:
                result=stored[key];t=task(project,result['taskId']);task_ids.add(t['id'])
                assert t['id'] in record['taskIds'] and t['state']=='succeeded' and t['results']==[result['data']['versionId'],result['report']['versionId']]
                assert t['payload']['inputs']==[r['versionId'] for r in result['inputs']]
                report=json.loads(Path(project.version(t['results'][1])['absolutePath']).read_text())
                assert report['parameters']==t['payload']['parameters']
                stages.append({'stage':key,'taskId':t['id'],'operation':t['payload']['operation'],'mode':t['payload']['parameters']['layout'].get('mode'),'results':t['results']})
            rows.append({**record,'stages':stages})
    verification=project.verify()
    with project.connection() as db:
        task_count=db.execute('SELECT count(*) FROM tasks').fetchone()[0];active=db.execute("SELECT count(*) FROM tasks WHERE state IN ('queued','running')").fetchone()[0];document_count=db.execute('SELECT count(*) FROM documents').fetchone()[0]
    assert verification['valid'] and active==0 and task_count==len(task_ids)==12 and document_count==4 and len(verification['versions'])==26
    result={'projectId':project.manifest['id'],'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'documents':rows,'verification':{'valid':True,'database':verification['database'],'versionCount':26,'taskCount':12,'documentCount':4,'activeTasks':0}}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result['verification']))

if __name__=='__main__':main()
