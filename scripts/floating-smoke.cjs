// Real Tauri windows + IPC + SQLite. Synthetic Tauri events verify drop routing;
// physical Windows drag gestures are a separate manual/native verification.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
process.env.TEMP = process.env.TMP = path.join(root, "qa/tmp");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts()[0];
  const main = context.pages().find((p) => !p.url().includes("floating"));
  const invoke = (page, action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const boot = await invoke(main, "bootstrap");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  assert.equal(boot.version, "0.2.0");
  const checks = [];
  const pass = (s) => {
    checks.push(s);
    console.log("PASS " + s);
  };
  const poll = async (fn, test) => {
    for (let i = 0; i < 80; i++) {
      const v = await fn();
      if (test(v)) return v;
      await sleep(100);
    }
    throw Error("Poll timeout");
  };
  await main.getByRole("button", { name: "标签浮窗 拖拽标注" }).click();
  const palette = await poll(
    () => context.pages().find((p) => p.url().includes("floating")),
    Boolean,
  );
  await palette.locator(".palette-chips").waitFor();
  let p = await invoke(palette, "floating.presets");
  assert.equal(p.ids.length, 4);
  pass("Separate floating window opens with four built-in presets");
  await palette.getByLabel("管理预设标签").click();
  await palette.getByLabel("新建预设标签").fill("浮窗测试预设");
  await palette.getByLabel("创建并固定标签").click();
  p = await poll(
    () => invoke(palette, "floating.presets"),
    (p) => p.tags.some((t) => t.name === "浮窗测试预设"),
  );
  const tag = p.tags.find((t) => t.name === "浮窗测试预设");
  await poll(
    () => invoke(palette, "floating.presets"),
    (p) => p.ids.includes(tag.id),
  );
  await palette.getByLabel("返回标签面板").click();
  await palette
    .getByRole("button", { name: "标签：浮窗测试预设", exact: true })
    .waitFor();
  pass("Create and pin a custom tag through palette UI");
  await palette.reload();
  await palette
    .getByRole("button", { name: "标签：浮窗测试预设", exact: true })
    .waitFor();
  pass("Custom presets survive WebView reload");
  const fixture = path.join(root, "qa/浮窗自动加入.png");
  fs.copyFileSync(path.join(root, "qa/fixtures/品牌视觉参考.png"), fixture);
  const chip = palette.getByRole("button", {
    name: "标签：浮窗测试预设",
    exact: true,
  });
  const box = await chip.boundingBox();
  const pos = await palette.evaluate(
    ({ x, y }) => ({ x: x * devicePixelRatio, y: y * devicePixelRatio }),
    { x: box.x + 10, y: box.y + 10 },
  );
  await palette.evaluate(
    ({ paths, position }) =>
      window.__TAURI_INTERNALS__.invoke("plugin:event|emit_to", {
        target: { kind: "AnyLabel", label: "floating" },
        event: "tauri://drag-drop",
        payload: { paths, position },
      }),
    { paths: [fixture], position: pos },
  );
  await palette
    .getByRole("status")
    .filter({ hasText: "浮窗自动加入.png" })
    .waitFor();
  const result = await invoke(main, "query", {
    text: "浮窗自动加入",
    limit: 100,
  });
  assert.equal(result.total, 1);
  const file = result.files[0];
  assert.ok(file.tags.some((t) => t.id === tag.id));
  pass(
    "File-drop event routes to exact preset; real backend imports and annotates",
  );
  const before = file.version;
  const duplicate = await invoke(palette, "annotation.apply", {
    tagId: tag.id,
    paths: [fixture],
  });
  assert.equal(duplicate.applied, 0);
  assert.equal((await invoke(main, "file", { id: file.id })).version, before);
  pass(
    "Repeated annotation does not duplicate labels or increment file version",
  );
  await palette.getByLabel("撤销上一步标注操作").click();
  await poll(
    () => invoke(main, "file", { id: file.id }),
    (f) => !f.tags.some((t) => t.id === tag.id),
  );
  assert.ok(fs.existsSync(fixture));
  pass("Undo removes new association and preserves original file");
  await invoke(main, "annotation.apply", { tagId: tag.id, ids: [file.id] });
  await palette.getByLabel("管理预设标签").click();
  await palette
    .getByRole("button", { name: "浮窗测试预设", exact: true })
    .click();
  await poll(
    () => invoke(palette, "floating.presets"),
    (p) => !p.ids.includes(tag.id),
  );
  assert.ok(
    (await invoke(main, "file", { id: file.id })).tags.some(
      (t) => t.id === tag.id,
    ),
  );
  pass("Unpinning leaves existing file annotations intact");
  await palette
    .getByRole("button", { name: "浮窗测试预设", exact: true })
    .click();
  await palette.getByLabel("返回标签面板").click();
  await palette.getByLabel("收起标签浮窗").click();
  await palette.waitForFunction(() => innerHeight === 64);
  await palette.getByLabel("展开标签浮窗").click();
  await palette.waitForFunction(() => innerHeight === 460);
  pass("Collapse and expand resize the native floating window");
  await main.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }),
  );
  await poll(
    () =>
      main.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
          label: "main",
        }),
      ),
    (v) => v === false,
  );
  assert.ok(!main.isClosed());
  await palette.getByLabel("打开工作台").click();
  await poll(
    () =>
      main.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
          label: "main",
        }),
      ),
    Boolean,
  );
  pass("Closing workspace leaves palette usable; palette reopens workspace");
  for (const theme of ["light", "dark"]) {
    await invoke(main, "settings.save", { key: "theme", value: theme });
    await palette.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme,
    );
    assert.equal(
      await palette.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await palette.screenshot({
      path: path.join(root, `qa/floating-${theme}.png`),
    });
  }
  pass("Theme changes synchronize across windows with no horizontal overflow");
  await invoke(main, "settings.save", { key: "theme", value: "light" });
  fs.writeFileSync(
    path.join(root, "qa/floating-smoke-results.json"),
    JSON.stringify({ checks }, null, 2),
  );
  await browser.close();
  console.log(`${checks.length} floating checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
