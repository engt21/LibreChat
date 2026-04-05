from __future__ import annotations

import json
import mimetypes
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from .models import StoredFile, StoredSession, VisibleFileSnapshot
from .settings import Settings

_INTERNAL_DIRS = {'.sandbox-venv', '.sandbox-pip-cache', '__pycache__'}
_TEMP_SCRIPT_PATTERN = re.compile(r'^[0-9a-f]{32}\.(?:py|js|java|cpp|go|rb|r)$', re.IGNORECASE)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()


def _normalize_relative_path(relative_path: str) -> str:
    normalized = relative_path.replace('\\', '/').strip().lstrip('/')
    if not normalized or normalized in {'.', '..'}:
        raise ValueError('Invalid relative path')
    parts = [part for part in normalized.split('/') if part not in {'', '.', '..'}]
    return '/'.join(parts)


def _sanitize_filename(name: str) -> str:
    safe = Path(name).name.strip().replace('\x00', '')
    safe = re.sub(r'[^A-Za-z0-9._()\- ]+', '_', safe)
    return safe or 'file'


class SessionStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.data_root = Path(settings.data_root)
        self.workspace_root = Path(settings.workspace_root)
        self.workspace_host_root = Path(settings.workspace_host_root)
        self.metadata_root = self.data_root / 'metadata'
        self.entities_root = self.data_root / 'entities'
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.metadata_root.mkdir(parents=True, exist_ok=True)
        self.entities_root.mkdir(parents=True, exist_ok=True)

    def _metadata_path(self, session_id: str) -> Path:
        return self.metadata_root / f'{session_id}.json'

    def _entity_path(self, entity_id: str) -> Path:
        return self.entities_root / f'{entity_id}.json'

    def workspace_path(self, session_id: str) -> Path:
        return self.workspace_root / session_id

    def workspace_host_path(self, session_id: str) -> Path:
        return self.workspace_host_root / session_id

    def cleanup_expired_sessions(self) -> None:
        cutoff = utcnow() - timedelta(hours=self.settings.session_ttl_hours)
        for metadata_path in self.metadata_root.glob('*.json'):
            try:
                session = self.get_session(metadata_path.stem)
            except FileNotFoundError:
                continue
            updated_at = datetime.fromisoformat(session.updated_at)
            if updated_at >= cutoff:
                continue
            self.delete_session(session.session_id)

    def delete_session(self, session_id: str) -> None:
        try:
            session = self.get_session(session_id)
        except FileNotFoundError:
            session = None

        if session and session.entity_id:
            entity_path = self._entity_path(session.entity_id)
            if entity_path.exists():
                entity_path.unlink()

        workspace_path = self.workspace_path(session_id)
        if workspace_path.exists():
            shutil.rmtree(workspace_path, ignore_errors=True)

        metadata_path = self._metadata_path(session_id)
        if metadata_path.exists():
            metadata_path.unlink()

    def get_session(self, session_id: str) -> StoredSession:
        metadata_path = self._metadata_path(session_id)
        if not metadata_path.exists():
            raise FileNotFoundError(session_id)

        data = json.loads(metadata_path.read_text())
        session = StoredSession.from_dict(data)
        self._prune_missing_files(session)
        return session

    def _resolve_entity_session_id(self, entity_id: str) -> str | None:
        entity_path = self._entity_path(entity_id)
        if not entity_path.exists():
            return None

        try:
            data = json.loads(entity_path.read_text())
        except json.JSONDecodeError:
            entity_path.unlink(missing_ok=True)
            return None

        session_id = data.get('session_id')
        if not session_id:
            return None
        if not self._metadata_path(session_id).exists():
            entity_path.unlink(missing_ok=True)
            return None
        return session_id

    def get_or_create_session(
        self,
        session_id: str | None = None,
        entity_id: str | None = None,
    ) -> StoredSession:
        if session_id:
            try:
                return self.get_session(session_id)
            except FileNotFoundError:
                return self._create_session(session_id, entity_id=entity_id)

        if entity_id:
            existing_session_id = self._resolve_entity_session_id(entity_id)
            if existing_session_id:
                return self.get_session(existing_session_id)

        return self._create_session(entity_id=entity_id)

    def _create_session(self, session_id: str | None = None, entity_id: str | None = None) -> StoredSession:
        now = iso_now()
        session = StoredSession(
            session_id=session_id or uuid4().hex,
            created_at=now,
            updated_at=now,
            entity_id=entity_id,
        )
        self.workspace_path(session.session_id).mkdir(parents=True, exist_ok=True)
        self.save_session(session)

        if entity_id:
            self._entity_path(entity_id).write_text(json.dumps({'session_id': session.session_id}))

        return session

    def save_session(self, session: StoredSession) -> StoredSession:
        session.updated_at = iso_now()
        self._metadata_path(session.session_id).write_text(json.dumps(session.to_dict(), indent=2))
        return session

    def _prune_missing_files(self, session: StoredSession) -> None:
        removed = [
            file_id
            for file_id, stored_file in session.files.items()
            if not (self.workspace_path(session.session_id) / stored_file.relative_path).exists()
        ]
        if not removed:
            return

        for file_id in removed:
            session.files.pop(file_id, None)
        self.save_session(session)

    def _allocate_relative_path(self, session: StoredSession, requested_name: str) -> str:
        safe_name = _sanitize_filename(requested_name)
        workspace_path = self.workspace_path(session.session_id)
        candidate = safe_name
        stem = Path(safe_name).stem or 'file'
        suffix = Path(safe_name).suffix
        index = 1

        while (workspace_path / candidate).exists():
            candidate = f'{stem}-{index}{suffix}'
            index += 1

        return candidate

    def register_file(
        self,
        session: StoredSession,
        relative_path: str,
        source: str,
        mime_type: str | None = None,
    ) -> StoredFile:
        normalized_path = _normalize_relative_path(relative_path)
        workspace_file = self.workspace_path(session.session_id) / normalized_path
        if not workspace_file.exists():
            raise FileNotFoundError(workspace_file)

        for stored_file in session.files.values():
            if stored_file.relative_path == normalized_path:
                stored_file.updated_at = iso_now()
                stored_file.size = workspace_file.stat().st_size
                if mime_type:
                    stored_file.mime_type = mime_type
                self.save_session(session)
                return stored_file

        stored_file = StoredFile(
            file_id=uuid4().hex,
            relative_path=normalized_path,
            source=source,
            created_at=iso_now(),
            updated_at=iso_now(),
            size=workspace_file.stat().st_size,
            mime_type=mime_type or mimetypes.guess_type(workspace_file.name)[0],
        )
        session.files[stored_file.file_id] = stored_file
        self.save_session(session)
        return stored_file

    def save_upload(self, session: StoredSession, file_stream, filename: str, mime_type: str | None) -> StoredFile:
        relative_path = self._allocate_relative_path(session, filename)
        destination = self.workspace_path(session.session_id) / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('wb') as output:
            shutil.copyfileobj(file_stream, output)
        return self.register_file(session, relative_path, source='upload', mime_type=mime_type)

    def list_files(self, session_id: str) -> list[StoredFile]:
        session = self.get_session(session_id)
        return sorted(session.files.values(), key=lambda file: file.updated_at)

    def get_file(self, session_id: str, file_id: str) -> StoredFile:
        session = self.get_session(session_id)
        stored_file = session.files.get(file_id)
        if not stored_file:
            raise FileNotFoundError(file_id)
        return stored_file

    def file_path(self, session_id: str, stored_file: StoredFile) -> Path:
        return self.workspace_path(session_id) / stored_file.relative_path

    def scan_visible_files(self, session_id: str) -> dict[str, VisibleFileSnapshot]:
        workspace_path = self.workspace_path(session_id)
        if not workspace_path.exists():
            return {}

        snapshots: dict[str, VisibleFileSnapshot] = {}
        for path in workspace_path.rglob('*'):
            if not path.is_file():
                continue
            relative_path = path.relative_to(workspace_path)
            if not self._is_visible(relative_path):
                continue
            stat = path.stat()
            relative = relative_path.as_posix()
            snapshots[relative] = VisibleFileSnapshot(
                relative_path=relative,
                size=stat.st_size,
                mtime_ns=stat.st_mtime_ns,
            )
        return snapshots

    def _is_visible(self, relative_path: Path) -> bool:
        if any(part in _INTERNAL_DIRS for part in relative_path.parts):
            return False
        if any(part.startswith('.') for part in relative_path.parts[:-1]):
            return False
        if relative_path.name.startswith('.'):
            return False
        if _TEMP_SCRIPT_PATTERN.match(relative_path.name):
            return False
        return True

    def sync_snapshot(self, session: StoredSession, snapshots: Iterable[VisibleFileSnapshot], source: str) -> None:
        existing_paths = {snapshot.relative_path for snapshot in snapshots}
        for file_id, stored_file in list(session.files.items()):
            if stored_file.relative_path not in existing_paths:
                session.files.pop(file_id, None)

        for snapshot in snapshots:
            self.register_file(session, snapshot.relative_path, source=source)

        self.save_session(session)

    def copy_file_to_session(
        self,
        source_session_id: str,
        source_file_id: str,
        target_session: StoredSession,
    ) -> StoredFile:
        source_file = self.get_file(source_session_id, source_file_id)
        source_path = self.file_path(source_session_id, source_file)
        if source_session_id == target_session.session_id:
            return source_file

        target_workspace = self.workspace_path(target_session.session_id)
        target_relative_path = source_file.relative_path
        if (target_workspace / target_relative_path).exists():
            existing = [
                file
                for file in target_session.files.values()
                if file.relative_path == target_relative_path
            ]
            if existing:
                return existing[0]
            target_relative_path = self._allocate_relative_path(target_session, Path(target_relative_path).name)

        destination = target_workspace / target_relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination)
        return self.register_file(
            target_session,
            target_relative_path,
            source='copied',
            mime_type=source_file.mime_type,
        )

    def summarize_changed_files(
        self,
        session: StoredSession,
        before: dict[str, VisibleFileSnapshot],
        after: dict[str, VisibleFileSnapshot],
    ) -> list[StoredFile]:
        changed: list[StoredFile] = []
        tracked_paths = {file.relative_path: file for file in session.files.values()}

        for relative_path, snapshot in before.items():
            after_snapshot = after.get(relative_path)
            if after_snapshot is None:
                tracked_file = tracked_paths.get(relative_path)
                if tracked_file:
                    session.files.pop(tracked_file.file_id, None)

        for relative_path, snapshot in after.items():
            before_snapshot = before.get(relative_path)
            if (
                before_snapshot is None
                or before_snapshot.size != snapshot.size
                or before_snapshot.mtime_ns != snapshot.mtime_ns
            ):
                changed.append(self.register_file(session, relative_path, source='generated'))

        self.save_session(session)
        return changed

    def api_file_name(self, session_id: str, stored_file: StoredFile) -> str:
        suffix = Path(stored_file.relative_path).suffix
        return f'{session_id}/{stored_file.file_id}{suffix}'

    def touch_session(self, session: StoredSession) -> StoredSession:
        session.updated_at = iso_now()
        return self.save_session(session)
