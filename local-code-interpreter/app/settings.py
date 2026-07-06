from __future__ import annotations

import os
from dataclasses import dataclass


def _get_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _get_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    api_key: str
    backend: str
    data_root: str
    workspace_root: str
    workspace_host_root: str
    session_ttl_hours: int
    cleanup_interval_seconds: int
    execution_timeout_seconds: int
    allow_network: bool
    memory_limit: str
    nano_cpus: int
    pids_limit: int
    python_image: str
    javascript_image: str
    java_image: str
    cpp_image: str
    go_image: str
    ruby_image: str
    r_image: str


def get_settings() -> Settings:
    return Settings(
        api_key=os.getenv('LOCAL_CODE_INTERPRETER_API_KEY', 'librechat-local-code-dev-key'),
        backend=os.getenv('LOCAL_CODE_SANDBOX_BACKEND', 'llm_sandbox'),
        data_root=os.getenv('LOCAL_CODE_DATA_ROOT', '/data'),
        workspace_root=os.getenv('LOCAL_CODE_WORKSPACE_ROOT', '/data/workspaces'),
        workspace_host_root=os.getenv(
            'LOCAL_CODE_WORKSPACE_HOST_ROOT',
            '/workspace/local-code-interpreter/data/workspaces',
        ),
        session_ttl_hours=max(_get_int('LOCAL_CODE_SESSION_TTL_HOURS', 1), 1),
        cleanup_interval_seconds=max(
            _get_int('LOCAL_CODE_CLEANUP_INTERVAL_SECONDS', 60),
            10,
        ),
        execution_timeout_seconds=_get_int('LOCAL_CODE_EXECUTION_TIMEOUT_SECONDS', 60),
        allow_network=_get_bool('LOCAL_CODE_ALLOW_NETWORK', False),
        memory_limit=os.getenv('LOCAL_CODE_MEMORY_LIMIT', '1g'),
        nano_cpus=_get_int('LOCAL_CODE_NANO_CPUS', 1_000_000_000),
        pids_limit=_get_int('LOCAL_CODE_PIDS_LIMIT', 256),
        python_image=os.getenv(
            'LOCAL_CODE_SANDBOX_PYTHON_IMAGE', 'ghcr.io/vndee/sandbox-python-311-bullseye'
        ),
        javascript_image=os.getenv(
            'LOCAL_CODE_SANDBOX_JAVASCRIPT_IMAGE', 'ghcr.io/vndee/sandbox-node-22-bullseye'
        ),
        java_image=os.getenv(
            'LOCAL_CODE_SANDBOX_JAVA_IMAGE', 'ghcr.io/vndee/sandbox-java-11-bullseye'
        ),
        cpp_image=os.getenv(
            'LOCAL_CODE_SANDBOX_CPP_IMAGE', 'ghcr.io/vndee/sandbox-cpp-11-bullseye'
        ),
        go_image=os.getenv(
            'LOCAL_CODE_SANDBOX_GO_IMAGE', 'ghcr.io/vndee/sandbox-go-123-bullseye'
        ),
        ruby_image=os.getenv(
            'LOCAL_CODE_SANDBOX_RUBY_IMAGE', 'ghcr.io/vndee/sandbox-ruby-302-bullseye'
        ),
        r_image=os.getenv('LOCAL_CODE_SANDBOX_R_IMAGE', 'ghcr.io/vndee/sandbox-r-451-bullseye'),
    )
