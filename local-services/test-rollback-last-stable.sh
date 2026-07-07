#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

snapshot="$fixture/snapshot"
pointer="$fixture/last-stable.env"
maintenance="$fixture/maintenance"
mutation_log="$fixture/mutations.log"
mkdir -p "$snapshot"
touch \
  "$snapshot/host-files.txt" \
  "$snapshot/container-files.txt" \
  "$snapshot/container-dirs.txt"

cat > "$pointer" <<EOF
type=runtime
snapshot=$snapshot
container=LibreChat
root=/opt/LibreChat-custom
created_epoch=$(date +%s)
EOF

mkdir -p "$fixture/bin"
for command in docker curl npm; do
  cat > "$fixture/bin/$command" <<'EOF'
#!/usr/bin/env bash
printf '%s %s\n' "$(basename "$0")" "$*" >> "$MUTATION_LOG"
exit 99
EOF
  chmod +x "$fixture/bin/$command"
done

run_helper() {
  PATH="$fixture/bin:$PATH" \
    MUTATION_LOG="$mutation_log" \
    LIBRECHAT_LAST_STABLE_POINTER="$pointer" \
    LIBRECHAT_HEALTH_MAINTENANCE_FILE="$maintenance" \
    "$ROOT_DIR/local-services/librechat-rollback-last-stable.sh" "$@"
}

bash -n "$ROOT_DIR/local-services/librechat-rollback-last-stable.sh"

set +e
no_arg_output="$(run_helper 2>&1)"
no_arg_status=$?
unknown_output="$(run_helper inspect 2>&1)"
unknown_status=$?
set -e

[[ "$no_arg_status" -eq 2 ]]
[[ "$unknown_status" -eq 2 ]]
grep -Fq 'Rollback is never executed implicitly' <<<"$no_arg_output"
grep -Fq 'Rollback is never executed implicitly' <<<"$unknown_output"

status_output="$(run_helper status)"
check_output="$(run_helper --check)"
grep -Fq 'rollback_pointer=valid type=runtime container=LibreChat' <<<"$status_output"
grep -Fq 'rollback_pointer=valid type=runtime container=LibreChat' <<<"$check_output"

[[ ! -e "$maintenance" ]]
[[ ! -s "$mutation_log" ]]

echo "rollback-last-stable explicit-execute safeguards: PASS"
