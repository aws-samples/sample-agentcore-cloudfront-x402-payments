#!/usr/bin/env python3
"""
Gateway API Access Test Script for x402 Payer Agent.

This script tests the AgentCore Gateway API access including:
1. AWS credential verification
2. SigV4 authentication
3. Gateway client connectivity
4. Rate limiting functionality
5. Error handling

Usage:
    # Run all tests
    python scripts/test_gateway_api.py
    
    # Run with specific agent ID (for live testing)
    python scripts/test_gateway_api.py --agent-id <AGENT_ID>
    
    # Run with verbose output
    python scripts/test_gateway_api.py --verbose
    
    # Run only credential tests (no agent required)
    python scripts/test_gateway_api.py --credentials-only
"""

import argparse
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@dataclass
class TestResult:
    """Result of a single test."""
    name: str
    passed: bool
    message: str = ""
    duration_ms: float = 0.0
    details: dict = field(default_factory=dict)


@dataclass
class TestSuite:
    """Collection of test results."""
    name: str
    results: list[TestResult] = field(default_factory=list)
    
    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)
    
    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)
    
    @property
    def total(self) -> int:
        return len(self.results)
    
    @property
    def all_passed(self) -> bool:
        return self.failed == 0


def print_header(title: str) -> None:
    """Print a formatted header."""
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def print_result(result: TestResult, verbose: bool = False) -> None:
    """Print a test result."""
    status = "✅ PASS" if result.passed else "❌ FAIL"
    print(f"  {status} | {result.name}")
    if result.message:
        print(f"         {result.message}")
    if verbose and result.details:
        for key, value in result.details.items():
            print(f"         {key}: {value}")


