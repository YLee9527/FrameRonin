"""A browser Worker supplies pixels; the owned queue worker alone publishes them.

The existing task generation, serial dispatcher, process cancellation and atomic
completion remain authoritative. No browser-provided path or output format is used.
"""
import json
import os
import time
from pathlib import Path
from PIL import Image
from .errors import RoninError
from .project import Project, checked_id

LEASE_SECONDS=15


def location(project,task_id,generation=None):
    checked_id(task_id)
    with project.connection() as db:
        row=db.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
        if not row:
            raise RoninError('TASK_MISSING','The task does not exist.')
        payload=json.loads(row['payload'])
        if payload['operation']!='image.customScale' or payload.get('parameters',{}).get('renderer')!='browser-worker':
            raise RoninError('BROWSER_OPERATION_UNSUPPORTED','This task does not accept browser pixels.')
        if generation is not None:
            if type(generation) is not int:
                raise RoninError('BROWSER_GENERATION_INVALID','A canonical execution generation is required.')
            project._check_completion(db,task_id,generation)
    return project.safe(f'tasks/{task_id}/output'),dict(row)


def ready(project,task_id):
    directory,row=location(project,task_id)
    request=project.safe(f'tasks/{task_id}/output/browser-request.json')
    if row['state']!='running' or not request.is_file():return {'ready':False,'state':row['state']}
    return {'ready':True,'generation':row['generation'],'leaseSeconds':LEASE_SECONDS}


def heartbeat(project,task_id,generation):
    with project.writer():
        directory,_=location(project,task_id,generation)
        lease=project.safe(f'tasks/{task_id}/output/browser-heartbeat')
        if not lease.is_file():raise RoninError('BROWSER_NOT_READY','The owned queue worker has not requested pixels.')
        os.utime(lease,None)
    return {'accepted':True}


def accept(project,task_id,generation,source):
    directory,row=location(project,task_id,generation)
    from .operations import parameters as checked_parameters
    parameters=checked_parameters('image.customScale',json.loads(row['payload'])['parameters'])
    # Decode and inspect outside the writer lock so cancellation is responsive.
    try:
        with Image.open(source) as image:
            if image.format!='PNG' or image.size!=(parameters['width'],parameters['height']) or getattr(image,'n_frames',1)!=1:
                raise RoninError('BROWSER_OUTPUT_INVALID','The Worker result must be one PNG with the reviewed dimensions.')
            image.load()
    except (OSError,ValueError,Image.DecompressionBombError) as error:
        raise RoninError('BROWSER_OUTPUT_INVALID','The Worker did not return a decodable PNG.') from error
    target=project.safe(f'tasks/{task_id}/output/browser-result.png')
    with project.writer():
        location(project,task_id,generation)
        if not project.safe(f'tasks/{task_id}/output/browser-request.json').is_file():raise RoninError('BROWSER_NOT_READY','The queue worker has not requested pixels.')
        try:os.link(source,target)
        except FileExistsError as error:raise RoninError('BROWSER_OUTPUT_EXISTS','The execution already received a result; reconcile it instead of resubmitting.') from error
    return {'accepted':True,'generation':generation}


def fail(project,task_id,generation):
    with project.writer():
        directory,_=location(project,task_id,generation)
        marker=project.safe(f'tasks/{task_id}/output/browser-error.json')
        if not marker.exists():marker.write_text(json.dumps({'code':'BROWSER_WORKER_FAILED','message':'The browser Worker failed or is unsupported. No native filter was substituted.'}))
    return {'accepted':True}


def wait_for_result(preview,directory,progress):
    project=Project(directory.parents[2]);task_id=directory.parent.name
    _,row=location(project,task_id)
    lease=directory/'browser-heartbeat';lease.touch()
    request=directory/'browser-request.json'
    request.write_text(json.dumps({'generation':row['generation'],'operation':preview['operation']}))
    result=directory/'browser-result.png';error=directory/'browser-error.json'
    started=time.monotonic()
    while not result.is_file():
        progress(.1)
        if error.is_file():raise RoninError('BROWSER_WORKER_FAILED','The browser Worker failed or is unavailable. Its result was not registered.')
        if time.time()-lease.stat().st_mtime>LEASE_SECONDS:
            raise RoninError('BROWSER_WORKER_DISCONNECTED','The workbench stopped responding. Reconcile this task before starting another attempt.')
        time.sleep(.1)
    location(project,task_id,row['generation'])
    report=directory/'report.json'
    report.write_text(json.dumps({'operation':preview['operation'],'parameters':preview['parameters'],
        'method':'original-host-canvas-worker','generation':row['generation'],'outputFrames':1,'elapsedSeconds':time.monotonic()-started}))
    progress(.9)
    return [result,report]
