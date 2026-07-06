# Local Code Interpreter Operations

The bridge keeps one sandbox child per active session/language and removes it after one hour of inactivity. Orphan cleanup now anchors that one-hour TTL to the session metadata `updated_at` timestamp when the container can be mapped back to a workspace session; if that metadata is missing or malformed, cleanup falls back to Docker's container creation time. Cleanup runs in the background, not only when another API request arrives.

Future children are named `librechat-code-*` and carry the `com.librechat.local-code-interpreter.managed=true` label. The janitor also recognizes legacy children by the configured sandbox image, so containers orphaned by an older bridge process are removed after the same TTL.

Configuration:

- `LOCAL_CODE_SESSION_TTL_HOURS` defaults to `1` and cannot be set below one hour.
- `LOCAL_CODE_CLEANUP_INTERVAL_SECONDS` defaults to `60` and cannot be set below ten seconds.
- Active children are excluded from orphan cleanup. Bridge shutdown still closes all children immediately.

Focused validation:

```bash
PYTHONPATH=local-code-interpreter python3 -m unittest discover -s local-code-interpreter/tests -p 'test_sandbox_cleanup.py' -v
```
