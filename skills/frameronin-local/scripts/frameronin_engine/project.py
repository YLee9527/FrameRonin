"""正式项目格式 1、素材版本、原子落盘、事务登记及恢复。"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import base64
import io
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


def image_display_metadata(image):
    orientation = image.getexif().get(274, 1)
    if type(orientation) is not int or orientation not in range(1, 9):
        orientation = 1
    width, height = image.size
    return {'orientation': orientation, 'displayWidth': height if orientation >= 5 else width,
            'displayHeight': width if orientation >= 5 else height, 'containerFormat': image.format}


def inspect_media(path):
    path = Path(path)
    result = {'bytes': path.stat().st_size, 'extension': path.suffix.lower()}
    if path.suffix.lower() in IMAGE_EXTENSIONS:
        from PIL import Image,ImageOps
        try:
            with Image.open(path) as image:
                width, height = image.size
                estimate = width * height * 4 * 3 + 128 * 1024**2
                if estimate > memory_budget():
                    raise RoninError('RESOURCE_LIMIT', 'Image decoding exceeds the project memory budget.',
                                     {'estimatedBytes': estimate, 'budgetBytes': memory_budget()})
                result.update(image_display_metadata(image))
                count = getattr(image, 'n_frames', 1)
                durations = []
                transparency = False
                for index in range(count):
                    image.seek(index)
                    image.load()
                    durations.append(int(image.info.get('duration', 100)))
                    if image.mode == 'RGBA' or 'transparency' in image.info:
                        transparency |= image.convert('RGBA').getchannel('A').getextrema()[0] < 255
                    if index == 0:
                        thumbnail = ImageOps.exif_transpose(image).convert('RGBA')
                        thumbnail.thumbnail((128, 128), Image.Resampling.NEAREST)
                        buffer = io.BytesIO()
                        thumbnail.save(buffer, format='PNG')
                        result['thumbnailDataUrl'] = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
                        del thumbnail
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
                          'archive' if path.suffix.lower() == '.zip' else
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
            if result['kind'] == 'audio':
                result.update(sampleRate=int(selected.get('sample_rate', 0)), channels=int(selected.get('channels', 0)))
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
            result = [dict(row) for row in db.execute('SELECT assets.*,versions.metadata FROM assets LEFT JOIN versions ON versions.id=assets.current_version ORDER BY assets.created_at,assets.id')]
            for row in result:
                row['metadata'] = json.loads(row['metadata']) if row['metadata'] else None
            return result

    def version(self, version_id, verify=True):
        with self.connection() as db:
            row = db.execute('SELECT v.*,a.name FROM versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=?', (version_id,)).fetchone()
        if not row:
            raise RoninError('VERSION_MISSING', 'The selected asset version no longer exists.')
        result = dict(row)
        result['metadata'] = json.loads(result['metadata'])
        path = self.safe(result['path'])
        if not path.is_file() or (verify and digest(path) != result['sha256']):
            raise RoninError('VERSION_CONTENT_CHANGED', 'The selected asset version is missing or its content changed.')
        # Old JPEG/WebP indices lack the browser's EXIF display dimensions.
        # Supplement them without changing raw dimensions, IDs or stored files.
        if result['metadata'].get('extension') in ['.jpg','.jpeg','.webp'] and 'displayWidth' not in result['metadata']:
            from PIL import Image
            with Image.open(path) as image:
                result['metadata'].update(image_display_metadata(image))
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
        with self.connection() as db:
            record = db.execute('SELECT * FROM pending WHERE version_id=?', (version_id,)).fetchone()
        if not record:
            return
        fingerprint = self._validate_pending(record)
        with self.writer(), self.connection() as db:
            record = db.execute('SELECT * FROM pending WHERE version_id=?', (version_id,)).fetchone()
            if not record:
                return
            self._publish(db, record, fingerprint)

    @staticmethod
    def _fingerprint(path):
        status = path.stat()
        return status.st_dev, status.st_ino, status.st_size, status.st_mtime_ns

    def _validate_pending(self, record):
        temporary = self.safe(record['temp_path'])
        final = self.safe(record['final_path'])
        candidate = final if final.is_file() else temporary
        if not candidate.is_file():
            raise RoninError('PENDING_CONTENT_INVALID', 'An interrupted import has no complete file.')
        fingerprint = self._fingerprint(candidate)
        if digest(candidate) != record['sha256'] or self._fingerprint(candidate) != fingerprint:
            raise RoninError('PENDING_CONTENT_INVALID', 'An interrupted import has invalid content.')
        return fingerprint

    def _publish(self, db, record, fingerprint):
        if record['task_id']:
            self._check_completion(db, record['task_id'], record['generation'])
        temporary = self.safe(record['temp_path'])
        final = self.safe(record['final_path'])
        candidate = final if final.is_file() else temporary
        if not candidate.is_file() or self._fingerprint(candidate) != fingerprint:
            raise RoninError('PENDING_CONTENT_INVALID', 'The staged output changed before publication.')
        final.parent.mkdir(parents=True, exist_ok=True)
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

    def finish_task(self, task_id, generation, results, ai_result=None):
        with self.connection() as db:
            self._check_completion(db, task_id, generation)
            records = [db.execute('SELECT * FROM pending WHERE version_id=? AND task_id=?', (version, task_id)).fetchone()
                       for version in results]
            if not records or any(record is None for record in records):
                raise RoninError('TASK_OUTPUT_MISSING', 'All task outputs must be staged before completion.')
        # Full content reads happen outside the writer lock so cancellation can invalidate the task promptly.
        fingerprints = [self._validate_pending(record) for record in records]
        with self.writer(), self.connection() as db:
            self._check_completion(db, task_id, generation)
            if ai_result:
                attempt = db.execute('SELECT * FROM ai_attempts WHERE id=?', (task_id,)).fetchone()
                if not attempt or attempt['state'] not in ['requested', 'running', 'unknown']:
                    raise Cancelled()
            for record, fingerprint in zip(records, fingerprints):
                current = db.execute('SELECT * FROM pending WHERE version_id=?', (record['version_id'],)).fetchone()
                if current is None or dict(current) != dict(record):
                    raise RoninError('PENDING_CONTENT_INVALID', 'A staged result changed during validation.')
                self._publish(db, current, fingerprint)
            db.execute('UPDATE tasks SET state=?,progress=1,results=?,updated_at=? WHERE id=?',
                       ('succeeded', json.dumps(results), now(), task_id))
            if ai_result:
                db.execute('UPDATE ai_attempts SET state=?,result_version=?,quality=?,updated_at=? WHERE id=?',
                           (ai_result['state'], results[0], json.dumps(ai_result['quality']), now(), task_id))

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
            known_tasks = {row[0] for row in db.execute('SELECT id FROM tasks')}
        orphaned = [str(file.relative_to(self.root)) for file in self.safe('assets').rglob('*')
                    if file.is_file() and str(file.relative_to(self.root)) not in known]
        orphaned += [str(file.relative_to(self.root)) for file in self.safe('.pending').iterdir()
                     if file.is_file() and str(file.relative_to(self.root)) not in known_temp]
        orphaned_tasks = [str(folder.relative_to(self.root)) for folder in self.safe('tasks').iterdir()
                          if folder.is_dir() and folder.name not in known_tasks]
        return {'pending': results, 'orphanedFiles': orphaned, 'orphanedTaskDirectories': orphaned_tasks, 'policy': 'preserve_and_report'}

    def checkout(self, asset_id, version_id):
        version = self.version(version_id)
        if version['asset_id'] != asset_id:
            raise RoninError('VERSION_ASSET_MISMATCH', 'The version belongs to another asset.')
        with self.writer(), self.connection() as db:
            db.execute('UPDATE assets SET current_version=? WHERE id=?', (version_id, asset_id))
        return version

    def save_document(self, document_id, kind, payload, expected_revision):
        checked_id(document_id)
        if type(expected_revision) is not int or expected_revision < 0:
            raise RoninError('DOCUMENT_REVISION_INVALID', 'Document revisions are non-negative integers.')
        if kind not in ['rseprite', 'workflow', 'map', 'sequence', 'pixel', 'image', 'game', 'ai-request','ronin-scale','ronin-unify','ronin-duplicates','image-fine','image-normal','image-expand-shrink','scatter']:
            raise RoninError('DOCUMENT_KIND_INVALID', 'Unknown editable document kind.')
        serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        if len(serialized.encode()) > 64 * 1024**2:
            raise RoninError('DOCUMENT_LIMIT', 'The document exceeds the 64 MiB limit.')
        with self.writer(), self.connection() as db:
            current = db.execute('SELECT * FROM documents WHERE id=?', (document_id,)).fetchone()
            if current and current['kind'] != kind:
                raise RoninError('DOCUMENT_KIND_CHANGED', 'Save a different document type with a new document ID.')
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
        if not all(isinstance(value, str) and 0 < len(value) <= limit for value, limit in [(sample_id, 200), (template, 200), (prompt, 32000)]):
            raise RoninError('AI_REQUEST_INVALID', 'Provide bounded sample, template and prompt strings.')
        if not isinstance(references, list) or not all(isinstance(value, str) for value in references) or len(references) > 16 or len(set(references)) != len(references):
            raise RoninError('AI_REFERENCES_INVALID', 'Select at most 16 unique reference versions.')
        for version in references:
            if self.version(checked_id(version))['metadata']['kind'] != 'image':
                raise RoninError('AI_REFERENCE_KIND', 'Select still images as ImageGen references.')
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
            db.execute('INSERT INTO tasks(id,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)',
                       (attempt_id, 'running', json.dumps({'operation':'ai.imagegen','sampleId':sample_id,'references':references}), now(), now()))
        return {'id': attempt_id, 'sampleId': sample_id, 'attempt': len(previous) + 1, 'state': 'requested'}

    def mark_ai(self, attempt_id, state, result_version=None, quality=None):
        if state not in ['running', 'unknown', 'cancel_requested', 'canceled', 'failed', 'succeeded', 'quality_failed']:
            raise RoninError('AI_STATE_INVALID', 'Unsupported AI state.')
        if state in ['succeeded', 'quality_failed'] or result_version:
            raise RoninError('AI_ACCEPT_REQUIRED', 'Publish AI output through ai-accept so cancellation and result registration are checked together.')
        with self.writer(), self.connection() as db:
            record = db.execute('SELECT * FROM ai_attempts WHERE id=?', (attempt_id,)).fetchone()
            if not record:
                raise RoninError('AI_ATTEMPT_MISSING', 'The AI attempt does not exist.')
            if record['state'] in ['canceled', 'failed', 'succeeded', 'quality_failed']:
                raise RoninError('AI_ATTEMPT_FINAL', 'A final AI attempt cannot be overwritten.')
            if record['state'] == 'cancel_requested' and state not in ['unknown', 'canceled', 'failed']:
                raise RoninError('AI_CANCEL_PENDING', 'Confirm the original service state after cancellation; do not reopen generation.')
            if state == 'running':
                task = db.execute('SELECT state FROM tasks WHERE id=?', (attempt_id,)).fetchone()
                if not task or task['state'] != 'running':
                    raise RoninError('AI_RESULT_INVALIDATED', 'Generation cannot be reopened after its local result was invalidated.')
            db.execute('UPDATE ai_attempts SET state=?,result_version=?,quality=?,updated_at=? WHERE id=?',
                       (state, result_version, json.dumps(quality) if quality is not None else None, now(), attempt_id))
            if state in ['cancel_requested', 'canceled', 'failed']:
                db.execute('UPDATE tasks SET state=?,generation=generation+1,updated_at=? WHERE id=? AND state=?',
                           ('failed' if state == 'failed' else 'canceled', now(), attempt_id, 'running'))
        return {'id': attempt_id, 'state': state, 'resultVersion': result_version}

    def ai_attempt(self, attempt_id):
        checked_id(attempt_id)
        with self.connection() as db:
            record = db.execute('SELECT * FROM ai_attempts WHERE id=?', (attempt_id,)).fetchone()
        if not record:
            raise RoninError('AI_ATTEMPT_MISSING', 'The AI attempt does not exist.')
        result = dict(record)
        result['reference_versions'] = json.loads(result['reference_versions'])
        result['quality'] = json.loads(result['quality']) if result['quality'] else None
        return result

    def accept_ai(self, attempt_id, source, quality_state, quality):
        attempt = self.ai_attempt(attempt_id)
        if quality_state not in ['succeeded', 'quality_failed'] or not isinstance(quality, dict):
            raise RoninError('AI_QUALITY_REQUIRED', 'Record the output quality decision separately from call completion.')
        if attempt['state'] not in ['requested', 'running', 'unknown']:
            raise RoninError('AI_RESULT_INVALIDATED', 'This AI attempt no longer accepts results.')
        if attempt['state'] == 'unknown' and quality.get('reconciled') is not True:
            raise RoninError('AI_RECONCILE_REQUIRED', 'Verify the original host call before accepting an uncertain result.')
        for version_id in attempt['reference_versions']:
            self.version(version_id)
        with self.connection() as db:
            task = db.execute('SELECT * FROM tasks WHERE id=?', (attempt_id,)).fetchone()
            if not task:
                raise RoninError('AI_LEGACY_RECONCILIATION', 'This older attempt has no cancellation epoch; reconcile it before creating a new attempt.')
            self._check_completion(db, attempt_id, task['generation'])
        if Path(source).suffix.lower() != '.png':
            raise RoninError('AI_OUTPUT_FORMAT', 'ImageGen output must be a fully decoded PNG.')
        staged = self.import_file(source, origin='codex-native-imagegen', task_id=attempt_id, generation=task['generation'], defer=True)
        self.finish_task(attempt_id, task['generation'], [staged['id']], ai_result={'state':quality_state,'quality':quality})
        return {'attempt':self.ai_attempt(attempt_id),'version':self.version(staged['id'])}

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
