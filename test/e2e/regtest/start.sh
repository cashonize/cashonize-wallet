#!/usr/bin/env bash
# Starts a fresh regtest chain for the regtest e2e tests on local BCHN and Fulcrum binaries: 300
# blocks mined to the funder, RPC and Fulcrum (ws) on the ports of env.sh. Every bind is on
# 127.0.0.1 and the node never dials a peer.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/e2e/regtest/env.sh
source "$here/env.sh"

for binary in "$BITCOIND_PATH" "$FULCRUM_PATH"; do
  if [[ ! -x "$binary" ]]; then
    echo "Not an executable: $binary (set BITCOIND_PATH / FULCRUM_PATH)" >&2
    exit 1
  fi
done

for port in $RPC_PORT $P2P_PORT $ZMQ_PORT $FULCRUM_TCP_PORT $FULCRUM_WS_PORT; do
  if ss -ltnH "sport = :$port" | grep -q .; then
    echo "Port $port is in use: the e2e regtest is running already. Stop it first." >&2
    exit 1
  fi
done

# a fresh chain per start; old runs stay until removed by hand
run="$REGTEST_DIR/run-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$run/node" "$run/fulcrum"
ln -sfn "$run" "$REGTEST_DIR/current"

cat >"$run/node/bitcoin.conf" <<CONF
regtest=1
server=1
txindex=1
disablewallet=1
printtoconsole=0

[regtest]
bind=127.0.0.1:$P2P_PORT
rpcbind=127.0.0.1:$RPC_PORT
rpcport=$RPC_PORT
rpcallowip=127.0.0.1
rpcuser=$RPC_USER
rpcpassword=$RPC_PASS
zmqpubhashblock=tcp://127.0.0.1:$ZMQ_PORT
zmqpubhashtx=tcp://127.0.0.1:$ZMQ_PORT
connect=0
dnsseed=0
discover=0
listenonion=0
maxtipage=2000000000
CONF

cat >"$run/fulcrum/fulcrum.conf" <<CONF
datadir = $run/fulcrum/db
bitcoind = 127.0.0.1:$RPC_PORT
rpcuser = $RPC_USER
rpcpassword = $RPC_PASS
tcp = 127.0.0.1:$FULCRUM_TCP_PORT
ws = 127.0.0.1:$FULCRUM_WS_PORT
peering = false
announce = false
polltime = 0.5
max_clients_per_ip = 100
CONF

"$BITCOIND_PATH" -datadir="$run/node" -daemon >"$run/node/bitcoind.out" 2>&1

for ((i = 0; i < 60; i++)); do
  if rpc getblockchaininfo >/dev/null 2>&1; then break; fi
  sleep 0.5
done
rpc getblockchaininfo >/dev/null

# 200 spendable coinbases for the funder, the other 100 still maturing
rpc generatetoaddress "[300, \"$FUNDER_ADDRESS\"]" >/dev/null

setsid "$FULCRUM_PATH" "$run/fulcrum/fulcrum.conf" >"$run/fulcrum/fulcrum.log" 2>&1 </dev/null &
echo $! >"$run/fulcrum/fulcrum.pid"

# Fulcrum opens its ports only once it has caught up with the node
for ((i = 0; i < 120; i++)); do
  if ss -ltnH "sport = :$FULCRUM_WS_PORT" | grep -q .; then
    echo "E2E regtest up: rpc 127.0.0.1:$RPC_PORT, electrum ws 127.0.0.1:$FULCRUM_WS_PORT ($run)"
    exit 0
  fi
  if ! kill -0 "$(cat "$run/fulcrum/fulcrum.pid")" 2>/dev/null; then
    echo "Fulcrum exited; see $run/fulcrum/fulcrum.log" >&2
    exit 1
  fi
  sleep 0.5
done
echo "Fulcrum did not open port $FULCRUM_WS_PORT in 60 s; see $run/fulcrum/fulcrum.log" >&2
exit 1
