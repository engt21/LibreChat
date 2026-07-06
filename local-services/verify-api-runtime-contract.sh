#!/usr/bin/env bash
set -euo pipefail

container="LibreChat"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      container="${2:?Missing container after --container}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--container NAME]"
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      exit 2
      ;;
  esac
done

docker inspect "$container" >/dev/null 2>&1 || {
  echo "ERROR: container does not exist: $container" >&2
  exit 1
}

runtime_json="$(docker inspect -f '{{json .Config.Entrypoint}}|{{json .Config.Cmd}}|{{.HostConfig.RestartPolicy.Name}}|{{.State.Running}}|{{.State.OOMKilled}}' "$container")"
IFS='|' read -r entrypoint_json command_json restart_policy running oom_killed <<<"$runtime_json"

if [[ "$running" != "true" ]]; then
  echo "ERROR: $container is not running" >&2
  exit 1
fi

if [[ "$oom_killed" == "true" ]]; then
  echo "ERROR: $container is marked OOMKilled" >&2
  exit 1
fi

if [[ "$entrypoint_json" != *docker-entrypoint.sh* ]]; then
  echo "ERROR: $container entrypoint is not canonical: $entrypoint_json" >&2
  exit 1
fi

if [[ "$command_json" == *"sleep"* || "$command_json" == *"infinity"* ]]; then
  echo "ERROR: $container command contains a builder/repair sentinel: $command_json" >&2
  exit 1
fi

if [[ "$command_json" != *'"npm"'* || "$command_json" != *'"run"'* || "$command_json" != *'"backend"'* ]]; then
  echo "ERROR: $container command is not the canonical LibreChat backend command: $command_json" >&2
  exit 1
fi

case "$restart_policy" in
  always|unless-stopped) ;;
  *)
    echo "ERROR: $container restart policy is '$restart_policy'; require always or unless-stopped" >&2
    exit 1
    ;;
esac

pid_one="$(docker exec "$container" sh -lc "tr '\\0' ' ' </proc/1/cmdline")"
if [[ "$pid_one" == *"sleep infinity"* || "$pid_one" == *"tail -f /dev/null"* ]]; then
  echo "ERROR: $container PID 1 is a builder/repair sentinel: $pid_one" >&2
  exit 1
fi

if [[ "$pid_one" != *"npm"* && "$pid_one" != *"node"* ]]; then
  echo "ERROR: $container PID 1 is not a Node/npm backend process: $pid_one" >&2
  exit 1
fi

echo "API runtime contract: PASS (container=$container restart=$restart_policy)"
