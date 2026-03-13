import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import * as XLSX from "xlsx";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import {
  getUserByUsername,
  getUserById,
  getAllUsers,
  createUser,
  deleteUser,
  searchAllocationByRegistration,
  searchAllocationByChassis,
  getAllocationById,
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
} from "./storage";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
    username: string;
    fullName: string;
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export async function registerRoutes(app: Express): Promise<Server> {
  const PgSession = connectPgSimple(session);
  const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const isProd = process.env.NODE_ENV === "production";

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
        secure: isProd,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );

  // Seed default admin user on first startup (runs in both dev and production)
  try {
    const seedPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const existing = await seedPool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existing.rowCount === 0) {
      await seedPool.query(
        "INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4)",
        ["admin", "admin123", "admin", "Administrator"]
      );
      console.log("Seeded default admin user (admin/admin123)");
    }
    await seedPool.end();
  } catch (e: any) {
    console.error("Seed admin error:", e.message);
  }

  function requireAuth(req: Request, res: Response, next: any) {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    next();
  }

  function requireAdmin(req: Request, res: Response, next: any) {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    if (req.session.role !== "admin") return res.status(403).json({ message: "Admin only" });
    next();
  }

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });
      const user = await getUserByUsername(username);
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.fullName = user.full_name;
      req.session.save((err) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name });
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name });
  });

  // Users (admin only)
  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const users = await getAllUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, full_name } = req.body;
      if (!username || !password || !role) return res.status(400).json({ message: "Missing fields" });
      const existing = await getUserByUsername(username);
      if (existing) return res.status(409).json({ message: "Username already exists" });
      const user = await createUser(username, password, role, full_name || username);
      res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (id === req.session.userId) return res.status(400).json({ message: "Cannot delete yourself" });
      await deleteUser(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Allocations - search
  app.get("/api/allocations/search", requireAuth, async (req, res) => {
    try {
      const { reg, chassis } = req.query;
      if (chassis && typeof chassis === "string" && chassis.trim().length >= 2) {
        const results = await searchAllocationByChassis(chassis);
        return res.json(results);
      }
      if (!reg || typeof reg !== "string" || reg.trim().length < 2) {
        return res.json([]);
      }
      const results = await searchAllocationByRegistration(reg);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/allocations/count", requireAuth, async (req, res) => {
    try {
      const count = await getAllocationCount();
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/allocations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const allocation = await getAllocationById(id);
      if (!allocation) return res.status(404).json({ message: "Not found" });
      res.json(allocation);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Excel upload (admin only)
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
      if (shouldReplace) {
        await clearAllocations();
      }

      const inserted = await bulkInsertAllocations(mapped);
      res.json({ inserted, total: mapped.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Repo Allocations
  function requireRepo(req: Request, res: Response, next: any) {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    if (req.session.role !== "repo" && req.session.role !== "admin") {
      return res.status(403).json({ message: "Repo or Admin only" });
    }
    next();
  }

  app.get("/api/repo-allocations/search", requireRepo, async (req, res) => {
    try {
      const { reg, chassis } = req.query;
      if (chassis && typeof chassis === "string" && chassis.trim().length >= 2) {
        const results = await searchRepoAllocationByChassis(chassis);
        return res.json(results);
      }
      if (!reg || typeof reg !== "string" || reg.trim().length < 2) return res.json([]);
      const results = await searchRepoAllocationByRegistration(reg);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/repo-allocations/count", requireAdmin, async (req, res) => {
    try {
      const count = await getRepoAllocationCount();
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/repo-allocations/:id", requireRepo, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const allocation = await getRepoAllocationById(id);
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
      if (shouldReplace) await clearRepoAllocations();
      const inserted = await bulkInsertRepoAllocations(mapped);
      res.json({ inserted, total: mapped.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Push token registration
  app.put("/api/auth/push-token", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || !req.session.userId) return res.status(400).json({ message: "Missing token" });
      await updateUserPushToken(req.session.userId, token);
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
        fos_user_id: req.session.userId,
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
      const notifs = await getAllNotifications();
      res.json(notifs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/notifications/unread-count", requireAdmin, async (req, res) => {
    try {
      const count = await getUnreadCount();
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/notifications/:id/read", requireAdmin, async (req, res) => {
    try {
      await markNotificationRead(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
