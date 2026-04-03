"""
Oracle Attestation Reference Implementation
============================================

This file is the **reference implementation** — it exists so AWS reviewers can
inspect the attestation logic in full without installing anything.

For production use, install the published package instead of copying this file:

    pip install headless-oracle-strands

Then import from the package:

    from headless_oracle_strands.attestation import (
        attestation_ref_from_receipt,
        is_market_open,
        validate_ttl,
        should_refetch,
        compute_composite_hash,
        ReplayDetector,
    )

PyPI: https://pypi.org/project/headless-oracle-strands/


Provides composable helpers for integrating external state attestation
into x402 payment flows. Implements the attestation_ref schema for
pre-execution verification of market state.

The oracle interface is provider-agnostic. Any oracle service that returns
Ed25519-signed receipts with the fields below can be used. Headless Oracle
(headlessoracle.com) is the reference implementation.

attestation_ref schema:
{
  "provider":      "<oracle_domain>",
  "receipt_id":    "<UUID>",
  "issued_at":     "<ISO8601>",
  "expires_at":    "<ISO8601>",
  "mic":           "<ISO10383 exchange MIC>",
  "status":        "OPEN|CLOSED|HALTED|UNKNOWN",
  "source":        "REALTIME|SCHEDULE|OVERRIDE|SYSTEM",
  "signature":     "<lowercase hex Ed25519, 128 chars>",
  "public_key_id": "<key identifier>",
  "issuer":        "<oracle_domain>",
  "replay_protection": {
    "correlation_id":   "<x402_transaction_id>",
    "composite_hash":   "<sha256(signature + correlation_id)>"
  }
}
"""

import hashlib
import re
from datetime import datetime, timezone, timedelta
from typing import Optional
from dataclasses import dataclass, asdict


# --- Constants ---

# Oracle receipts expire 60 seconds after issued_at.
DEFAULT_TTL_SECONDS = 60

# Agent should proactively re-fetch if within this window of expiry.
PREFETCH_BUFFER_SECONDS = 5

# Grace window for geographic propagation delay at Lambda@Edge.
EXECUTION_GRACE_MS = 500

# Valid market statuses. UNKNOWN is treated as CLOSED (fail-closed).
VALID_STATUSES = {"OPEN", "CLOSED", "HALTED", "UNKNOWN"}

# Valid source types for audit trail.
VALID_SOURCES = {"REALTIME", "SCHEDULE", "OVERRIDE", "SYSTEM"}

# Ed25519 signature: 64 bytes = 128 hex characters, lowercase.
ED25519_SIG_PATTERN = re.compile(r"^[0-9a-f]{128}$")


# --- Data Classes ---

@dataclass
class ReplayProtection:
    """Binds an oracle receipt to a specific x402 transaction."""
    correlation_id: str
    composite_hash: str


@dataclass
class AttestationRef:
    """
    Oracle attestation reference for x402 payment flows.

    Embeds a cryptographic proof of market state into the payment event,
    creating a verifiable chain: oracle attests state → agent includes
    attestation with payment → entire decision chain is auditable.
    """
    provider: str
    receipt_id: str
    issued_at: str
    expires_at: str
    mic: str
    status: str
    source: str
    signature: str
    public_key_id: str
    issuer: str
    replay_protection: ReplayProtection

    def to_dict(self) -> dict:
        """Serialize to dictionary for JSON embedding in payment events."""
        return asdict(self)


@dataclass
class OracleSkipped:
    """
    Represents an explicitly skipped oracle check.

    Used when a human operator overrides the oracle requirement.
    The field is REQUIRED in payment_receipt — omission is indistinguishable
    from a logging failure.
    """
    attestation_ref: None
    oracle_skipped: bool
    oracle_skipped_reason: str

    def to_dict(self) -> dict:
        return {
            "attestation_ref": None,
            "oracle_skipped": self.oracle_skipped,
            "oracle_skipped_reason": self.oracle_skipped_reason,
        }


# --- Helper 1: Construct attestation_ref from oracle receipt ---

