-- Billing: 7-day trial, then Rs 2,000/month via Cashfree. Dhanraj Enterprises is exempt.
-- The server applies all of this automatically on boot (ensureSchema in server/storage.ts)
-- and shared/schema.ts declares the same objects for `drizzle-kit push`. This file is for
-- running by hand / documentation only. Safe to run repeatedly.

ALTER TABLE agencies ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

-- Pre-billing agencies = no trial, no payment, not exempt.
UPDATE agencies SET billing_exempt = TRUE
 WHERE trial_ends_at IS NULL AND subscription_ends_at IS NULL AND billing_exempt = FALSE
   AND LOWER(TRIM(name)) = 'dhanraj enterprises';
UPDATE agencies SET billing_exempt = TRUE WHERE UPPER(code) = 'DHANRAJ1' AND billing_exempt = FALSE;
UPDATE agencies SET trial_ends_at = NOW() + INTERVAL '7 days'
 WHERE trial_ends_at IS NULL AND subscription_ends_at IS NULL AND billing_exempt = FALSE;

CREATE TABLE IF NOT EXISTS subscription_payments (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  agency_id INTEGER NOT NULL,
  order_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'PENDING',
  payment_session_id TEXT,
  cf_order_id TEXT,
  cf_payment_id TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_payments_order_id_unique UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_agency ON subscription_payments (agency_id);
