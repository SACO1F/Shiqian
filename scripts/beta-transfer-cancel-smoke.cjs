const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223"),
    p = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
  const api = (action, payload = {}) =>
    p.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const boot = await api("bootstrap"),
    root = path.resolve(__dirname, ".."),
    qa = path.join(
      root,
      "qa",
      process.env.BETA_QA_DIR || "beta-transfer-cancel",
    );
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  fs.mkdirSync(qa, { recursive: true });
  const original = path.join(qa, "取消测试.bin"),
    fd = fs.openSync(original, "w"),
    buffer = Buffer.alloc(1024 * 1024, 37);
  for (let i = 0; i < 1024; i++) fs.writeSync(fd, buffer);
  fs.closeSync(fd);
  await api("import", { paths: [original] });
  for (let i = 0; i < 200; i++) {
    if ((await api("import.status"))?.done) break;
    await p.waitForTimeout(25);
  }
  const file = (await api("query", { text: "取消测试", limit: 10 })).files[0];
  assert.ok(file);
  const plan = await api("package.plan", { ids: [file.id] });
  const output = path.join(qa, "取消导出.sqtagpack");
  const pending = api("package.export", {
    ids: [file.id],
    path: output,
    fingerprint: plan.fingerprint,
  }).then(
    (v) => ({ value: v }),
    (e) => ({ error: String(e) }),
  );
  for (let i = 0; i < 200; i++) {
    const status = await api("package.status");
    if (status.busy && status.bytes > 0) break;
    await p.waitForTimeout(5);
  }
  await api("package.cancel");
  const cancelled = await pending;
  assert.ok(
    cancelled.error?.includes("TRANSFER_CANCELLED"),
    JSON.stringify(cancelled),
  );
  assert.ok(!fs.existsSync(output));
  assert.equal(fs.statSync(original).size, 1024 ** 3);
  assert.equal((await api("package.status")).busy, false);
  console.log(
    "PASS cancel actual 1GB export: no published partial package, source unchanged, busy released",
  );
  // A successful large package exercises cancellation during extraction (after full validation).
  const complete = path.join(qa, "完整资料.sqtagpack");
  await api("package.export", {
    ids: [file.id],
    path: complete,
    fingerprint: plan.fingerprint,
  });
  const preview = await api("package.inspect", { path: complete });
  const destination = path.join(qa, "接收");
  fs.mkdirSync(destination, { recursive: true });
  const before = (await api("bootstrap")).counts.all;
  const importing = api("package.import", {
    path: complete,
    destination,
    fingerprint: preview.fingerprint,
  }).then(
    (v) => ({ value: v }),
    (e) => ({ error: String(e) }),
  );
  for (let i = 0; i < 4000; i++) {
    const status = await api("package.status");
    if (
      status.busy &&
      (status.phase === "复制文件" || status.phase === "复制并导入") &&
      status.bytes > (status.phase === "复制文件" ? 0 : 1024 ** 3)
    )
      break;
    await p.waitForTimeout(5);
  }
  await api("package.cancel");
  const result = await importing;
  assert.ok(
    result.error?.includes("TRANSFER_CANCELLED"),
    JSON.stringify(result),
  );
  assert.equal((await api("bootstrap")).counts.all, before);
  assert.equal(fs.readdirSync(destination).length, 0);
  assert.ok(!fs.existsSync(path.join(boot.dataPath, "transfer-state.json")));
  assert.ok(fs.existsSync(original));
  console.log(
    "PASS cancel actual 1GB extraction: own copies cleaned, database unchanged, originals preserved",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
