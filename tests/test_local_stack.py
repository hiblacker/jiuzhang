import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('local_stack', Path(__file__).parents[1] / 'tools/local-stack.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class BackupTest(unittest.TestCase):
    def backup(self, root):
        source = root / 'backup'; source.mkdir()
        (source / 'postgres').mkdir(); (source / 'postgres/PG_VERSION').write_text('17\n')
        (source / 'lake').mkdir(); (source / 'lake/raw.jsonl').write_text('{"id":"001"}\n')
        ops.write_json(source / 'manifest.json', {'version': 1, 'state': 'COMPLETE', 'postgresMajor': '17',
            'gitRevision': 'synthetic', 'files': ops.hashes(source)})
        return source

    def test_roundtrip_and_never_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = self.backup(root); target = root / 'restored'
            self.assertEqual(ops.restore(source, target)['state'], 'RESTORED_OFFLINE')
            self.assertEqual((target / 'lake/raw.jsonl').read_text(), '{"id":"001"}\n')
            self.assertEqual((target / 'lake/raw.jsonl').stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(RuntimeError, 'TARGET_MUST_BE_NEW'):
                ops.restore(source, target)

    def test_corruption_and_missing_files_are_rejected_before_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = self.backup(root)
            (source / 'lake/raw.jsonl').write_text('{"id":"002"}\n')
            with self.assertRaisesRegex(RuntimeError, 'CHECKSUM_MISMATCH'):
                ops.restore(source, root / 'restored')
            self.assertFalse((root / 'restored').exists())
            (source / 'lake/raw.jsonl').unlink()
            with self.assertRaisesRegex(RuntimeError, 'CHECKSUM_MISMATCH'):
                ops.verify(source)

    def test_extra_files_and_external_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = self.backup(root)
            (source / 'extra').write_text('unexpected')
            with self.assertRaisesRegex(RuntimeError, 'CHECKSUM_MISMATCH'):
                ops.verify(source)
            (source / 'extra').unlink(); (source / 'link').symlink_to(root)
            with self.assertRaisesRegex(RuntimeError, 'SYMLINK_UNSUPPORTED'):
                ops.verify(source)


if __name__ == '__main__':
    unittest.main()
