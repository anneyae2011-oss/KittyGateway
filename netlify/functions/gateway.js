import { query } from './db.js';

export async function handler(event, context) {
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
      return { statusCode: 500, headers, body: JSON.stringify({ error: "DATABASE_URL environment variable is missing." }) };
    }

    // Resolve path
    const path = event.path.replace(/^\/v1/, '').replace(/^\/\.netlify\/functions\/gateway/, '').replace(/^\//, '');

    // Fetch active provider (needed for both routes)
    const providerRes = await query(`SELECT id, name, api_key, base_url FROM providers WHERE is_active = TRUE LIMIT 1`);
    const activeProvider = providerRes.rows[0];

    // ── GET /models (public, no auth required) ──────────────────────────────
    if (path === 'models') {
      if (!activeProvider) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ data: [{ id: "no-provider-configured", object: "model", created: Date.now(), owned_by: "maomao" }] })
        };
      }

      try {
        const fetchRes = await fetch(`${activeProvider.base_url}/models`, {
          headers: { 'Authorization': `Bearer ${activeProvider.api_key}` }
        });
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          return { statusCode: 200, headers, body: JSON.stringify(data) };
        }
      } catch (_) {}

      // Fallback: return a single placeholder model using the provider name
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          data: [{ id: `${activeProvider.id}-default`, object: "model", created: Date.now(), owned_by: activeProvider.id }]
        })
      };
    }

    // ── All other routes require auth ────────────────────────────────────────
    const authHeader = event.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: { message: "Missing or invalid Authorization header.", type: "invalid_request_error" } }) };
    }

    const userKey = authHeader.replace('Bearer ', '').trim();
    if (!userKey.startsWith('mm_')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: { message: "Invalid API Key format. Key must start with 'mm_'.", type: "invalid_request_error" } }) };
    }

    const keyRes = await query(`SELECT id, key_value, name, is_active FROM api_keys WHERE key_value = $1`, [userKey]);
    if (keyRes.rows.length === 0) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: { message: "The provided API Key is invalid.", type: "invalid_request_error", code: "invalid_api_key" } }) };
    }

    const apiKey = keyRes.rows[0];
    if (!apiKey.is_active) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: { message: "This API Key has been suspended or revoked.", type: "access_denied", code: "key_suspended" } }) };
    }

    // Rate limiting
    const rpmRes = await query(`SELECT COUNT(*)::int as count FROM request_logs WHERE key_id = $1 AND timestamp >= NOW() - INTERVAL '1 minute'`, [apiKey.id]);
    if (rpmRes.rows[0].count >= 3) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: { message: "Rate limit exceeded: 3 RPM.", type: "rate_limit_error", code: "rpm_limit_exceeded" } }) };
    }

    const rpdRes = await query(`SELECT COUNT(*)::int as count FROM request_logs WHERE key_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`, [apiKey.id]);
    if (rpdRes.rows[0].count >= 300) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: { message: "Rate limit exceeded: 300 RPD.", type: "rate_limit_error", code: "rpd_limit_exceeded" } }) };
    }

    // ── POST /chat/completions ───────────────────────────────────────────────
    if (path === 'chat/completions') {
      if (!activeProvider) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: { message: "No active API provider configured.", type: "service_unavailable" } }) };
      }

      let payload = {};
      try { payload = JSON.parse(event.body); } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Malformed JSON payload.", type: "invalid_request_error" } }) };
      }

      const messages = payload.messages || [];
      if (messages.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Messages array cannot be empty.", type: "invalid_request_error" } }) };
      }

      // CSAM moderation check
      const modApiKey = process.env.OPENAI_API_KEY || null;
      if (modApiKey) {
        try {
          const promptText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
          const modRes = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${modApiKey}` },
            body: JSON.stringify({ input: promptText, model: 'omni-moderation-latest' })
          });
          if (modRes.ok) {
            const modData = await modRes.json();
            const result = modData.results?.[0];
            if (result) {
              const isCsamFlagged = result.categories?.['sexual/minors'] === true;
              const csamScore = result.category_scores?.['sexual/minors'] || 0;
              if (isCsamFlagged || csamScore > 0.05) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Content rejected: child safety policy violation.", type: "safety_policy_violation", code: "csam_blocked" } }) };
              }
            }
          }
        } catch (modErr) {
          console.error("Moderation check failed:", modErr);
        }
      }

      // Context size limit
      const contextRes = await query(`SELECT value FROM settings WHERE key = 'context_size'`);
      const contextSize = parseInt(contextRes.rows[0]?.value || '8192', 10);
      payload.max_tokens = payload.max_tokens ? Math.min(payload.max_tokens, contextSize) : Math.min(4096, contextSize);

      // Log request
      await query(`INSERT INTO request_logs (key_id, endpoint) VALUES ($1, $2)`, [apiKey.id, '/chat/completions']);

      // Forward to provider (OpenAI-compatible)
      try {
        const fetchRes = await fetch(`${activeProvider.base_url}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeProvider.api_key}` },
          body: JSON.stringify(payload)
        });

        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          let errJson = {};
          try { errJson = JSON.parse(errText); } catch (e) {}
          return { statusCode: fetchRes.status, headers, body: JSON.stringify({ error: { message: errJson.error?.message || errText || "Upstream provider error.", type: "provider_error" } }) };
        }

        return { statusCode: 200, headers, body: await fetchRes.text() };
      } catch (err) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: { message: "Bad Gateway. Unable to reach upstream provider.", details: err.message, type: "gateway_error" } }) };
      }
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: { message: `Endpoint not found.`, type: "invalid_request_error" } }) };

  } catch (err) {
    console.error("Error in gateway:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: { message: "Internal server error.", details: err.message, type: "api_error" } }) };
  }
}
