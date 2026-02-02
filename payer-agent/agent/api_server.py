"""
API server for the x402 payer agent.

Supports two modes:
1. Local mode (default): Runs the agent locally using Strands SDK + Bedrock
2. AgentCore mode: Invokes a deployed AgentCore Runtime

Usage:
    # Local mode (default)
    python -m agent.api_server
    
    # AgentCore mode (set AGENT_RUNTIME_ARN)
    AGENT_RUNTIME_ARN=arn:aws:... python -m agent.api_server
"""

import json
import os
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(
    title="x402 Payer Agent API",
    description="API for invoking the x402 payer agent",
    version="1.0.0",
)

# CORS configuration for web UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy-loaded components
_agent = None
_runtime_client = None
_imports_done = False


def _ensure_imports():
    """Lazy import to avoid nest_asyncio conflicts on Python 3.13."""
    global _imports_done
    if not _imports_done:
        global config, create_payer_agent, RuntimeClient, create_runtime_client
        from .config import config as _config
        from .main import create_payer_agent as _create_payer_agent
        from .runtime_client import RuntimeClient as _RuntimeClient
        from .runtime_client import create_runtime_client as _create_runtime_client
        config = _config
        create_payer_agent = _create_payer_agent
        RuntimeClient = _RuntimeClient
        create_runtime_client = _create_runtime_client
        _imports_done = True


def _use_local_mode() -> bool:
    """Check if we should use local mode (no AgentCore)."""
    _ensure_imports()
    return not config.agent_runtime_arn


def _get_local_agent():
    """Get or create the local Strands agent."""
    global _agent
    if _agent is None:
        _ensure_imports()
        _agent = create_payer_agent()
    return _agent


def _get_runtime_client():
    """Get or create the AgentCore runtime client."""
    global _runtime_client
    if _runtime_client is None:
        _ensure_imports()
        if not config.agent_runtime_arn:
            raise HTTPException(500, "AGENT_RUNTIME_ARN not set")
        _runtime_client = create_runtime_client(
            agent_runtime_arn=config.agent_runtime_arn,
            region=config.aws_region,
        )
    return _runtime_client


class InvokeRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = None


class InvokeResponse(BaseModel):
    success: bool
    completion: str
    session_id: str
    error: Optional[str] = None


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/invoke", response_model=InvokeResponse)
async def invoke_agent(request: InvokeRequest):
    """Invoke the agent with the given prompt."""
    session_id = request.session_id or str(uuid.uuid4())
    
    try:
        if _use_local_mode():
            # Local mode: use Strands agent directly
            agent = _get_local_agent()
            response = agent(request.prompt)
            return InvokeResponse(
                success=True,
                completion=str(response),
                session_id=session_id,
            )
        else:
            # AgentCore mode: invoke runtime
            client = _get_runtime_client()
            response = client.invoke(
                prompt=request.prompt,
                session_id=session_id,
            )
            if not response.success:
                raise HTTPException(500, response.error or "Agent invocation failed")
            return InvokeResponse(
                success=True,
                completion=response.completion,
                session_id=response.session_id,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/invoke-streaming")
async def invoke_agent_streaming(request: InvokeRequest):
    """Invoke the agent and stream the response (SSE)."""
    session_id = request.session_id or str(uuid.uuid4())
    
    async def generate():
        try:
            if _use_local_mode():
                # Local mode: run agent and return full response
                # (Strands doesn't support streaming yet)
                agent = _get_local_agent()
                response = str(agent(request.prompt))
                yield f"data: {json.dumps({'type': 'text', 'text': response})}\n\n"
            else:
                # AgentCore mode: stream from runtime
                client = _get_runtime_client()
                for chunk in client.invoke_streaming(
                    prompt=request.prompt,
                    session_id=session_id,
                ):
                    yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/info")
async def get_info():
    """Get agent configuration info."""
    _ensure_imports()
    return {
        "mode": "local" if _use_local_mode() else "agentcore",
        "agent_runtime_arn": config.agent_runtime_arn or "Not configured (local mode)",
        "region": config.aws_region,
        "seller_api_url": config.seller_api_url or "Not configured",
    }


if __name__ == "__main__":
    import asyncio
    import uvicorn
    
    port = int(os.getenv("API_PORT", "8080"))
    cfg = uvicorn.Config(app, host="0.0.0.0", port=port)
    server = uvicorn.Server(cfg)
    asyncio.run(server.serve())
