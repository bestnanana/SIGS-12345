const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const logDir = path.join(root, "logs");
fs.mkdirSync(logDir, { recursive: true });

function start(name, args) {
  const out = fs.openSync(path.join(logDir, `${name}.log`), "a");
  const err = fs.openSync(path.join(logDir, `${name}.err.log`), "a");
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true
  });
  child.unref();
  console.log(`${name} started: ${child.pid}`);
}

start("api", ["server/index.js"]);
start("web-static", ["scripts/static-server.js"]);
