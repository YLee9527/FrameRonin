import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
import psutil
from unittest.mock import patch, Mock
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from frameronin_engine.project import Project, identifier
from frameronin_engine.errors import RoninError, Cancelled
from frameronin_engine.operations import preview
from frameronin_engine.tasks import submit, task, wait, cancel


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='frameronin-test-')
        self.root = Path(self.directory.name)
        self.project = Project.create(self.root / 'project')
        self.source = self.root / 'source.png'
        image = Image.new('RGBA', (16, 12), (0, 0, 0, 0))
        image.putpixel((2, 3), (255, 30, 20, 255))
        image.save(self.source)
        self.version = self.project.import_file(self.source)

    def tearDown(self):
        self.directory.cleanup()

    def test_copy_reopen_tamper_and_checkout(self):
        original = self.source.read_bytes()
        second = self.project.import_file(self.source, self.version['asset_id'])
        self.assertEqual(second['parent_id'], self.version['id'])
        reopened = Project(self.project.root)
        reopened.checkout(self.version['asset_id'], self.version['id'])
        self.assertEqual(reopened.assets()[0]['current_version'], self.version['id'])
        self.assertEqual(self.source.read_bytes(), original)
        Path(second['absolutePath']).write_bytes(b'tampered')
        with self.assertRaisesRegex(RoninError, 'content changed'):
            reopened.version(second['id'])
        self.assertFalse(reopened.verify()['valid'])

    def test_paths_and_symlinks_rejected(self):
        with self.assertRaises(RoninError):
            self.project.safe('../outside.png')
        link = self.project.root / 'assets/link'
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(RoninError):
            self.project.safe('assets/link/source.png')
        with self.assertRaises(RoninError):
            self.project.import_file(self.source, 'nested/path')

    def test_interrupted_rename_recovery(self):
        original = self.project._finalize_pending
        with patch.object(self.project, '_finalize_pending', side_effect=OSError('interruption')):
            with self.assertRaises(OSError):
                self.project.import_file(self.source)
        self.assertEqual(self.project.recover()['pending'][0]['state'], 'recovered')
        self.assertTrue(self.project.verify()['valid'])
        self.assertEqual(len(self.project.assets()), 2)

    def test_unknown_fields_ranges_and_stale_versions(self):
        payload = {'operation': 'image.crop', 'inputs': [self.version['id']], 'parameters': {'width': 8, 'height': 8}}
        self.assertEqual(preview(self.project, payload)['processingMode'], 'original_resolution')
        for invalid in [dict(payload, command='whoami'), dict(payload, operation='shell'),
                        dict(payload, parameters={'width': True}), dict(payload, parameters={'width': 8193}),
                        dict(payload, parameters={'anything': 1}), dict(payload, inputs=[identifier()])]:
            with self.assertRaises(RoninError):
                preview(self.project, invalid)

    def test_documents_cas_and_saved_history(self):
        document = identifier()
        self.project.save_document(document, 'rseprite', {'frames': [1]}, 0)
        self.project.save_document(document, 'rseprite', {'frames': [1, 2]}, 1)
        with self.assertRaises(RoninError):
            self.project.save_document(document, 'rseprite', {}, 1)
        self.project.restore_document(document, 1, 2)
        self.assertEqual(self.project.document(document)['payload']['frames'], [1])

    def test_ai_unknown_reconciliation_and_retry_limit(self):
        attempt = self.project.begin_ai('sample', 'free-image', 'red character', [self.version['id']])
        self.project.mark_ai(attempt['id'], 'unknown')
        with self.assertRaises(RoninError):
            self.project.begin_ai('sample', 'free-image', 'red character', [])

        self.project.mark_ai(attempt['id'], 'failed')
        for _ in range(2):
            attempt = self.project.begin_ai('sample', 'free-image', 'red character', [])
            self.project.mark_ai(attempt['id'], 'failed')
        with self.assertRaises(RoninError):
            self.project.begin_ai('sample', 'free-image', 'red character', [])

    def test_ai_result_acceptance_obeys_cancel_and_reconciliation(self):
        attempt = self.project.begin_ai('accepted', 'free-image', 'character', [])
        self.project.mark_ai(attempt['id'], 'running')
        result = self.project.accept_ai(attempt['id'], self.source, 'succeeded', {'visual':'synthetic fixture'})
        self.assertEqual(result['attempt']['result_version'], result['version']['id'])
        self.assertEqual(task(self.project, attempt['id'])['state'], 'succeeded')
        self.assertEqual(result['version']['origin'], 'codex-native-imagegen')
        attempt = self.project.begin_ai('unknown', 'free-image', 'character', [])
        self.project.mark_ai(attempt['id'], 'unknown')
        with self.assertRaises(RoninError): self.project.accept_ai(attempt['id'], self.source, 'succeeded', {})
        self.project.accept_ai(attempt['id'], self.source, 'quality_failed', {'reconciled':True,'reason':'fixture only'})
        attempt = self.project.begin_ai('canceled', 'free-image', 'character', [])
        canceled = cancel(self.project, attempt['id'])
        self.assertEqual(canceled['aiState'], 'cancel_requested')
        with self.assertRaises(RoninError): self.project.accept_ai(attempt['id'], self.source, 'succeeded', {})
        self.project.mark_ai(attempt['id'], 'canceled')

    def test_worker_pixels_and_late_completion(self):
        submitted = submit(self.project, {'operation': 'image.flip', 'inputs': [self.version['id']], 'parameters': {}})
        result = wait(self.project, submitted['id'], 15)
        self.assertEqual(result['state'], 'succeeded', result)
        version = self.project.version(result['results'][0])
        with Image.open(version['absolutePath']) as image:
            self.assertEqual(image.getpixel((13, 3)), (255, 30, 20, 255))
        pending = submit(self.project, {'operation': 'sequence.zip', 'inputs': [self.version['id']] * 1000, 'parameters': {}})
        canceled = cancel(self.project, pending['id'])
        self.assertEqual(canceled['state'], 'canceled')
        self.assertLess(canceled['cancelElapsedSeconds'], 5)
        with self.assertRaises(Cancelled):
            self.project.import_file(self.source, task_id=pending['id'], generation=0)

    def test_queue_keeps_later_tasks_without_worker_allocation(self):
        source = self.root / 'larger.png'
        Image.new('RGBA', (512, 512), (255, 40, 80, 255)).save(source)
        version = self.project.import_file(source)
        first = submit(self.project, {'operation':'sequence.zip','inputs':[version['id']] * 1000,'parameters':{}})
        deadline = time.monotonic() + 5
        while task(self.project, first['id'])['state'] == 'queued' and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(task(self.project, first['id'])['state'], 'running')
        second = submit(self.project, {'operation':'image.flip','inputs':[version['id']],'parameters':{}})
        queued = task(self.project, second['id'])
        self.assertEqual(queued['state'], 'queued')
        self.assertIsNone(queued['pid'])
        self.assertEqual(cancel(self.project, first['id'])['state'], 'canceled')
        self.assertEqual(wait(self.project, second['id'], 10)['state'], 'succeeded')

    def test_cancel_stops_nested_media_processes_and_records_confirmation(self):
        source = self.root / 'flow.png'
        Image.new('RGBA', (512, 512), (40, 80, 120, 255)).save(source)
        version = self.project.import_file(source)
        submitted = submit(self.project, {'operation':'sequence.opticalFlow',
            'inputs':[version['id']] * 16, 'parameters':{'quality':'high'}})
        family = []
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            record = task(self.project, submitted['id'])
            if record['pid']:
                try:
                    parent = psutil.Process(record['pid'])
                    family = [parent] + parent.children(recursive=True)
                    if any('run.mjs' in ' '.join(child.cmdline()) for child in family): break
                except psutil.NoSuchProcess:
                    pass
            time.sleep(0.02)
        self.assertGreater(len(family), 1, record)
        result = cancel(self.project, submitted['id'])
        self.assertTrue(result['processStopConfirmed'])
        self.assertLess(result['cancelElapsedSeconds'], 5)
        self.assertEqual(result['results'], [])
        for child in family:
            self.assertFalse(child.is_running() and child.status() != psutil.STATUS_ZOMBIE)
        receipt = json.loads((self.project.root / f'tasks/{submitted["id"]}/cancellation.json').read_text())
        self.assertEqual(receipt['scope'], 'local_owned_processes')
        self.assertGreaterEqual(receipt['ownedProcessCount'], 2)
        with self.assertRaises(Cancelled):
            self.project.import_file(source, task_id=submitted['id'], generation=0)

    def test_cancel_denial_is_recorded_and_never_reported_as_confirmed(self):
        task_id = identifier()
        with self.project.connection() as db:
            db.execute('INSERT INTO tasks(id,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)',
                       (task_id, 'running', '{}', 'now', 'now'))
        process = Mock(pid=999999)
        process.children.return_value = []
        with patch('frameronin_engine.tasks._owned_process', return_value=process), \
             patch('frameronin_engine.tasks.os.getpgid', return_value=process.pid), \
             patch('frameronin_engine.tasks.os.killpg', side_effect=PermissionError('denied')):
            with self.assertRaises(RoninError) as caught:
                cancel(self.project, task_id)
        self.assertEqual(caught.exception.code, 'CANCEL_STOP_UNCONFIRMED')
        record = task(self.project, task_id)
        self.assertEqual(record['state'], 'canceled')
        self.assertEqual(record['results'], [])
        self.assertEqual(record['error']['code'], 'CANCEL_STOP_UNCONFIRMED')
        with self.assertRaises(RoninError): cancel(self.project, task_id)
        receipt = json.loads((self.project.root / f'tasks/{task_id}/cancellation.json').read_text())
        self.assertFalse(receipt['processStopConfirmed'])

    def test_cancel_during_output_checksum_rejects_publication(self):
        task_id = identifier()
        with self.project.connection() as db:
            db.execute('INSERT INTO tasks(id,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)',
                       (task_id, 'running', '{}', 'now', 'now'))
        staged = self.project.import_file(self.source, task_id=task_id, generation=0, defer=True)
        original = self.project._validate_pending
        def validate_then_cancel(record):
            fingerprint = original(record)
            cancel(self.project, task_id)
            return fingerprint
        with patch.object(self.project, '_validate_pending', side_effect=validate_then_cancel), self.assertRaises(Cancelled):
            self.project.finish_task(task_id, 0, [staged['id']])
        with self.project.connection() as db:
            self.assertIsNone(db.execute('SELECT id FROM versions WHERE id=?', (staged['id'],)).fetchone())
        self.assertEqual(task(self.project, task_id)['state'], 'canceled')

    def test_revisioned_proposals_do_not_execute_on_preview(self):
        from frameronin_engine.proposals import save, execute
        payload = {'operation':'image.flip','inputs':[self.version['id']],'parameters':{}}
        selected = [self.version['id']]
        proposal = save(self.project, payload, selected)
        other = self.project.import_file(self.source)
        with self.assertRaises(RoninError): save(self.project, dict(payload, assetId=other['asset_id']), selected)
        with self.project.connection() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM tasks').fetchone()[0], 0)
        revised = save(self.project, payload, selected, proposal['id'], 1)
        with self.assertRaises(RoninError): execute(self.project, proposal['id'], 1)
        replacement = self.project.import_file(self.source, self.version['asset_id'])
        with self.assertRaises(RoninError): execute(self.project, proposal['id'], 2)
        with self.assertRaises(RoninError): save(self.project, dict(payload, inputs=[replacement['id']]), selected)
        refreshed = save(self.project, payload, selected, revised['id'], 2)
        submitted = execute(self.project, refreshed['id'], 3)
        with self.assertRaises(RoninError): execute(self.project, refreshed['id'], 3)
        self.assertEqual(wait(self.project, submitted['id'], 10)['state'], 'succeeded')
        with self.assertRaises(RoninError): save(self.project, {'operation':'workflow.legacy','inputs':[self.version['id']],'parameters':{}}, selected)


if __name__ == '__main__':
    unittest.main()
