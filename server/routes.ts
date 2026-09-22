import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import * as XLSX from "xlsx";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { getSubscriptionInfo } from "./billing";
import { registerBillingRoutes } from "./billingRoutes";
import {
  ensureSchema,
  verifyPassword,
  createAgencyWithOwner,
  getAgencyByCode,
  getAgencyById,
  getLegacyAgency,
  updateAgency,
  getUserByUsernameInAgency,
  getUserById,
  getAllUsers,
  createUser,
  deleteUser,
  searchAllocationByRegistration,
  searchAllocationByChassis,
  getAllocationById,
  getAllAllocations,
  getAllRepoAllocations,
  bulkInsertAllocations,
  clearAllocations,
  getAllocationCount,
  createNotification,
  getAllNotifications,
  markNotificationRead,
  getUnreadCount,
  searchRepoAllocationByRegistration,
  searchRepoAllocationByChassis,
  getRepoAllocationById,
  bulkInsertRepoAllocations,
  clearRepoAllocations,
  getRepoAllocationCount,
  updateUserPushToken,
  getAllAgenciesWithStats,
  setAgencyActive,
  setAgencyBillingExempt,
  extendAgencySubscription,
} from "./storage";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
    username: string;
    fullName: string;
    agencyId: number;
  }
}


// ── In-memory data version tracker ───────────────────────────────────────────
// Incremented on every allocation upload so FOS/Repo devices know to re-sync.
let dataVersion = { alloc: Date.now(), repo: Date.now() };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export async function registerRoutes(app: Express): Promise<Server> {
  const PgSession = connectPgSimple(session);
  const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });

  app.use(
    session({
      store: new PgSession({
        pool: sessionPool,
        tableName: "user_sessions",
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "dhanraj-secret-key-2024",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "none",
      },
    })
  );

  // Create/upgrade the agencies table + agency_id columns on every boot.
  try {
    await ensureSchema();
  } catch (e: any) {
    console.error("Schema setup error:", e.message);
  }

  // ── Legacy session compatibility ───────────────────────────────────────────
  // APKs built before the multi-tenant upgrade hold sessions that carry a
  // userId but no agencyId. Rather than log those users out, we look the
  // agency up from their own user row and attach it to the session. The value
  // comes from the database, never from the client, so this grants no access
  // the user didn't already have.
  async function hydrateAgency(req: Request): Promise<boolean> {
    if (!req.session.userId) return false;
    if (req.session.agencyId) return true;
    const user = await getUserById(req.session.userId);
    if (!user) return false;
    req.session.agencyId = user.agency_id;
    // Backfill the other fields old sessions may predate, too.
    if (!req.session.role) req.session.role = user.role;
    if (!req.session.username) req.session.username = user.username;
    if (!req.session.fullName) req.session.fullName = user.full_name;
    await new Promise<void>((resolve) => req.session.save(() => resolve()));
    return true;
  }

  // ── Auth guards ────────────────────────────────────────────────────────────
  // requireSession      – logged in only (no subscription check). Used by billing,
  //                       so a locked-out agency can still see status and pay.
  // requireAdminNoBilling – admin only, no subscription check (start a payment).
  // requireAuth / requireAdmin / requireRepo – the above PLUS an active trial or
  //                       paid subscription; otherwise HTTP 402. Every data route
  //                       uses these, so the paywall is enforced on the server and
  //                       can't be bypassed by tampering with the app.

  // Returns true if the caller may proceed; otherwise has already sent a 402.
  async function subscriptionOk(req: Request, res: Response): Promise<boolean> {
    const agency = await getAgencyById(req.session.agencyId!);
    if (!agency) {
      res.status(401).json({ message: "Agency not found" });
      return false;
    }
    const subscription = getSubscriptionInfo(agency);
    if (!subscription.hasAccess) {
      res.status(402).json({
        code: "SUBSCRIPTION_EXPIRED",
        message:
          req.session.role === "admin"
            ? "Your free trial or subscription has ended. Please renew to continue."
            : "Your agency's subscription has expired. Please ask your admin to renew it.",
        subscription,
      });
      return false;
    }
    return true;
  }

  async function requireSession(req: Request, res: Response, next: any) {
    try {
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      next();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function requireAdminNoBilling(req: Request, res: Response, next: any) {
    try {
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (req.session.role !== "admin") return res.status(403).json({ message: "Admin only" });
      next();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function requireAuth(req: Request, res: Response, next: any) {
    try {
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (!(await subscriptionOk(req, res))) return;
      next();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function requireAdmin(req: Request, res: Response, next: any) {
    try {
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (req.session.role !== "admin") return res.status(403).json({ message: "Admin only" });
      if (!(await subscriptionOk(req, res))) return;
      next();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function requireRepo(req: Request, res: Response, next: any) {
    try {
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (req.session.role !== "repo" && req.session.role !== "admin") {
        return res.status(403).json({ message: "Repo or Admin only" });
      }
      if (!(await subscriptionOk(req, res))) return;
      next();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  // super_admin sits above every agency — no subscription check applies to
  // it (there's no agency to bill), and it must never be reachable via
  // requireAdmin, which is scoped to the caller's own agency_id.
  async function requireSuperAdmin(req: Request, res: Response, next: any) {
    try {
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (req.session.role !== "super_admin") {
        return res.status(403).json({ message: "Super admin only" });
      }
      next();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  // ── Super admin: cross-agency management ───────────────────────────────────
  app.get("/api/super-admin/agencies", requireSuperAdmin, async (_req, res) => {
    try {
      const agencies = await getAllAgenciesWithStats();
      res.json(
        agencies.map((a) => ({
          ...a,
          subscription: getSubscriptionInfo(a),
        }))
      );
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/super-admin/agencies/:id/active", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { is_active } = req.body;
      if (typeof is_active !== "boolean") {
        return res.status(400).json({ message: "is_active must be true or false" });
      }
      const agency = await setAgencyActive(id, is_active);
      res.json(agency);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/super-admin/agencies/:id/billing-exempt", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { billing_exempt } = req.body;
      if (typeof billing_exempt !== "boolean") {
        return res.status(400).json({ message: "billing_exempt must be true or false" });
      }
      const agency = await setAgencyBillingExempt(id, billing_exempt);
      res.json(agency);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/super-admin/agencies/:id/extend", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const months = parseInt(req.body.months, 10);
      if (!Number.isFinite(months) || months <= 0) {
        return res.status(400).json({ message: "months must be a positive number" });
      }
      const agency = await extendAgencySubscription(id, months);
      res.json(agency);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  registerBillingRoutes(app, { requireSession, requireAdminNoBilling });

  // ── Agency registration (public) ───────────────────────────────────────────
  // Agency owner creates their agency profile here; a unique agency code is
  // generated and the owner becomes that agency's first admin user.
  app.post("/api/agencies/register", async (req, res) => {
    try {
      const { agencyName, ownerName, phone, username, password } = req.body;
      if (!agencyName?.trim() || !ownerName?.trim() || !username?.trim() || !password?.trim()) {
        return res.status(400).json({ message: "Agency name, owner name, username and password are required" });
      }
      if (String(password).length < 4) {
        return res.status(400).json({ message: "Password must be at least 4 characters" });
      }
      const { agency, user } = await createAgencyWithOwner({
        agencyName: agencyName.trim(),
        ownerName: ownerName.trim(),
        phone: (phone || "").trim(),
        username: username.trim(),
        password: password.trim(),
      });

      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.fullName = user.full_name;
      req.session.agencyId = agency.id;
      req.session.save((err) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({
          id: user.id,
          username: user.username,
          role: user.role,
          fullName: user.full_name,
          agencyId: agency.id,
          agencyName: agency.name,
          agencyCode: agency.code,
          subscription: getSubscriptionInfo(agency),
        });
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { agencyCode, username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      let agency;
      if (agencyCode?.trim()) {
        agency = await getAgencyByCode(agencyCode.trim());
        if (!agency || !agency.is_active) {
          return res.status(401).json({ message: "Invalid agency code" });
        }
      } else {
        // ── Old APK compatibility ────────────────────────────────────────────
        // Builds released before the multi-tenant upgrade don't send an agency
        // code. Those logins resolve against the legacy agency only, so users
        // already in the field keep working without reinstalling.
        // Set LEGACY_LOGIN_DISABLED=true to turn this off once everyone has
        // updated to a build that sends an agency code.
        if (process.env.LEGACY_LOGIN_DISABLED === "true") {
          return res.status(400).json({ message: "Agency code is required. Please update the app." });
        }
        agency = await getLegacyAgency();
        if (!agency || !agency.is_active) {
          return res.status(400).json({ message: "Agency code is required" });
        }
      }

      const user = await getUserByUsernameInAgency(agency.id, username);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.fullName = user.full_name;
      req.session.agencyId = agency.id;
      req.session.save((err) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({
          id: user.id,
          username: user.username,
          role: user.role,
          fullName: user.full_name,
          agencyId: agency.id,
          agencyName: agency.name,
          agencyCode: agency.code,
          subscription: getSubscriptionInfo(agency),
        });
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      // Hydrates agencyId for sessions created by pre-upgrade APKs.
      if (!(await hydrateAgency(req))) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ message: "User not found" });
      const agency = await getAgencyById(req.session.agencyId!);
      if (!agency || !agency.is_active) return res.status(401).json({ message: "Agency not found" });
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
        agencyId: agency.id,
        agencyName: agency.name,
        agencyCode: agency.code,
        subscription: getSubscriptionInfo(agency),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Agency profile (own agency only)
  app.get("/api/agency", requireAuth, async (req, res) => {
    try {
      const agency = await getAgencyById(req.session.agencyId!);
      if (!agency) return res.status(404).json({ message: "Agency not found" });
      res.json(agency);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/agency", requireAdmin, async (req, res) => {
    try {
      const { name, owner_name, phone } = req.body;
      const agency = await updateAgency(req.session.agencyId!, { name, owner_name, phone });
      res.json(agency);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Users (admin only, scoped to the admin's own agency)
  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const users = await getAllUsers(req.session.agencyId!);
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, full_name } = req.body;
      if (!username || !password || !role) return res.status(400).json({ message: "Missing fields" });
      const existing = await getUserByUsernameInAgency(req.session.agencyId!, username);
      if (existing) return res.status(409).json({ message: "Username already exists in this agency" });
      const user = await createUser(req.session.agencyId!, username, password, role, full_name || username);
      res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (id === req.session.userId!) return res.status(400).json({ message: "Cannot delete yourself" });
      await deleteUser(id, req.session.agencyId!);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Allocations
  app.get("/api/allocations/search", requireAuth, async (req, res) => {
    try {
      const { reg, chassis } = req.query;
      const agencyId = req.session.agencyId!;
      if (chassis && typeof chassis === "string" && chassis.trim().length >= 2) {
        const results = await searchAllocationByChassis(agencyId, chassis);
        return res.json(results);
      }
      if (!reg || typeof reg !== "string" || reg.trim().length < 2) {
        return res.json([]);
      }
      const results = await searchAllocationByRegistration(agencyId, reg);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/allocations/all", requireAuth, async (req, res) => {
    try {
      const role = req.session.role;
      const agencyId = req.session.agencyId!;
      const allocations = role === "repo"
        ? await getAllRepoAllocations(agencyId)
        : await getAllAllocations(agencyId);
      res.json(allocations);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/allocations/count", requireAuth, async (req, res) => {
    try {
      const count = await getAllocationCount(req.session.agencyId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/allocations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const allocation = await getAllocationById(req.session.agencyId!, id);
      if (!allocation) return res.status(404).json({ message: "Not found" });
      res.json(allocation);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/allocations/upload", requireAdmin, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rawRows.length === 0) return res.status(400).json({ message: "Excel file is empty" });
      const mapped = rawRows.map((row: any) => ({
        loan_no: String(row["LOAN NO"] || row["loan_no"] || row["LoanNo"] || ""),
        app_id: String(row["APP ID"] || row["app_id"] || row["AppId"] || ""),
        customer_name: String(row["CUSTOMERNAME"] || row["customer_name"] || row["CustomerName"] || ""),
        emi: parseFloat(row["EMI"] || row["emi"] || 0) || 0,
        emi_due: parseFloat(row["EMI_DUE"] || row["emi_due"] || 0) || 0,
        cbc: parseFloat(row["CBC"] || row["cbc"] || 0) || 0,
        lpp: parseFloat(row["LPP"] || row["lpp"] || 0) || 0,
        cbc_lpp: parseFloat(row["CBC+LPP"] || row["cbc_lpp"] || row["CBC_LPP"] || 0) || 0,
        pos: parseFloat(row["Pos"] || row["POS"] || row["pos"] || 0) || 0,
        bkt: String(row["Bkt"] || row["BKT"] || row["bkt"] || ""),
        customer_address: String(row["CUSTOMER_ADDDRESS"] || row["CUSTOMER_ADDRESS"] || row["customer_address"] || ""),
        first_emi_due_date: String(row["FIRST_EMI_DUE_DATE"] || row["first_emi_due_date"] || ""),
        loan_maturity_date: String(row["LOAN_MATURITY_DATE"] || row["loan_maturity_date"] || ""),
        asset_make: String(row["ASSET_MAKE"] || row["asset_make"] || ""),
        registration_no: String(row["REGISTRATION_NO"] || row["registration_no"] || row["RegNo"] || ""),
        engine_no: String(row["engine_no"] || row["ENGINE_NO"] || row["EngineNo"] || ""),
        chassis_no: String(row["chassis_no"] || row["CHASSIS_NO"] || row["ChassisNo"] || ""),
        ten: String(row["Ten"] || row["TEN"] || row["ten"] || ""),
        number: String(row["Number"] || row["NUMBER"] || row["number"] || ""),
        status: String(row["status"] || row["STATUS"] || row["Status"] || ""),
        detail_fb: String(row["Detail FB"] || row["detail_fb"] || row["DetailFB"] || row["DETAIL_FB"] || ""),
      }));
      const shouldReplace = req.body.replace === "true";
      const agencyId = req.session.agencyId!;
      if (shouldReplace) await clearAllocations(agencyId);
      const inserted = await bulkInsertAllocations(agencyId, mapped);
      dataVersion.alloc = Date.now();
      res.json({ inserted, total: mapped.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Repo Allocations
  app.get("/api/repo-allocations/search", requireRepo, async (req, res) => {
    try {
      const { reg, chassis } = req.query;
      const agencyId = req.session.agencyId!;
      if (chassis && typeof chassis === "string" && chassis.trim().length >= 2) {
        const results = await searchRepoAllocationByChassis(agencyId, chassis);
        return res.json(results);
      }
      if (!reg || typeof reg !== "string" || reg.trim().length < 2) return res.json([]);
      const results = await searchRepoAllocationByRegistration(agencyId, reg);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/repo-allocations/count", requireAdmin, async (req, res) => {
    try {
      const count = await getRepoAllocationCount(req.session.agencyId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/repo-allocations/:id", requireRepo, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const allocation = await getRepoAllocationById(req.session.agencyId!, id);
      if (!allocation) return res.status(404).json({ message: "Not found" });
      res.json(allocation);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/repo-allocations/upload", requireAdmin, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rawRows.length === 0) return res.status(400).json({ message: "Excel file is empty" });
      const mapped = rawRows.map((row: any) => ({
        loan_no: String(row["LOAN NO"] || row["loan_no"] || row["LoanNo"] || ""),
        app_id: String(row["APP ID"] || row["app_id"] || row["AppId"] || ""),
        customer_name: String(row["CUSTOMERNAME"] || row["customer_name"] || row["CustomerName"] || ""),
        emi: parseFloat(row["EMI"] || row["emi"] || 0) || 0,
        emi_due: parseFloat(row["EMI_DUE"] || row["emi_due"] || 0) || 0,
        cbc: parseFloat(row["CBC"] || row["cbc"] || 0) || 0,
        lpp: parseFloat(row["LPP"] || row["lpp"] || 0) || 0,
        cbc_lpp: parseFloat(row["CBC+LPP"] || row["cbc_lpp"] || row["CBC_LPP"] || 0) || 0,
        pos: parseFloat(row["Pos"] || row["POS"] || row["pos"] || 0) || 0,
        bkt: String(row["Bkt"] || row["BKT"] || row["bkt"] || ""),
        customer_address: String(row["CUSTOMER_ADDDRESS"] || row["CUSTOMER_ADDRESS"] || row["customer_address"] || ""),
        first_emi_due_date: String(row["FIRST_EMI_DUE_DATE"] || row["first_emi_due_date"] || ""),
        loan_maturity_date: String(row["LOAN_MATURITY_DATE"] || row["loan_maturity_date"] || ""),
        asset_make: String(row["ASSET_MAKE"] || row["asset_make"] || ""),
        registration_no: String(row["REGISTRATION_NO"] || row["registration_no"] || row["RegNo"] || ""),
        engine_no: String(row["engine_no"] || row["ENGINE_NO"] || row["EngineNo"] || ""),
        chassis_no: String(row["chassis_no"] || row["CHASSIS_NO"] || row["ChassisNo"] || ""),
        ten: String(row["Ten"] || row["TEN"] || row["ten"] || ""),
        number: String(row["Number"] || row["NUMBER"] || row["number"] || ""),
        status: String(row["status"] || row["STATUS"] || row["Status"] || ""),
        detail_fb: String(row["Detail FB"] || row["detail_fb"] || row["DetailFB"] || row["DETAIL_FB"] || ""),
      }));
      const shouldReplace = req.body.replace === "true";
      const agencyId = req.session.agencyId!;
      if (shouldReplace) await clearRepoAllocations(agencyId);
      const inserted = await bulkInsertRepoAllocations(agencyId, mapped);
      dataVersion.repo = Date.now();
      res.json({ inserted, total: mapped.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Push token
  app.put("/api/auth/push-token", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || !req.session.userId!) return res.status(400).json({ message: "Missing token" });
      await updateUserPushToken(req.session.userId!, token);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Notifications
  app.post("/api/notifications", requireAuth, async (req, res) => {
    try {
      const { customer_name, registration_no, allocation_id, source_role } = req.body;
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const role = source_role || req.session.role || "fos";
      const notif = await createNotification({
        agency_id: req.session.agencyId!,
        fos_user_id: req.session.userId!,
        fos_name: req.session.fullName || req.session.username || role.toUpperCase(),
        customer_name,
        registration_no,
        allocation_id,
        source_role: role,
      });
      res.json(notif);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/notifications", requireAdmin, async (req, res) => {
    try {
      const notifs = await getAllNotifications(req.session.agencyId!);
      res.json(notifs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/notifications/unread-count", requireAdmin, async (req, res) => {
    try {
      const count = await getUnreadCount(req.session.agencyId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/notifications/:id/read", requireAdmin, async (req, res) => {
    try {
      await markNotificationRead(req.session.agencyId!, parseInt(String(req.params.id)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });


  // Public endpoint — FOS/Repo devices poll this on foreground to detect new uploads
  app.get("/api/data-version", requireAuth, (_req, res) => {
    res.json({ alloc: dataVersion.alloc, repo: dataVersion.repo });
  });

  const httpServer = createServer(app);
  return httpServer;
}
