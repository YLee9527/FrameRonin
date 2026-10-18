"""Loopback-only workbench API. Never serves arbitrary filesystem paths."""
import asyncio
import json
from pathlib import Path
import tempfile
import uuid
from fastapi import FastAPI, File, Form, UploadFile, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from .errors import RoninError
from .operations import REGISTRY, preview
from .project import Project, checked_id, identifier, now, memory_budget
from .tasks import submit, task, cancel, recover_tasks

WORKBENCH = Path(__file__).resolve().parents[2] / 'assets/workbench/dist'


def application(project, port):
    app = FastAPI(title='FrameRonin Local', docs_url=None, redoc_url=None)
    allowed_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
    allowed_origins = {f'http://{host}' for host in allowed_hosts}

    @app.middleware('http')
    async def local_only(request, call_next):
        if request.headers.get('host') not in allowed_hosts:
            return JSONResponse({'detail': 'Untrusted host'}, status_code=403)
        if request.method not in ['GET', 'HEAD']:
            if request.headers.get('origin') not in allowed_origins or request.headers.get('x-frameronin-local') != '1':
                return JSONResponse({'detail': 'Only same-origin workbench writes are allowed'}, status_code=403)
        return await call_next(request)

    @app.exception_handler(RoninError)
    async def ronin_error(_request, error):
        return JSONResponse({'detail': error.message, 'error': error.record()}, status_code=400)

    @app.get('/api/project')
    def get_project():
        return {'project': project.manifest, 'assets': project.assets(), 'operations': REGISTRY, 'memoryBudgetBytes': memory_budget()}

    @app.get('/api/project/context')
    def project_context():
        # Imports and document restores need identity and limits, not the full
        # asset library and its thumbnails on every request.
        return {'project': project.manifest, 'operations': REGISTRY, 'memoryBudgetBytes': memory_budget()}

    @app.get('/api/tasks/{task_id}/browser/input')
    def native_browser_input(task_id: str, generation: int):
        from .browser_tasks import input_source
        version=input_source(project,task_id,generation)
        return FileResponse(version['absolutePath'],headers={'Cache-Control':'no-store'})

    async def import_upload(file, asset_id=None):
        suffix = Path(file.filename or 'upload').suffix.lower()
        temporary = project.safe(f'.pending/upload-{identifier()}{suffix}')
        written = 0
        try:
            with temporary.open('xb') as output:
                while block := await file.read(1024 * 1024):
                    written += len(block)
                    if written > 4 * 1024**3:
                        raise RoninError('FILE_LIMIT', 'The uploaded file exceeds 4 GiB.')
                    output.write(block)
            version = await asyncio.to_thread(project.import_file, temporary, asset_id)
            with project.writer(), project.connection() as db:
                db.execute('UPDATE assets SET name=? WHERE id=?', (Path(file.filename or 'Imported asset').name, version['asset_id']))
            return version
        finally:
            await file.close()
            if temporary.exists():
                temporary.unlink()

    @app.post('/api/assets')
    async def import_asset(file: UploadFile = File(...), assetId: str | None = Form(None)):
        return await import_upload(file, assetId)

    @app.get('/api/versions/{version_id}')
    def get_version(version_id: str):
        return project.version(version_id)

    @app.get('/api/versions/{version_id}/content')
    def version_content(version_id: str):
        version = project.version(version_id)
        return FileResponse(version['absolutePath'])

    @app.post('/api/versions/manifest')
    def version_manifest(payload:dict):
        if set(payload)!={'versions'} or not isinstance(payload['versions'],list) or not 1<=len(payload['versions'])<=8192 or not all(isinstance(value,str) for value in payload['versions']) or len(set(payload['versions']))!=len(payload['versions']):
            raise RoninError('VERSION_MANIFEST_INVALID','Select up to 8192 unique canonical version IDs.')
        values=[];retained=0
        for version_id in payload['versions']:
            checked_id(version_id);version=project.version(version_id)
            public={key:version.get(key) for key in ['id','name','metadata']}
            retained+=len(json.dumps(public))*2
            if retained>memory_budget()//16:raise RoninError('VERSION_MANIFEST_LIMIT','The metadata response exceeds its budget; select fewer resources.')
            values.append(public)
        return values

    @app.post('/api/tasks/preview')
    def task_preview(payload: dict):
        result = preview(project, payload)
        result.pop('versions', None)
        return result

    @app.post('/api/tasks')
    def create_task(payload: dict):
        return submit(project, payload,browser_client=True)

    @app.post('/api/tasks/manifest')
    def task_manifest(payload:dict):
        # Editor lineage needs provenance, not all historical parameters, events,
        # file buffers or the most recent 200 tasks in the project list.
        ids=payload.get('tasks')
        if set(payload)!={'tasks'} or not isinstance(ids,list) or not 1<=len(ids)<=8192 or not all(isinstance(value,str) for value in ids) or len(set(ids))!=len(ids):
            raise RoninError('TASK_MANIFEST_INVALID','Select up to 8192 unique canonical task IDs.')
        values=[];retained=0
        with project.connection() as db:
            for task_id in ids:
                checked_id(task_id)
                row=db.execute('SELECT id,state,payload,results FROM tasks WHERE id=?',(task_id,)).fetchone()
                if row is None:raise RoninError('TASK_MISSING','The task does not exist in this project.')
                request=json.loads(row['payload'])
                public={'id':row['id'],'state':row['state'],'operation':request['operation'],'inputs':request['inputs'],'results':json.loads(row['results'])}
                retained+=len(json.dumps(public))*2
                if retained>min(memory_budget()//16,16*1024**2):raise RoninError('TASK_MANIFEST_LIMIT','The lineage metadata exceeds its response budget.')
                values.append(public)
        return values

    @app.post('/api/proposals')
    def create_proposal(payload: dict):
        from .proposals import save
        if set(payload) - {'id','revision','request','selectedVersions'} or not {'request','selectedVersions'} <= payload.keys():
            raise RoninError('PROPOSAL_FIELDS_INVALID', 'Unexpected proposal fields.')
        return save(project, payload['request'], payload['selectedVersions'], payload.get('id'), payload.get('revision', 0))

    @app.get('/api/proposals/{proposal_id}')
    def get_proposal(proposal_id: str):
        from .proposals import get
        return get(project, proposal_id)

    @app.post('/api/proposals/{proposal_id}/execute')
    def execute_proposal(proposal_id: str, payload: dict):
        from .proposals import execute
        if set(payload) != {'revision'}:
            raise RoninError('PROPOSAL_FIELDS_INVALID', 'Execution requires the exact reviewed revision.')
        return execute(project, proposal_id, payload['revision'])

    @app.get('/api/tasks/{task_id}')
    def task_status(task_id: str):
        return task(project, task_id)

    @app.post('/api/tasks/{task_id}/cancel')
    async def cancel_task(task_id: str):
        return await asyncio.to_thread(cancel, project, task_id)

    @app.get('/api/tasks/{task_id}/results')
    def result_manifest(task_id:str):
        record=task(project,task_id)
        if record['state']!='succeeded':raise RoninError('TASK_NOT_COMPLETE','Only accepted task results can be previewed.')
        versions=[project.version(version_id) for version_id in record['results']]
        return [{key:version.get(key) for key in ['id','name','metadata']} for version in versions]

    @app.get('/api/tasks')
    def list_tasks():
        with project.connection() as db:
            ids = [row[0] for row in db.execute('SELECT id FROM tasks ORDER BY created_at DESC LIMIT 200')]
        return [task(project, value) for value in ids]

    @app.get('/api/tasks/{task_id}/browser')
    def browser_ready(task_id:str):
        from .browser_tasks import ready
        return ready(project,task_id)

    @app.post('/api/tasks/{task_id}/browser/heartbeat')
    def browser_heartbeat(task_id:str,payload:dict):
        from .browser_tasks import heartbeat
        if set(payload)!={'generation'}:raise RoninError('BROWSER_FIELDS_INVALID','Only the execution generation is accepted.')
        return heartbeat(project,task_id,payload['generation'])

    @app.post('/api/tasks/{task_id}/browser/failure')
    def browser_failure(task_id:str,payload:dict):
        from .browser_tasks import fail
        if set(payload)!={'generation'}:raise RoninError('BROWSER_FIELDS_INVALID','Only the execution generation is accepted.')
        return fail(project,task_id,payload['generation'])

    @app.post('/api/tasks/{task_id}/browser/result')
    async def browser_result(task_id:str,generation:int=Form(...),file:UploadFile=File(...)):
        from .browser_tasks import location,accept
        location(project,task_id,generation)
        temporary=project.safe(f'tasks/{task_id}/output/browser-upload-{identifier()}.png')
        written=0
        try:
            with temporary.open('xb') as output:
                while block:=await file.read(1024*1024):
                    written+=len(block)
                    if written>min(memory_budget()//4,128*1024**2):raise RoninError('BROWSER_OUTPUT_LIMIT','The encoded Worker result exceeds its upload budget.')
                    output.write(block)
            return await asyncio.to_thread(accept,project,task_id,generation,temporary)
        finally:
            await file.close()
            if temporary.exists():temporary.unlink()

    @app.post('/api/jobs')
    async def create_video_job(file: UploadFile = File(...), params: str = Form('{}')):
        version = await import_upload(file)
        original = json.loads(params)
        known = {'fps', 'frame_range', 'max_frames', 'target_size', 'bg_color', 'transparent', 'padding', 'spacing',
                 'layout_mode', 'columns', 'matte_strength', 'crop_mode'}
        if set(original) - known:
            raise RoninError('PARAMETER_UNKNOWN', 'Unknown video parameters.')
        values = {'fps': original.get('fps', 12), 'start': original.get('frame_range', {}).get('start_sec', 0),
                  'end': original.get('frame_range', {}).get('end_sec', 5), 'maxFrames': original.get('max_frames', 300),
                  'width': original.get('target_size', {}).get('w', 256), 'height': original.get('target_size', {}).get('h', 256),
                  'background': original.get('bg_color', '#000000'), 'transparent': original.get('transparent', True),
                  'padding': original.get('padding', 0), 'spacing': original.get('spacing', 0),
                  'columns': original.get('columns', 4), 'layout': original.get('layout_mode', 'fixed_columns'),
                  'matteStrength': original.get('matte_strength', 0.6), 'crop': original.get('crop_mode', 'tight_bbox')}
        result = submit(project, {'operation': 'video.extract', 'inputs': [version['id']], 'parameters': values})
        return {'job_id': result['id']}

    def legacy_status(task_id):
        record = task(project, task_id)
        state = {'queued': 'queued', 'running': 'processing', 'succeeded': 'completed', 'failed': 'failed', 'canceled': 'canceled'}
        result = {'id': task_id, 'status': state[record['state']], 'progress': record['progress'], 'error': record['error']}
        if record['state'] == 'succeeded' and record['results']:
            version = project.version(record['results'][0])
            result['result'] = version['metadata']
        return result

    @app.get('/api/jobs/{task_id}')
    def video_status(task_id: str):
        return legacy_status(task_id)

    def result_content(task_id, suffix):
        record = task(project, task_id)
        if record['state'] != 'succeeded':
            raise RoninError('TASK_NOT_COMPLETE', 'The task has no accepted results.')
        for version_id in record['results']:
            version = project.version(version_id)
            if Path(version['path']).suffix == suffix:
                return FileResponse(version['absolutePath'], filename=f'FrameRonin-{task_id}{suffix}')
        raise RoninError('RESULT_FORMAT_MISSING', 'The task did not produce this format.')

    @app.get('/api/jobs/{task_id}/result')
    def video_result(task_id: str, format: str = 'png'):
        if format not in ['png', 'zip']:
            raise RoninError('RESULT_FORMAT_INVALID', 'Supported video outputs are PNG and ZIP.')
        return result_content(task_id, f'.{format}')

    @app.get('/api/jobs/{task_id}/index')
    def video_index(task_id: str):
        return result_content(task_id, '.json')

    @app.post('/api/watermark')
    async def create_watermark(file: UploadFile = File(...)):
        version = await import_upload(file)
        result = submit(project, {'operation': 'video.watermark', 'inputs': [version['id']], 'parameters': {}})
        return {'job_id': result['id']}

    @app.get('/api/watermark/{task_id}')
    def watermark_status(task_id: str):
        return legacy_status(task_id)

    @app.get('/api/watermark/{task_id}/result')
    def watermark_result(task_id: str):
        return result_content(task_id, '.mp4')

    @app.post('/api/matte')
    async def matte(file: UploadFile = File(...)):
        version = await import_upload(file)
        record = submit(project, {'operation': 'image.matte', 'inputs': [version['id']], 'parameters': {}})
        try:
            while True:
                current = task(project, record['id'])
                if current['state'] == 'succeeded':
                    return result_content(record['id'], '.png')
                if current['state'] in ['failed', 'canceled']:
                    raise RoninError('MATTE_FAILED', 'Background removal did not complete.', current['error'])
                await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            await asyncio.to_thread(cancel, project, record['id'])
            raise

    @app.get('/api/documents')
    def documents():
        with project.connection() as db:
            return [dict(row) for row in db.execute('SELECT id,kind,revision,updated_at FROM documents ORDER BY updated_at DESC')]

    @app.get('/api/documents/{document_id}')
    def document(document_id: str):
        return project.document(document_id)

    @app.post('/api/documents/{document_id}')
    def save_document(document_id: str, payload: dict):
        if set(payload) != {'kind', 'revision', 'payload'}:
            raise RoninError('DOCUMENT_FIELDS_INVALID', 'Unexpected document fields.')
        return project.save_document(document_id, payload['kind'], payload['payload'], payload['revision'])

    @app.post('/api/ai/requests')
    def ai_request(payload: dict):
        if set(payload) != {'template', 'prompt', 'references'} or not isinstance(payload['prompt'], str) or not 0 < len(payload['prompt']) <= 32000 or not isinstance(payload['template'], str) or not 0 < len(payload['template']) <= 200 or not isinstance(payload['references'], list) or len(payload['references']) > 16 or not all(isinstance(value, str) for value in payload['references']) or len(set(payload['references'])) != len(payload['references']):
            raise RoninError('AI_REQUEST_INVALID', 'Invalid AI request.')
        for version_id in payload['references']:
            if project.version(version_id)['metadata']['kind'] != 'image':
                raise RoninError('AI_REFERENCE_KIND', 'Select still images as references.')
        request_id = identifier()
        # A request is a reviewable document; creating it never dispatches ImageGen.
        project.save_document(request_id, 'ai-request', {'type': 'imagegen-request', **payload}, 0)
        return {'id': request_id, 'state': 'awaiting_codex', 'instruction': f'Use $frameronin-local to execute image request {request_id} in the current project.'}

    if WORKBENCH.is_dir():
        app.mount('/', StaticFiles(directory=WORKBENCH, html=True), name='workbench')
    return app


def serve(project, port=8765):
    if not WORKBENCH.is_dir():
        raise RoninError('WORKBENCH_NOT_BUILT', 'Run setup.py --workbench before starting the workbench.')
    if not 1024 <= port <= 65535:
        raise RoninError('PORT_INVALID', 'Select an unprivileged local port.')
    project.recover()
    recover_tasks(project)
    print(json.dumps({'url': f'http://127.0.0.1:{port}', 'project': project.manifest}), flush=True)
    uvicorn.run(application(project, port), host='127.0.0.1', port=port, log_level='warning')
