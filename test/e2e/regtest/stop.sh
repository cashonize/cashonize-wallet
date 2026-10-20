#!/usr/bin/env bash
# Stops the Fulcrum and bitcoind that start.sh started; the run's data directory stays.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/e2e/regtest/env.sh
source "$here/env.sh"

run="$REGTEST_DIR/current"
if [[ ! -d "$run" ]]; then
  echo "No e2e regtest run in $REGTEST_DIR"
  exit 0
fi

# signals a pid only while it is still the process we started: pids get reused
stop_process() {
  local pidfile="$1" name="$2"
  [[ -f "$pidfile" ]] || return 0
  local pid
  pid="$(cat "$pidfile")"
  if ! grep -qa "$name" "/proc/$pid/cmdline" 2>/dev/null; then return 0; fi
  kill -TERM "$pid"
  for ((i = 0; i < 60; i++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -KILL "$pid"
}

stop_process "$run/fulcrum/fulcrum.pid" Fulcrum
stop_process "$run/node/regtest/bitcoind.pid" bitcoind
echo "E2E regtest stopped ($(readlink -f "$run"))"