def attestation_ref_from_receipt(
    oracle_response: dict,
    x402_transaction_id: str,
    provider: str = "headlessoracle.com",
) -> AttestationRef:
    """
    Construct an attestation_ref from an oracle receipt response.

    Args:
        oracle_response: Raw JSON response from the oracle API.
            Must contain: receipt_id, issued_at, expires_at, mic, status,
            source, signature, public_key_id, issuer.
        x402_transaction_id: The correlation ID for this x402 transaction.
            Binds the oracle receipt to this specific payment flow.
        provider: Oracle provider domain. Defaults to headlessoracle.com.
            Override for alternative oracle providers.

    Returns:
        AttestationRef ready for embedding in payment_required events.

    Raises:
        ValueError: If required fields are missing or invalid.
    """
    required_fields = [
        "receipt_id", "issued_at", "expires_at", "mic", "status",
        "source", "signature", "public_key_id", "issuer",
    ]
    missing = [f for f in required_fields if f not in oracle_response]
    if missing:
        raise ValueError(f"Oracle response missing required fields: {missing}")

    status = oracle_response["status"]
    if status not in VALID_STATUSES:
        raise ValueError(
            f"Invalid status '{status}'. Must be one of: {VALID_STATUSES}"
        )

    source = oracle_response["source"]
    if source not in VALID_SOURCES:
        raise ValueError(
            f"Invalid source '{source}'. Must be one of: {VALID_SOURCES}"
        )

    signature = oracle_response["signature"]
    if not ED25519_SIG_PATTERN.match(signature):
        raise ValueError(
            "Invalid signature format. Expected 128 lowercase hex characters."
        )

    composite = compute_composite_hash(signature, x402_transaction_id)

    return AttestationRef(
        provider=provider,
        receipt_id=oracle_response["receipt_id"],
        issued_at=oracle_response["issued_at"],
        expires_at=oracle_response["expires_at"],
        mic=oracle_response["mic"],
        status=status,
        source=source,
        signature=signature,
        public_key_id=oracle_response["public_key_id"],
        issuer=oracle_response["issuer"],
        replay_protection=ReplayProtection(
            correlation_id=x402_transaction_id,
            composite_hash=composite,
        ),
    )


def oracle_skipped_ref(reason: str = "operator_override") -> OracleSkipped:
    """
    Create an attestation_ref placeholder for when oracle was explicitly skipped.

    Use this when a human operator overrides the oracle requirement.
    NEVER omit attestation_ref from payment_receipt — use this instead.

    Args:
        reason: Why oracle was skipped. e.g. "operator_override",
            "emergency_maintenance", "oracle_unreachable_operator_approved".

    Returns:
        OracleSkipped object for embedding in payment_receipt.
    """
    return OracleSkipped(
        attestation_ref=None,
        oracle_skipped=True,
        oracle_skipped_reason=reason,
    )


# --- Helper 2: TTL Validation ---

def validate_ttl(
    attestation_ref: AttestationRef,
    now: Optional[datetime] = None,
    grace_ms: int = EXECUTION_GRACE_MS,
) -> bool:
    """
    Validate that an oracle attestation has not expired.

    Enforcement point: the FACILITATOR checks this at EXECUTION time,
    not at approval time. Market state can change between approval and execution.

    Args:
        attestation_ref: The attestation to validate.
        now: Current time (UTC). Defaults to datetime.now(timezone.utc).
        grace_ms: Grace window in milliseconds for network propagation.
            Default 500ms is reasonable for Lambda@Edge geographic delay.

    Returns:
        True if attestation is still valid (not expired).
    """
    if now is None:
        now = datetime.now(timezone.utc)

    expires_at = datetime.fromisoformat(
        attestation_ref.expires_at.replace("Z", "+00:00")
    )
    grace = timedelta(milliseconds=grace_ms)

    return now < (expires_at + grace)


