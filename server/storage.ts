import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface DbUser {
  id: number;
  username: string;
  password: string;
  role: "admin" | "fos" | "repo";
  full_name: string;
  created_at: string;
}

export interface Allocation {
  id: number;
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
  fos_user_id: number;
  fos_name: string;
  customer_name: string;
  registration_no: string;
  allocation_id: number;
  is_read: boolean;
  created_at: string;
}

export async function getUserByUsername(username: string): Promise<DbUser | null> {
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return result.rows[0] || null;
}

export async function getUserById(id: number): Promise<DbUser | null> {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function getAllUsers(): Promise<Omit<DbUser, "password">[]> {
  const result = await pool.query(
    "SELECT id, username, role, full_name, created_at FROM users ORDER BY created_at DESC"
  );
  return result.rows;
}

export async function createUser(
  username: string,
  password: string,
  role: string,
  full_name: string
): Promise<DbUser> {
  const result = await pool.query(
    "INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4) RETURNING *",
    [username, password, role, full_name]
  );
  return result.rows[0];
}

export async function deleteUser(id: number): Promise<void> {
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

export async function searchAllocationByRegistration(regNo: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM allocations WHERE LOWER(registration_no) LIKE LOWER($1) ORDER BY id",
    [`%${regNo.trim()}%`]
  );
  return result.rows;
}

export async function searchAllocationByChassis(chassis: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM allocations WHERE LOWER(chassis_no) LIKE LOWER($1) ORDER BY id",
    [`%${chassis.trim()}%`]
  );
  return result.rows;
}

export async function getAllocationById(id: number): Promise<Allocation | null> {
  const result = await pool.query("SELECT * FROM allocations WHERE id = $1", [id]);
  return result.rows[0] || null;
}

// Returns all allocations — used by FOS app for offline caching
export async function getAllAllocations(): Promise<Allocation[]> {
  const result = await pool.query("SELECT * FROM allocations ORDER BY id");
  return result.rows;
}

export async function getAllRepoAllocations(): Promise<Allocation[]> {
  const result = await pool.query("SELECT * FROM repo_allocations ORDER BY id");
  return result.rows;
}

export async function bulkInsertAllocations(rows: Partial<Allocation>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const row of rows) {
      await client.query(
        `INSERT INTO allocations 
          (loan_no, app_id, customer_name, emi, emi_due, cbc, lpp, cbc_lpp, pos, bkt,
           customer_address, first_emi_due_date, loan_maturity_date, asset_make,
           registration_no, engine_no, chassis_no, ten, number, status, detail_fb)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
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

export async function clearAllocations(): Promise<void> {
  await pool.query("TRUNCATE TABLE allocations RESTART IDENTITY CASCADE");
}

export async function getAllocationCount(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) FROM allocations");
  return parseInt(result.rows[0].count);
}

export async function updateUserPushToken(userId: number, token: string): Promise<void> {
  await pool.query("UPDATE users SET push_token = $1 WHERE id = $2", [token, userId]);
}

export async function getAdminPushTokens(): Promise<string[]> {
  const result = await pool.query(
    "SELECT push_token FROM users WHERE role = 'admin' AND push_token IS NOT NULL AND push_token != ''"
  );
  return result.rows.map((r: any) => r.push_token);
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

export async function createNotification(data: {
  fos_user_id: number;
  fos_name: string;
  customer_name: string;
  registration_no: string;
  allocation_id: number;
  source_role?: string;
}): Promise<Notification> {
  const result = await pool.query(
    `INSERT INTO notifications (fos_user_id, fos_name, customer_name, registration_no, allocation_id, source_role)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.fos_user_id, data.fos_name, data.customer_name, data.registration_no, data.allocation_id, data.source_role || "fos"]
  );
  const role = (data.source_role || "fos").toUpperCase();
  const title = `${role} Alert — ${data.registration_no}`;
  const body = `${data.fos_name} viewed ${data.customer_name}`;
  getAdminPushTokens().then((tokens) => sendExpoPushNotifications(tokens, title, body)).catch(() => {});
  return result.rows[0];
}

export async function getAllNotifications(): Promise<Notification[]> {
  const result = await pool.query("SELECT * FROM notifications ORDER BY created_at DESC");
  return result.rows;
}

export async function markNotificationRead(id: number): Promise<void> {
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [id]);
}

export async function getUnreadCount(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) FROM notifications WHERE is_read = FALSE");
  return parseInt(result.rows[0].count);
}

export async function searchRepoAllocationByRegistration(regNo: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM repo_allocations WHERE LOWER(registration_no) LIKE LOWER($1) ORDER BY id",
    [`%${regNo.trim()}%`]
  );
  return result.rows;
}

export async function searchRepoAllocationByChassis(chassis: string): Promise<Allocation[]> {
  const result = await pool.query(
    "SELECT * FROM repo_allocations WHERE LOWER(chassis_no) LIKE LOWER($1) ORDER BY id",
    [`%${chassis.trim()}%`]
  );
  return result.rows;
}

export async function getRepoAllocationById(id: number): Promise<Allocation | null> {
  const result = await pool.query("SELECT * FROM repo_allocations WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function bulkInsertRepoAllocations(rows: Partial<Allocation>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const row of rows) {
      await client.query(
        `INSERT INTO repo_allocations
          (loan_no, app_id, customer_name, emi, emi_due, cbc, lpp, cbc_lpp, pos, bkt,
           customer_address, first_emi_due_date, loan_maturity_date, asset_make,
           registration_no, engine_no, chassis_no, ten, number, status, detail_fb)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
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

export async function clearRepoAllocations(): Promise<void> {
  await pool.query("TRUNCATE TABLE repo_allocations RESTART IDENTITY CASCADE");
}

export async function getRepoAllocationCount(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) FROM repo_allocations");
  return parseInt(result.rows[0].count);
}
