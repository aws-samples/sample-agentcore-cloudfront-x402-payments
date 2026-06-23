## Oracle Attestation Reference Implementation

Adds composable helpers for integrating external state attestation into x402
payment flows, addressing the pre-execution verification gap discussed in #11.

### What this adds

- `attestation_ref_from_receipt()` — constructs an `attestation_ref` from any
  oracle response conforming to the Ed25519-signed receipt schema
- `validate_ttl()` / `should_refetch()` — TTL enforcement with configurable
  grace window (default 500ms) and proactive re-fetch logic
- `compute_composite_hash()` — SHA-256 binding of oracle signature to x402
  transaction ID for replay protection
- `ReplayDetector` — indexes `payment_required` events by `receipt_id` and
  verifies consistency at `payment_receipt` time
- `is_market_open()` — fail-closed gate (UNKNOWN = CLOSED)
- `authorized_by_*` helpers — typed values replacing null in authorization fields
- `oracle_skipped_ref()` — explicit representation when oracle is bypassed by
  human override

### Design decisions

- **Provider-agnostic**: The `provider` field and constructor accept any oracle
  domain. Headless Oracle is the reference implementation, not a hard dependency.
- **Fail-closed**: `UNKNOWN` status is treated as `CLOSED`. An agent that cannot
  confirm market state halts — it does not proceed on stale data.
- **TTL enforcement at execution**: The facilitator checks `expires_at > now` at
  the execution point, not at approval. Market state can change between approval
  and execution.
- **60-second receipt TTL**: Intentional. 5 minutes is an eternity in trading.

### Tests

Full test suite covering construction, validation, replay detection, fail-closed
semantics, and edge cases. Run with `pytest tests/test_oracle_attestation.py -v`.

## Strands Integration

For agents built on the Strands SDK (as used in this reference architecture):

```bash
pip install headless-oracle-strands
```

```python
from headless_oracle_strands import get_market_status, get_market_schedule, list_exchanges

# Use as Strands @tool decorated functions — drop-in for the agent's tool list
```

Full package: https://pypi.org/project/headless-oracle-strands/

Builder and Pro plan holders can also subscribe to real-time status change webhooks via `POST /v5/webhooks/subscribe`, receiving signed receipts on market state transitions without polling — useful for agents that need to act immediately on open/close events rather than gating each request.

Closes #11
