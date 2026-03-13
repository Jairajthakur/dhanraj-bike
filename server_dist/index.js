// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import multer from "multer";
import * as XLSX from "xlsx";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool as Pool2 } from "pg";

// server/storage.ts
import { Pool } from "pg";
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function getUserByUsername(username) {
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return result.rows[0] || null;
}
async function getUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}
async function getAllUsers() {
  const result = await pool.query(
    "SELECT id, username, role, full_name, created_at FROM users ORDER BY created_at DESC"
  );
  return result.rows;
}
async function createUser(username, password, role, full_name) {
  const result = await pool.query(
    "INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4) RETURNING *",
    [username, password, role, full_name]
  );
  return result.rows[0];
}
async function deleteUser(id) {
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}
async function searchAllocationByRegistration(regNo) {
  const result = await pool.query(
    "SELECT * FROM allocations WHERE LOWER(registration_no) LIKE LOWER($1) ORDER BY id",
    [`%${regNo.trim()}%`]
  );
  return result.rows;
}
async function getAllocationById(id) {
  const result = await pool.query("SELECT * FROM allocations WHERE id = $1", [id]);
  return result.rows[0] || null;
}
async function bulkInsertAllocations(rows) {
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
          row.loan_no ?? "",
          row.app_id ?? "",
          row.customer_name ?? "",
          row.emi ?? 0,
          row.emi_due ?? 0,
          row.cbc ?? 0,
          row.lpp ?? 0,
          row.cbc_lpp ?? 0,
          row.pos ?? 0,
          row.bkt ?? "",
          row.customer_address ?? "",
          row.first_emi_due_date ?? "",
          row.loan_maturity_date ?? "",
          row.asset_make ?? "",
          row.registration_no ?? "",
          row.engine_no ?? "",
          row.chassis_no ?? "",
          row.ten ?? "",
          row.number ?? "",
          row.status ?? "",
          row.detail_fb ?? ""
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
async function clearAllocations() {
  await pool.query("TRUNCATE TABLE allocations RESTART IDENTITY CASCADE");
}
async function getAllocationCount() {
  const result = await pool.query("SELECT COUNT(*) FROM allocations");
  return parseInt(result.rows[0].count);
}
async function createNotification(data) {
  const result = await pool.query(
    `INSERT INTO notifications (fos_user_id, fos_name, customer_name, registration_no, allocation_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.fos_user_id, data.fos_name, data.customer_name, data.registration_no, data.allocation_id]
  );
  return result.rows[0];
}
async function getAllNotifications() {
  const result = await pool.query("SELECT * FROM notifications ORDER BY created_at DESC");
  return result.rows;
}
async function markNotificationRead(id) {
  await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [id]);
}
async function getUnreadCount() {
  const result = await pool.query("SELECT COUNT(*) FROM notifications WHERE is_read = FALSE");
  return parseInt(result.rows[0].count);
}

// server/routes.ts
var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
async function registerRoutes(app2) {
  const PgSession = connectPgSimple(session);
  const sessionPool = new Pool2({ connectionString: process.env.DATABASE_URL });
  const isProd = process.env.NODE_ENV === "production";
  app2.use(
    session({
      store: new PgSession({
        pool: sessionPool,
        tableName: "user_sessions",
        createTableIfMissing: true
      }),
      secret: process.env.SESSION_SECRET || "dhanraj-secret-key-2024",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProd,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1e3,
        sameSite: "lax"
      }
    })
  );
  try {
    const seedPool = new Pool2({ connectionString: process.env.DATABASE_URL });
    const existing = await seedPool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existing.rowCount === 0) {
      await seedPool.query(
        "INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4)",
        ["admin", "admin123", "admin", "Administrator"]
      );
      console.log("Seeded default admin user (admin/admin123)");
    }
    await seedPool.end();
  } catch (e) {
    console.error("Seed admin error:", e.message);
  }
  function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    next();
  }
  function requireAdmin(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    if (req.session.role !== "admin") return res.status(403).json({ message: "Admin only" });
    next();
  }
  app2.post("/api/auth/login", async (req, res) => {
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
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });
  app2.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name });
  });
  app2.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const users = await getAllUsers();
      res.json(users);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, full_name } = req.body;
      if (!username || !password || !role) return res.status(400).json({ message: "Missing fields" });
      const existing = await getUserByUsername(username);
      if (existing) return res.status(409).json({ message: "Username already exists" });
      const user = await createUser(username, password, role, full_name || username);
      res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (id === req.session.userId) return res.status(400).json({ message: "Cannot delete yourself" });
      await deleteUser(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/allocations/search", requireAuth, async (req, res) => {
    try {
      const { reg } = req.query;
      if (!reg || typeof reg !== "string" || reg.trim().length < 2) {
        return res.json([]);
      }
      const results = await searchAllocationByRegistration(reg);
      res.json(results);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/allocations/count", requireAuth, async (req, res) => {
    try {
      const count = await getAllocationCount();
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/allocations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const allocation = await getAllocationById(id);
      if (!allocation) return res.status(404).json({ message: "Not found" });
      res.json(allocation);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/allocations/upload", requireAdmin, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rawRows.length === 0) return res.status(400).json({ message: "Excel file is empty" });
      const mapped = rawRows.map((row) => ({
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
        detail_fb: String(row["Detail FB"] || row["detail_fb"] || row["DetailFB"] || row["DETAIL_FB"] || "")
      }));
      const shouldReplace = req.body.replace === "true";
      if (shouldReplace) {
        await clearAllocations();
      }
      const inserted = await bulkInsertAllocations(mapped);
      res.json({ inserted, total: mapped.length });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/notifications", requireAuth, async (req, res) => {
    try {
      const { customer_name, registration_no, allocation_id } = req.body;
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const notif = await createNotification({
        fos_user_id: req.session.userId,
        fos_name: req.session.fullName || req.session.username || "FOS",
        customer_name,
        registration_no,
        allocation_id
      });
      res.json(notif);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/notifications", requireAdmin, async (req, res) => {
    try {
      const notifs = await getAllNotifications();
      res.json(notifs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/notifications/unread-count", requireAdmin, async (req, res) => {
    try {
      const count = await getUnreadCount();
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/notifications/:id/read", requireAdmin, async (req, res) => {
    try {
      await markNotificationRead(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  app.set("trust proxy", true);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
