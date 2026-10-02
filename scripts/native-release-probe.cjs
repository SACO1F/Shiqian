// Position the real Windows cursor over the named QA fixture before running.
// This exercises the native release path; it does not inject a full drag gesture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const p = b
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("floating"));
  const api = (action, payload = {}) =>
    p.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const boot = await api("bootstrap");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  const tag = await api("tag.create", { name: "原生释放验证" });
  await api("floating.drag", { tagId: tag.id });
  let files = [];
  for (let i = 0; i < 40; i++) {
    files = (await api("query", { include: [tag.id], mode: "all", limit: 100 }))
      .files;
    if (files.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(
    files.some(
      (f) =>
        path.resolve(f.path) ===
        path.join(root, "qa/fixtures/品牌视觉参考.png"),
    ),
    "Native release must resolve the exact observed fixture",
  );
  const log =
    "PASS native release resolves the real Windows Explorer file and commits its tag via SQLite.\nInitiation is via IPC after placing the physical cursor; a full cross-window drag gesture is not simulated by this test.\n";
  fs.writeFileSync(path.join(root, "qa/native-release-v020.txt"), log);
  console.log(log);
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