def test_boto3_import() -> TestResult:
    """Test that boto3 can be imported."""
    start = time.time()
    try:
        import boto3
        return TestResult(
            name="boto3 import",
            passed=True,
            message=f"boto3 version: {boto3.__version__}",
            duration_ms=(time.time() - start) * 1000,
        )
    except ImportError as e:
        return TestResult(
            name="boto3 import",
            passed=False,
            message=f"Failed to import boto3: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_auth_module_import() -> TestResult:
    """Test that auth module can be imported."""
    start = time.time()
    try:
        from agent.auth import SigV4Auth, get_aws_credentials, AWSCredentials
        return TestResult(
            name="Auth module import",
            passed=True,
            message="All auth components imported successfully",
            duration_ms=(time.time() - start) * 1000,
        )
    except ImportError as e:
        return TestResult(
            name="Auth module import",
            passed=False,
            message=f"Failed to import auth module: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_gateway_client_import() -> TestResult:
    """Test that gateway client can be imported."""
    start = time.time()
    try:
        from agent.gateway_client import GatewayClient, create_gateway_client
        return TestResult(
            name="Gateway client import",
            passed=True,
            message="Gateway client imported successfully",
            duration_ms=(time.time() - start) * 1000,
        )
    except ImportError as e:
        return TestResult(
            name="Gateway client import",
            passed=False,
            message=f"Failed to import gateway client: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_aws_credentials() -> TestResult:
    """Test that AWS credentials are available."""
    start = time.time()
    try:
        from agent.auth import get_aws_credentials
        creds = get_aws_credentials()
        
        # Mask the access key for display
        masked_key = creds.access_key[:4] + "..." + creds.access_key[-4:]
        has_token = "Yes" if creds.session_token else "No"
        
        return TestResult(
            name="AWS credentials available",
            passed=True,
            message=f"Access key: {masked_key}, Session token: {has_token}",
            duration_ms=(time.time() - start) * 1000,
            details={
                "access_key_prefix": creds.access_key[:4],
                "has_session_token": bool(creds.session_token),
            },
        )
    except Exception as e:
        return TestResult(
            name="AWS credentials available",
            passed=False,
            message=f"Failed to get credentials: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_sts_caller_identity() -> TestResult:
    """Test AWS STS GetCallerIdentity."""
    start = time.time()
    try:
        import boto3
        sts = boto3.client("sts")
        identity = sts.get_caller_identity()
        
        return TestResult(
            name="STS GetCallerIdentity",
            passed=True,
            message=f"Account: {identity['Account']}",
            duration_ms=(time.time() - start) * 1000,
            details={
                "account": identity["Account"],
                "arn": identity["Arn"],
                "user_id": identity["UserId"],
            },
        )
    except Exception as e:
        return TestResult(
            name="STS GetCallerIdentity",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_sigv4_signing() -> TestResult:
    """Test SigV4 request signing."""
    start = time.time()
    try:
        from agent.auth import SigV4Auth, get_aws_credentials
        
        creds = get_aws_credentials()
        auth = SigV4Auth(
            region="us-west-2",
            service="bedrock-agent-runtime",
            credentials=creds,
        )
        
        # Sign a test request
        headers = auth.sign_request(
            method="POST",
            url="https://bedrock-agent-runtime.us-west-2.amazonaws.com/agents/test/invoke",
            body='{"inputText": "test"}',
        )
        
        # Verify required headers are present
        required_headers = ["authorization", "host", "x-amz-date", "x-amz-content-sha256"]
        missing = [h for h in required_headers if h not in headers]
        
        if missing:
            return TestResult(
                name="SigV4 request signing",
                passed=False,
                message=f"Missing headers: {missing}",
                duration_ms=(time.time() - start) * 1000,
            )
        
        # Verify authorization header format
        auth_header = headers["authorization"]
        if not auth_header.startswith("AWS4-HMAC-SHA256"):
            return TestResult(
                name="SigV4 request signing",
                passed=False,
                message="Invalid authorization header format",
                duration_ms=(time.time() - start) * 1000,
            )
        
        return TestResult(
            name="SigV4 request signing",
            passed=True,
            message="Request signed successfully with all required headers",
            duration_ms=(time.time() - start) * 1000,
            details={
                "headers_count": len(headers),
                "auth_algorithm": "AWS4-HMAC-SHA256",
            },
        )
    except Exception as e:
        return TestResult(
            name="SigV4 request signing",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_gateway_client_creation() -> TestResult:
    """Test Gateway client creation."""
    start = time.time()
    try:
        from agent.gateway_client import GatewayClient
        
        client = GatewayClient(
            agent_id="test-agent-id",
            agent_alias_id="TSTALIASID",
            region="us-west-2",
            rate_limit_enabled=True,
        )
        
        # Verify client configuration
        if client.config.agent_id != "test-agent-id":
            return TestResult(
                name="Gateway client creation",
                passed=False,
                message="Agent ID not set correctly",
                duration_ms=(time.time() - start) * 1000,
            )
        
        return TestResult(
            name="Gateway client creation",
            passed=True,
            message="Client created with correct configuration",
            duration_ms=(time.time() - start) * 1000,
            details={
                "agent_id": client.config.agent_id,
                "region": client.config.region,
                "rate_limit_enabled": client.config.rate_limit_enabled,
            },
        )
    except Exception as e:
        return TestResult(
            name="Gateway client creation",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_rate_limiter() -> TestResult:
    """Test rate limiter functionality."""
    start = time.time()
    try:
        from agent.rate_limiter import RateLimiter, RateLimitConfig
        
        config = RateLimitConfig(
            requests_per_second=10.0,
            burst_capacity=5,
            block_on_limit=True,
        )
        limiter = RateLimiter(config)
        
        # Test acquiring tokens
        for i in range(5):
            limiter.acquire()
        
        stats = limiter.stats
        
        return TestResult(
            name="Rate limiter functionality",
            passed=True,
            message=f"Processed {stats.total_requests} requests",
            duration_ms=(time.time() - start) * 1000,
            details={
                "total_requests": stats.total_requests,
                "allowed_requests": stats.allowed_requests,
                "throttled_requests": stats.throttled_requests,
            },
        )
    except Exception as e:
        return TestResult(
            name="Rate limiter functionality",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_bedrock_client_creation() -> TestResult:
    """Test Bedrock Agent Runtime client creation."""
    start = time.time()
    try:
        import boto3
        from botocore.config import Config
        
        config = Config(
            region_name="us-west-2",
            retries={"max_attempts": 3, "mode": "adaptive"},
        )
        
        client = boto3.client("bedrock-agent-runtime", config=config)
        
        # Verify client was created (check for expected methods)
        if not hasattr(client, "invoke_agent"):
            return TestResult(
                name="Bedrock client creation",
                passed=False,
                message="Client missing invoke_agent method",
                duration_ms=(time.time() - start) * 1000,
            )
        
        return TestResult(
            name="Bedrock client creation",
            passed=True,
            message="Bedrock Agent Runtime client created successfully",
            duration_ms=(time.time() - start) * 1000,
        )
    except Exception as e:
        return TestResult(
            name="Bedrock client creation",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_gateway_verify_credentials() -> TestResult:
    """Test Gateway client credential verification."""
    start = time.time()
    try:
        from agent.gateway_client import GatewayClient
        
        client = GatewayClient(
            agent_id="test-agent-id",
            region="us-west-2",
        )
        
        is_valid = client.verify_credentials()
        
        if not is_valid:
            return TestResult(
                name="Gateway credential verification",
                passed=False,
                message="Credentials verification failed",
                duration_ms=(time.time() - start) * 1000,
            )
        
        identity = client.get_caller_identity()
        
        return TestResult(
            name="Gateway credential verification",
            passed=True,
            message=f"Verified for account: {identity.get('Account', 'unknown')}",
            duration_ms=(time.time() - start) * 1000,
            details=identity or {},
        )
    except Exception as e:
        return TestResult(
            name="Gateway credential verification",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def test_agent_invocation(agent_id: str, region: str = "us-west-2") -> TestResult:
    """Test actual agent invocation (requires deployed agent)."""
    start = time.time()
    try:
        from agent.gateway_client import GatewayClient
        
        client = GatewayClient(
            agent_id=agent_id,
            agent_alias_id="TSTALIASID",
            region=region,
        )
        
        response = client.invoke(
            input_text="Hello, this is a test message.",
            enable_trace=False,
        )
        
        if not response.success:
            return TestResult(
                name="Agent invocation",
                passed=False,
                message=f"Invocation failed: {response.error}",
                duration_ms=(time.time() - start) * 1000,
                details={
                    "error_type": response.error_type,
                    "session_id": response.session_id,
                },
            )
        
        return TestResult(
            name="Agent invocation",
            passed=True,
            message=f"Response received ({len(response.completion)} chars)",
            duration_ms=(time.time() - start) * 1000,
            details={
                "session_id": response.session_id,
                "response_length": len(response.completion),
            },
        )
    except Exception as e:
        return TestResult(
            name="Agent invocation",
            passed=False,
            message=f"Failed: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


def run_credential_tests(verbose: bool = False) -> TestSuite:
    """Run credential-related tests."""
    suite = TestSuite(name="Credential Tests")
    
    print_header("Credential Tests")
    
    tests = [
        test_boto3_import,
        test_auth_module_import,
        test_aws_credentials,
        test_sts_caller_identity,
        test_sigv4_signing,
    ]
    
    for test_fn in tests:
        result = test_fn()
        suite.results.append(result)
        print_result(result, verbose)
    
    return suite


def run_client_tests(verbose: bool = False) -> TestSuite:
    """Run Gateway client tests."""
    suite = TestSuite(name="Gateway Client Tests")
    
    print_header("Gateway Client Tests")
    
    tests = [
        test_gateway_client_import,
        test_gateway_client_creation,
        test_rate_limiter,
        test_bedrock_client_creation,
        test_gateway_verify_credentials,
    ]
    
    for test_fn in tests:
        result = test_fn()
        suite.results.append(result)
        print_result(result, verbose)
    
    return suite


def run_integration_tests(
    agent_id: str,
    region: str = "us-west-2",
    verbose: bool = False,
) -> TestSuite:
    """Run integration tests (requires deployed agent)."""
    suite = TestSuite(name="Integration Tests")
    
    print_header("Integration Tests")
    
    result = test_agent_invocation(agent_id, region)
    suite.results.append(result)
    print_result(result, verbose)
    
    return suite


def print_summary(suites: list[TestSuite]) -> None:
    """Print test summary."""
    print_header("Test Summary")
    
    total_passed = sum(s.passed for s in suites)
    total_failed = sum(s.failed for s in suites)
    total_tests = sum(s.total for s in suites)
    
    for suite in suites:
        status = "✅" if suite.all_passed else "❌"
        print(f"  {status} {suite.name}: {suite.passed}/{suite.total} passed")
    
    print(f"\n  Total: {total_passed}/{total_tests} passed, {total_failed} failed")
    
    if total_failed == 0:
        print("\n  🎉 All tests passed!")
    else:
        print(f"\n  ⚠️  {total_failed} test(s) failed")


def main():
    parser = argparse.ArgumentParser(
        description="Test AgentCore Gateway API access"
    )
    parser.add_argument(
        "--agent-id",
        help="Agent ID for integration tests (optional)",
    )
    parser.add_argument(
        "--region",
        default="us-west-2",
        help="AWS region (default: us-west-2)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed test output",
    )
    parser.add_argument(
        "--credentials-only",
        action="store_true",
        help="Run only credential tests",
    )
    
    args = parser.parse_args()
    
    print("\n🔐 x402 Payer Agent - Gateway API Access Tests")
    print("=" * 60)
    
    suites = []
    
    # Always run credential tests
    suites.append(run_credential_tests(args.verbose))
    
    # Run client tests unless credentials-only
    if not args.credentials_only:
        suites.append(run_client_tests(args.verbose))
    
    # Run integration tests if agent ID provided
    if args.agent_id:
        suites.append(run_integration_tests(
            agent_id=args.agent_id,
            region=args.region,
            verbose=args.verbose,
        ))
    
    # Print summary
    print_summary(suites)
    
    # Exit with appropriate code
    total_failed = sum(s.failed for s in suites)
    sys.exit(0 if total_failed == 0 else 1)


if __name__ == "__main__":
    main()
