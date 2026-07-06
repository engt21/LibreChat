from __future__ import annotations

import base64
import shlex
import tempfile
import threading
import time
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import docker
from llm_sandbox import ArtifactSandboxSession, SandboxBackend, SandboxSession, SupportedLanguage

from app.models import AdapterExecutionResult
from app.sandbox_cleanup import MANAGED_LABEL, OWNER_LABEL, OWNER_VALUE, SandboxContainerJanitor
from app.settings import Settings

from .base import SandboxAdapter


@dataclass(frozen=True)
class SessionRunConfig:
    language: SupportedLanguage
    image: str
    capture_plots: bool = False
    command_prefix: str | None = None
    script_suffix: str | None = None


@dataclass(frozen=True)
class CommandRunConfig:
    session_language: SupportedLanguage
    image: str
    script_suffix: str
    command_builder: Callable[[str, str], str]


RuntimeSession = Any


@dataclass
class ManagedRuntimeSession:
    session: RuntimeSession
    workspace_host_path: str
    last_used_at: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


class LlmSandboxAdapter(SandboxAdapter):
    def __init__(self, settings: Settings):
        self.settings = settings
        self._sessions: dict[tuple[str, str], ManagedRuntimeSession] = {}
        self._sessions_lock = threading.Lock()
        self._prewarm_lock = threading.Lock()
        self._prewarm_started = False
        self._container_janitor = SandboxContainerJanitor(
            docker.from_env(),
            {
                settings.python_image,
                settings.javascript_image,
                settings.java_image,
                settings.cpp_image,
                settings.go_image,
                settings.ruby_image,
                settings.r_image,
            },
            settings.workspace_host_root,
        )
        self._run_configs: dict[str, SessionRunConfig] = {
            'python': SessionRunConfig(
                language=SupportedLanguage.PYTHON,
                image=settings.python_image,
                capture_plots=True,
                command_prefix='python',
                script_suffix='py',
            ),
            'javascript': SessionRunConfig(
                language=SupportedLanguage.JAVASCRIPT,
                image=settings.javascript_image,
                command_prefix='node',
                script_suffix='js',
            ),
            'java': SessionRunConfig(language=SupportedLanguage.JAVA, image=settings.java_image),
            'cpp': SessionRunConfig(language=SupportedLanguage.CPP, image=settings.cpp_image),
            'go': SessionRunConfig(language=SupportedLanguage.GO, image=settings.go_image),
            'ruby': SessionRunConfig(
                language=SupportedLanguage.RUBY,
                image=settings.ruby_image,
                command_prefix='ruby',
                script_suffix='rb',
            ),
            'r': SessionRunConfig(
                language=SupportedLanguage.R,
                image=settings.r_image,
                capture_plots=True,
                command_prefix='Rscript',
                script_suffix='r',
            ),
        }
        self._command_configs: dict[str, CommandRunConfig] = {
            'bash': CommandRunConfig(
                session_language=SupportedLanguage.PYTHON,
                image=settings.python_image,
                script_suffix='sh',
                command_builder=lambda script_path, args: f'bash {shlex.quote(script_path)}{args}',
            ),
            'c': CommandRunConfig(
                session_language=SupportedLanguage.CPP,
                image=settings.cpp_image,
                script_suffix='c',
                command_builder=lambda script_path, args: (
                    f'gcc {shlex.quote(script_path)} -o /tmp/{Path(script_path).stem}.out '
                    f'&& /tmp/{Path(script_path).stem}.out{args}'
                ),
            ),
        }

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
        normalized_lang = self._normalize_language(lang)
        timeout_seconds = timeout or self.settings.execution_timeout_seconds

        if normalized_lang in self._command_configs:
            return self._execute_command_script(
                session_id=session_id,
                normalized_lang=normalized_lang,
                config=self._command_configs[normalized_lang],
                workspace_host_path=workspace_host_path,
                code=code,
                args=args,
                timeout_seconds=timeout_seconds,
            )

        run_config = self._run_configs.get(normalized_lang)
        if not run_config:
            supported = sorted(set(self._run_configs) | set(self._command_configs))
            raise ValueError(
                f'Unsupported language "{lang}". Supported local languages: {", ".join(supported)}'
            )

        if args and run_config.command_prefix and run_config.script_suffix:
            return self._execute_session_command(
                session_id=session_id,
                normalized_lang=normalized_lang,
                run_config=run_config,
                workspace_host_path=workspace_host_path,
                code=code,
                args=args,
                timeout_seconds=timeout_seconds,
            )

        return self._execute_code(
            session_id=session_id,
            normalized_lang=normalized_lang,
            run_config=run_config,
            workspace_path=workspace_path,
            workspace_host_path=workspace_host_path,
            code=code,
            timeout_seconds=timeout_seconds,
        )

    def cleanup_expired_sessions(self) -> None:
        expiration_seconds = max(self.settings.session_ttl_hours, 1) * 3600
        cutoff = time.monotonic() - expiration_seconds
        expired_keys: list[tuple[str, str]] = []

        with self._sessions_lock:
            for key, runtime in self._sessions.items():
                if runtime.last_used_at < cutoff:
                    expired_keys.append(key)

        for key in expired_keys:
            self._discard_runtime(key)

    def cleanup_orphaned_containers(self) -> list[str]:
        with self._sessions_lock:
            active_container_ids = {
                container_id
                for runtime in self._sessions.values()
                if (
                    container_id := getattr(
                        getattr(runtime.session, 'container', None),
                        'id',
                        None,
                    )
                )
            }
            return self._container_janitor.cleanup(
                active_container_ids=active_container_ids,
                ttl_seconds=max(self.settings.session_ttl_hours, 1) * 3600,
                now=time.time(),
            )

    def shutdown(self) -> None:
        with self._sessions_lock:
            keys = list(self._sessions.keys())

        for key in keys:
            self._discard_runtime(key)

    def start_background_prewarm(self) -> None:
        with self._prewarm_lock:
            if self._prewarm_started:
                return
            self._prewarm_started = True

        threading.Thread(target=self._prewarm_python_runtime, daemon=True).start()

    def _prewarm_python_runtime(self) -> None:
        prewarm_container_path = Path(self.settings.workspace_root) / '.prewarm'
        prewarm_container_path.mkdir(parents=True, exist_ok=True)
        prewarm_host_path = str(Path(self.settings.workspace_host_root) / '.prewarm')

        session: RuntimeSession | None = None
        try:
            session = self._create_open_session(
                language=SupportedLanguage.PYTHON,
                image=self.settings.python_image,
                capture_plots=False,
                workspace_host_path=prewarm_host_path,
            )
            session.run('print(0)', timeout=min(self.settings.execution_timeout_seconds, 30))
        except Exception:
            return
        finally:
            if session is not None:
                with suppress(Exception):
                    session.close()

    def _execute_code(
        self,
        *,
        session_id: str,
        normalized_lang: str,
        run_config: SessionRunConfig,
        workspace_path: str,
        workspace_host_path: str,
        code: str,
        timeout_seconds: int,
    ) -> AdapterExecutionResult:
        def invoke(session: RuntimeSession) -> AdapterExecutionResult:
            result = session.run(code, timeout=timeout_seconds)
            materialized_files = []
            if run_config.capture_plots and getattr(result, 'plots', None):
                materialized_files = self._persist_plots(workspace_path, result.plots)

            return AdapterExecutionResult(
                stdout=self._sanitize_stdout(result.stdout or '', run_config.language),
                stderr=(result.stderr or '').rstrip(),
                materialized_files=materialized_files,
            )

        return self._with_runtime_session(
            session_id=session_id,
            normalized_lang=normalized_lang,
            workspace_host_path=workspace_host_path,
            create_session=lambda: self._create_open_session(
                language=run_config.language,
                image=run_config.image,
                capture_plots=run_config.capture_plots,
                workspace_host_path=workspace_host_path,
            ),
            invoke=invoke,
        )

    def _execute_session_command(
        self,
        *,
        session_id: str,
        normalized_lang: str,
        run_config: SessionRunConfig,
        workspace_host_path: str,
        code: str,
        args: list[str],
        timeout_seconds: int,
    ) -> AdapterExecutionResult:
        def invoke(session: RuntimeSession) -> AdapterExecutionResult:
            container_script_path = self._copy_script_to_runtime(
                session=session,
                code=code,
                suffix=run_config.script_suffix or 'txt',
            )
            try:
                quoted_args = self._quoted_args(args)
                command = f'{run_config.command_prefix} {shlex.quote(container_script_path)}{quoted_args}'
                result = session.execute_command(
                    self._timeout_command(command, timeout_seconds),
                    workdir='/mnt/data',
                )
            finally:
                self._remove_runtime_file(session, container_script_path)

            return AdapterExecutionResult(
                stdout=(result.stdout or '').rstrip(),
                stderr=(result.stderr or '').rstrip(),
            )

        return self._with_runtime_session(
            session_id=session_id,
            normalized_lang=normalized_lang,
            workspace_host_path=workspace_host_path,
            create_session=lambda: self._create_open_session(
                language=run_config.language,
                image=run_config.image,
                capture_plots=run_config.capture_plots,
                workspace_host_path=workspace_host_path,
            ),
            invoke=invoke,
        )

    def _execute_command_script(
        self,
        *,
        session_id: str,
        normalized_lang: str,
        config: CommandRunConfig,
        workspace_host_path: str,
        code: str,
        args: list[str],
        timeout_seconds: int,
    ) -> AdapterExecutionResult:
        def invoke(session: RuntimeSession) -> AdapterExecutionResult:
            container_script_path = self._copy_script_to_runtime(
                session=session,
                code=code,
                suffix=config.script_suffix,
            )
            try:
                command = config.command_builder(container_script_path, self._quoted_args(args))
                result = session.execute_command(
                    self._timeout_command(command, timeout_seconds),
                    workdir='/mnt/data',
                )
            finally:
                self._remove_runtime_file(session, container_script_path)

            return AdapterExecutionResult(
                stdout=(result.stdout or '').rstrip(),
                stderr=(result.stderr or '').rstrip(),
            )

        return self._with_runtime_session(
            session_id=session_id,
            normalized_lang=normalized_lang,
            workspace_host_path=workspace_host_path,
            create_session=lambda: self._create_open_session(
                language=config.session_language,
                image=config.image,
                capture_plots=False,
                workspace_host_path=workspace_host_path,
            ),
            invoke=invoke,
        )

    def _with_runtime_session(
        self,
        *,
        session_id: str,
        normalized_lang: str,
        workspace_host_path: str,
        create_session: Callable[[], RuntimeSession],
        invoke: Callable[[RuntimeSession], AdapterExecutionResult],
    ) -> AdapterExecutionResult:
        runtime_key = (session_id, normalized_lang)

        for attempt in range(2):
            runtime = self._get_or_create_runtime(runtime_key, workspace_host_path, create_session)
            try:
                with runtime.lock:
                    runtime.last_used_at = time.monotonic()
                    result = invoke(runtime.session)
                    runtime.last_used_at = time.monotonic()
                    return result
            except Exception:
                self._discard_runtime(runtime_key, expected=runtime)
                if attempt == 1:
                    raise

        raise RuntimeError('Failed to execute local code session')

    def _get_or_create_runtime(
        self,
        key: tuple[str, str],
        workspace_host_path: str,
        create_session: Callable[[], RuntimeSession],
    ) -> ManagedRuntimeSession:
        stale_runtime: ManagedRuntimeSession | None = None

        with self._sessions_lock:
            runtime = self._sessions.get(key)
            if runtime and runtime.workspace_host_path == workspace_host_path:
                return runtime
            if runtime:
                stale_runtime = self._sessions.pop(key)

        if stale_runtime:
            self._close_runtime(stale_runtime)

        session = create_session()
        runtime = ManagedRuntimeSession(session=session, workspace_host_path=workspace_host_path)

        with self._sessions_lock:
            displaced_runtime: ManagedRuntimeSession | None = None
            existing = self._sessions.get(key)
            if existing and existing.workspace_host_path == workspace_host_path:
                self._close_runtime(runtime)
                return existing
            if existing:
                displaced_runtime = self._sessions.pop(key)
            self._sessions[key] = runtime

        if displaced_runtime:
            self._close_runtime(displaced_runtime)

        return runtime

    def _discard_runtime(
        self,
        key: tuple[str, str],
        expected: ManagedRuntimeSession | None = None,
    ) -> None:
        runtime: ManagedRuntimeSession | None = None

        with self._sessions_lock:
            current = self._sessions.get(key)
            if current is None:
                return
            if expected is not None and current is not expected:
                return
            runtime = self._sessions.pop(key)

        if runtime:
            self._close_runtime(runtime)

    def _close_runtime(self, runtime: ManagedRuntimeSession) -> None:
        with runtime.lock:
            with suppress(Exception):
                runtime.session.close()

    def _create_open_session(
        self,
        *,
        language: SupportedLanguage,
        image: str,
        capture_plots: bool,
        workspace_host_path: str,
    ) -> RuntimeSession:
        session_cls = ArtifactSandboxSession if capture_plots else SandboxSession
        session = session_cls(
            backend=SandboxBackend.DOCKER,
            lang=language,
            image=image,
            runtime_configs=self._runtime_configs(workspace_host_path),
            workdir='/mnt/data',
            verbose=False,
            skip_environment_setup=True,
        )
        session.open()
        return session

    def _copy_script_to_runtime(self, *, session, code: str, suffix: str) -> str:
        temp_file = tempfile.NamedTemporaryFile(mode='w', suffix=f'.{suffix}', delete=False)
        try:
            temp_file.write(code)
            temp_file.flush()
            temp_file.close()
            container_script_path = f'/tmp/{uuid4().hex}.{suffix}'
            session.copy_to_runtime(temp_file.name, container_script_path)
            return container_script_path
        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    def _remove_runtime_file(self, session: RuntimeSession, path: str) -> None:
        with suppress(Exception):
            session.execute_command(f'rm -f {shlex.quote(path)}')

    def _persist_plots(self, workspace_host_path: str, plots) -> list[str]:
        workspace = Path(workspace_host_path)
        materialized_files: list[str] = []
        for index, plot in enumerate(plots, start=1):
            suffix = getattr(plot.format, 'value', 'png')
            filename = f'plot-{uuid4().hex[:8]}-{index}.{suffix}'
            destination = workspace / filename
            destination.write_bytes(base64.b64decode(plot.content_base64))
            materialized_files.append(filename)
        return materialized_files

    def _active_container_ids(self) -> set[str]:
        with self._sessions_lock:
            runtimes = list(self._sessions.values())

        active_ids: set[str] = set()
        for runtime in runtimes:
            container = getattr(runtime.session, 'container', None)
            container_id = getattr(container, 'id', None)
            if container_id:
                active_ids.add(container_id)
        return active_ids

    def _runtime_configs(self, workspace_host_path: str) -> dict[str, object]:
        return {
            'name': f'librechat-code-{uuid4().hex[:12]}',
            'labels': {
                MANAGED_LABEL: 'true',
                OWNER_LABEL: OWNER_VALUE,
            },
            'volumes': {
                workspace_host_path: {
                    'bind': '/mnt/data',
                    'mode': 'rw',
                },
            },
            'network_disabled': not self.settings.allow_network,
            'mem_limit': self.settings.memory_limit,
            'nano_cpus': self.settings.nano_cpus,
            'pids_limit': self.settings.pids_limit,
            'cap_drop': ['ALL'],
            'security_opt': ['no-new-privileges=true'],
        }

    def _sanitize_stdout(self, stdout: str, language: SupportedLanguage) -> str:
        cleaned = stdout.rstrip()
        setup_banner = None
        if language == SupportedLanguage.PYTHON:
            setup_banner = 'Python plot detection setup complete'
        elif language == SupportedLanguage.R:
            setup_banner = 'R plot detection setup complete'

        if setup_banner and cleaned.startswith(setup_banner):
            cleaned = cleaned[len(setup_banner) :].lstrip('\n')

        return cleaned

    def _normalize_language(self, lang: str) -> str:
        normalized = lang.strip().lower()
        aliases = {
            'py': 'python',
            'python3': 'python',
            'js': 'javascript',
            'node': 'javascript',
            'sh': 'bash',
            'shell': 'bash',
            'zsh': 'bash',
            'c++': 'cpp',
            'golang': 'go',
            'rb': 'ruby',
        }
        return aliases.get(normalized, normalized)

    def _quoted_args(self, args: list[str]) -> str:
        if not args:
            return ''
        return ' ' + ' '.join(shlex.quote(arg) for arg in args)

    def _timeout_command(self, command: str, timeout_seconds: int) -> str:
        return f'timeout {max(timeout_seconds, 1)}s sh -lc {shlex.quote(command)}'
