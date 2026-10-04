// Runs against our isolated, real Tauri WebView over CDP. No mocked IPC or files.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = process.env.PLAYWRIGHT_MODULE || "playwright";
const root = path.resolve(__dirname, "..");
process.env.TEMP = path.join(root, "qa/tmp");
process.env.TMP = process.env.TEMP;
const { chromium } = require(runtime);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const checks = [];
  const api = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const pass = (name) => {
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  const poll = async (fn, predicate) => {
    for (let i = 0; i < 80; i++) {
      const result = await fn();
      if (predicate(result)) return result;
      await sleep(100);
    }
    throw Error("Timed out waiting for backend state");
  };
  const query = {
    scope: "all",
    text: "",
    include: [],
    exclude: [],
    mode: "all",
    kinds: [],
    status: "",
    directory: "",
    recursive: true,
    sort: "name",
    direction: "asc",
    offset: 0,
    limit: 100,
  };
  const fixtures = path.join(root, "qa/fixtures");
  const boot = await api("bootstrap");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
    "Refusing to run destructive fixture reset outside QA",
  );
  for (const f of (await api("query", query)).files) {
    await api("note.save", { id: f.id, text: "", version: f.noteVersion });
    await api("files.favorite", {
      ids: [f.id],
      versions: { [f.id]: f.version },
      value: false,
    });
  }
  for (const tag of (await api("bootstrap")).tags)
    await api("tags.delete", { id: tag.id, version: tag.version });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".app-shell").waitFor();
  await api("import", { paths: [fixtures], recursive: true });
  let job = await poll(
    () => api("import.status"),
    (j) => j?.done,
  );
  assert.equal(job.failed, 0);
  assert.equal(job.added + job.existing, 9);
  pass("Recursive import reaches the real SQLite library");
  await page.getByLabel("刷新文件状态").click();
  await page
    .getByRole("option", { name: "品牌视觉参考.png", exact: true })
    .waitFor();
  let files = (await api("query", query)).files;
  const image = files.find((f) => f.name === "品牌视觉参考.png"),
    pdf = files.find((f) => f.kind === "pdf"),
    text = files.find((f) => f.name === "项目需求说明.md");
  await page.getByRole("option", { name: image.name, exact: true }).click();
  await page.getByLabel("添加标签", { exact: true }).fill("品牌升级");
  await page.getByLabel("添加标签", { exact: true }).press("Enter");
  await poll(
    () => api("file", { id: image.id }),
    (f) => f.tags.some((t) => t.name === "品牌升级"),
  );
  pass("Create and attach a tag through the inspector");
  await page.getByLabel("添加标签", { exact: true }).fill("待确认");
  await page.getByLabel("添加标签", { exact: true }).press("Enter");
  await poll(
    () => api("file", { id: image.id }),
    (f) => f.tags.length === 2,
  );
  pass("Multiple tags persist on one file");
  const note = "这是一份首版验证备注。保留绿色主视觉，下一轮确认版式。";
  await page.getByLabel("备注", { exact: true }).fill(note);
  await poll(
    () => api("file", { id: image.id }),
    (f) => f.note === note,
  );
  await sleep(200);
  assert.equal(
    await page.getByLabel("备注", { exact: true }).inputValue(),
    note,
  );
  pass("Autosave keeps the new note visible after acknowledgement");
  await page.getByRole("option", { name: text.name, exact: true }).click();
  assert.equal(await page.getByLabel("备注", { exact: true }).inputValue(), "");
  await page.getByRole("option", { name: image.name, exact: true }).click();
  assert.equal(
    await page.getByLabel("备注", { exact: true }).inputValue(),
    note,
  );
  pass("Switching files does not lose or mix notes");
  await page
    .getByRole("option", { name: pdf.name, exact: true })
    .click({ modifiers: ["Control"] });
  await page.getByLabel("添加标签", { exact: true }).fill("品牌升级");
  await page.getByLabel("添加标签", { exact: true }).press("Enter");
  await poll(
    () => api("file", { id: pdf.id }),
    (f) => f.tags.length === 1,
  );
  pass("Batch tag addition applies to the selected files");
  await page.getByLabel("撤销上一步").click();
  await poll(
    () => api("file", { id: pdf.id }),
    (f) => f.tags.length === 0,
  );
  assert.equal((await api("file", { id: image.id })).tags.length, 2);
  pass("Undo preserves tag associations that predated the batch");
  await page.getByLabel("搜索文件", { exact: true }).fill("绿色主视觉");
  await poll(
    () => page.locator(".file-card").count(),
    (n) => n === 1,
  );
  assert.equal(
    await page.locator(".file-card").getAttribute("aria-label"),
    image.name,
  );
  pass("Search finds a file by its saved note");
  await page.getByLabel("搜索文件", { exact: true }).fill("no-such-file-83721");
  await poll(
    () => page.locator(".file-card").count(),
    (n) => n === 0,
  );
  pass("A later search replaces earlier results");
  await page.getByRole("button", { name: "清除筛选条件", exact: true }).click();
  await page.getByRole("option", { name: image.name, exact: true }).waitFor();
  await page.getByRole("option", { name: pdf.name, exact: true }).click();
  await page.getByLabel("放大预览").click();
  await page.locator(".quick-preview img").waitFor();
  assert.ok(
    await page
      .locator(".quick-preview img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(root, "qa/pdf-preview.png") });
  await page.getByLabel("关闭对话框").click();
  pass("PDF first-page preview renders using bundled PDF.js");
  await page.getByRole("option", { name: text.name, exact: true }).click();
  await page.getByLabel("放大预览").click();
  assert.ok(
    (await page.locator(".quick-preview").innerText()).includes("<script>"),
  );
  assert.equal(await page.locator(".quick-preview script").count(), 0);
  await page.getByLabel("关闭对话框").click();
  pass("Text preview displays markup as plain text");
  await page.getByRole("option", { name: "损坏图片.png", exact: true }).click();
  await page.getByLabel("放大预览").click();
  await page.locator(".quick-preview .preview-error").waitFor();
  await page.getByLabel("关闭对话框").click();
  pass("Damaged image degrades without crashing");
  await page.getByRole("option", { name: image.name, exact: true }).click();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await poll(
    () => api("file", { id: image.id }),
    (f) => f.favorite,
  );
  pass("Favorite action persists");
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await page.getByRole("button", { name: "移除记录", exact: true }).click();
  await poll(
    () => api("query", query),
    (r) => r.total === 8,
  );
  assert.ok(fs.existsSync(image.path));
  await page.getByLabel("撤销上一步").click();
  await poll(
    () => api("query", query),
    (r) => r.total === 9,
  );
  pass("Soft removal and undo retain the original file");
  const backup = path.join(root, "qa/ui-roundtrip.sqtagbackup");
  await api("backup.export", { path: backup });
  assert.equal((await api("backup.inspect", { path: backup })).fileCount, 9);
  let f = await api("file", { id: image.id });
  await api("note.save", {
    id: f.id,
    text: "changed after backup",
    version: f.noteVersion,
  });
  const restored = await api("backup.restore", { path: backup });
  assert.equal((await api("file", { id: image.id })).note, note);
  assert.ok(fs.existsSync(restored.recoveryBackup));
  pass("Real IPC backup, verification and restore preserve annotations");
  await page.reload();
  await page.getByRole("option", { name: image.name, exact: true }).waitFor();
  await page.getByRole("option", { name: image.name, exact: true }).click();
  assert.equal(
    await page.getByLabel("备注", { exact: true }).inputValue(),
    note,
  );
  pass("Reload reads persisted database content");
  await page.getByLabel("列表视图").click();
  await page.locator(".file-list").first().waitFor();
  pass("List view renders real files");
  await page.getByLabel("瀑布流视图").click();
  await page.locator(".file-card:not(.file-list)").first().waitFor();
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByLabel("关闭对话框").click();
  await page.screenshot({ path: path.join(root, "qa/desktop-dark.png") });
  pass("Theme switching works");
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByLabel("关闭对话框").click();
  await sleep(500);
  await page.screenshot({ path: path.join(root, "qa/desktop-light.png") });
  assert.deepEqual(errors, []);
  pass("No uncaught frontend errors");
  fs.writeFileSync(
    path.join(root, "qa/desktop-smoke-results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
