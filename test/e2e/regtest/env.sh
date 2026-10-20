# Shared by start.sh and stop.sh: binaries, the data directory, ports and the node's RPC.
# The ports differ from bch-wallet-lib's local regtest, so both can run at once.
BITCOIND_PATH="${BITCOIND_PATH:-$HOME/BCH-infra/bchn/bin/bitcoind}"
FULCRUM_PATH="${FULCRUM_PATH:-$HOME/BCH-infra/fulcrum/Fulcrum}"
REGTEST_DIR="${REGTEST_DIR:-$HOME/BCH-infra/regtest-cashonize-e2e}"

RPC_PORT=18543
P2P_PORT=18544
ZMQ_PORT=28432
FULCRUM_TCP_PORT=60101
FULCRUM_WS_PORT=60103
RPC_USER=e2e
RPC_PASS=e2e

# The funder's address, which the coinbases are mined to: the key of test/e2e/regtest/chain.ts
FUNDER_ADDRESS=bchreg:qpttdv3qg2usm4nm7talhxhl05mlhms3ys43u76rn0

rpc() {
  local method="$1" params="${2:-[]}"
  curl -sf --user "$RPC_USER:$RPC_PASS" -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"1.0\",\"id\":\"e2e\",\"method\":\"$method\",\"params\":$params}" \
    "http://127.0.0.1:$RPC_PORT/"
}
