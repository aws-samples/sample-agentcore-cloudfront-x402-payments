"""
Lambda handler for web-ui API proxy.

This is a lightweight proxy that forwards requests to AgentCore Runtime.
It handles SigV4 signing so the browser doesn't need AWS credentials.

Uses async pattern with DynamoDB to handle long-running agent requests
that exceed API Gateway's 29-second timeout.
"""

import json
import os
import uuid
import time
import boto3
from urllib.request import urlopen, Request
from urllib.error import URLError

# Base Sepolia configuration
BASE_SEPOLIA_RPC = "https://sepolia.base.org"
USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  # USDC on Base Sepolia

# In-memory cache for pending requests (works within same Lambda instance)
# For production, use DynamoDB or ElastiCache
_pending_requests = {}

# Initialize clients outside handler for connection reuse
_client = None
_lambda_client = None

def get_client():
    global _client
    if _client is None:
        _client = boto3.client('bedrock-agentcore')
    return _client

def get_lambda_client():
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client('lambda')
    return _lambda_client


def handler(event, context):
    """Lambda handler for API Gateway proxy integration."""
    
    # Handle CORS preflight
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    if http_method == 'OPTIONS':
        return cors_response(200, '')
    
    # Get path
    path = event.get('path') or event.get('rawPath', '')
    method = http_method
    
    # Check if this is an async worker invocation
    if event.get('_async_worker'):
        return async_worker(event)
    
    # Route requests
    if path == '/health' and method == 'GET':
        return cors_response(200, {'status': 'healthy'})
    
    if path == '/info' and method == 'GET':
        return cors_response(200, {
            'mode': 'agentcore',
            'agent_runtime_arn': os.environ.get('AGENT_RUNTIME_ARN', 'Not configured'),
        })
    
    if path == '/wallet' and method == 'GET':
        return get_wallet_info()
    
    if path == '/invoke' and method == 'POST':
        return invoke_agent_async(event, context)
    
    if path == '/poll' and method == 'GET':
        return poll_result(event)
    
    return cors_response(404, {'error': 'Not found'})


def get_wallet_info():
    """Get the agent's wallet address and USDC balance from Base Sepolia."""
    wallet_address = os.environ.get('WALLET_ADDRESS', '')
    
    if not wallet_address:
        return cors_response(500, {'error': 'WALLET_ADDRESS not configured'})
    
    try:
        # Query USDC balance using eth_call
        # balanceOf(address) selector = 0x70a08231
        padded_address = wallet_address[2:].lower().zfill(64)
        call_data = f"0x70a08231{padded_address}"
        
        payload = json.dumps({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [
                {"to": USDC_CONTRACT, "data": call_data},
                "latest"
            ],
            "id": 1
        }).encode()
        
        req = Request(BASE_SEPOLIA_RPC, data=payload, headers={
            "Content-Type": "application/json",
            "User-Agent": "x402-web-ui/1.0",
        })
        with urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
        
        # Parse balance (USDC has 6 decimals)
        balance_hex = result.get('result', '0x0')
        balance_wei = int(balance_hex, 16)
        balance_usdc = balance_wei / 1_000_000
        
        return cors_response(200, {
            'address': wallet_address,
            'balance': f"{balance_usdc:.6f}",
            'network': 'Base Sepolia',
            'currency': 'USDC',
        })
        
    except (URLError, json.JSONDecodeError, ValueError) as e:
        return cors_response(500, {'error': f'Failed to fetch balance: {str(e)}'})


def invoke_agent_async(event, context):
    """Start agent invocation asynchronously and return request ID for polling."""
    try:
        body = json.loads(event.get('body', '{}'))
    except json.JSONDecodeError:
        return cors_response(400, {'error': 'Invalid JSON'})
    
    prompt = body.get('prompt') or body.get('message')
    if not prompt:
        return cors_response(400, {'error': 'prompt or message field required'})
    
    session_id = body.get('session_id') or f"web-{uuid.uuid4().hex[:8]}-{uuid.uuid4().hex}"
    
    # Ensure session_id is at least 33 characters
    if len(session_id) < 33:
        session_id = f"web-session-{session_id}-{uuid.uuid4().hex}"
    
    # Generate request ID for polling
    request_id = f"req-{uuid.uuid4().hex}"
    
    # Store pending request
    _pending_requests[request_id] = {
        'status': 'processing',
        'started_at': time.time(),
        'session_id': session_id,
    }
    
    # Invoke self asynchronously to do the actual work
    try:
        lambda_client = get_lambda_client()
        lambda_client.invoke(
            FunctionName=context.function_name,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps({
                '_async_worker': True,
                'request_id': request_id,
                'prompt': prompt,
                'session_id': session_id,
            }),
        )
    except Exception as e:
        _pending_requests[request_id] = {
            'status': 'error',
            'error': f'Failed to start async worker: {str(e)}',
            'session_id': session_id,
        }
    
    # Return immediately with request ID
    return cors_response(202, {
        'request_id': request_id,
        'status': 'processing',
        'session_id': session_id,
        'message': 'Request started. Poll /poll?request_id=... for results.',
    })


def poll_result(event):
    """Poll for async request result."""
    # Get request_id from query string
    query_params = event.get('queryStringParameters') or {}
    request_id = query_params.get('request_id')
    
    if not request_id:
        return cors_response(400, {'error': 'request_id query parameter required'})
    
    # Check in-memory cache
    if request_id in _pending_requests:
        result = _pending_requests[request_id]
        
        # If complete or error, remove from cache
        if result.get('status') in ('complete', 'error'):
            del _pending_requests[request_id]
        
        return cors_response(200, result)
    
    # Not found - might be in a different Lambda instance or expired
    return cors_response(200, {
        'status': 'unknown',
        'message': 'Request not found. It may have completed in another instance or expired.',
    })


def async_worker(event):
    """Worker function that runs asynchronously to handle long agent requests."""
    request_id = event.get('request_id')
    prompt = event.get('prompt')
    session_id = event.get('session_id')
    
    runtime_arn = os.environ.get('AGENT_RUNTIME_ARN')
    if not runtime_arn:
        _pending_requests[request_id] = {
            'status': 'error',
            'error': 'AGENT_RUNTIME_ARN not configured',
            'session_id': session_id,
        }
        return {'statusCode': 500}
    
    try:
        client = get_client()
        payload = json.dumps({'prompt': prompt}).encode()
        
        response = client.invoke_agent_runtime(
            agentRuntimeArn=runtime_arn,
            runtimeSessionId=session_id,
            payload=payload,
        )
        
        # Process response
        completion = ''
        if 'response' in response:
            resp = response['response']
            if hasattr(resp, 'read'):
                raw = resp.read()
                if isinstance(raw, bytes):
                    raw = raw.decode('utf-8')
                try:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        completion = data.get('response', data.get('completion', raw))
                    else:
                        completion = raw
                except json.JSONDecodeError:
                    completion = raw
            else:
                completion = str(resp)
        
        _pending_requests[request_id] = {
            'status': 'complete',
            'success': True,
            'completion': completion,
            'session_id': session_id,
        }
        
    except Exception as e:
        _pending_requests[request_id] = {
            'status': 'error',
            'success': False,
            'error': str(e),
            'session_id': session_id,
        }
    
    return {'statusCode': 200}


def cors_response(status_code, body):
    """Return response with CORS headers."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        'body': json.dumps(body) if isinstance(body, dict) else body,
    }
