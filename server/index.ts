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
    const allowedOrigins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      allowedOrigins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        allowedOrigins.add(`https://${d.trim()}`);
      });
    }
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      allowedOrigins.add(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    }
    if (process.env.ALLOWED_ORIGINS) {
      process.env.ALLOWED_ORIGINS.split(",").forEach((d) => {
        allowedOrigins.add(d.trim());
      });
    }

    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (!origin) {
      res.header("Access-Control-Allow-Origin", "*");
    } else if (isLocalhost || allowedOrigins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
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

// Play Store (and Apple) require a reachable Privacy Policy URL, and Play
// Console asks for a support contact. These three pages are served as plain
// HTML so they work as public links in the store listing without needing the
// Expo app itself to be running. Fill in the placeholders below via env vars
// before publishing — see server/templates/{privacy-policy,terms,support}.html.
function configureLegalPages(app: express.Application) {
  const appName = getAppName();
  const effectiveDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const values: Record<string, string> = {
    APP_NAME_PLACEHOLDER: appName,
    EFFECTIVE_DATE_PLACEHOLDER: effectiveDate,
    SUPPORT_EMAIL_PLACEHOLDER: process.env.SUPPORT_EMAIL || "th.jairaj@gmail.com",
    SUPPORT_PHONE_PLACEHOLDER: process.env.SUPPORT_PHONE || "+91 86258 88869",
    RESPONSE_TIME_PLACEHOLDER: process.env.SUPPORT_RESPONSE_TIME || "1 business day",
    COMPANY_NAME_PLACEHOLDER: process.env.COMPANY_NAME || "the developer of this app",
    GOVERNING_LAW_PLACEHOLDER: process.env.GOVERNING_LAW || "India",
  };

  function render(fileName: string): string | null {
    const filePath = path.resolve(process.cwd(), "server", "templates", fileName);
    if (!fs.existsSync(filePath)) return null;
    let html = fs.readFileSync(filePath, "utf-8");
    for (const [key, val] of Object.entries(values)) {
      html = html.split(key).join(val);
    }
    return html;
  }

  function servePage(routePath: string, fileName: string) {
    app.get(routePath, (_req: Request, res: Response) => {
      const html = render(fileName);
      if (!html) return res.status(404).send("Not found");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    });
  }

  servePage("/privacy", "privacy-policy.html");
  servePage("/terms", "terms.html");
  servePage("/support", "support.html");
  log("Legal pages ready at /privacy, /terms, /support");
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
  let landingPageTemplate = "<html><body><h1>APP_NAME_PLACEHOLDER</h1></body></html>";
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  if (fs.existsSync(templatePath)) {
    landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
    log("Landing page template loaded from disk");
  } else {
    console.warn(
      `Warning: Landing page template not found at ${templatePath}, using fallback`
    );
  }

  const appName = getAppName();

  // The QR-code / "Open in Expo Go" page used to live at "/", which meant a
  // normal desktop or mobile browser visiting the site never saw the actual
  // app — only instructions for installing Expo Go. It now lives at
  // /preview, and "/" serves the real web build of the app (see below).
  app.get("/preview", (req: Request, res: Response) => {
    serveLandingPage({ req, res, landingPageTemplate, appName });
  });

  // Native OTA manifest routing (used by EAS Update / the production
  // native app requesting the latest published JS bundle over-the-air).
  app.use((req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.path.startsWith("/api")) return next();
      if (req.path !== "/" && req.path !== "/manifest") return next();
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      next();
    } catch (err) {
      console.error("Error handling manifest route:", err);
      res.status(500).send("Internal Server Error");
    }
  });

  // Native OTA update bundles (JS bundles published via `expo export` for
  // ios/android, consumed by the installed native app, not by browsers).
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  // Web build of the app itself, produced by `npx expo export -p web`
  // (see package.json's "build:web" script). Ships as a set of prerendered
  // HTML "shells" — one per route — that all load the same JS bundle and
  // then hydrate client-side, plus the static asset files they reference.
  const webDistPath = path.resolve(process.cwd(), "dist");
  const hasWebBuild = fs.existsSync(path.join(webDistPath, "index.html"));

  if (hasWebBuild) {
    log(`Serving web app build from ${webDistPath}`);
    app.use(
      express.static(webDistPath, {
        // lets "/login" resolve to "dist/login.html", "/" resolve to
        // "dist/index.html", etc.
        extensions: ["html"],
      })
    );
  } else {
    console.warn(
      `Warning: no web build found at ${webDistPath}. Run "npm run build:web" ` +
        `(or the full "npm run build") to generate it. Falling back to the ` +
        `Expo Go preview page at "/".`
    );
    app.get("/", (req: Request, res: Response) => {
      serveLandingPage({ req, res, landingPageTemplate, appName });
    });
  }

  // Raw project assets (referenced directly by URL from legal pages, etc).
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));

  if (hasWebBuild) {
    // SPA fallback: expo-router's static export only prerenders one HTML
    // shell per route file (e.g. "allocation/[id].html" for the dynamic
    // "/allocation/:id" route), so a request for a concrete URL like
    // "/allocation/42" won't match a file on disk above. For any GET that
    // isn't an API call and isn't a request for a file with an extension
    // (js/css/png/etc — those should 404 normally if missing), hand back
    // index.html and let the client-side router in the already-loaded app
    // resolve the real route from the URL.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      // Server-rendered payment pages (checkout launcher, Cashfree return page)
      // live under "/billing" and are registered later by registerRoutes(). They
      // must not be swallowed by the SPA shell, or the app's own client-side
      // router renders its "this screen doesn't exist" page instead of the
      // actual checkout/return HTML the server sends.
      if (req.path.startsWith("/billing")) return next();
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(webDistPath, "index.html"));
    });
  }

  log("Expo routing: web app on \"/\", Expo Go preview on \"/preview\"");
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

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/ping", (_req: Request, res: Response) => {
    res.status(200).send("pong");
  });

  configureLegalPages(app);
  configureExpoAndLanding(app);

  let server: any;
  try {
    server = await registerRoutes(app);
  } catch (err) {
    console.error("Error registering routes:", err);
    // Don't exit — start server anyway so healthcheck passes
    server = http.createServer(app);
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
