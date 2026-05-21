import { query } from './db.js';

export async function handler(event, context) {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (!process.env.DATABASE_URL) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "DATABASE_URL environment variable is missing." })
      };
    }

    // 1. Authenticate user's API Key from Bearer Token
    const authHeader = event.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: { message: "Missing or invalid Authorization header. Must be Bearer token.", type: "invalid_request_error" } })
      };
    }

    const userKey = authHeader.replace('Bearer ', '').trim();
    if (!userKey.startsWith('mm_')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: { message: "Invalid API Key format. Key must start with 'mm_'.", type: "invalid_request_error" } })
      };
    }

    // Look up key in database
    const keyRes = await query(
      `SELECT id, key_value, name, is_active FROM api_keys WHERE key_value = $1`,
      [userKey]
    );

    if (keyRes.rows.length === 0) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: { message: "The provided API Key is invalid.", type: "invalid_request_error", code: "invalid_api_key" } })
      };
    }

    const apiKey = keyRes.rows[0];
    if (!apiKey.is_active) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: { message: "This API Key has been suspended or revoked.", type: "access_denied", code: "key_suspended" } })
      };
    }

    // 2. Rate Limiting Check (RPM 3, RPD 300)
    // RPM Check: Last 60 seconds
    const rpmRes = await query(
      `SELECT COUNT(*)::int as count FROM request_logs WHERE key_id = $1 AND timestamp >= NOW() - INTERVAL '1 minute'`,
      [apiKey.id]
    );
    if (rpmRes.rows[0].count >= 3) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: {
            message: "Rate limit exceeded: Requests Per Minute (RPM) limit is 3. Please slow down.",
            type: "rate_limit_error",
            code: "rpm_limit_exceeded"
          }
        })
      };
    }

    // RPD Check: Last 24 hours
    const rpdRes = await query(
      `SELECT COUNT(*)::int as count FROM request_logs WHERE key_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
      [apiKey.id]
    );
    if (rpdRes.rows[0].count >= 300) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: {
            message: "Rate limit exceeded: Requests Per Day (RPD) limit is 300.",
            type: "rate_limit_error",
            code: "rpd_limit_exceeded"
          }
        })
      };
    }

    // Fetch active provider from DB
    const providerRes = await query(`SELECT id, name, api_key, base_url, is_active FROM providers WHERE is_active = TRUE LIMIT 1`);
    const activeProvider = providerRes.rows[0];

    // Identify standard path (e.g. models, chat/completions)
    const path = event.path.replace(/^\/v1/, '').replace(/^\/\.netlify\/functions\/gateway/, '');
    
    // GET /models
    if (path === '/models' || path === 'models') {
      if (!activeProvider) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            data: [
              { id: "maomao-no-active-provider", object: "model", created: Date.now(), owned_by: "maomao" }
            ]
          })
        };
      }

      // Fetch models from active provider
      try {
        const fetchRes = await fetch(`${activeProvider.base_url}/models`, {
          headers: { 'Authorization': `Bearer ${activeProvider.api_key}` }
        });
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        // Fallback if provider doesn't support /models
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            data: [{ id: `${activeProvider.id}-default`, object: "model", created: Date.now(), owned_by: activeProvider.id }]
          })
        };
      } catch (err) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            data: [{ id: `${activeProvider.id}-default`, object: "model", created: Date.now(), owned_by: activeProvider.id }]
          })
        };
      }
    }

    // POST /chat/completions
    if (path === '/chat/completions' || path === 'chat/completions') {
      if (!activeProvider) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({ error: { message: "No active API provider has been configured by the administrator.", type: "service_unavailable" } })
        };
      }

      let payload = {};
      try {
        payload = JSON.parse(event.body);
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: { message: "Malformed JSON payload.", type: "invalid_request_error" } })
        };
      }

      // Check messages
      const messages = payload.messages || [];
      if (messages.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: { message: "Messages array cannot be empty.", type: "invalid_request_error" } })
        };
      }

      // 3. Pre-Moderation CSAM check using omni-moderation-latest
      // Build combined prompt text for safety review
      const promptText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
      
      // We will look for an OpenAI API key to execute the moderation call.
      // We can use process.env.OPENAI_API_KEY or the active provider key (if OpenAI or OpenRouter).
      const modApiKey = process.env.OPENAI_API_KEY || (activeProvider.id === 'openai' ? activeProvider.api_key : null);
      
      if (modApiKey) {
        try {
          const modRes = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${modApiKey}`
            },
            body: JSON.stringify({
              input: promptText,
              model: 'omni-moderation-latest'
            })
          });

          if (modRes.ok) {
            const modData = await modRes.json();
            const result = modData.results?.[0];
            
            if (result) {
              const isCsamFlagged = result.categories?.['sexual/minors'] === true;
              const csamScore = result.category_scores?.['sexual/minors'] || 0;
              
              // If CSAM (sexual/minors) is flagged, or score is extremely high (e.g. > 0.05)
              if (isCsamFlagged || csamScore > 0.05) {
                console.warn(`[SAFETY BLOCK] CSAM violation detected (score: ${csamScore})`);
                
                // Immediately reject with clean error (or empty response as user requested)
                return {
                  statusCode: 400,
                  headers,
                  body: JSON.stringify({
                    error: {
                      message: "Content rejected: This request violates our safety policies regarding child safety.",
                      type: "safety_policy_violation",
                      code: "csam_blocked"
                    }
                  })
                };
              }
            }
          }
        } catch (modErr) {
          console.error("Omni Moderation check failed:", modErr);
          // If the moderation check fails, we allow requests to continue but log the error
          // to prevent blocking legitimate requests due to moderation provider downtime.
        }
      }

      // 4. Load configured context size limit
      const contextRes = await query(`SELECT value FROM settings WHERE key = 'context_size'`);
      const contextSize = parseInt(contextRes.rows[0]?.value || '8192', 10);

      // Inject context tokens limit into model parameters if supported
      if (payload.max_tokens) {
        payload.max_tokens = Math.min(payload.max_tokens, contextSize);
      } else {
        payload.max_tokens = Math.min(4096, contextSize);
      }

      // 5. Log request to database
      await query(
        `INSERT INTO request_logs (key_id, endpoint) VALUES ($1, $2)`,
        [apiKey.id, '/chat/completions']
      );

      // 6. Forward request to Provider API (OpenAI-compatible)
      const targetUrl = `${activeProvider.base_url}/chat/completions`;
      const forwardHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeProvider.api_key}`
      };

      // Standard non-streaming fetch
      try {
        const fetchRes = await fetch(targetUrl, {
          method: 'POST',
          headers: forwardHeaders,
          body: JSON.stringify(payload)
        });

        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          let errJson = {};
          try { errJson = JSON.parse(errText); } catch (e) {}

          return {
            statusCode: fetchRes.status,
            headers,
            body: JSON.stringify({
              error: {
                message: errJson.error?.message || errText || "Failed upstream model call.",
                type: "provider_error",
                code: errJson.error?.code || fetchRes.statusText
              }
            })
          };
        }

        // Return provider response directly
        const dataText = await fetchRes.text();
        return {
          statusCode: 200,
          headers,
          body: dataText
        };

      } catch (err) {
        console.error("Fetch proxy routing failed:", err);
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({ error: { message: "Bad Gateway. Unable to reach upstream API provider.", details: err.message, type: "gateway_error" } })
        };
      }
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: { message: `Endpoint ${event.path} not found.`, type: "invalid_request_error" } })
    };

  } catch (err) {
    console.error("Error in core gateway:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: { message: "Internal server error inside gateway routing.", details: err.message, type: "api_error" } })
    };
  }
}
