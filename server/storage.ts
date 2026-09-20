import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

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
          `INSERT INTO agencies (name, code, owner_name, phone, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
          [data.agencyName, code, data.ownerName, data.phone]
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
