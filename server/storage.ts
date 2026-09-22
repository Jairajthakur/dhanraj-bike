import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { TRIAL_DAYS, CURRENCY, addMonths, billingExemptCodes } from "./billing";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Schema bootstrap ─────────────────────────────────────────────────────────
// Idempotent — safe to run on every server boot. Mirrors migrations/0002_agencies.sql
// so a Railway deploy needs no manual migration step.
export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agencies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        owner_name VARCHAR(255) DEFAULT '',
        phone VARCHAR(50) DEFAULT '',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const usersHasAgency = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'agency_id'
    `);

    if (usersHasAgency.rowCount === 0) {
      await client.query("BEGIN");
      try {
        let legacyId: number | null = null;
        const anyUsers = await client.query("SELECT COUNT(*) FROM users");
        if (parseInt(anyUsers.rows[0].count) > 0) {
          const legacy = await client.query(
            `INSERT INTO agencies (name, code, owner_name, is_active) VALUES ($1, $2, $3, TRUE) RETURNING id`,
            ["Dhanraj Enterprises", "DHANRAJ1", "Legacy Admin"]
          );
          legacyId = legacy.rows[0].id;
        }

        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id INTEGER`);
        await client.query(`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS agency_id INTEGER`);
        await client.query(`ALTER TABLE repo_allocations ADD COLUMN IF NOT EXISTS agency_id INTEGER`);
        await client.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS agency_id INTEGER`);

        if (legacyId !== null) {
          await client.query(`UPDATE users SET agency_id = $1 WHERE agency_id IS NULL`, [legacyId]);
          await client.query(`UPDATE allocations SET agency_id = $1 WHERE agency_id IS NULL`, [legacyId]);
          await client.query(`UPDATE repo_allocations SET agency_id = $1 WHERE agency_id IS NULL`, [legacyId]);
          await client.query(`UPDATE notifications SET agency_id = $1 WHERE agency_id IS NULL`, [legacyId]);
        }

        await client.query(`ALTER TABLE users ALTER COLUMN agency_id SET NOT NULL`);
        await client.query(`ALTER TABLE allocations ALTER COLUMN agency_id SET NOT NULL`);
        await client.query(`ALTER TABLE repo_allocations ALTER COLUMN agency_id SET NOT NULL`);
        await client.query(`ALTER TABLE notifications ALTER COLUMN agency_id SET NOT NULL`);

        await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key`);
        await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_unique`);
        await client.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS users_agency_username_idx ON users (agency_id, username)`
        );

        await client.query("COMMIT");
        if (legacyId !== null) {
          console.log(`Backfilled legacy agency ${legacyId} (code DHANRAJ1) for pre-existing data`);
        }
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_agency ON users (agency_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_allocations_agency ON allocations (agency_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_repo_allocations_agency ON repo_allocations (agency_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_agency ON notifications (agency_id)`);

    // ── Billing (trial + Rs 2,000/month via Cashfree) ────────────────────────
    // Keep in sync with shared/schema.ts — the Docker start command runs
    // `drizzle-kit push --force`, which drops anything not declared there. That
    // push also runs BEFORE this code, so the columns may already exist (empty);
    // hence "un-billed" agencies are detected from their data, not from whether
    // the column had to be created.
    await client.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ`);

    // "Un-billed" = predates billing: no trial recorded, no payment, not exempt.
    // Every agency registered after this ships gets trial_ends_at at creation, so
    // it can never look un-billed. That is what makes the steps below safe to
    // run on every boot (idempotent) and impossible for a new registrant to abuse.
    const UNBILLED = `trial_ends_at IS NULL AND subscription_ends_at IS NULL AND billing_exempt = FALSE`;

    // 1) The pre-existing Dhanraj Enterprises agency is exempt (matched by name
    //    only among pre-billing rows, so registering that name later gains nothing).
    await client.query(
      `UPDATE agencies SET billing_exempt = TRUE WHERE ${UNBILLED} AND LOWER(TRIM(name)) = 'dhanraj enterprises'`
    );
    // 2) Configured exempt codes (default DHANRAJ1) are always exempt.
    await client.query(
      `UPDATE agencies SET billing_exempt = TRUE WHERE UPPER(code) = ANY($1) AND billing_exempt = FALSE`,
      [billingExemptCodes()]
    );
    // 3) Every other pre-existing agency gets a fresh 7-day trial starting now,
    //    rather than being locked out instantly because it was created long ago.
    const backfilled = await client.query(
      `UPDATE agencies SET trial_ends_at = NOW() + make_interval(days => $1) WHERE ${UNBILLED}`,
      [TRIAL_DAYS]
    );
    if (backfilled.rowCount) {
      console.log(`Billing: gave ${backfilled.rowCount} existing agenc${backfilled.rowCount === 1 ? "y" : "ies"} a ${TRIAL_DAYS}-day trial`);
    }

    await client.query(`
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
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_subscription_payments_agency ON subscription_payments (agency_id)`
    );
  } finally {
    client.release();
  }
}

