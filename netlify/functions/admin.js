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

    // Check Password Authorization
    const passwordHeader = event.headers['x-admin-password'] || '';
    let requestBody = {};
    if (event.body) {
      try {
        requestBody = JSON.parse(event.body);
      } catch (e) {}
    }

    const password = passwordHeader || requestBody.password;
    if (password !== 'witchyliz2010') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Unauthorized. Invalid admin password." })
      };
    }

    const { action } = requestBody;

    if (event.httpMethod === 'POST') {
      
      // Action: GET CONFIG
      if (action === 'get_config') {
        // 1. Fetch all providers
        const providersRes = await query(`SELECT id, name, api_key, base_url, is_active FROM providers ORDER BY id`);
        
        // 2. Fetch context size
        const contextRes = await query(`SELECT value FROM settings WHERE key = 'context_size'`);
        const contextSize = contextRes.rows[0]?.value || '8192';

        // 3. Fetch all keys and count their total requests
        const keysRes = await query(`
          SELECT 
            k.id, k.key_value, k.name, k.created_at, k.is_active,
            COUNT(r.id)::int as total_requests
          FROM api_keys k
          LEFT JOIN request_logs r ON k.id = r.key_id
          GROUP BY k.id, k.key_value, k.name, k.created_at, k.is_active
          ORDER BY k.created_at DESC
        `);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            providers: providersRes.rows,
            context_size: contextSize,
            keys: keysRes.rows
          })
        };
      }

      // Action: ADD CUSTOM PROVIDER
      if (action === 'add_provider') {
        const { name, api_key, base_url } = requestBody;
        if (!name || !base_url) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing name or base_url" }) };
        }

        let formattedBaseUrl = base_url.trim().replace(/\/$/, '');

        // Generate a slug id from the name
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

        await query(
          `INSERT INTO providers (id, name, api_key, base_url, is_active)
           VALUES ($1, $2, $3, $4, FALSE)
           ON CONFLICT (id) DO UPDATE SET name = $2, api_key = COALESCE($3, providers.api_key), base_url = $4`,
          [id, name, api_key || null, formattedBaseUrl]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: "Provider added successfully.", id })
        };
      }

      // Action: DELETE PROVIDER
      if (action === 'delete_provider') {
        const { provider_id } = requestBody;
        if (!provider_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing provider_id" }) };
        }

        await query(`DELETE FROM providers WHERE id = $1`, [provider_id]);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: "Provider deleted successfully." })
        };
      }

      // Action: UPDATE PROVIDER
      if (action === 'update_provider') {
        const { provider_id, api_key, base_url, is_active } = requestBody;
        if (!provider_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing provider_id" }) };
        }

        // Standardize URLs
        let formattedBaseUrl = base_url ? base_url.trim().replace(/\/$/, '') : null;

        // If activating this provider, we deactivate all other providers to make sure only one is active at a time
        if (is_active) {
          await query(`UPDATE providers SET is_active = FALSE`);
        }

        await query(
          `UPDATE providers 
           SET api_key = COALESCE($1, api_key), 
               base_url = COALESCE($2, base_url), 
               is_active = $3,
               updated_at = NOW() 
           WHERE id = $4`,
          [api_key || null, formattedBaseUrl, is_active, provider_id]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: "Provider updated successfully." })
        };
      }

      // Action: UPDATE CONTEXT SIZE
      if (action === 'update_context_size') {
        const { context_size } = requestBody;
        if (!context_size) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing context_size" }) };
        }

        await query(
          `INSERT INTO settings (key, value) VALUES ('context_size', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [String(context_size)]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: "Context size updated successfully." })
        };
      }

      // Action: TOGGLE USER KEY STATUS (REVOKE / RESTORE)
      if (action === 'toggle_key') {
        const { key_id, is_active } = requestBody;
        if (!key_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing key_id" }) };
        }

        await query(
          `UPDATE api_keys SET is_active = $1 WHERE id = $2`,
          [is_active, key_id]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: `API Key ${is_active ? 'activated' : 'revoked'} successfully.` })
        };
      }

      // Action: DELETE KEY
      if (action === 'delete_key') {
        const { key_id } = requestBody;
        if (!key_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing key_id" }) };
        }

        await query(`DELETE FROM api_keys WHERE id = $1`, [key_id]);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: "API Key deleted successfully." })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unsupported action." })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };

  } catch (err) {
    console.error("Error in admin serverless function:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error in admin portal.", details: err.message })
    };
  }
}
