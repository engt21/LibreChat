from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.sandbox_cleanup import MANAGED_LABEL, OWNER_LABEL, OWNER_VALUE, SandboxContainerJanitor


class FakeContainer:
    def __init__(
        self,
        container_id: str,
        created_epoch: float,
        labels: dict[str, str] | None = None,
        mount_source: str | None = None,
        remove_error: Exception | None = None,
    ):
        self.id = container_id
        self.attrs = {
            'Created': datetime.fromtimestamp(created_epoch, timezone.utc).isoformat(),
            'Config': {'Labels': labels or {}},
            'Mounts': [{'Source': mount_source}] if mount_source else [],
        }
        self.removed = False
        self.remove_error = remove_error

    def remove(self, force: bool = False) -> None:
        if self.remove_error is not None:
            raise self.remove_error
        self.removed = force


class FakeContainers:
    def __init__(
        self,
        labeled: list[FakeContainer],
        by_image: dict[str, list[FakeContainer]],
        failures: dict[str, Exception] | None = None,
    ):
        self.labeled = labeled
        self.by_image = by_image
        self.failures = failures or {}

    def list(self, *, all: bool, filters: dict[str, str]) -> list[FakeContainer]:
        self.assert_all = all
        if 'label' in filters:
            failure = self.failures.get('label')
            if failure is not None:
                raise failure
            return self.labeled
        ancestor = filters['ancestor']
        failure = self.failures.get(ancestor)
        if failure is not None:
            raise failure
        return self.by_image.get(ancestor, [])


class FakeClient:
    def __init__(self, containers: FakeContainers):
        self.containers = containers


class SandboxContainerJanitorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.workspace_root = self.root / 'workspaces'
        self.metadata_root = self.root / 'metadata'
        self.workspace_root.mkdir()
        self.metadata_root.mkdir()
        self.labels = {
            MANAGED_LABEL: 'true',
            OWNER_LABEL: OWNER_VALUE,
        }

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _workspace_mount(self, session_id: str) -> str:
        workspace = self.workspace_root / session_id
        workspace.mkdir(exist_ok=True)
        return str(workspace)

    def _write_metadata(self, session_id: str, *, updated_epoch: float) -> None:
        metadata = {
            'session_id': session_id,
            'created_at': datetime.fromtimestamp(updated_epoch - 60, timezone.utc).isoformat(),
            'updated_at': datetime.fromtimestamp(updated_epoch, timezone.utc).isoformat(),
            'files': {},
        }
        (self.metadata_root / f'{session_id}.json').write_text(json.dumps(metadata))

    def test_uses_session_activity_metadata_when_available(self) -> None:
        now = 10_000.0
        active = FakeContainer('active', now - 7_200, self.labels)
        recent = FakeContainer(
            'recent',
            now - 7_200,
            mount_source=self._workspace_mount('session-recent'),
        )
        stale = FakeContainer(
            'stale',
            now - 7_200,
            mount_source=self._workspace_mount('session-stale'),
        )
        expired = FakeContainer('expired', now - 7_200, self.labels)
        young = FakeContainer('young', now - 1_000, self.labels)
        unrelated = FakeContainer('unrelated', now - 7_200, mount_source='/srv/other/session-b')
        self._write_metadata('session-recent', updated_epoch=now - 1_800)
        self._write_metadata('session-stale', updated_epoch=now - 7_200)
        containers = FakeContainers(
            labeled=[active, young, expired],
            by_image={'sandbox-image': [active, recent, stale, unrelated]},
        )
        janitor = SandboxContainerJanitor(
            FakeClient(containers),
            {'sandbox-image'},
            str(self.workspace_root),
        )

        removed = janitor.cleanup(
            active_container_ids={'active'},
            ttl_seconds=3_600,
            now=now,
        )

        self.assertEqual(set(removed), {'expired', 'stale'})
        self.assertFalse(active.removed)
        self.assertFalse(young.removed)
        self.assertFalse(recent.removed)
        self.assertTrue(stale.removed)
        self.assertTrue(expired.removed)
        self.assertFalse(unrelated.removed)

    def test_falls_back_to_created_time_when_activity_metadata_is_missing_or_malformed(self) -> None:
        now = 10_000.0
        missing = FakeContainer(
            'missing',
            now - 7_200,
            mount_source=self._workspace_mount('session-missing'),
        )
        malformed = FakeContainer(
            'malformed',
            now - 7_200,
            mount_source=self._workspace_mount('session-malformed'),
        )
        young = FakeContainer(
            'young',
            now - 1_000,
            mount_source=self._workspace_mount('session-young'),
        )
        (self.metadata_root / 'session-malformed.json').write_text('{not-json')
        containers = FakeContainers(
            labeled=[],
            by_image={'sandbox-image': [missing, malformed, young]},
        )
        janitor = SandboxContainerJanitor(
            FakeClient(containers),
            {'sandbox-image'},
            str(self.workspace_root),
        )

        removed = janitor.cleanup(
            active_container_ids=set(),
            ttl_seconds=3_600,
            now=now,
        )

        self.assertEqual(set(removed), {'missing', 'malformed'})
        self.assertTrue(missing.removed)
        self.assertTrue(malformed.removed)
        self.assertFalse(young.removed)

    def test_handles_docker_failures_without_aborting_cleanup(self) -> None:
        now = 10_000.0
        failed_remove = FakeContainer(
            'failed-remove',
            now - 7_200,
            self.labels,
            remove_error=RuntimeError('remove failed'),
        )
        removed_ok = FakeContainer(
            'removed-ok',
            now - 7_200,
            mount_source=self._workspace_mount('session-removed'),
        )
        self._write_metadata('session-removed', updated_epoch=now - 7_200)
        containers = FakeContainers(
            labeled=[],
            by_image={'sandbox-image': [failed_remove, removed_ok]},
            failures={'label': RuntimeError('docker unavailable')},
        )
        janitor = SandboxContainerJanitor(
            FakeClient(containers),
            {'sandbox-image'},
            str(self.workspace_root),
        )

        removed = janitor.cleanup(
            active_container_ids=set(),
            ttl_seconds=3_600,
            now=now,
        )

        self.assertEqual(removed, ['removed-ok'])
        self.assertFalse(failed_remove.removed)
        self.assertTrue(removed_ok.removed)


if __name__ == '__main__':
    unittest.main()