// ── Password hashing ─────────────────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  // Existing/legacy rows may still hold a plaintext password (pre-hashing).
  // bcrypt hashes always start with $2 — anything else is treated as legacy plaintext.
  if (!stored.startsWith("$2")) {
    return plain === stored;
  }
  return bcrypt.compare(plain, stored);
}

// ── Agencies ──────────────────────────────────────────────────────────────────
export interface Agency {
  id: number;
  name: string;
  code: string;
  owner_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  billing_exempt: boolean;
  trial_ends_at: Date | null;
  subscription_ends_at: Date | null;
}

function generateAgencyCode(): string {
  // 6 uppercase alphanumeric chars, unambiguous alphabet (no 0/O/1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

export async function getAgencyByCode(code: string): Promise<Agency | null> {
  const result = await pool.query("SELECT * FROM agencies WHERE UPPER(code) = UPPER($1)", [code.trim()]);
  return result.rows[0] || null;
}

export async function getAgencyById(id: number): Promise<Agency | null> {
  const result = await pool.query("SELECT * FROM agencies WHERE id = $1", [id]);
  return result.rows[0] || null;
}

// The "legacy" agency is the tenant that pre-upgrade data was backfilled into.
// Old APKs log in without an agency code, so those logins resolve here.
// Override with LEGACY_AGENCY_CODE if you ever need to point it elsewhere.
export async function getLegacyAgency(): Promise<Agency | null> {
  const override = process.env.LEGACY_AGENCY_CODE;
  if (override) {
    return getAgencyByCode(override);
  }
  // Fall back to the oldest agency — on an upgraded database that is the one
  // ensureSchema() created during the backfill.
  const result = await pool.query("SELECT * FROM agencies ORDER BY id ASC LIMIT 1");
  return result.rows[0] || null;
}

export async function updateAgency(
  id: number,
  data: { name?: string; owner_name?: string; phone?: string }
): Promise<Agency> {
  const result = await pool.query(
    `UPDATE agencies SET
       name = COALESCE($2, name),
       owner_name = COALESCE($3, owner_name),
       phone = COALESCE($4, phone)
     WHERE id = $1 RETURNING *`,
    [id, data.name, data.owner_name, data.phone]
  );
  return result.rows[0];
}

// ── Super admin (cross-agency) ───────────────────────────────────────────────
// Everything below is scoped to NO single agency on purpose — only reachable
// through requireSuperAdmin in routes.ts, never through the normal per-agency
// requireAdmin guard.
export interface AgencyWithStats extends Agency {
  user_count: number;
  allocation_count: number;
  repo_allocation_count: number;
}

export async function getAllAgenciesWithStats(): Promise<AgencyWithStats[]> {
  const result = await pool.query(`
    SELECT
      a.*,
      COALESCE(u.cnt, 0)::int AS user_count,
      COALESCE(al.cnt, 0)::int AS allocation_count,
      COALESCE(ra.cnt, 0)::int AS repo_allocation_count
    FROM agencies a
    LEFT JOIN (SELECT agency_id, COUNT(*) cnt FROM users GROUP BY agency_id) u ON u.agency_id = a.id
    LEFT JOIN (SELECT agency_id, COUNT(*) cnt FROM allocations GROUP BY agency_id) al ON al.agency_id = a.id
    LEFT JOIN (SELECT agency_id, COUNT(*) cnt FROM repo_allocations GROUP BY agency_id) ra ON ra.agency_id = a.id
    ORDER BY a.created_at DESC
  `);
  return result.rows;
}

export async function setAgencyActive(id: number, is_active: boolean): Promise<Agency> {
  const result = await pool.query(
    "UPDATE agencies SET is_active = $2 WHERE id = $1 RETURNING *",
    [id, is_active]
  );
  return result.rows[0];
}

export async function setAgencyBillingExempt(id: number, billing_exempt: boolean): Promise<Agency> {
  const result = await pool.query(
    "UPDATE agencies SET billing_exempt = $2 WHERE id = $1 RETURNING *",
    [id, billing_exempt]
  );
  return result.rows[0];
}

// Extends (or sets, if the agency currently has no paid time left) the paid
// period by `months`, counting from whichever is later: now, or the agency's
// existing subscription_ends_at. Lets a super admin manually comp/extend an
// agency without going through Cashfree.
export async function extendAgencySubscription(id: number, months: number): Promise<Agency> {
  const result = await pool.query(
    `UPDATE agencies SET
       subscription_ends_at = GREATEST(COALESCE(subscription_ends_at, NOW()), NOW())
         + make_interval(months => $2)
     WHERE id = $1 RETURNING *`,
    [id, months]
  );
  return result.rows[0];
}

// Registers a new agency + its first admin (owner) user in one transaction.
export async function createAgencyWithOwner(data: {
  agencyName: string;
  ownerName: string;
  phone: string;
  username: string;
  password: string;
}): Promise<{ agency: Agency; user: DbUser }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Retry on the astronomically unlikely chance of a code collision.
    let agencyRow;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateAgencyCode();
      try {
        agencyRow = await client.query(
          `INSERT INTO agencies (name, code, owner_name, phone, is_active, trial_ends_at)
           VALUES ($1, $2, $3, $4, TRUE, NOW() + make_interval(days => $5)) RETURNING *`,
          [data.agencyName, code, data.ownerName, data.phone, TRIAL_DAYS]
        );
        break;
      } catch (e: any) {
        if (e.code === "23505" && attempt < 4) continue; // unique_violation on code
        throw e;
      }
    }
    const agency: Agency = agencyRow!.rows[0];

    const hashed = await hashPassword(data.password);
    const userRow = await client.query(
      `INSERT INTO users (agency_id, username, password, role, full_name) VALUES ($1, $2, $3, 'admin', $4) RETURNING *`,
      [agency.id, data.username, hashed, data.ownerName || data.username]
    );

    await client.query("COMMIT");
    return { agency, user: userRow.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Subscription payments ────────────────────────────────────────────────────
export interface SubscriptionPayment {
  id: number;
  agency_id: number;
  order_id: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PAID";
  payment_session_id: string | null;
  cf_order_id: string | null;
  cf_payment_id: string | null;
  period_start: Date | null;
  period_end: Date | null;
  paid_at: Date | null;
  created_at: Date;
}

export async function createSubscriptionPayment(data: {
  agency_id: number;
  order_id: string;
  amount: number;
  payment_session_id: string;
  cf_order_id: string;
}): Promise<SubscriptionPayment> {
  const result = await pool.query(
    `INSERT INTO subscription_payments (agency_id, order_id, amount, currency, payment_session_id, cf_order_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.agency_id, data.order_id, data.amount, CURRENCY, data.payment_session_id, data.cf_order_id]
  );
  return result.rows[0];
}

export async function getSubscriptionPayment(orderId: string): Promise<SubscriptionPayment | null> {
  const result = await pool.query("SELECT * FROM subscription_payments WHERE order_id = $1", [orderId]);
  return result.rows[0] || null;
}

// The agency's newest unpaid order from the last 24h — used to reconcile in case
// the webhook never arrived.
export async function getRecentPendingPayment(agencyId: number): Promise<SubscriptionPayment | null> {
  const result = await pool.query(
    `SELECT * FROM subscription_payments
     WHERE agency_id = $1 AND status = 'PENDING' AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [agencyId]
  );
  return result.rows[0] || null;
}

// Marks an order paid and extends the agency by one month, atomically and
// idempotently: webhook, return page and status polling can all race on the same
// order and the month is still granted exactly once (row lock + status check).
// The new month starts when current access ends, so paying early loses no days.
export async function activatePaidOrder(
  orderId: string,
  cfPaymentId: string | null
): Promise<{ activated: boolean; agencyId: number | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pay = await client.query("SELECT * FROM subscription_payments WHERE order_id = $1 FOR UPDATE", [orderId]);
    const payment: SubscriptionPayment | undefined = pay.rows[0];
    if (!payment) {
      await client.query("ROLLBACK");
      return { activated: false, agencyId: null };
    }
    if (payment.status === "PAID") {
      await client.query("COMMIT");
      return { activated: false, agencyId: payment.agency_id };
    }

    const ag = await client.query("SELECT * FROM agencies WHERE id = $1 FOR UPDATE", [payment.agency_id]);
    const agency: Agency = ag.rows[0];
    if (!agency) {
      await client.query("ROLLBACK");
      return { activated: false, agencyId: null };
    }

    const now = new Date();
    let start = now;
    if (agency.trial_ends_at && new Date(agency.trial_ends_at) > start) start = new Date(agency.trial_ends_at);
    if (agency.subscription_ends_at && new Date(agency.subscription_ends_at) > start) {
      start = new Date(agency.subscription_ends_at);
    }
    const end = addMonths(start, 1);

    await client.query(
      `UPDATE subscription_payments
       SET status = 'PAID', paid_at = $2, cf_payment_id = $3, period_start = $4, period_end = $5
       WHERE order_id = $1`,
      [orderId, now, cfPaymentId, start, end]
    );
    await client.query("UPDATE agencies SET subscription_ends_at = $2 WHERE id = $1", [agency.id, end]);
    await client.query("COMMIT");
    return { activated: true, agencyId: agency.id };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────
export interface DbUser {
  id: number;
  agency_id: number;
  username: string;
  password: string;
  role: "admin" | "fos" | "repo";
  full_name: string;
  created_at: string;
}

export async function getUserByUsernameInAgency(agencyId: number, username: string): Promise<DbUser | null> {
  const result = await pool.query(
    "SELECT * FROM users WHERE agency_id = $1 AND username = $2",
    [agencyId, username]
  );
  return result.rows[0] || null;
}

export async function getUserById(id: number): Promise<DbUser | null> {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function getAllUsers(agencyId: number): Promise<Omit<DbUser, "password">[]> {
  const result = await pool.query(
    "SELECT id, agency_id, username, role, full_name, created_at FROM users WHERE agency_id = $1 ORDER BY created_at DESC",
    [agencyId]
  );
  return result.rows;
}

export async function createUser(
  agencyId: number,
  username: string,
  password: string,
  role: string,
  full_name: string
): Promise<DbUser> {
  const hashed = await hashPassword(password);
  const result = await pool.query(
    "INSERT INTO users (agency_id, username, password, role, full_name) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [agencyId, username, hashed, role, full_name]
  );
  return result.rows[0];
}

// Scoped to the caller's agency so one agency can never delete another's user.
export async function deleteUser(id: number, agencyId: number): Promise<void> {
  await pool.query("DELETE FROM users WHERE id = $1 AND agency_id = $2", [id, agencyId]);
}

export async function updateUserPushToken(userId: number, token: string): Promise<void> {
  await pool.query("UPDATE users SET push_token = $1 WHERE id = $2", [token, userId]);
}

export async function getAdminPushTokens(agencyId: number): Promise<string[]> {
  const result = await pool.query(
    "SELECT push_token FROM users WHERE agency_id = $1 AND role = 'admin' AND push_token IS NOT NULL AND push_token != ''",
    [agencyId]
  );
  return result.rows.map((r: any) => r.push_token);
}

// ── Allocations ───────────────────────────────────────────────────────────────
export interface Allocation {
  id: number;
  agency_id: number;
  loan_no: string;
  app_id: string;
  customer_name: string;
  emi: number;
  emi_due: number;
  cbc: number;
  lpp: number;
  cbc_lpp: number;
  pos: number;
  bkt: string;
  customer_address: string;
  first_emi_due_date: string;
  loan_maturity_date: string;
  asset_make: string;
  registration_no: string;
  engine_no: string;
  chassis_no: string;
  ten: string;
  number: string;
  status: string;
  detail_fb: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: number;
  agency_id: number;
  fos_user_id: number;
  fos_name: string;
  customer_name: string;
  registration_no: string;
  allocation_id: number;
  is_read: boolean;
  created_at: string;
}

export async function searchAllocationByRegistration(agencyId: number, regNo: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM allocations WHERE agency_id = $1 AND LOWER(registration_no) LIKE LOWER($2) ORDER BY id",
    [agencyId, `%${regNo.trim()}%`]
  );
  return result.rows;
}

export async function searchAllocationByChassis(agencyId: number, chassis: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM allocations WHERE agency_id = $1 AND LOWER(chassis_no) LIKE LOWER($2) ORDER BY id",
    [agencyId, `%${chassis.trim()}%`]
  );
  return result.rows;
}

export async function getAllocationById(agencyId: number, id: number): Promise<Allocation | null> {
  const result = await pool.query("SELECT * FROM allocations WHERE id = $1 AND agency_id = $2", [id, agencyId]);
  return result.rows[0] || null;
}

// Returns all allocations for one agency — used by FOS app for offline caching
export async function getAllAllocations(agencyId: number): Promise<Allocation[]> {
  const result = await pool.query("SELECT * FROM allocations WHERE agency_id = $1 ORDER BY id", [agencyId]);
  return result.rows;
}

export async function getAllRepoAllocations(agencyId: number): Promise<Allocation[]> {
  const result = await pool.query("SELECT * FROM repo_allocations WHERE agency_id = $1 ORDER BY id", [agencyId]);
  return result.rows;
}

export async function bulkInsertAllocations(agencyId: number, rows: Partial<Allocation>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const row of rows) {
      await client.query(
        `INSERT INTO allocations 
          (agency_id, loan_no, app_id, customer_name, emi, emi_due, cbc, lpp, cbc_lpp, pos, bkt,
           customer_address, first_emi_due_date, loan_maturity_date, asset_make,
           registration_no, engine_no, chassis_no, ten, number, status, detail_fb)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          agencyId,
          row.loan_no ?? "", row.app_id ?? "", row.customer_name ?? "",
          row.emi ?? 0, row.emi_due ?? 0, row.cbc ?? 0, row.lpp ?? 0, row.cbc_lpp ?? 0,
          row.pos ?? 0, row.bkt ?? "", row.customer_address ?? "",
          row.first_emi_due_date ?? "", row.loan_maturity_date ?? "", row.asset_make ?? "",
          row.registration_no ?? "", row.engine_no ?? "", row.chassis_no ?? "",
          row.ten ?? "", row.number ?? "", row.status ?? "", row.detail_fb ?? "",
        ]
      );
      inserted++;
    }
    await client.query("COMMIT");
    return inserted;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function clearAllocations(agencyId: number): Promise<void> {
  await pool.query("DELETE FROM allocations WHERE agency_id = $1", [agencyId]);
}

export async function getAllocationCount(agencyId: number): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) FROM allocations WHERE agency_id = $1", [agencyId]);
  return parseInt(result.rows[0].count);
}

export async function createNotification(data: {
  agency_id: number;
  fos_user_id: number;
  fos_name: string;
  customer_name: string;
  registration_no: string;
  allocation_id: number;
  source_role?: string;
}): Promise<Notification> {
  const result = await pool.query(
    `INSERT INTO notifications (agency_id, fos_user_id, fos_name, customer_name, registration_no, allocation_id, source_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.agency_id, data.fos_user_id, data.fos_name, data.customer_name, data.registration_no, data.allocation_id, data.source_role || "fos"]
  );
  const role = (data.source_role || "fos").toUpperCase();
  const title = `${role} Alert — ${data.registration_no}`;
  const body = `${data.fos_name} viewed ${data.customer_name}`;
  getAdminPushTokens(data.agency_id).then((tokens) => sendExpoPushNotifications(tokens, title, body)).catch(() => {});
  return result.rows[0];
}

async function sendExpoPushNotifications(tokens: string[], title: string, body: string): Promise<void> {
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({ to, title, body, sound: "default" }));
  try {
    await fetch("https://exp.host/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch {}
}

export async function getAllNotifications(agencyId: number): Promise<Notification[]> {
  const result = await pool.query(
    "SELECT * FROM notifications WHERE agency_id = $1 ORDER BY created_at DESC",
    [agencyId]
  );
  return result.rows;
}

export async function markNotificationRead(agencyId: number, id: number): Promise<void> {
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = $1 AND agency_id = $2", [id, agencyId]);
}

export async function getUnreadCount(agencyId: number): Promise<number> {
  const result = await pool.query(
    "SELECT COUNT(*) FROM notifications WHERE agency_id = $1 AND is_read = FALSE",
    [agencyId]
  );
  return parseInt(result.rows[0].count);
}

export async function searchRepoAllocationByRegistration(agencyId: number, regNo: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM repo_allocations WHERE agency_id = $1 AND LOWER(registration_no) LIKE LOWER($2) ORDER BY id",
    [agencyId, `%${regNo.trim()}%`]
  );
  return result.rows;
}

export async function searchRepoAllocationByChassis(agencyId: number, chassis: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM repo_allocations WHERE agency_id = $1 AND LOWER(chassis_no) LIKE LOWER($2) ORDER BY id",
    [agencyId, `%${chassis.trim()}%`]
  );
  return result.rows;
}

