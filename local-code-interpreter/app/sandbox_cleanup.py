from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MANAGED_LABEL = 'com.librechat.local-code-interpreter.managed'
OWNER_LABEL = 'com.librechat.local-code-interpreter.owner'
OWNER_VALUE = 'local-code-interpreter'
logger = logging.getLogger(__name__)


def _parse_epoch(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _created_epoch(container: Any) -> float:
    return _parse_epoch(container.attrs.get('Created')) or 0.0


class SandboxContainerJanitor:
    def __init__(self, client: Any, sandbox_images: set[str], workspace_host_root: str):
        self.client = client
        self.sandbox_images = {image for image in sandbox_images if image}
        self.workspace_host_root = Path(workspace_host_root).resolve()
        self.metadata_root = self.workspace_host_root.parent / 'metadata'

    def _workspace_session_id(self, container: Any) -> str | None:
        for mount in container.attrs.get('Mounts') or []:
            source = mount.get('Source')
            if not source:
                continue
            try:
                relative_path = Path(source).resolve().relative_to(self.workspace_host_root)
            except ValueError:
                continue
            if relative_path.parts:
                return relative_path.parts[0]
        return None

    def _metadata_activity_epoch(self, container: Any, now: float) -> float | None:
        session_id = self._workspace_session_id(container)
        if not session_id:
            return None

        metadata_path = self.metadata_root / f'{session_id}.json'
        try:
            metadata = json.loads(metadata_path.read_text())
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError):
            logger.warning(
                'Ignoring malformed sandbox activity metadata for %s',
                metadata_path,
                exc_info=True,
            )
            return None

        activity_epoch = _parse_epoch(metadata.get('updated_at'))
        if activity_epoch is None or activity_epoch > now:
            if metadata.get('updated_at') is not None:
                logger.warning(
                    'Ignoring unreliable sandbox activity timestamp for %s',
                    metadata_path,
                )
            return None

        return activity_epoch

    def _expiration_anchor_epoch(self, container: Any, now: float) -> float:
        return self._metadata_activity_epoch(container, now) or _created_epoch(container)

    def _is_librechat_child(self, container: Any) -> bool:
        labels = container.attrs.get('Config', {}).get('Labels') or {}
        if labels.get(MANAGED_LABEL) == 'true' and labels.get(OWNER_LABEL) == OWNER_VALUE:
            return True

        for mount in container.attrs.get('Mounts') or []:
            source = mount.get('Source')
            if not source:
                continue
            try:
                Path(source).resolve().relative_to(self.workspace_host_root)
                return True
            except ValueError:
                continue
        return False

    def cleanup(self, *, active_container_ids: set[str], ttl_seconds: int, now: float) -> list[str]:
        candidates: dict[str, Any] = {}

        try:
            labeled_containers = self.client.containers.list(
                all=True,
                filters={'label': f'{MANAGED_LABEL}=true'},
            )
        except Exception:
            logger.exception('Failed to list managed sandbox containers')
            labeled_containers = []

        for container in labeled_containers:
            candidates[container.id] = container

        for image in self.sandbox_images:
            try:
                image_containers = self.client.containers.list(
                    all=True,
                    filters={'ancestor': image},
                )
            except Exception:
                logger.exception('Failed to list sandbox containers for image %s', image)
                continue
            for container in image_containers:
                candidates[container.id] = container

        removed: list[str] = []
        for container_id, container in candidates.items():
            if container_id in active_container_ids:
                continue
            if not self._is_librechat_child(container):
                continue
            if now - self._expiration_anchor_epoch(container, now) < ttl_seconds:
                continue
            try:
                container.remove(force=True)
                removed.append(container_id)
            except Exception:
                logger.exception('Failed to remove expired sandbox container %s', container_id)

        return removed
