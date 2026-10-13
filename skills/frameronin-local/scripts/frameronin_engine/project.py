"""正式项目格式 1、素材版本、原子落盘、事务登记及恢复。"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import uuid
import zipfile

from .errors import RoninError, Cancelled

FORMAT_VERSION = 1
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | {'.mp4', '.mov', '.mkv', '.webm', '.avi', '.wav', '.mp3', '.ogg', '.zip', '.psd', '.json', '.gd', '.tscn', '.tres'}


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier():
    return str(uuid.uuid4())


def checked_id(value):
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError()
    except (ValueError, TypeError, AttributeError) as error:
        raise RoninError('ID_INVALID', 'IDs must be canonical UUID strings.') from error
    return value


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        while block := source.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def memory_budget():
    import psutil
    return min(psutil.virtual_memory().total // 4, 2 * 1024**3)


def inspect_media(path):
    path = Path(path)
    result = {'bytes': path.stat().st_size, 'extension': path.suffix.lower()}
    if path.suffix.lower() in IMAGE_EXTENSIONS:
        from PIL import Image
        try:
            with Image.open(path) as image:
                width, height = image.size
                estimate = width * height * 4 * 3 + 128 * 1024**2
                if estimate > memory_budget():
                    raise RoninError('RESOURCE_LIMIT', 'Image decoding exceeds the project memory budget.',
                                     {'estimatedBytes': estimate, 'budgetBytes': memory_budget()})
                count = getattr(image, 'n_frames', 1)
                durations = []
                transparency = False
                for index in range(count):
                    image.seek(index)
                    image.load()
                    durations.append(int(image.info.get('duration', 100)))
                    if image.mode == 'RGBA' or 'transparency' in image.info:
                        transparency |= image.convert('RGBA').getchannel('A').getextrema()[0] < 255
                result.update(kind='image' if count == 1 else 'animation', width=width, height=height,
                              frames=count, durationsMs=durations, transparency=transparency,
                              pixelFormat='RGBA8', processingDimensions={'width': width, 'height': height})
        except RoninError:
            raise
        except (OSError, ValueError, Image.DecompressionBombError) as error:
            raise RoninError('INVALID_IMAGE', 'The selected file cannot be fully decoded as an image.') from error
    else:
        result['kind'] = ('video' if path.suffix.lower() in {'.mp4', '.mov', '.mkv', '.webm', '.avi'} else
                          'audio' if path.suffix.lower() in {'.wav', '.mp3', '.ogg'} else
                          'script_pending_review' if path.suffix.lower() == '.gd' else 'document')
        if result['kind'] in ['video', 'audio']:
            import subprocess
            try:
                decoded = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format',
                    '-show_streams', '-of', 'json', str(path)], timeout=30, stderr=subprocess.DEVNULL))
            except (subprocess.SubprocessError, ValueError) as error:
                raise RoninError('INVALID_MEDIA', 'The selected media cannot be decoded by ffprobe.') from error
            selected = next((stream for stream in decoded.get('streams', []) if stream.get('codec_type') == result['kind']), None)
            if not selected:
                raise RoninError('INVALID_MEDIA', 'The selected media has no required stream.')
            result.update(durationSeconds=float(decoded.get('format', {}).get('duration', 0)),
                          codec=selected.get('codec_name'), width=selected.get('width', 0), height=selected.get('height', 0))
        elif path.suffix.lower() == '.zip':
            try:
                with zipfile.ZipFile(path) as bundle:
                    entries = bundle.infolist()
                    if len(entries) > 10000 or sum(item.file_size for item in entries) > 4 * 1024**3:
                        raise RoninError('ARCHIVE_LIMIT', 'The archive exceeds entry or decoded size limits.')
                    names = [item.filename for item in entries]
                    if len(names) != len(set(names)) or any(Path(name).is_absolute() or '..' in Path(name).parts for name in names):
                        raise RoninError('ARCHIVE_PATH_INVALID', 'The archive contains duplicate or unsafe paths.')
                    for item in entries:
                        with bundle.open(item) as source:
                            while source.read(1024 * 1024):
                                pass
                    result.update(entries=len(entries), decodedBytes=sum(item.file_size for item in entries))
            except zipfile.BadZipFile as error:
                raise RoninError('INVALID_ARCHIVE', 'The archive failed content validation.') from error
        elif path.suffix.lower() == '.json':
            if path.stat().st_size > 64 * 1024**2:
                raise RoninError('DOCUMENT_LIMIT', 'The JSON document exceeds 64 MiB.')
            try:
                json.loads(path.read_text(), parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
            except (ValueError, UnicodeError) as error:
                raise RoninError('INVALID_JSON', 'The JSON document has invalid content.') from error
    return result


SCHEMA = '''
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,current_version TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),parent_id TEXT,
 path TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL,origin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,state TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,
 payload TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,pid INTEGER,process_created REAL,error TEXT,
 results TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,version_id TEXT NOT NULL,parent_id TEXT,
 name TEXT NOT NULL,temp_path TEXT NOT NULL,final_path TEXT NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,
 origin TEXT NOT NULL,task_id TEXT,generation INTEGER,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_attempts(id TEXT PRIMARY KEY,sample_id TEXT NOT NULL,attempt INTEGER NOT NULL,state TEXT NOT NULL,
 template TEXT NOT NULL,prompt TEXT NOT NULL,reference_versions TEXT NOT NULL,result_version TEXT,quality TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_history(document_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,
 created_at TEXT NOT NULL,PRIMARY KEY(document_id,revision));
CREATE TABLE IF NOT EXISTS recovery_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,path TEXT,details TEXT NOT NULL,created_at TEXT NOT NULL);
'''


class Project:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        manifest_path = self.safe('project.json')
        if not manifest_path.is_file():
            raise RoninError('PROJECT_MISSING', 'Select or initialize a FrameRonin project.')
        self.manifest = json.loads(manifest_path.read_text())
        if self.manifest.get('formatVersion') != FORMAT_VERSION:
            raise RoninError('PROJECT_VERSION_UNSUPPORTED', 'The project format is not supported.')
        for path in ['project.sqlite', 'project.sqlite-wal', 'project.sqlite-shm', '.write.lock']:
            self.safe(path)
        self.db_path = self.safe('project.sqlite')

    @classmethod
    def create(cls, root, name='FrameRonin', language='zh'):
        root = Path(root).expanduser().resolve()
        if root.exists() and any(root.iterdir()):
            raise RoninError('PROJECT_NOT_EMPTY', 'Initialize into an empty directory; existing data is preserved.')
        if language not in ['zh', 'en', 'ja']:
            raise RoninError('LANGUAGE_INVALID', 'Supported languages are zh, en and ja.')
        root.mkdir(parents=True, exist_ok=True)
        for folder in ['assets', 'tasks', 'exports', 'documents', '.pending']:
            (root / folder).mkdir()
        manifest = {'formatVersion': FORMAT_VERSION, 'id': identifier(), 'name': name,
                    'language': language, 'createdAt': now()}
        with (root / 'project.json').open('x') as output:
            json.dump(manifest, output, ensure_ascii=False, indent=2)
        project = cls(root)
        with project.connection() as db:
            db.executescript(SCHEMA)
        return project

    def safe(self, relative):
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts:
            raise RoninError('PATH_OUTSIDE_PROJECT', 'Only relative project paths are accepted.')
        cursor = self.root
        for part in path.parts:
            cursor /= part
            if cursor.is_symlink():
                raise RoninError('PROJECT_SYMLINK', 'Project-managed files cannot be symbolic links.')
        resolved = cursor.resolve()
        if not resolved.is_relative_to(self.root):
            raise RoninError('PATH_OUTSIDE_PROJECT', 'The requested path escapes the project.')
        return resolved

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA journal_mode=WAL')
        try:
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def writer(self):
        lock_path = self.safe('.write.lock')
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def assets(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute('SELECT * FROM assets ORDER BY created_at,id')]

    def version(self, version_id, verify=True):
        with self.connection() as db:
            row = db.execute('SELECT * FROM versions WHERE id=?', (version_id,)).fetchone()
        if not row:
            raise RoninError('VERSION_MISSING', 'The selected asset version no longer exists.')
        result = dict(row)
        result['metadata'] = json.loads(result['metadata'])
        path = self.safe(result['path'])
        if not path.is_file() or (verify and digest(path) != result['sha256']):
            raise RoninError('VERSION_CONTENT_CHANGED', 'The selected asset version is missing or its content changed.')
        result['absolutePath'] = str(path)
        return result

    def import_file(self, source, asset_id=None, origin='import', task_id=None, generation=None, defer=False):
        source = Path(source).expanduser().resolve(strict=True)
        if not source.is_file() or source.suffix.lower() not in MEDIA_EXTENSIONS:
            raise RoninError('FORMAT_UNSUPPORTED', 'The selected file format is not supported.')
        if source.stat().st_size > 4 * 1024**3:
            raise RoninError('FILE_LIMIT', 'A single imported file exceeds 4 GiB.')
        version_id = identifier()
        asset_id = checked_id(asset_id) if asset_id else identifier()
        temp_relative = f'.pending/{version_id}{source.suffix.lower()}'
        temporary = self.safe(temp_relative)
        before = source.stat()
        with source.open('rb') as incoming, temporary.open('xb') as output:
            shutil.copyfileobj(incoming, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        after = source.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
            temporary.unlink()
            raise RoninError('IMPORT_CHANGED', 'The source changed while being imported; retry after it is stable.')
        metadata = inspect_media(temporary)
        checksum = digest(temporary)
        final_relative = f'assets/{asset_id}/{version_id}{source.suffix.lower()}'
        with self.writer(), self.connection() as db:
            asset = db.execute('SELECT * FROM assets WHERE id=?', (asset_id,)).fetchone()
            parent = asset['current_version'] if asset else None
            if task_id:
                self._check_completion(db, task_id, generation)
            db.execute('INSERT INTO pending VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (identifier(), asset_id, version_id, parent, source.name, temp_relative, final_relative,
                        checksum, json.dumps(metadata), origin, task_id, generation, now()))
        if defer:
            return {'id': version_id, 'state': 'pending'}
        self._finalize_pending(version_id)
        return self.version(version_id)

    @staticmethod
    def _check_completion(db, task_id, generation):
        task = db.execute('SELECT state,generation FROM tasks WHERE id=?', (task_id,)).fetchone()
        if not task or task['state'] != 'running' or task['generation'] != generation:
            raise Cancelled()

    def _finalize_pending(self, version_id):
        with self.writer(), self.connection() as db:
            record = db.execute('SELECT * FROM pending WHERE version_id=?', (version_id,)).fetchone()
            if not record:
                return
            self._publish(db, record)

    def _publish(self, db, record):
        if record['task_id']:
            self._check_completion(db, record['task_id'], record['generation'])
        temporary = self.safe(record['temp_path'])
        final = self.safe(record['final_path'])
        final.parent.mkdir(parents=True, exist_ok=True)
        candidate = final if final.is_file() else temporary
        if not candidate.is_file() or digest(candidate) != record['sha256']:
            raise RoninError('PENDING_CONTENT_INVALID', 'An interrupted import has invalid content.')
        if not final.is_file():
            os.replace(temporary, final)
            directory = os.open(final.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        db.execute('INSERT OR IGNORE INTO assets VALUES(?,?,?,?)',
                   (record['asset_id'], record['name'], record['version_id'], now()))
        db.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)',
                   (record['version_id'], record['asset_id'], record['parent_id'], record['final_path'],
                    record['sha256'], record['metadata'], now(), record['origin']))
        db.execute('UPDATE assets SET current_version=? WHERE id=?', (record['version_id'], record['asset_id']))
        db.execute('DELETE FROM pending WHERE version_id=?', (record['version_id'],))

    def finish_task(self, task_id, generation, results):
        with self.writer(), self.connection() as db:
            self._check_completion(db, task_id, generation)
            records = [db.execute('SELECT * FROM pending WHERE version_id=? AND task_id=?', (version, task_id)).fetchone()
                       for version in results]
            if not records or any(record is None for record in records):
                raise RoninError('TASK_OUTPUT_MISSING', 'All task outputs must be staged before completion.')
            for record in records:
                self._publish(db, record)
            db.execute('UPDATE tasks SET state=?,progress=1,results=?,updated_at=? WHERE id=?',
                       ('succeeded', json.dumps(results), now(), task_id))

    def recover(self):
        with self.connection() as db:
            pending = [dict(row) for row in db.execute('SELECT * FROM pending')]
        results = []
        for record in pending:
            try:
                if record['task_id']:
                    raise RoninError('TASK_OUTPUT_PENDING', 'Interrupted task outputs require task reconciliation.')
                self._finalize_pending(record['version_id'])
                results.append({'versionId': record['version_id'], 'state': 'recovered'})
            except RoninError as error:
                with self.writer(), self.connection() as db:
                    db.execute('INSERT INTO recovery_events VALUES(?,?,?,?,?)',
                               (identifier(), error.code, record['final_path'], json.dumps(error.record()), now()))
                    if isinstance(error, Cancelled):
                        db.execute('DELETE FROM pending WHERE version_id=?', (record['version_id'],))
                results.append({'versionId': record['version_id'], 'state': 'rejected', 'error': error.record()})
        with self.connection() as db:
            remaining = [dict(row) for row in db.execute('SELECT * FROM pending')]
            known = {row[0] for row in db.execute('SELECT path FROM versions')} | {row['final_path'] for row in remaining}
            known_temp = {row['temp_path'] for row in remaining}
        orphaned = [str(file.relative_to(self.root)) for file in self.safe('assets').rglob('*')
                    if file.is_file() and str(file.relative_to(self.root)) not in known]
        orphaned += [str(file.relative_to(self.root)) for file in self.safe('.pending').iterdir()
                     if file.is_file() and str(file.relative_to(self.root)) not in known_temp]
        return {'pending': results, 'orphanedFiles': orphaned, 'policy': 'preserve_and_report'}

    def checkout(self, asset_id, version_id):
        version = self.version(version_id)
        if version['asset_id'] != asset_id:
            raise RoninError('VERSION_ASSET_MISMATCH', 'The version belongs to another asset.')
        with self.writer(), self.connection() as db:
            db.execute('UPDATE assets SET current_version=? WHERE id=?', (version_id, asset_id))
        return version

    def save_document(self, document_id, kind, payload, expected_revision):
        checked_id(document_id)
        if kind not in ['rseprite', 'workflow', 'map', 'sequence', 'image', 'game']:
            raise RoninError('DOCUMENT_KIND_INVALID', 'Unknown editable document kind.')
        serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        if len(serialized.encode()) > 64 * 1024**2:
            raise RoninError('DOCUMENT_LIMIT', 'The document exceeds the 64 MiB limit.')
        with self.writer(), self.connection() as db:
            current = db.execute('SELECT * FROM documents WHERE id=?', (document_id,)).fetchone()
            revision = current['revision'] if current else 0
            if revision != expected_revision:
                raise RoninError('DOCUMENT_REVISION_CHANGED', 'Reload the document before saving another revision.')
            db.execute('INSERT OR REPLACE INTO document_history VALUES(?,?,?,?)',
                       (document_id, revision + 1, serialized, now()))
            db.execute('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)',
                       (document_id, kind, revision + 1, serialized, now()))
        return {'id': document_id, 'revision': revision + 1, 'kind': kind}

    def document(self, document_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM documents WHERE id=?', (document_id,)).fetchone()
        if not row:
            raise RoninError('DOCUMENT_MISSING', 'The document does not exist.')
        result = dict(row)
        result['payload'] = json.loads(result['payload'])
        return result

    def restore_document(self, document_id, history_revision, expected_revision):
        current = self.document(document_id)
        with self.connection() as db:
            row = db.execute('SELECT payload FROM document_history WHERE document_id=? AND revision=?',
                             (document_id, history_revision)).fetchone()
        if not row:
            raise RoninError('DOCUMENT_HISTORY_MISSING', 'The requested saved revision does not exist.')
        return self.save_document(document_id, current['kind'], json.loads(row['payload']), expected_revision)

    def begin_ai(self, sample_id, template, prompt, references):
        for version in references:
            self.version(version)
        with self.writer(), self.connection() as db:
            previous = list(db.execute('SELECT * FROM ai_attempts WHERE sample_id=? ORDER BY attempt', (sample_id,)))
            if previous and previous[-1]['state'] in ['requested', 'running', 'unknown', 'cancel_requested']:
                raise RoninError('AI_RECONCILE_REQUIRED', 'Reconcile the previous AI attempt before starting another.')
            if len(previous) >= 3:
                raise RoninError('AI_RETRY_LIMIT', 'This quality sample has reached its three-attempt limit.')
            attempt_id = identifier()
            db.execute('INSERT INTO ai_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (attempt_id, sample_id, len(previous) + 1, 'requested', template, prompt,
                        json.dumps(references), None, None, now(), now()))
        return {'id': attempt_id, 'sampleId': sample_id, 'attempt': len(previous) + 1, 'state': 'requested'}

    def mark_ai(self, attempt_id, state, result_version=None, quality=None):
        if state not in ['running', 'unknown', 'cancel_requested', 'canceled', 'failed', 'succeeded', 'quality_failed']:
            raise RoninError('AI_STATE_INVALID', 'Unsupported AI state.')
        if result_version:
            self.version(result_version)
        if state in ['succeeded', 'quality_failed'] and not result_version:
            raise RoninError('AI_RESULT_REQUIRED', 'A decoded registered result version is required.')
        with self.writer(), self.connection() as db:
            record = db.execute('SELECT * FROM ai_attempts WHERE id=?', (attempt_id,)).fetchone()
            if not record:
                raise RoninError('AI_ATTEMPT_MISSING', 'The AI attempt does not exist.')
            if record['state'] in ['canceled', 'failed', 'succeeded', 'quality_failed']:
                raise RoninError('AI_ATTEMPT_FINAL', 'A final AI attempt cannot be overwritten.')
            db.execute('UPDATE ai_attempts SET state=?,result_version=?,quality=?,updated_at=? WHERE id=?',
                       (state, result_version, json.dumps(quality) if quality is not None else None, now(), attempt_id))
        return {'id': attempt_id, 'state': state, 'resultVersion': result_version}

    def verify(self):
        with self.connection() as db:
            integrity = db.execute('PRAGMA integrity_check').fetchone()[0]
            ids = [row[0] for row in db.execute('SELECT id FROM versions')]
        checks = []
        for version_id in ids:
            try:
                version = self.version(version_id)
                inspect_media(version['absolutePath'])
                checks.append({'id': version_id, 'valid': True})
            except RoninError as error:
                checks.append({'id': version_id, 'valid': False, 'error': error.record()})
        return {'valid': integrity == 'ok' and all(item['valid'] for item in checks),
                'database': integrity, 'versions': checks}
