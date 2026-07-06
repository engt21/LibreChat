from __future__ import annotations

import logging
import threading
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.adapters.llm_sandbox import LlmSandboxAdapter
from app.models import ExecOutputFile, ExecRequest, ExecResponse, ProgrammaticExecRequest
from app.settings import Settings, get_settings
from app.store import SessionStore

settings = get_settings()
store = SessionStore(settings)
adapter = LlmSandboxAdapter(settings)

app = FastAPI(title='LibreChat Local Code Interpreter', version='0.1.0')
logger = logging.getLogger(__name__)
cleanup_stop = threading.Event()
cleanup_thread: threading.Thread | None = None


def require_api_key(x_api_key: str | None = Header(default=None, alias='X-API-Key')) -> None:
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail='Invalid API key')


def get_runtime() -> tuple[Settings, SessionStore, LlmSandboxAdapter]:
    adapter.cleanup_expired_sessions()
    store.cleanup_expired_sessions()
    return settings, store, adapter


@app.on_event('startup')
def startup_runtime() -> None:
    global cleanup_thread
    adapter.start_background_prewarm()
    cleanup_stop.clear()
    cleanup_thread = threading.Thread(target=cleanup_runtime_loop, daemon=True)
    cleanup_thread.start()


@app.on_event('shutdown')
def shutdown_runtime() -> None:
    cleanup_stop.set()
    if cleanup_thread is not None:
        cleanup_thread.join(timeout=5)
    adapter.shutdown()


def cleanup_runtime_once() -> None:
    adapter.cleanup_expired_sessions()
    removed = adapter.cleanup_orphaned_containers()
    if removed:
        logger.info('Removed %d expired local Code Interpreter sandbox containers', len(removed))


def cleanup_runtime_loop() -> None:
    while not cleanup_stop.is_set():
        try:
            cleanup_runtime_once()
        except Exception:
            logger.exception('Local Code Interpreter sandbox cleanup failed')
        cleanup_stop.wait(settings.cleanup_interval_seconds)


@app.get('/v1/health')
def health() -> dict[str, str | bool]:
    return {
        'status': 'ok',
        'backend': settings.backend,
        'network_enabled': settings.allow_network,
    }


@app.post('/v1/upload')
def upload_file(
    file: UploadFile = File(...),
    entity_id: str | None = Form(default=None),
    _: None = Depends(require_api_key),
    runtime: tuple[Settings, SessionStore, LlmSandboxAdapter] = Depends(get_runtime),
) -> dict[str, object]:
    _, runtime_store, _ = runtime
    session = runtime_store.get_or_create_session(entity_id=entity_id)
    stored_file = runtime_store.save_upload(
        session,
        file.file,
        filename=file.filename or 'upload.bin',
        mime_type=file.content_type,
    )
    return {
        'message': 'success',
        'session_id': session.session_id,
        'files': [
            {
                'fileId': stored_file.file_id,
                'filename': Path(stored_file.relative_path).name,
            },
        ],
    }


@app.get('/v1/files/{session_id}')
def list_session_files(
    session_id: str,
    detail: str = Query(default='full'),
    _: None = Depends(require_api_key),
    runtime: tuple[Settings, SessionStore, LlmSandboxAdapter] = Depends(get_runtime),
) -> list[dict[str, object]]:
    _, runtime_store, _ = runtime
    try:
        files = runtime_store.list_files(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail='Session not found') from exc

    response: list[dict[str, object]] = []
    for stored_file in files:
        name = runtime_store.api_file_name(session_id, stored_file)
        if detail == 'summary':
            response.append(
                {
                    'name': name,
                    'lastModified': stored_file.updated_at,
                }
            )
            continue
        response.append(
            {
                'id': stored_file.file_id,
                'name': name,
                'bytes': stored_file.size,
                'lastModified': stored_file.updated_at,
                'metadata': {
                    'original-filename': stored_file.relative_path,
                    'source': stored_file.source,
                },
            }
        )
    return response


@app.get('/v1/download/{session_id}/{file_id}')
def download_file(
    session_id: str,
    file_id: str,
    _: None = Depends(require_api_key),
    runtime: tuple[Settings, SessionStore, LlmSandboxAdapter] = Depends(get_runtime),
) -> FileResponse:
    _, runtime_store, _ = runtime
    try:
        stored_file = runtime_store.get_file(session_id, file_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail='File not found') from exc

    file_path = runtime_store.file_path(session_id, stored_file)
    media_type = stored_file.mime_type or 'application/octet-stream'
    return FileResponse(file_path, media_type=media_type, filename=Path(stored_file.relative_path).name)


@app.post('/v1/exec', response_model=ExecResponse)
def exec_code(
    payload: ExecRequest,
    _: None = Depends(require_api_key),
    runtime: tuple[Settings, SessionStore, LlmSandboxAdapter] = Depends(get_runtime),
) -> ExecResponse:
    _, runtime_store, runtime_adapter = runtime
    session = runtime_store.get_or_create_session(session_id=payload.session_id)

    for file_ref in payload.files:
        runtime_store.copy_file_to_session(file_ref.session_id, file_ref.id, session)

    before_snapshot = runtime_store.scan_visible_files(session.session_id)
    try:
        result = runtime_adapter.execute(
            session_id=session.session_id,
            workspace_path=str(runtime_store.workspace_path(session.session_id)),
            workspace_host_path=str(runtime_store.workspace_host_path(session.session_id)),
            lang=payload.lang,
            code=payload.code,
            args=payload.args,
            timeout=payload.timeout,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    after_snapshot = runtime_store.scan_visible_files(session.session_id)
    changed_files = runtime_store.summarize_changed_files(session, before_snapshot, after_snapshot)
    if not changed_files:
        runtime_store.touch_session(session)

    return ExecResponse(
        session_id=session.session_id,
        stdout=result.stdout,
        stderr=result.stderr,
        files=[
            ExecOutputFile(
                id=stored_file.file_id,
                name=stored_file.relative_path,
                session_id=session.session_id,
            )
            for stored_file in sorted(changed_files, key=lambda file: file.relative_path)
        ],
    )


@app.post('/v1/exec/programmatic')
def exec_programmatic(
    _: ProgrammaticExecRequest,
    __: None = Depends(require_api_key),
) -> dict[str, object]:
    return {
        'status': 'error',
        'error': 'Programmatic tool calling is not supported by the local llm-sandbox bridge.',
        'tool_calls': [],
        'stdout': '',
        'stderr': '',
    }
