const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
process.env.TEMP = path.join(root, "qa/tmp");
process.env.TMP = process.env.TEMP;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { DatabaseSync } = require("node:sqlite");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => !p.url().includes("floating"));
  await page.reload();
  const boot = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("api", { action: "bootstrap" }),
  );
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  await page.getByLabel("搜索文件", { exact: true }).fill("品牌视觉参考");
  const details = page.getByLabel("切换详情面板", { exact: true });
  if ((await details.getAttribute("aria-pressed")) === "false")
    await details.click();
  await page
    .getByRole("option", { name: "品牌视觉参考.png", exact: true })
    .click();
  const text = `关闭窗口前写入：下次打开后仍能找回这段备注。${new Date().toISOString()}`;
  await page.getByLabel("备注", { exact: true }).fill(text);
  const closed = page.waitForEvent("close", { timeout: 15000 });
  await page
    .evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("plugin:window|close", {
        label: "main",
      }),
    )
    .catch(() => {});
  await closed;
  // WebView destruction precedes process shutdown. Wait until the app releases
  // its WAL connection before opening an independent read-only SQLite handle.
  const appPid = Number(
    fs.readFileSync(path.join(root, "qa/app-pid.txt"), "utf8"),
  );
  let exited = false;
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(appPid, 0);
    } catch {
      exited = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(
    exited,
    "Application process must exit before independent persistence verification",
  );
  let saved;
  for (let i = 0; i < 50; i++) {
    let db;
    try {
      db = new DatabaseSync(path.join(boot.dataPath, "library.sqlite"), {
        readOnly: true,
      });
      saved = db
        .prepare("SELECT note FROM files WHERE name=? AND removed_at IS NULL")
        .get("品牌视觉参考.png");
      break;
    } catch (error) {
      if (error.errcode !== 1546 || i === 49) throw error;
    } finally {
      db?.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(saved.note, text);
  fs.writeFileSync(
    path.join(root, "qa/desktop-close-result.txt"),
    "PASS Native window close flushes an edit made less than 500ms earlier into SQLite.\n",
  );
  console.log(
    "PASS Native window close flushes an edit made less than 500ms earlier into SQLite.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
