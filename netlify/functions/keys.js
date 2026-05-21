import { query } from './db.js';
import crypto from 'crypto';

export async function handler(event, context) {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Check if DATABASE_URL is present
    if (!process.env.DATABASE_URL) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "DATABASE_URL environment variable is missing." })
      };
    }

    if (event.httpMethod === 'POST') {
      const keyValue = `mm_${crypto.randomBytes(16).toString('hex')}`;
      const body = event.body ? JSON.parse(event.body) : {};
      const oldKey = body.old_key || null;

      if (oldKey) {
        // Reroll: update key_value in place so request_logs (RPD/RPM) are preserved
        const res = await query(
          `UPDATE api_keys SET key_value = $1 WHERE key_value = $2 RETURNING id, key_value, name, created_at, is_active`,
          [keyValue, oldKey]
        );
        if (res.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "Old key not found." }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ message: "API Key rerolled successfully.", key: res.rows[0] }) };
      }

      // Fresh key generation
      const name = `Key - ${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const res = await query(
        `INSERT INTO api_keys (key_value, name) VALUES ($1, $2) RETURNING id, key_value, name, created_at, is_active`,
        [keyValue, name]
      );
      return { statusCode: 201, headers, body: JSON.stringify({ message: "API Key generated successfully.", key: res.rows[0] }) };
    } 
    
    if (event.httpMethod === 'GET') {
      // Get stats for a specific key
      const { key } = event.queryStringParameters || {};
      if (!key) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing 'key' query parameter." })
        };
      }

      // 1. Fetch key info
      const keyRes = await query(
        `SELECT id, key_value, name, created_at, is_active FROM api_keys WHERE key_value = $1`,
        [key]
      );

      if (keyRes.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Invalid API Key." })
        };
      }

      const apiKey = keyRes.rows[0];

      if (!apiKey.is_active) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: "API Key is revoked/disabled." })
        };
      }

      // 2. Count request logs in the last 60 seconds (RPM)
      const rpmRes = await query(
        `SELECT COUNT(*)::int as count FROM request_logs WHERE key_id = $1 AND timestamp >= NOW() - INTERVAL '1 minute'`,
        [apiKey.id]
      );

      // 3. Count request logs in the last 24 hours (RPD)
      const rpdRes = await query(
        `SELECT COUNT(*)::int as count FROM request_logs WHERE key_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
        [apiKey.id]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          key: {
            name: apiKey.name,
            key_value: apiKey.key_value,
            created_at: apiKey.created_at,
            is_active: apiKey.is_active
          },
          limits: {
            rpm_limit: 3,
            rpd_limit: 300,
            rpm_used: rpmRes.rows[0].count,
            rpd_used: rpdRes.rows[0].count
          }
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };

  } catch (err) {
    console.error("Error in keys serverless function:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error occurred.", details: err.message })
    };
  }
}
