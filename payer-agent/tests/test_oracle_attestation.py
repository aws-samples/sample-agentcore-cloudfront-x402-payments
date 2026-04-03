"""Tests for oracle attestation helpers."""

import hashlib
from datetime import datetime, timezone, timedelta

import pytest

from headless_oracle_strands.attestation import (
    attestation_ref_from_receipt,
    oracle_skipped_ref,
    validate_ttl,
    should_refetch,
    compute_composite_hash,
    ReplayDetector,
    is_market_open,
    authorized_by_auto,
    authorized_by_operator,
    authorized_by_agent,
)


# --- Fixtures ---

VALID_SIGNATURE = "a" * 128  # 128 lowercase hex chars
TX_ID = "tx-x402-abc123"


def make_oracle_response(**overrides):
    """Create a valid oracle response with optional field overrides."""
    base = {
        "receipt_id": "6b4a2c8f-1234-5678-9abc-def012345678",
        "issued_at": "2026-03-28T14:30:00.000Z",
        "expires_at": "2026-03-28T14:31:00.000Z",
        "mic": "XNYS",
        "status": "OPEN",
        "source": "REALTIME",
        "signature": VALID_SIGNATURE,
        "public_key_id": "key_2026_v1",
        "issuer": "headlessoracle.com",
    }
    base.update(overrides)
    return base


# --- Tests: attestation_ref_from_receipt ---

