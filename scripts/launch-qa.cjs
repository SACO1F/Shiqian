const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = path.join(root, "qa");
fs.mkdirSync(path.join(qa, "tmp"), { recursive: true });
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "src-tauri/target/debug/shiqian.exe");
const env = {
  ...process.env,
  SHIQIAN_DATA_DIR: process.env.SHIQIAN_QA_DATA_DIR || path.join(qa, "data"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    process.env.SHIQIAN_QA_BROWSER_ARGS || "--remote-debugging-port=9223",
  TEMP: path.join(qa, "tmp"),
  TMP: path.join(qa, "tmp"),
};
const child = spawn(executable, [], {
  cwd: root,
  env,
  detached: true,
  windowsHide: true,
  stdio: [
    "ignore",
    fs.openSync(path.join(qa, "app-out.log"), "w"),
    fs.openSync(path.join(qa, "app-error.log"), "w"),
  ],
});
fs.writeFileSync(path.join(qa, "app-pid.txt"), String(child.pid));
console.log(`Started QA instance: ${child.pid}`);
child.unref();
(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9223/json/version");
      if (response.ok) {
        console.log("QA WebView is ready");
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(
    "QA WebView did not expose CDP on port 9223; inspect qa/app-error.log",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
