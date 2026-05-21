"""
MaoMaoAI Omni Moderation Middleware (Python)
Strict CSAM Pre-Filtering Layer

This script runs as a lightweight API gateway middleware in front of MaoMaoAI.
It intercepts all chat completion requests, routes them to OpenAI's Omni Moderation
('omni-moderation-latest') endpoint to scan for CSAM (sexual/minors), and:
1. Rejects CSAM content instantly with a clean error response.
2. Permits standard consensual adult NSFW content and safe messages.
3. Forwards safe requests directly to your deployed MaoMaoAI Gateway.

Prerequisites:
    pip install fastapi uvicorn requests python-dotenv

Environment Variables Required:
    OPENAI_API_KEY: Standard OpenAI API Key for executing omni-moderation-latest checks.
    MAOMAO_API_URL: Target URL of your deployed MaoMaoAI gateway (e.g., https://yoursite.netlify.app/v1)
"""

import os
import sys
import json
import logging
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("MaoMaoModeration")

# Load environment variables
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MAOMAO_API_URL = os.getenv("MAOMAO_API_URL", "http://localhost:8888/v1")

if not OPENAI_API_KEY:
    logger.warning("WARNING: 'OPENAI_API_KEY' environment variable is not configured. Moderation pre-checks will be bypassed.")

app = FastAPI(title="MaoMaoAI Content Moderation Middleware", version="1.0.0")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "MaoMaoAI Content Moderation Middleware",
        "target_gateway": MAOMAO_API_URL,
        "moderation_engine": "omni-moderation-latest",
        "rules": "Strict CSAM rejection. Consensual adult NSFW content allowed."
    }

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """
    Intercept completions, check for CSAM safety violations, and proxy safe traffic.
    """
    try:
        body = await request.body()
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.")

    messages = payload.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="Messages array cannot be empty.")

    # 1. Evaluate safety using OpenAI's omni-moderation-latest model
    if OPENAI_API_KEY:
        try:
            # Combine messages into a clean format for multimodal/text inspection
            combined_text = "\n".join([f"{msg.get('role', 'user')}: {msg.get('content', '')}" for msg in messages])

            logger.info("Executing Omni Moderation pre-check...")
            mod_res = requests.post(
                "https://api.openai.com/v1/moderations",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}"
                },
                json={
                    "input": combined_text,
                    "model": "omni-moderation-latest"
                },
                timeout=8
            )

            if mod_res.ok:
                mod_data = mod_res.json()
                results = mod_data.get("results", [])
                
                if results:
                    result = results[0]
                    categories = result.get("categories", {})
                    category_scores = result.get("category_scores", {})
                    
                    is_csam_flagged = categories.get("sexual/minors", False)
                    csam_score = category_scores.get("sexual/minors", 0.0)

                    logger.info(f"Moderation report: sexual/minors flag={is_csam_flagged}, score={csam_score:.5f}")

                    # Strict enforcement on CSAM content (sexual/minors)
                    # We block if flagged true or if the score exceeds a strict safety threshold
                    if is_csam_flagged or csam_score > 0.05:
                        logger.warning(f"BLOCKING REQUEST: CSAM violation detected (score: {csam_score})")
                        
                        # Return 400 Bad Request with immediate security violation error details
                        return JSONResponse(
                            status_code=400,
                            content={
                                "error": {
                                    "message": "Content rejected: This request violates our safety policies regarding child safety.",
                                    "type": "safety_policy_violation",
                                    "code": "csam_blocked"
                                }
                            }
                        )
                    
                    # Consensual adult NSFW check:
                    # 'sexual' might be flagged true. If so, we log it but do NOT block it,
                    # in line with user requirements to permit consensual adult content.
                    if categories.get("sexual", False):
                        logger.info("Adult NSFW detected but allowed (consensual/adult material).")

            else:
                logger.error(f"Moderation endpoint returned status {mod_res.status_code}: {mod_res.text}")
                
        except Exception as e:
            logger.error(f"Failed to execute moderation check: {str(e)}")
            # In production, decide whether to fail-open or fail-closed.
            # We fail-open here to prevent service downtime due to moderation API outages.

    # 2. Proxy safe requests forward to MaoMaoAI Gateway
    # Build headers (forwarding authorization bearer and others)
    headers = {}
    auth_header = request.headers.get("Authorization")
    if auth_header:
        headers["Authorization"] = auth_header

    headers["Content-Type"] = "application/json"

    # Handle Netlify functions or standard endpoints
    target_endpoint = f"{MAOMAO_API_URL.rstrip('/')}/chat/completions"
    logger.info(f"Forwarding safe request to MaoMaoAI Gateway: {target_endpoint}")

    try:
        response = requests.post(
            target_endpoint,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        # Return response cleanly to client
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers)
        )

    except requests.exceptions.RequestException as e:
        logger.error(f"Proxy connection to MaoMaoAI failed: {str(e)}")
        return JSONResponse(
            status_code=502,
            content={
                "error": {
                    "message": "Moderation proxy was unable to reach the downstream MaoMaoAI gateway.",
                    "details": str(e),
                    "type": "gateway_error"
                }
            }
        )

# Catch-all endpoint for general proxying (e.g. /v1/models)
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def catch_all(request: Request, path: str):
    """
    General reverse proxy proxying for other routes like `/v1/models`
    """
    method = request.method
    body = await request.body()
    
    headers = {}
    auth_header = request.headers.get("Authorization")
    if auth_header:
        headers["Authorization"] = auth_header
    if request.headers.get("Content-Type"):
        headers["Content-Type"] = request.headers.get("Content-Type")

    target_endpoint = f"{MAOMAO_API_URL.rstrip('/')}/{path}"
    logger.info(f"Routing {method} proxy call directly to: {target_endpoint}")

    try:
        response = requests.request(
            method=method,
            url=target_endpoint,
            headers=headers,
            data=body if body else None,
            timeout=30
        )
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers)
        )
    except Exception as e:
        logger.error(f"General proxy call failed: {str(e)}")
        return JSONResponse(
            status_code=502,
            content={"error": {"message": "General proxy call failed.", "details": str(e)}}
        )

if __name__ == "__main__":
    import uvicorn
    # Default to port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