class TestAttestationRefFromReceipt:
    """Tests for constructing attestation_ref from an oracle receipt."""

    def test_valid_receipt_construction(self):
        """Happy path: all fields present and valid."""
        response = make_oracle_response()
        ref = attestation_ref_from_receipt(response, TX_ID)

        assert ref.provider == "headlessoracle.com"
        assert ref.receipt_id == response["receipt_id"]
        assert ref.mic == "XNYS"
        assert ref.status == "OPEN"
        assert ref.source == "REALTIME"
        assert ref.replay_protection.correlation_id == TX_ID

    def test_custom_provider(self):
        """Provider field overrides the default."""
        response = make_oracle_response()
        ref = attestation_ref_from_receipt(response, TX_ID, provider="other-oracle.io")
        assert ref.provider == "other-oracle.io"

    def test_missing_field_raises(self):
        """Missing required field raises ValueError with field name."""
        response = make_oracle_response()
        del response["signature"]
        with pytest.raises(ValueError, match="missing required fields"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_missing_multiple_fields_raises(self):
        """Multiple missing fields all listed in error."""
        response = make_oracle_response()
        del response["signature"]
        del response["receipt_id"]
        with pytest.raises(ValueError, match="missing required fields"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_invalid_status_raises(self):
        """Unknown status values are rejected."""
        response = make_oracle_response(status="MAYBE")
        with pytest.raises(ValueError, match="Invalid status"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_invalid_source_raises(self):
        """Unknown source values are rejected."""
        response = make_oracle_response(source="GUESS")
        with pytest.raises(ValueError, match="Invalid source"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_invalid_signature_format_raises(self):
        """Non-hex signature is rejected."""
        response = make_oracle_response(signature="INVALID")
        with pytest.raises(ValueError, match="Invalid signature format"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_uppercase_signature_rejected(self):
        """Uppercase hex is rejected — signature must be lowercase."""
        response = make_oracle_response(signature="A" * 128)
        with pytest.raises(ValueError, match="Invalid signature format"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_short_signature_rejected(self):
        """Signature shorter than 128 chars is rejected."""
        response = make_oracle_response(signature="a" * 64)
        with pytest.raises(ValueError, match="Invalid signature format"):
            attestation_ref_from_receipt(response, TX_ID)

    def test_composite_hash_embedded(self):
        """replay_protection.composite_hash is set correctly."""
        response = make_oracle_response()
        ref = attestation_ref_from_receipt(response, TX_ID)
        expected = compute_composite_hash(VALID_SIGNATURE, TX_ID)
        assert ref.replay_protection.composite_hash == expected

    def test_to_dict_round_trips(self):
        """to_dict() includes all fields."""
        response = make_oracle_response()
        ref = attestation_ref_from_receipt(response, TX_ID)
        d = ref.to_dict()
        assert d["mic"] == "XNYS"
        assert d["status"] == "OPEN"
        assert "replay_protection" in d
        assert d["replay_protection"]["correlation_id"] == TX_ID

    def test_all_valid_statuses_accepted(self):
        """Each valid status value is accepted without error."""
        for status in ("OPEN", "CLOSED", "HALTED", "UNKNOWN"):
            response = make_oracle_response(status=status)
            ref = attestation_ref_from_receipt(response, TX_ID)
            assert ref.status == status

    def test_all_valid_sources_accepted(self):
        """Each valid source value is accepted without error."""
        for source in ("REALTIME", "SCHEDULE", "OVERRIDE", "SYSTEM"):
            response = make_oracle_response(source=source)
            ref = attestation_ref_from_receipt(response, TX_ID)
            assert ref.source == source


# --- Tests: oracle_skipped_ref ---

class TestOracleSkippedRef:
    """Tests for explicitly skipped oracle checks."""

    def test_default_reason(self):
        """Default reason is operator_override."""
        ref = oracle_skipped_ref()
        d = ref.to_dict()
        assert d["attestation_ref"] is None
        assert d["oracle_skipped"] is True
        assert d["oracle_skipped_reason"] == "operator_override"

    def test_custom_reason(self):
        """Custom skip reason is preserved."""
        ref = oracle_skipped_ref("emergency_maintenance")
        assert ref.oracle_skipped_reason == "emergency_maintenance"

    def test_oracle_skipped_is_true(self):
        """oracle_skipped field is always True."""
        ref = oracle_skipped_ref()
        assert ref.oracle_skipped is True


# --- Tests: TTL validation ---

class TestValidateTtl:
    """Tests for TTL enforcement at execution time."""

    def test_valid_ttl(self):
        """Receipt is valid 30 seconds before expiry."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        now = datetime(2026, 3, 28, 14, 30, 30, tzinfo=timezone.utc)
        assert validate_ttl(ref, now=now) is True

    def test_expired_ttl(self):
        """Receipt is invalid 1 second after expiry + grace."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        now = datetime(2026, 3, 28, 14, 31, 1, tzinfo=timezone.utc)
        assert validate_ttl(ref, now=now) is False

    def test_within_grace_window(self):
        """Receipt within 500ms grace window is still valid."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        # 200ms after expires_at — within default 500ms grace
        now = datetime(2026, 3, 28, 14, 31, 0, 200000, tzinfo=timezone.utc)
        assert validate_ttl(ref, now=now) is True

    def test_exactly_at_expiry(self):
        """Receipt is valid at exactly expires_at (before grace ends)."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        now = datetime(2026, 3, 28, 14, 31, 0, tzinfo=timezone.utc)
        assert validate_ttl(ref, now=now) is True

    def test_custom_grace_ms(self):
        """Custom grace window is respected."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        # 100ms after expiry — outside 0ms grace, inside 500ms grace
        now = datetime(2026, 3, 28, 14, 31, 0, 100000, tzinfo=timezone.utc)
        assert validate_ttl(ref, now=now, grace_ms=0) is False
        assert validate_ttl(ref, now=now, grace_ms=500) is True


# --- Tests: should_refetch ---

class TestShouldRefetch:
    """Tests for proactive re-fetch logic."""

    def test_should_refetch_near_expiry(self):
        """Should refetch when 3 seconds from expiry (within 5s buffer)."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        now = datetime(2026, 3, 28, 14, 30, 57, tzinfo=timezone.utc)
        assert should_refetch(ref, now=now) is True

    def test_should_not_refetch_fresh(self):
        """Should not refetch when receipt is fresh (10s after issued)."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        now = datetime(2026, 3, 28, 14, 30, 10, tzinfo=timezone.utc)
        assert should_refetch(ref, now=now) is False

    def test_custom_buffer_seconds(self):
        """Custom buffer is respected."""
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        # 8 seconds before expiry
        now = datetime(2026, 3, 28, 14, 30, 52, tzinfo=timezone.utc)
        # Within 10s buffer → True; within 5s buffer → False
        assert should_refetch(ref, now=now, buffer_seconds=10) is True
        assert should_refetch(ref, now=now, buffer_seconds=5) is False


# --- Tests: composite hash ---

class TestComputeCompositeHash:
    """Tests for replay protection hash computation."""

    def test_deterministic(self):
        """Same inputs always produce same hash."""
        h1 = compute_composite_hash(VALID_SIGNATURE, TX_ID)
        h2 = compute_composite_hash(VALID_SIGNATURE, TX_ID)
        assert h1 == h2

    def test_changes_with_tx_id(self):
        """Different transaction IDs produce different hashes."""
        h1 = compute_composite_hash(VALID_SIGNATURE, "tx-1")
        h2 = compute_composite_hash(VALID_SIGNATURE, "tx-2")
        assert h1 != h2

    def test_changes_with_signature(self):
        """Different signatures produce different hashes."""
        h1 = compute_composite_hash("a" * 128, TX_ID)
        h2 = compute_composite_hash("b" * 128, TX_ID)
        assert h1 != h2

    def test_is_sha256(self):
        """Hash matches sha256(signature + correlation_id)."""
        payload = (VALID_SIGNATURE + TX_ID).encode("utf-8")
        expected = hashlib.sha256(payload).hexdigest()
        assert compute_composite_hash(VALID_SIGNATURE, TX_ID) == expected


# --- Tests: replay detection ---

class TestReplayDetector:
    """Tests for replay attack detection."""

    def test_register_and_verify(self):
        """Happy path: register then verify succeeds."""
        detector = ReplayDetector()
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        detector.register(ref)
        assert detector.verify(ref) is True

    def test_duplicate_registration_raises(self):
        """Registering the same receipt_id twice raises ValueError."""
        detector = ReplayDetector()
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        detector.register(ref)
        with pytest.raises(ValueError, match="Replay detected"):
            detector.register(ref)

    def test_unknown_receipt_raises(self):
        """Verifying without prior registration raises ValueError."""
        detector = ReplayDetector()
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        with pytest.raises(ValueError, match="Unknown receipt_id"):
            detector.verify(ref)

    def test_tampered_attestation_raises(self):
        """Verifying a modified attestation raises ValueError."""
        detector = ReplayDetector()
        ref = attestation_ref_from_receipt(make_oracle_response(), TX_ID)
        detector.register(ref)

        # Build a different ref with same receipt_id but different status
        tampered_response = make_oracle_response(status="CLOSED")
        tampered_response["receipt_id"] = ref.receipt_id  # same ID
        tampered_ref = attestation_ref_from_receipt(tampered_response, TX_ID)

        with pytest.raises(ValueError, match="mismatch"):
            detector.verify(tampered_ref)

    def test_purge_expired_removes_old_entries(self):
        """Entries past max_age_seconds are removed by purge."""
        detector = ReplayDetector()
        # Receipt that expired long ago
        response = make_oracle_response(
            expires_at="2020-01-01T00:01:00.000Z",
        )
        ref = attestation_ref_from_receipt(response, TX_ID)
        detector.register(ref)
        assert len(detector._store) == 1

        purged = detector.purge_expired(max_age_seconds=60)
        assert purged == 1
        assert len(detector._store) == 0

    def test_purge_keeps_recent_entries(self):
        """Entries within max_age_seconds are retained."""
        detector = ReplayDetector()
        # Future receipt — not expired
        response = make_oracle_response(
            expires_at="2099-01-01T00:01:00.000Z",
        )
        ref = attestation_ref_from_receipt(response, TX_ID)
        detector.register(ref)

        purged = detector.purge_expired(max_age_seconds=60)
        assert purged == 0
        assert len(detector._store) == 1


# --- Tests: fail-closed gate ---

class TestIsMarketOpen:
    """Tests for the fail-closed market state check."""

    def test_open_status_returns_true(self):
        """Only OPEN status returns True."""
        ref = attestation_ref_from_receipt(make_oracle_response(status="OPEN"), TX_ID)
        assert is_market_open(ref) is True

    def test_closed_status_returns_false(self):
        """CLOSED returns False."""
        ref = attestation_ref_from_receipt(make_oracle_response(status="CLOSED"), TX_ID)
        assert is_market_open(ref) is False

    def test_unknown_is_treated_as_closed(self):
        """UNKNOWN is fail-closed — returns False."""
        ref = attestation_ref_from_receipt(make_oracle_response(status="UNKNOWN"), TX_ID)
        assert is_market_open(ref) is False

    def test_halted_is_treated_as_closed(self):
        """HALTED is fail-closed — returns False."""
        ref = attestation_ref_from_receipt(make_oracle_response(status="HALTED"), TX_ID)
        assert is_market_open(ref) is False


# --- Tests: authorized_by helpers ---

class TestAuthorizedBy:
    """Tests for authorization field helpers."""

    def test_auto_threshold(self):
        """auto: prefix with threshold value."""
        assert authorized_by_auto(0.01) == "auto:0.01"

    def test_auto_zero_threshold(self):
        """Zero threshold is a valid autonomous configuration."""
        assert authorized_by_auto(0.0) == "auto:0.0"

    def test_operator(self):
        """Operator value is a plain string."""
        assert authorized_by_operator() == "operator"

    def test_agent_id(self):
        """agent: prefix with agent ID."""
        assert authorized_by_agent("agent-7f3a") == "agent:agent-7f3a"

    def test_agent_different_ids(self):
        """Different agent IDs produce different values."""
        assert authorized_by_agent("a1") != authorized_by_agent("a2")
