from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import AdapterExecutionResult


class SandboxAdapter(ABC):
    @abstractmethod
    def execute(
        self,
        *,
        session_id: str,
        workspace_path: str,
        workspace_host_path: str,
        lang: str,
        code: str,
        args: list[str],
        timeout: int | None = None,
    ) -> AdapterExecutionResult:
        raise NotImplementedError
