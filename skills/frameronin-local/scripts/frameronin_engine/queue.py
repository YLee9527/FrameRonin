"""One durable dispatcher per installed runtime; queued jobs allocate no worker."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import psutil
from .errors import RoninError
from .project import Project, checked_id, now

ROOT = Path(__file__).resolve().parents[2]
ENTRY = ROOT / 'scripts/frameronin.py'
RUNTIME = ROOT / '.runtime'


@contextmanager
def connection():
    RUNTIME.mkdir(exist_ok=True)
    database = sqlite3.connect(RUNTIME / 'queue.sqlite', timeout=30)
    database.row_factory = sqlite3.Row
    database.execute('PRAGMA journal_mode=WAL')
    database.execute('CREATE TABLE IF NOT EXISTS jobs(project TEXT NOT NULL,task TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(project,task))')
    database.execute('CREATE TABLE IF NOT EXISTS dispatcher(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER,created REAL)')
    try:
        database.execute('BEGIN IMMEDIATE')
        yield database
        database.commit()
    except BaseException:
        database.rollback()
        raise
    finally:
        database.close()


def owned_dispatcher(record):
    if not record or not record['pid']: return False
    try:
        process = psutil.Process(record['pid'])
        return abs(process.create_time() - record['created']) < 0.01 and process.cmdline() == [sys.executable, str(ENTRY), 'dispatch']
    except psutil.Error:
        return False


def _start(database):
    record = database.execute('SELECT * FROM dispatcher WHERE id=1').fetchone()
    if owned_dispatcher(record): return
    with (RUNTIME / 'dispatcher.log').open('ab') as log:
        process = subprocess.Popen([sys.executable, str(ENTRY), 'dispatch'], stdout=log, stderr=log,
                                   stdin=subprocess.DEVNULL, start_new_session=True)
        created = psutil.Process(process.pid).create_time()
        database.execute('INSERT OR REPLACE INTO dispatcher VALUES(1,?,?)', (process.pid, created))
        threading.Thread(target=process.wait, daemon=True).start()


def enqueue(project, task_id):
    checked_id(task_id)
    with connection() as database:
        database.execute('INSERT OR IGNORE INTO jobs VALUES(?,?,?)', (str(project.root), task_id, now()))
        _start(database)


def dispatch():
    # A separate lock prevents overlap if a previous dispatcher lost its registry lease.
    RUNTIME.mkdir(exist_ok=True)
    with (RUNTIME / 'dispatch.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        while True:
            with connection() as database:
                job = database.execute('SELECT * FROM jobs ORDER BY created,task LIMIT 1').fetchone()
                if not job:
                    database.execute('DELETE FROM dispatcher WHERE pid=?', (os.getpid(),))
                    return
                job = dict(job)
            project = None
            try:
                project = Project(job['project'])
                existing = None
                with project.writer(), project.connection() as database:
                    record = database.execute('SELECT * FROM tasks WHERE id=?', (job['task'],)).fetchone()
                    if not record or record['state'] in {'succeeded', 'failed', 'canceled'}:
                        process = None
                    elif record['pid']:
                        from .tasks import _owned_process
                        existing = _owned_process(dict(record))
                        if not existing:
                            raise RoninError('WORKER_INTERRUPTED', 'The previous worker stopped before publishing its result.')
                        process = None
                    elif record['state'] != 'queued':
                        raise RoninError('QUEUE_STATE_UNKNOWN', 'Reconcile the existing task before dispatching it again.')
                    else:
                        directory = project.safe(f'tasks/{job["task"]}')
                        with (directory / 'worker.log').open('ab') as log:
                            process = subprocess.Popen([sys.executable, str(ENTRY), 'worker', '--project', str(project.root), '--task', job['task']],
                                                       stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
                        database.execute('UPDATE tasks SET pid=?,process_created=?,updated_at=? WHERE id=?',
                                         (process.pid, psutil.Process(process.pid).create_time(), now(), job['task']))
                if process:
                    process.wait()
                if existing:
                    # Reconnect to the original process; never run an uncertain task twice.
                    while existing.is_running() and existing.status() != psutil.STATUS_ZOMBIE:
                        time.sleep(0.1)
                if process or existing:
                    with project.writer(), project.connection() as database:
                        database.execute('UPDATE tasks SET state=?,generation=generation+1,error=?,updated_at=? WHERE id=? AND state IN (?,?)',
                                         ('failed', json.dumps({'code':'WORKER_INTERRUPTED','message':'The worker stopped before publishing its result.'}),
                                          now(), job['task'], 'queued', 'running'))
            except (RoninError, OSError, ValueError, sqlite3.Error, psutil.NoSuchProcess) as error:
                if project:
                    information = error.record() if isinstance(error, RoninError) else {'code':'DISPATCH_FAILED','message':str(error)[:500]}
                    with project.writer(), project.connection() as database:
                        database.execute('UPDATE tasks SET state=?,generation=generation+1,error=?,updated_at=? WHERE id=? AND state IN (?,?)',
                                         ('failed', json.dumps(information), now(), job['task'], 'queued', 'running'))
            finally:
                with connection() as database:
                    database.execute('DELETE FROM jobs WHERE project=? AND task=?', (job['project'], job['task']))
