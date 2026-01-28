"""
Simple API server for the web UI to invoke the AgentCore Runtime.

This provides a simple HTTP endpoint that the web UI can call.
The server handles AWS authentication and calls invoke_agent_runtime.

Usage:
    # Start the server
    python -m agent.api_server
    
    # Or with uvicorn
    uvicorn agent.api_server:app --host 0.0.0.0 --port 8080
"""

import json
import os
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import config
from .runtime_client import RuntimeClient, create_runtime_client

app = FastAPI(
    title="x402 Payer Agent API",
    description="API for invoking the x402 payer agent via AgentCore Runtime",
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

# Global runtime client (initialized on first request)
_runtime_client: Optional[RuntimeClient] = None


def get_runtime_client() -> RuntimeClient:
    """Get or create the runtime client."""
    global _runtime_client
    if _runtime_client is None:
        agent_runtime_arn = config.agent_runtime_arn
        if not agent_runtime_arn:
            raise HTTPException(
                status_code=500,
                detail="AGENT_RUNTIME_ARN environment variable not set",
            )
        _runtime_client = create_runtime_client(
            agent_runtime_arn=agent_runtime_arn,
            region=config.aws_region,
        )
    return _runtime_client


class InvokeRequest(BaseModel):
    """Request body for agent invocation."""
    prompt: str
    session_id: Optional[str] = None


class InvokeResponse(BaseModel):
    """Response from agent invocation."""
    success: bool
    completion: str
    session_id: str
    error: Optional[str] = None


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/invoke", response_model=InvokeResponse)
async def invoke_agent(request: InvokeRequest):
    """
    Invoke the agent with the given prompt.
    
    This endpoint calls invoke_agent_runtime on the AgentCore Runtime.
    """
    client = get_runtime_client()
    session_id = request.session_id or str(uuid.uuid4())
    
    response = client.invoke(
        prompt=request.prompt,
        session_id=session_id,
    )
    
    if not response.success:
        raise HTTPException(
            status_code=500,
            detail=response.error or "Agent invocation failed",
        )
    
    return InvokeResponse(
        success=True,
        completion=response.completion,
        session_id=response.session_id,
    )


@app.post("/invoke-streaming")
async def invoke_agent_streaming(request: InvokeRequest):
    """
    Invoke the agent and stream the response.
    
    Returns a Server-Sent Events stream.
    """
    client = get_runtime_client()
    session_id = request.session_id or str(uuid.uuid4())
    
    async def generate():
        try:
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
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/info")
async def get_info():
    """Get information about the configured agent."""
    return {
        "agent_runtime_arn": config.agent_runtime_arn or "Not configured",
        "region": config.aws_region,
        "seller_api_url": config.seller_api_url or "Not configured",
    }


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("API_PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
