#!/usr/bin/env python3
"""Test stale artifact rejection without starting services or modifying the checkout."""
from importlib import import_module
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

build = import_module('backend-build')
local = import_module('local-stack')


class BackendBuildTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'src/main.java'
        self.source.parent.mkdir()
        self.source.write_text('first')
        self.root_patch = patch.object(build, 'ROOT', self.root)
        self.inputs_patch = patch.object(build, 'INPUTS', ('src',))
        self.root_patch.start()
        self.inputs_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.inputs_patch.stop)
        for role in build.ROLES:
            jar = build.artifact(role)
            jar.parent.mkdir(parents=True)
            jar.write_bytes((role + '-original').encode())
        build.record(build.fingerprint())

    def test_matching_build_accepts_both_artifacts(self):
        for role in build.ROLES:
            self.assertEqual(build.check(role), build.checksum(build.artifact(role)))

    def test_source_content_change_with_same_timestamp_is_rejected(self):
        before = self.source.stat()
        self.source.write_text('other')
        os.utime(self.source, ns=(before.st_atime_ns, before.st_mtime_ns))
        with self.assertRaisesRegex(RuntimeError, 'stale'):
            build.check('api')

    def test_source_addition_and_deletion_are_rejected(self):
        added = self.root / 'src/added.java'
        added.write_text('new input')
        with self.assertRaisesRegex(RuntimeError, 'stale'):
            build.check('worker')
        added.unlink()
        self.source.unlink()
        with self.assertRaisesRegex(RuntimeError, 'stale'):
            build.check('api')

    def test_replaced_jar_is_rejected(self):
        build.artifact('api').write_bytes(b'older jar')
        with self.assertRaisesRegex(RuntimeError, 'stale'):
            build.check('api')
        self.assertEqual(build.check('worker'), build.checksum(build.artifact('worker')))

    def test_missing_or_invalid_manifest_is_rejected(self):
        manifest = self.root / '.local/backend-build.json'
        for body in ('invalid json', '{}'):
            manifest.write_text(body)
            with self.assertRaisesRegex(RuntimeError, 'stale'):
                build.check('api')
        manifest.unlink()
        with self.assertRaisesRegex(RuntimeError, 'stale'):
            build.check('worker')

    def test_build_cannot_record_changed_inputs(self):
        expected = build.fingerprint()
        self.source.write_text('changed during build')
        with self.assertRaisesRegex(RuntimeError, 'changed during'):
            build.record(expected)

    def test_running_older_artifact_is_not_reported_as_current(self):
        with patch.object(local, 'managed', return_value={'artifact': 'previous'}):
            with patch.object(local.subprocess, 'Popen') as spawn:
                with self.assertRaisesRegex(RuntimeError, 'running an older build'):
                    local.start('api')
                spawn.assert_not_called()

    def test_running_current_artifact_is_idempotent(self):
        with patch.object(local, 'managed', return_value={'artifact': build.check('api')}):
            with patch.object(local.subprocess, 'Popen') as spawn:
                local.start('api')
                spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main()
