const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.resolve(__dirname, "..");
const candidates = [path.join(root, "client", "dist"), path.join(root, "dist")];
const dist = candidates.find((dir) => fs.existsSync(path.join(dir, "index.html")));
const port = Number(process.env.WEB_PORT || 5173);
const apiTarget = new URL(process.env.API_TARGET || "http://localhost:3001");

if (!dist) {
  console.error("Cannot find built frontend. Run `npm.cmd run build` first.");
  process.exit(1);
}

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/uploads/")) {
    const proxyReq = http.request(
      {
        hostname: apiTarget.hostname,
        port: apiTarget.port || 80,
        path: req.url,
        method: req.method,
        headers: req.headers
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ message: "API 服务未连接，请确认后端 3001 已启动" }));
    });
    req.pipe(proxyReq);
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  const requested = path.normalize(urlPath).replace(/^([/\\])+/, "");
  const fullPath = path.join(dist, requested || "index.html");
  const safePath = fullPath.startsWith(dist) ? fullPath : path.join(dist, "index.html");
  const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
    ? safePath
    : path.join(dist, "index.html");
  const ext = path.extname(filePath).toLowerCase();

  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Frontend running at http://localhost:${port}/`);
});
