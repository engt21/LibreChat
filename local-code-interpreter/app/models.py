from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from pydantic import BaseModel, Field


class CodeEnvFileRef(BaseModel):
    id: str
    name: str
    session_id: str


class ExecRequest(BaseModel):
    lang: str
    code: str
    args: list[str] = Field(default_factory=list)
    timeout: int | None = None
    session_id: str | None = None
    files: list[CodeEnvFileRef] = Field(default_factory=list)


class ProgrammaticExecRequest(BaseModel):
    session_id: str | None = None
    continuation_token: str | None = None
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    timeout: int | None = None
    files: list[CodeEnvFileRef] = Field(default_factory=list)


class ExecOutputFile(BaseModel):
    id: str
    name: str
    session_id: str


class ExecResponse(BaseModel):
    session_id: str
    stdout: str = ''
    stderr: str = ''
    files: list[ExecOutputFile] = Field(default_factory=list)


@dataclass
class StoredFile:
    file_id: str
    relative_path: str
    source: str
    created_at: str
    updated_at: str
    size: int
    mime_type: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'StoredFile':
        return cls(**data)


@dataclass
class StoredSession:
    session_id: str
    created_at: str
    updated_at: str
    entity_id: str | None = None
    files: dict[str, StoredFile] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            'session_id': self.session_id,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'entity_id': self.entity_id,
            'files': {file_id: file.to_dict() for file_id, file in self.files.items()},
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'StoredSession':
        files = {
            file_id: StoredFile.from_dict(file_data)
            for file_id, file_data in (data.get('files') or {}).items()
        }
        return cls(
            session_id=data['session_id'],
            created_at=data['created_at'],
            updated_at=data['updated_at'],
            entity_id=data.get('entity_id'),
            files=files,
        )


@dataclass(frozen=True)
class VisibleFileSnapshot:
    relative_path: str
    size: int
    mtime_ns: int


@dataclass
class AdapterExecutionResult:
    stdout: str
    stderr: str
    materialized_files: list[str] = field(default_factory=list)
