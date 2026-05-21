import pg from 'pg';
const { Pool } = pg;

// Connection Pool to Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

let isInitialized = false;

export async function getPool() {
  if (!isInitialized) {
    await initDb();
    isInitialized = true;
  }
  return pool;
}

export async function query(text, params) {
  const activePool = await getPool();
  return activePool.query(text, params);
}

export async function initDb() {
  const client = await pool.connect();
  try {
    // 1. Create api_keys table
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key_value VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      );
    `);

    // 2. Create providers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS providers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        api_key TEXT NOT NULL,
        base_url TEXT NOT NULL,
        is_active BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Create settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 4. Create request_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        endpoint VARCHAR(255) NOT NULL
      );
    `);

    // Insert default settings if they do not exist
    await client.query(`
      INSERT INTO settings (key, value)
      VALUES ('context_size', '8192')
      ON CONFLICT (key) DO NOTHING;
    `);

    // Insert default providers if they don't exist
    await client.query(`
      INSERT INTO providers (id, name, api_key, base_url, is_active)
      VALUES 
        ('openai', 'OpenAI', '', 'https://api.openai.com/v1', false),
        ('anthropic', 'Anthropic', '', 'https://api.anthropic.com/v1', false),
        ('gemini', 'Google Gemini', '', 'https://generativetool.googleapis.com/v1beta', false),
        ('openrouter', 'OpenRouter', '', 'https://openrouter.ai/api/v1', false)
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log("Database self-initialized successfully.");
  } catch (err) {
    console.error("Error during database self-initialization:", err);
    throw err;
  } finally {
    client.release();
  }
}