export async function getRepoAllocationById(agencyId: number, id: number): Promise<Allocation | null> {
  const result = await pool.query("SELECT * FROM repo_allocations WHERE id = $1 AND agency_id = $2", [id, agencyId]);
  return result.rows[0] || null;
}

export async function bulkInsertRepoAllocations(agencyId: number, rows: Partial<Allocation>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const row of rows) {
      await client.query(
        `INSERT INTO repo_allocations
          (agency_id, loan_no, app_id, customer_name, emi, emi_due, cbc, lpp, cbc_lpp, pos, bkt,
           customer_address, first_emi_due_date, loan_maturity_date, asset_make,
           registration_no, engine_no, chassis_no, ten, number, status, detail_fb)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          agencyId,
          row.loan_no ?? "", row.app_id ?? "", row.customer_name ?? "",
          row.emi ?? 0, row.emi_due ?? 0, row.cbc ?? 0, row.lpp ?? 0, row.cbc_lpp ?? 0,
          row.pos ?? 0, row.bkt ?? "", row.customer_address ?? "",
          row.first_emi_due_date ?? "", row.loan_maturity_date ?? "", row.asset_make ?? "",
          row.registration_no ?? "", row.engine_no ?? "", row.chassis_no ?? "",
          row.ten ?? "", row.number ?? "", row.status ?? "", row.detail_fb ?? "",
        ]
      );
      inserted++;
    }
    await client.query("COMMIT");
    return inserted;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function clearRepoAllocations(agencyId: number): Promise<void> {
  await pool.query("DELETE FROM repo_allocations WHERE agency_id = $1", [agencyId]);
}

export async function getRepoAllocationCount(agencyId: number): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) FROM repo_allocations WHERE agency_id = $1", [agencyId]);
  return parseInt(result.rows[0].count);
}
