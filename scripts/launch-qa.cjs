const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = path.join(root, "qa");
const port = Number(process.env.SHIQIAN_CDP_PORT || "9223");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid QA CDP port");
const dataDirectory = path.resolve(process.env.SHIQIAN_QA_DATA_DIR || path.join(qa, "data"));
if (!dataDirectory.startsWith(qa + path.sep)) throw Error("QA data must stay inside the project's qa directory");
const runDirectory = port === 9223 ? qa : path.dirname(dataDirectory);
fs.mkdirSync(path.join(runDirectory, "tmp"), { recursive: true });
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "src-tauri/target/debug/shiqian.exe");
const env = {
  ...process.env,
  SHIQIAN_DATA_DIR: dataDirectory,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    process.env.SHIQIAN_QA_BROWSER_ARGS || `--remote-debugging-port=${port}`,
  TEMP: path.join(runDirectory, "tmp"),
  TMP: path.join(runDirectory, "tmp"),
};
const child = spawn(executable, [], {
  cwd: root,
  env,
  detached: true,
  windowsHide: true,
  stdio: [
    "ignore",
    fs.openSync(path.join(runDirectory, "app-out.log"), "w"),
    fs.openSync(path.join(runDirectory, "app-error.log"), "w"),
  ],
});
fs.writeFileSync(path.join(runDirectory, "app-pid.txt"), String(child.pid));
console.log(`Started QA instance: ${child.pid}`);
child.unref();
(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        console.log("QA WebView is ready");
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(
    `QA WebView did not expose CDP on port ${port}; inspect ${runDirectory}/app-error.log`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