def should_refetch(
    attestation_ref: AttestationRef,
    now: Optional[datetime] = None,
    buffer_seconds: int = PREFETCH_BUFFER_SECONDS,
) -> bool:
    """
    Check if the agent should proactively re-fetch an oracle receipt.

    Rule: re-fetch if T_current > T_expiry - buffer_seconds BEFORE
    initiating the x402 sequence. This prevents starting a payment
    flow with a receipt that will expire mid-transaction.

    Args:
        attestation_ref: The current attestation.
        now: Current time (UTC). Defaults to datetime.now(timezone.utc).
        buffer_seconds: Seconds before expiry to trigger re-fetch.
            Default 5s provides margin for the x402 round-trip.

    Returns:
        True if the agent should re-fetch before proceeding.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    expires_at = datetime.fromisoformat(
        attestation_ref.expires_at.replace("Z", "+00:00")
    )
    buffer = timedelta(seconds=buffer_seconds)

    return now > (expires_at - buffer)


# --- Helper 3: Composite Hash ---

def compute_composite_hash(signature: str, correlation_id: str) -> str:
    """
    Compute the replay protection composite hash.

    Formula: sha256(signature + correlation_id)

    Binds the oracle receipt to a specific x402 transaction, preventing
    a valid receipt from being injected into a different payment flow.

    Args:
        signature: The Ed25519 signature from the oracle receipt (hex string).
        correlation_id: The x402 transaction ID.

    Returns:
        Hex-encoded SHA-256 hash.
    """
    payload = (signature + correlation_id).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# --- Helper 4: Replay Detection ---

class ReplayDetector:
    """
    Detects replay attacks by tracking attestation_ref usage.

    The facilitator indexes payment_required events by receipt_id.
    On payment_receipt, it verifies the attestation_ref matches the
    stored record exactly. The composite_hash provides a second layer
    by binding the receipt to a specific transaction attempt.

    For production use, replace the in-memory store with DynamoDB,
    Redis, or equivalent. TTL-based eviction is recommended since
    oracle receipts expire after 60 seconds — entries older than
    2x TTL (120s) can be safely purged.
    """

    def __init__(self):
        self._store: dict = {}

    def register(self, attestation_ref: AttestationRef) -> None:
        """
        Register an attestation_ref at payment_required time.

        Args:
            attestation_ref: The attestation to register.

        Raises:
            ValueError: If this receipt_id is already registered
                (potential replay attempt).
        """
        receipt_id = attestation_ref.receipt_id
        if receipt_id in self._store:
            raise ValueError(
                f"Replay detected: receipt_id '{receipt_id}' already registered. "
                f"Each oracle receipt may only be used once per payment flow."
            )
        self._store[receipt_id] = attestation_ref.to_dict()

    def verify(self, attestation_ref: AttestationRef) -> bool:
        """
        Verify an attestation_ref at payment_receipt time.

        Checks:
        1. receipt_id was previously registered at payment_required.
        2. attestation_ref fields match the registered record exactly.
        3. composite_hash is consistent (signature + correlation_id).

        Args:
            attestation_ref: The attestation from payment_receipt.

        Returns:
            True if verification passes.

        Raises:
            ValueError: If receipt_id not found or fields don't match.
        """
        receipt_id = attestation_ref.receipt_id

        if receipt_id not in self._store:
            raise ValueError(
                f"Unknown receipt_id '{receipt_id}'. "
                f"No matching payment_required event found."
            )

        stored = self._store[receipt_id]
        current = attestation_ref.to_dict()

        if stored != current:
            raise ValueError(
                f"Attestation mismatch for receipt_id '{receipt_id}'. "
                f"The attestation_ref in payment_receipt differs from "
                f"the one registered at payment_required."
            )

        expected_hash = compute_composite_hash(
            attestation_ref.signature,
            attestation_ref.replay_protection.correlation_id,
        )
        if attestation_ref.replay_protection.composite_hash != expected_hash:
            raise ValueError(
                f"Composite hash mismatch for receipt_id '{receipt_id}'. "
                f"Expected {expected_hash}, got "
                f"{attestation_ref.replay_protection.composite_hash}."
            )

        return True

    def purge_expired(self, max_age_seconds: int = DEFAULT_TTL_SECONDS * 2) -> int:
        """
        Remove entries older than max_age_seconds.

        Oracle receipts expire after 60s. Entries older than 2x TTL
        are safe to purge. Call periodically to prevent memory growth.

        Returns:
            Number of entries purged.
        """
        now = datetime.now(timezone.utc)
        to_remove = []

        for receipt_id, ref_dict in self._store.items():
            expires_at = datetime.fromisoformat(
                ref_dict["expires_at"].replace("Z", "+00:00")
            )
            age = (now - expires_at).total_seconds()
            if age > max_age_seconds:
                to_remove.append(receipt_id)

        for rid in to_remove:
            del self._store[rid]

        return len(to_remove)


# --- Fail-Closed Gate ---

def is_market_open(attestation_ref: AttestationRef) -> bool:
    """
    Fail-closed market state check.

    ONLY returns True if status is explicitly "OPEN".
    UNKNOWN is treated as CLOSED — this is intentional.
    An agent that cannot confirm the market is open MUST NOT proceed.

    Args:
        attestation_ref: The oracle attestation to check.

    Returns:
        True ONLY if status == "OPEN".
    """
    return attestation_ref.status == "OPEN"


# --- Authorized_by helpers ---

def authorized_by_auto(threshold_usdc: float) -> str:
    """
    Generate authorized_by value for autonomous execution below threshold.

    Example: authorized_by_auto(0.01) -> "auto:0.01"

    The auto: prefix makes the threshold machine-readable. A log aggregator
    or Cedar policy can parse and alert by threshold without joining tables.

    Args:
        threshold_usdc: The USDC threshold below which execution is autonomous.

    Returns:
        Formatted authorized_by string.
    """
    return f"auto:{threshold_usdc}"


def authorized_by_operator() -> str:
    """authorized_by value for human-approved out-of-band execution."""
    return "operator"


def authorized_by_agent(agent_id: str) -> str:
    """
    authorized_by value for delegated agent approval in A2A flows.

    Example: authorized_by_agent("agent-7f3a") -> "agent:agent-7f3a"

    Args:
        agent_id: The delegating agent's identifier.

    Returns:
        Formatted authorized_by string.
    """
    return f"agent:{agent_id}"
