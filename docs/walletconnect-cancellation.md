# BCH WalletConnect: `bch_cancelPendingRequests` Method

## Overview

`bch_cancelPendingRequests` is a custom WalletConnect RPC method that allows a dapp to request cancellation of pending signing requests. This enables better UX when users cancel an operation in the dapp UI. The wallet can dismiss its signing dialog rather than leaving it open and allowing the user to sign a transaction that is no longer required or valid.

<img width="1284" height="618" alt="Screenshot 2026-02-16 at 12 35 57" src="https://github.com/user-attachments/assets/f1730123-79b4-45b3-b2de-f30d68def8da" />

## Method Specification

### Request

```json
{
  "method": "bch_cancelPendingRequests",
  "params": {}
}
```

### Response

```json
{
  "result": {
    "cancelledCount": 1
  }
}
```

The `cancelledCount` indicates how many pending requests were cancelled. This may be 0 if no requests were pending when the cancellation was processed.

## Session Capability Advertisement

Wallets MUST advertise support for this method in the session namespaces:

```typescript
const namespaces = {
  bch: {
    methods: [
      "bch_getAddresses",
      "bch_signTransaction",
      "bch_signMessage",
      "bch_cancelPendingRequests", // Add this
    ],
    // ... other namespace properties
  },
}
```

Dapps SHOULD check for this method in `session.namespaces.bch.methods` before sending cancellation requests to maintain backwards compatibility with wallets that don't support it.

## The WalletConnect Queue Problem

### Background

WalletConnect v2 implements an internal request queue. When a dapp sends a request (e.g., `bch_signTransaction`), subsequent requests are queued and not delivered to the wallet until the previous request receives a response.

This is by design to prevent unresponded requests, but it creates a problem for cancellation:

1. Dapp sends `bch_signTransaction` (request #1)
2. Wallet receives request #1, shows signing dialog
3. User clicks "Cancel" in dapp UI
4. Dapp sends `bch_cancelPendingRequests` (request #2)
5. Request #2 is QUEUED - not delivered to wallet yet
6. Wallet dialog remains open, user has to dismiss it manually
7. Only after user approves/rejects #1 does wallet receive #2

### Solution: Wallet-Side Queue Polling

Since cancellation requests get queued behind the very requests they're trying to cancel, wallets MUST implement polling to detect queued cancellation requests.

The WalletConnect SDK provides `getPendingSessionRequests()` which returns **all** queued requests, bypassing the normal event-driven delivery. Wallets can poll this method to find and process cancellation requests immediately.

## Implementation Guide

### Dapp Implementation

```typescript
// When user cancels an operation
function cancelWalletAction() {
  // Check if wallet supports cancellation
  const supportsCancellation = session.namespaces.bch?.methods?.includes(
    "bch_cancelPendingRequests",
  )

  if (signClient && session && supportsCancellation) {
    // Fire-and-forget - don't await, just send
    signClient
      .request({
        topic: session.topic,
        chainId: connectedChain,
        request: {
          method: "bch_cancelPendingRequests",
          params: {},
        },
      })
      .catch((e) => console.log("Failed to cancel:", e))
  }

  // Continue with local cancellation logic
  // (reject promises, close modals, etc.)
}
```

### Wallet Implementation

WalletConnect doesn't provide a way to listen for the arrival of messages into the queue. Therefore, wallets MUST implement polling to detect queued cancellation requests. This can be conditional on the queue being non-empty. An interval of 100-500ms is recommended for responsiveness.

#### 1. Poll for cancellation requests in the queue

```typescript
async function checkForCancellationRequests() {
  // getPendingSessionRequests() returns ALL queued requests
  const queuedRequests = walletKit.getPendingSessionRequests()

  for (const request of queuedRequests) {
    if (request.params.request.method === "bch_cancelPendingRequests") {
      await processCancellation(request)
    }
  }
}
```

#### 2. Process Cancellation

```typescript
async function cancelPendingRequestsForTopic(cancellationRequest) {
  const { topic: cancellationRequestTopic, id: cancellationRequestId } = cancellationRequest;

  let cancelledCount: number = 0;

  // Get ALL queued requests from WalletConnect
  const queuedRequests = web3wallet.getPendingSessionRequests();

  for (const request of queuedRequests) {
    // Only process requests for this session
    if (request.topic !== cancellationRequestTopic) continue;

    // Respond to the cancellation request itself and don't cancel any subsequent requests
    if (request.id === cancellationRequestId) {
      await web3wallet.respondSessionRequest({
        topic: cancellationRequestTopic,
        response: {
          id: cancellationRequestId,
          jsonrpc: '2.0',
          result: {
            cancelledCount: 1
          }
        }
      });

      continue;
    }

    // close the pending approvaldialog if it matches this request
    if (dialog?.id === request.id) {
      dialog.close();
    }

    // Reject the request (responds with USER_REJECTED)
    await rejectRequest(request);
    cancelledCount++;
  }
}
```

#### 3. Handle Direct Delivery (Edge Case)

If there are no pending requests when cancellation arrives, it will be delivered normally through the `session_request` event. Handle this case in your request handler. It should result in a response with `cancelledCount: 0`.

```typescript
case "bch_cancelPendingRequests":
  // Usually handled by polling, but if nothing is pending,
  // this arrives normally through the session_request event
  await cancelPendingRequestsForTopic(event);
  break;
```

## Future Improvements

### 1. Should this be proposed as a standard WalletConnect method such as `wc_cancelPendingRequests`?

It's possible this feature has been omitted from WalletConnect for a reason. We are proposing this as a
experimental feature scoped to BCH so that we can get feedback before proposing it to the WalletConnect.

### 2. Response code for cancelled requests

It may be desirable to return a different response code to distinguish cancelled requests (e.g. `REQUEST_CANCELLED`) from rejected requests (`USER_REJECTED`).

### 3. Should the requests be cancellable by ID?

It may be desirable to allow requests to be cancelled by ID, rather than only as a batch:

```json
{
  "method": "bch_cancelPendingRequests",
  "params": {
    "requestIds": ["1771322090000", "1771322091000"]
  }
}
```

## Security Considerations

- Cancellation requests are scoped by session topic - one dapp cannot cancel another dapp's requests
- Wallets SHOULD only cancel requests from the same session that sent the cancellation
- The cancellation request ID should be excluded from cancellation (don't cancel yourself)

## Error Handling

| Scenario                      | Dapp Behavior                          | Wallet Behavior                  |
| ----------------------------- | -------------------------------------- | -------------------------------- |
| Wallet doesn't support method | Catch error, proceed with local cancel | N/A                              |
| No pending requests           | N/A                                    | Respond with `cancelledCount: 0` |
| Request already approved      | N/A                                    | Skip                             |
| Session disconnected          | Request fails                          | N/A                              |

## Compatibility

This method is an extension to the BCH WalletConnect protocol. Implementations should:

- **Dapps**: Check `session.namespaces.bch.methods` before sending
- **Wallets**: Advertise in session namespaces and implement polling

## Examples

The Cashonize implementation of this method can be found [here](https://github.com/Cashonize/cashonize-wallet/blob/main/src/stores/walletconnectStore.ts).

A minimal test dapp with support for cancellation can be found [here](https://github.com/Cashonize/cashonize-wallet/tree/main/test/e2e/test-dapp).

## References

- [WalletConnect v2 Specs](https://specs.walletconnect.com/)
- [WalletKit SDK - getPendingSessionRequests](https://docs.reown.com/walletkit/web/usage)
- [GitHub Issue: Request Queue Behavior](https://github.com/WalletConnect/WalletConnectKotlinV2/issues/1268)

