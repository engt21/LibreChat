# Benchmark Production Priority

Detached benchmarks on the LibreChat VM must be launched through `run-benchmark-production-priority.sh`. Do not restart an unmanaged benchmark directly.

The supervisor enforces these defaults:

- Three consecutive successful checks of LibreChat `/api/config` and MongoDB health before launch or resume.
- Immediate `SIGSTOP` of the entire benchmark service when either check fails.
- Resume only after three consecutive healthy checks.
- `CPUQuota=20%`, `CPUWeight=10`, `MemoryHigh=1536M`, `MemoryMax=2G`, no swap, `IOWeight=10`, `20M/s` read, `10M/s` write, and `Nice=15`.
- `OOMPolicy=stop`, so a benchmark memory failure stops the benchmark rather than competing with production recovery.

Launch pattern on the VM:

```bash
nohup /opt/LibreChat-custom/local-services/run-benchmark-production-priority.sh \
  --unit librechat-detached-benchmark \
  --working-directory /path/to/benchmark \
  -- ./run-benchmark.sh \
  > "$HOME/.local/state/librechat-benchmark-priority/supervisor.log" 2>&1 &
```

The wrapper creates a transient user-systemd service for the benchmark and writes status to `~/.local/state/librechat-benchmark-priority/<unit>.env`. The supervisor itself must remain running; if it is intentionally stopped, stop the transient benchmark service too.

The helper resolves the benchmark working directory's block device with `findmnt`. If the filesystem source is not a `/dev/*` device, set `LIBRECHAT_BENCHMARK_IO_DEVICE` explicitly; the benchmark fails closed rather than running without a hard IO bandwidth cap.

To bring an already-running user-systemd benchmark under the policy, use `--adopt-unit`. The helper first pauses the entire unit, applies the runtime CPU/memory/IO controls, waits for healthy LibreChat and MongoDB, and only then resumes it. If the supervisor exits, an adopted benchmark is left paused rather than allowed to continue unmanaged.

```bash
./local-services/run-benchmark-production-priority.sh \
  --adopt-unit oai-alpha-full-cd.service \
  --working-directory /home/timeng/oai_alpha_testing_vm
```

Health-only and policy checks:

```bash
./local-services/run-benchmark-production-priority.sh --check-health
./local-services/run-benchmark-production-priority.sh --print-policy
./local-services/test-benchmark-production-priority.sh
```

Overrides use the `LIBRECHAT_BENCHMARK_*` environment variables documented by `--print-policy`. Raising limits is a production-capacity decision; the defaults intentionally favor LibreChat and MongoDB.
