-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'fos',
  full_name VARCHAR(255),
  push_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Allocations table
CREATE TABLE IF NOT EXISTS allocations (
  id SERIAL PRIMARY KEY,
  loan_no VARCHAR(255),
  app_id VARCHAR(255),
  customer_name VARCHAR(255),
  emi DECIMAL(10, 2),
  emi_due DECIMAL(10, 2),
  cbc DECIMAL(10, 2),
  lpp DECIMAL(10, 2),
  cbc_lpp DECIMAL(10, 2),
  pos DECIMAL(10, 2),
  bkt VARCHAR(255),
  customer_address TEXT,
  first_emi_due_date VARCHAR(255),
  loan_maturity_date VARCHAR(255),
  asset_make VARCHAR(255),
  registration_no VARCHAR(255),
  engine_no VARCHAR(255),
  chassis_no VARCHAR(255),
  ten VARCHAR(255),
  number VARCHAR(255),
  status VARCHAR(255),
  detail_fb TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Repo Allocations table
CREATE TABLE IF NOT EXISTS repo_allocations (
  id SERIAL PRIMARY KEY,
  loan_no VARCHAR(255),
  app_id VARCHAR(255),
  customer_name VARCHAR(255),
  emi DECIMAL(10, 2),
  emi_due DECIMAL(10, 2),
  cbc DECIMAL(10, 2),
  lpp DECIMAL(10, 2),
  cbc_lpp DECIMAL(10, 2),
  pos DECIMAL(10, 2),
  bkt VARCHAR(255),
  customer_address TEXT,
  first_emi_due_date VARCHAR(255),
  loan_maturity_date VARCHAR(255),
  asset_make VARCHAR(255),
  registration_no VARCHAR(255),
  engine_no VARCHAR(255),
  chassis_no VARCHAR(255),
  ten VARCHAR(255),
  number VARCHAR(255),
  status VARCHAR(255),
  detail_fb TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  fos_user_id INTEGER REFERENCES users(id),
  fos_name VARCHAR(255),
  customer_name VARCHAR(255),
  registration_no VARCHAR(255),
  allocation_id INTEGER,
  source_role VARCHAR(50),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User sessions table (for express-session)
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions (expire);
