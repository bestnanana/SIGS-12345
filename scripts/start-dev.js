const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const logDir = path.join(root, "logs");
fs.mkdirSync(logDir, { recursive: true });

function start(name, command, args) {
  const out = fs.openSync(path.join(logDir, `${name}.log`), "a");
  const err = fs.openSync(path.join(logDir, `${name}.err.log`), "a");
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    shell: false,
    stdio: ["ignore", out, err],
    windowsHide: true
  });
  child.unref();
  console.log(`${name} started: ${child.pid}`);
}

start("api", process.execPath, ["server/index.js"]);
start("web", process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "--configLoader",
  "native",
  "--host",
  "0.0.0.0",
  "--port",
  "5173"
]);
