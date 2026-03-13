const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const config = getDefaultConfig(__dirname);

// In development, proxy /api/* requests from Metro (port 8082, external port 3001)
// to the Express backend (port 5000). This allows Android Expo Go devices to
// reach the API through standard HTTPS, bypassing mobile network restrictions
// on port 5000.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith("/api")) {
        const options = {
          hostname: "localhost",
          port: 5000,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: "localhost:5000",
          },
        };

        const proxy = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });

        proxy.on("error", (err) => {
          console.error("[Metro API proxy error]", err.message);
          res.writeHead(502);
          res.end("Backend unavailable");
        });

        req.pipe(proxy, { end: true });
        return;
      }

      return middleware(req, res, next);
    };
  },
};

module.exports = config;
