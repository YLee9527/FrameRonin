"""Durable jobs with owned process groups, cancellation epochs and bounded memory."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import psutil
from .errors import Cancelled, RoninError
from .operations import preview
from .project import Project, identifier, now

FINAL = {'succeeded', 'failed', 'canceled'}
ENTRY = Path(__file__).resolve().parents[1] / 'frameronin.py'


def task(project, task_id):
    with project.connection() as db:
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
    if not row:
        raise RoninError('TASK_MISSING', 'The task does not exist.')
    result = dict(row)
    for field in ['payload', 'results', 'error']:
        result[field] = json.loads(result[field]) if result[field] else None
    return result


def submit(project, payload):
    details = preview(project, payload)
    task_id = identifier()
    directory = project.safe(f'tasks/{task_id}')
    directory.mkdir()
    with project.writer(), project.connection() as db:
        db.execute('INSERT INTO tasks(id,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)',
                   (task_id, 'queued', json.dumps(payload), now(), now()))
    with (directory / 'worker.log').open('ab') as log:
        process = subprocess.Popen([sys.executable, str(ENTRY), 'worker', '--project', str(project.root), '--task', task_id],
                                   stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
        threading.Thread(target=process.wait, daemon=True).start()
    return {'id': task_id, 'state': 'queued', 'preview': {k: v for k, v in details.items() if k != 'versions'}}


def _owned_process(record):
    if not record['pid'] or not record['process_created']:
        return None
    try:
        process = psutil.Process(record['pid'])
        if abs(process.create_time() - record['process_created']) > 0.01:
            return None
        arguments = process.cmdline()
        if str(ENTRY) not in arguments or record['id'] not in arguments or 'worker' not in arguments:
            return None
        return process
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None


def cancel(project, task_id):
    requested = time.monotonic()
    with project.writer(), project.connection() as db:
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if not row:
            raise RoninError('TASK_MISSING', 'The task does not exist.')
        if row['state'] in FINAL:
            return task(project, task_id)
        record = dict(row)
        # Invalidate all completion callbacks before delivering any process signal.
        db.execute('UPDATE tasks SET state=?,generation=generation+1,updated_at=? WHERE id=?',
                   ('canceled', now(), task_id))
    process = _owned_process(record)
    if process:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        deadline = requested + 4.5
        while time.monotonic() < deadline:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.05)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    result = task(project, task_id)
    result['cancelElapsedSeconds'] = time.monotonic() - requested
    return result


def wait(project, task_id, timeout=60):
    deadline = time.monotonic() + timeout
    while True:
        result = task(project, task_id)
        if result['state'] in FINAL or time.monotonic() >= deadline:
            return result
        time.sleep(0.1)


def recover_tasks(project):
    with project.connection() as db:
        records = [dict(row) for row in db.execute("SELECT * FROM tasks WHERE state IN ('queued','running')")]
    results = []
    for record in records:
        if record['pid'] and not _owned_process(record):
            with project.writer(), project.connection() as db:
                db.execute('UPDATE tasks SET state=?,generation=generation+1,error=?,updated_at=? WHERE id=? AND state=?',
                           ('failed', json.dumps({'code': 'WORKER_INTERRUPTED', 'message': 'The worker stopped before completing.'}),
                            now(), record['id'], record['state']))
            results.append(record['id'])
    return results


def worker(project, task_id):
    process = psutil.Process()
    with project.writer(), project.connection() as db:
        record = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if not record or record['state'] != 'queued':
            return
        generation = record['generation']
        db.execute('UPDATE tasks SET state=?,pid=?,process_created=?,updated_at=? WHERE id=?',
                   ('running', process.pid, process.create_time(), now(), task_id))
    stop = threading.Event()
    try:
        details = preview(project, json.loads(record['payload']))
        directory = project.safe(f'tasks/{task_id}/output')
        peak = [0]

        def monitor():
            while not stop.wait(0.1):
                try:
                    family = [process] + process.children(recursive=True)
                    rss = 0
                    for child in family:
                        try:
                            rss += child.memory_info().rss
                        except psutil.NoSuchProcess:
                            continue
                    peak[0] = max(peak[0], rss)
                    if rss > details['budgetBytes']:
                        with project.writer(), project.connection() as db:
                            db.execute('UPDATE tasks SET state=?,generation=generation+1,error=?,updated_at=? WHERE id=? AND state=?',
                                       ('failed', json.dumps({'code': 'RESOURCE_LIMIT', 'message': 'Measured worker memory exceeded the budget.',
                                                            'peakBytes': rss, 'budgetBytes': details['budgetBytes']}),
                                        now(), task_id, 'running'))
                        os.killpg(os.getpid(), signal.SIGTERM)
                        return
                except psutil.NoSuchProcess:
                    return

        watchdog = threading.Thread(target=monitor, daemon=True)
        watchdog.start()

        def progress(value):
            with project.writer(), project.connection() as db:
                project._check_completion(db, task_id, generation)
                db.execute('UPDATE tasks SET progress=?,updated_at=? WHERE id=?', (max(0, min(0.99, value)), now(), task_id))

        from .media import run
        files = run(details, directory, progress)
        results = []
        for file in files:
            resolved = Path(file).resolve(strict=True)
            if not resolved.is_relative_to(directory):
                raise RoninError('OUTPUT_OUTSIDE_TASK', 'A worker returned a file outside its owned output directory.')
            results.append(project.import_file(resolved, asset_id=details['assetId'] if len(files) == 1 else None,
                                               origin=details['operation'], task_id=task_id, generation=generation, defer=True)['id'])
        project.finish_task(task_id, generation, results)
        (project.safe(f'tasks/{task_id}') / 'metrics.json').write_text(json.dumps({
            'peakControlledProcessBytes': peak[0], 'budgetBytes': details['budgetBytes'],
            'estimatedBytes': details['estimatedBytes'], 'processingMode': details['processingMode']}))
    except Cancelled:
        pass
    except (RoninError, OSError, ValueError, subprocess.SubprocessError) as error:
        information = error.record() if isinstance(error, RoninError) else {
            'code': 'PROCESSING_FAILED', 'message': str(error)[:1000]}
        with project.writer(), project.connection() as db:
            db.execute('UPDATE tasks SET state=?,error=?,updated_at=? WHERE id=? AND state=? AND generation=?',
                       ('failed', json.dumps(information), now(), task_id, 'running', generation))
    finally:
        stop.set()
