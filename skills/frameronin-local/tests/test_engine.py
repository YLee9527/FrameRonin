import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from frameronin_engine.project import Project, identifier
from frameronin_engine.errors import RoninError, Cancelled
from frameronin_engine.operations import preview
from frameronin_engine.tasks import submit, wait, cancel


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


if __name__ == '__main__':
    unittest.main()
