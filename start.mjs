const { Pool } = require("pg");
const { spawn } = require("child_process");

async function runMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  console.log("Running database migrations...");
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'fos',
        full_name TEXT NOT NULL DEFAULT '',
        push_token TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS allocations (
        id SERIAL PRIMARY KEY,
        loan_no TEXT NOT NULL DEFAULT '',
        app_id TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        emi NUMERIC NOT NULL DEFAULT 0,
        emi_due NUMERIC NOT NULL DEFAULT 0,
        cbc NUMERIC NOT NULL DEFAULT 0,
        lpp NUMERIC NOT NULL DEFAULT 0,
        cbc_lpp NUMERIC NOT NULL DEFAULT 0,
        pos NUMERIC NOT NULL DEFAULT 0,
        bkt TEXT NOT NULL DEFAULT '',
        customer_address TEXT NOT NULL DEFAULT '',
        first_emi_due_date TEXT NOT NULL DEFAULT '',
        loan_maturity_date TEXT NOT NULL DEFAULT '',
        asset_make TEXT NOT NULL DEFAULT '',
        registration_no TEXT NOT NULL DEFAULT '',
        engine_no TEXT NOT NULL DEFAULT '',
        chassis_no TEXT NOT NULL DEFAULT '',
        ten TEXT NOT NULL DEFAULT '',
        number TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        detail_fb TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS repo_allocations (
        id SERIAL PRIMARY KEY,
        loan_no TEXT NOT NULL DEFAULT '',
        app_id TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        emi NUMERIC NOT NULL DEFAULT 0,
        emi_due NUMERIC NOT NULL DEFAULT 0,
        cbc NUMERIC NOT NULL DEFAULT 0,
        lpp NUMERIC NOT NULL DEFAULT 0,
        cbc_lpp NUMERIC NOT NULL DEFAULT 0,
        pos NUMERIC NOT NULL DEFAULT 0,
        bkt TEXT NOT NULL DEFAULT '',
        customer_address TEXT NOT NULL DEFAULT '',
        first_emi_due_date TEXT NOT NULL DEFAULT '',
        loan_maturity_date TEXT NOT NULL DEFAULT '',
        asset_make TEXT NOT NULL DEFAULT '',
        registration_no TEXT NOT NULL DEFAULT '',
        engine_no TEXT NOT NULL DEFAULT '',
        chassis_no TEXT NOT NULL DEFAULT '',
        ten TEXT NOT NULL DEFAULT '',
        number TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        detail_fb TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        fos_user_id INTEGER NOT NULL,
        fos_name TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        registration_no TEXT NOT NULL DEFAULT '',
        allocation_id INTEGER NOT NULL DEFAULT 0,
        source_role TEXT NOT NULL DEFAULT 'fos',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);
      CREATE INDEX IF NOT EXISTS idx_allocations_reg ON allocations (LOWER(registration_no));
      CREATE INDEX IF NOT EXISTS idx_allocations_chassis ON allocations (LOWER(chassis_no));
      CREATE INDEX IF NOT EXISTS idx_repo_reg ON repo_allocations (LOWER(registration_no));
      CREATE INDEX IF NOT EXISTS idx_repo_chassis ON repo_allocations (LOWER(chassis_no));
    `);
    console.log("Migrations complete");
  } finally {
    await pool.end();
  }
}

async function main() {
  await runMigrations();
  console.log("Starting server...");
  const child = spawn("node", ["server_dist/index.js"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
