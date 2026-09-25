/**
 * Запуск сайта на обычном Node.js-хостинге (без Vercel): node node-server.js
 * Отдаёт статику и подключает серверные функции из api/ по тем же адресам
 * (/api/get-upload-url, /api/submit-application). Переменные окружения те же.
 * Порт берётся из PORT (по умолчанию 3000).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 100 * 1024;

const STATIC_FILES = new Set(["/index.html", "/styles.css", "/script.js", "/config.js"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon"
};

const API = {
  "/api/get-upload-url": require("./api/get-upload-url"),
  "/api/submit-application": require("./api/submit-application")
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendFile(res, filePath, method) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const isAsset = filePath.includes(path.sep + "assets" + path.sep);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": data.length,
      "Cache-Control": isAsset ? "public, max-age=86400" : "public, max-age=0, must-revalidate"
    });
    res.end(method === "HEAD" ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    const body = JSON.stringify(obj);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
  };

  if (API[pathname]) {
    try {
      const raw = await readBody(req);
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        req.body = {};
      }
      await API[pathname](req, res);
    } catch (e) {
      console.error("Ошибка API:", e);
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  const rel = pathname === "/" ? "/index.html" : pathname;
  const isAssetPath = rel.startsWith("/assets/");
  if (!STATIC_FILES.has(rel) && !isAssetPath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const abs = path.normalize(path.join(ROOT, rel));
  const allowedDir = isAssetPath ? path.join(ROOT, "assets") + path.sep : ROOT + path.sep;
  if (!abs.startsWith(allowedDir)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  sendFile(res, abs, req.method);
});

server.listen(PORT, () => console.log("Сайт запущен: http://localhost:" + PORT));
