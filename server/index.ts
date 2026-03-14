import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");

    // Allow all origins for mobile app (React Native / Expo APK has no origin)
    // and allow any configured domain
    const allowedOrigins = new Set<string>();

    // Replit domains (kept for dev compatibility)
    if (process.env.REPLIT_DEV_DOMAIN) {
      allowedOrigins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        allowedOrigins.add(`https://${d.trim()}`);
      });
    }

    // Railway domain
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      allowedOrigins.add(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    }

    // Custom allowed origins from env
    if (process.env.ALLOWED_ORIGINS) {
      process.env.ALLOWED_ORIGINS.split(",").forEach((d) => {
        allowedOrigins.add(d.trim());
      });
    }

    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    // Mobile apps (React Native) send requests without an origin header
    // So if there's no origin, we allow it (it's the APK making the request)
    if (!origin) {
      res.header("Access-Control-Allow-Origin", "*");
    } else if (isLocalhost || allowedOrigins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
      // Allow all origins in production for mobile app support
      res.header("Access-Control-Allow-Origin", origin);
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "...";
      }
      log(logLine);
    });
    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  try {
    const manifestPath = path.resolve(
      process.cwd(),
      "static-build",
      platform,
      "manifest.json"
    );
    if (!fs.existsSync(manifestPath)) {
      return res
        .status(404)
        .json({ error: `Manifest not found for platform: ${platform}` });
    }
    res.setHeader("expo-protocol-version", "1");
    res.setHeader("expo-sfv-version", "0");
    res.setHeader("content-type", "application/json");
    const manifest = fs.readFileSync(manifestPath, "utf-8");
    res.send(manifest);
  } catch (err) {
    console.error("Error serving manifest:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  try {
    const forwardedProto = req.header("x-forwarded-proto");
    const protocol = forwardedProto || req.protocol || "https";
    const forwardedHost = req.header("x-forwarded-host");
    const host = forwardedHost || req.get("host");
    const baseUrl = `${protocol}://${host}`;
    const expsUrl = `${host}`;
    const html = landingPageTemplate
      .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
      .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
      .replace(/APP_NAME_PLACEHOLDER/g, appName);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    console.error("Error serving landing page:", err);
    res.status(500).send("Internal Server Error");
  }
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app.use((req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.path.startsWith("/api")) return next();
      if (req.path !== "/" && req.path !== "/manifest") return next();
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      if (req.path === "/") {
        return serveLandingPage({ req, res, landingPageTemplate, appName });
      }
      next();
    } catch (err) {
      console.error("Error handling landing/manifest route:", err);
      res.status(500).send("Internal Server Error");
    }
  });
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });
}

(async () => {
  app.set("trust proxy", true);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  // Health check routes BEFORE registerRoutes
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/ping", (_req: Request, res: Response) => {
    res.status(200).send("pong");
  });

  configureExpoAndLanding(app);
  let server: any;
  try {
    server = await registerRoutes(app);
  } catch (err) {
    console.error("Error registering routes:", err);
    process.exit(1); // Exit so Railway restarts the container
  }
  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "8080", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );

  if (process.env.NODE_ENV === "development") {
    const proxyApp = express();
    proxyApp.set("trust proxy", true);
    proxyApp.get("/connect", (req, res) => {
      const domain = process.env.REPLIT_DEV_DOMAIN || "localhost";
      const expoUrl = `exp://${domain}:3001`;
      const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(
        expoUrl
      )}`;
      res.setHeader("Content-Type", "text/html");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open in Expo Go</title>
<style>
body { background:#0F0F0F; color:#fff; font-family:sans-serif; display:flex;
flex-direction:column; align-items:center; justify-content:center;
min-height:100vh; margin:0; padding:20px; box-sizing:border-box; }
h1 { color:#F59E0B; font-size:1.4rem; margin-bottom:8px; }
p { color:#aaa; font-size:.9rem; margin:4px 0 20px; text-align:center; }
.qr { background:#fff; padding:16px; border-radius:12px; }
.url { background:#1a1a1a; border:1px solid #333; border-radius:8px;
padding:10px 16px; font-size:.8rem; color:#F59E0B; word-break:break-all;
margin-top:20px; max-width:320px; text-align:center; }
.steps { color:#aaa; font-size:.85rem; margin-top:20px; max-width:320px; line-height:1.7; }
.steps b { color:#fff; }
</style>
</head>
<body>
<h1>Open in Expo Go</h1>
<p>Scan with your phone camera or Expo Go app</p>
<div class="qr"><img src="${qrApi}" width="280" height="280" alt="QR Code"></div>
<div class="url">${expoUrl}</div>
<div class="steps">
<b>Instructions:</b><br>
1. Install <b>Expo Go</b> on your Android / iOS device<br>
2. Open your phone camera and scan the QR code above<br>
3. Tap the notification to open in Expo Go<br>
<br>
Or in Expo Go: tap <b>Enter URL manually</b> and paste the URL above
</div>
</body>
</html>`);
    });
    proxyApp.use(
      createProxyMiddleware({
        pathFilter: "/api",
        target: `http://127.0.0.1:${port}`,
        changeOrigin: false,
      })
    );
    const expoProxy = createProxyMiddleware({
      target: "http://127.0.0.1:8082",
      changeOrigin: false,
      ws: true,
    });
    proxyApp.use(expoProxy);
    const proxyServer = http.createServer(proxyApp);
    proxyServer.on("upgrade", (expoProxy as any).upgrade);
    proxyServer.listen(8081, "0.0.0.0", () => {
      log("dev proxy serving on port 8081 (webview → Expo dev server)");
    });
  }
})();
