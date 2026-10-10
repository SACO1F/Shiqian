const { chooseSelect } = require("./select-control.cjs");
const { getSearch } = require("./search-control.cjs");
// Real Tauri WebView, real IPC and isolated QA data only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const release = `v${require("../package.json").version.replaceAll(".", "")}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => !p.url().includes("floating"));
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const checks = [];
  const pass = (text) => {
    checks.push(text);
    console.log(`PASS ${text}`);
  };
  const api = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const poll = async (fn, condition) => {
    for (let i = 0; i < 100; i++) {
      const value = await fn();
      if (condition(value)) return value;
      await pause(100);
    }
    throw Error("Condition timed out");
  };
  const boot = await api("bootstrap");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  for (const [key, value] of Object.entries({
    views: { all: "grid" },
    details: false,
    galleryColumns: 3,
    sidebarCollapsed: false,
    theme: "light",
  }))
    await api("settings.save", { key, value });
  await api("import", {
    paths: [path.join(root, "qa/gallery-fixtures")],
    recursive: true,
  });
  await poll(
    () => api("import.status"),
    (job) => job?.done,
  );
  await page.reload();
  await page.setViewportSize({ width: 1360, height: 870 });
  await page.locator(".masonry-space").waitFor();
  await poll(
    () =>
      page
        .locator(".masonry-card img")
        .evaluateAll(
          (imgs) =>
            imgs.filter((im) => im.complete && im.naturalWidth > 0).length,
        ),
    (count) => count >= 6,
  );
  await page.mouse.move(650, 30);
  await pause(350);
  assert.equal(
    await page.locator(".masonry-space").getAttribute("data-columns"),
    "3",
  );
  assert.equal(
    await page
      .locator(".masonry-card .file-subline, .masonry-card .file-kind")
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator(".gallery-caption")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
  const assertLayout = async (variety = false) => {
    await page.waitForFunction(
      () =>
        document.querySelector(".masonry-card") &&
        !document.querySelector(".masonry-card .spin"),
    );
    await pause(100);
    const rectangles = await page.locator(".masonry-card").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    if (variety)
      assert.ok(new Set(rectangles.map((r) => Math.round(r.h))).size >= 3);
    for (let i = 0; i < rectangles.length; i++)
      for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i],
          b = rectangles[j];
        assert.ok(
          a.x + a.w <= b.x + 1 ||
            b.x + b.w <= a.x + 1 ||
            a.y + a.h <= b.y + 1 ||
            b.y + b.h <= a.y + 1,
          "Masonry cards overlap",
        );
      }
  };
  await assertLayout(true);
  pass(
    "Image-first masonry keeps varied aspect ratios, hides routine metadata and has no overlapping cards",
  );
  await page.getByLabel("增加列数", { exact: true }).click();
  await poll(
    () => api("bootstrap"),
    (b) => b.settings.galleryColumns === 4,
  );
  assert.equal(
    await page.locator(".masonry-space").getAttribute("data-columns"),
    "4",
  );
  await assertLayout();
  await page.getByLabel("减少列数", { exact: true }).click();
  await poll(
    () => api("bootstrap"),
    (b) => b.settings.galleryColumns === 3,
  );
  await assertLayout();
  pass(
    "Plus/minus controls increase/decrease image columns and persist to SQLite",
  );
  await page.getByLabel("收拢左侧菜单", { exact: true }).click();
  assert.ok((await page.locator(".sidebar").boundingBox()).width < 80);
  assert.ok(
    await page
      .getByRole("button", { name: "全部文件", exact: true })
      .isVisible(),
  );
  assert.ok(
    await page
      .getByRole("button", { name: "标签浮窗", exact: true })
      .isVisible(),
  );
  await page.getByLabel("展开标签索引", { exact: true }).click();
  assert.ok((await page.locator(".sidebar").boundingBox()).width > 150);
  await page.getByLabel("收拢左侧菜单", { exact: true }).click();
  await page.getByRole("slider", { name: "瀑布流列数" }).fill("8");
  await poll(
    () => api("bootstrap"),
    (b) => b.settings.sidebarCollapsed && b.settings.galleryColumns === 8,
  );
  await page.reload();
  await page.locator(".masonry-space[data-columns='8']").waitFor();
  await assertLayout();
  assert.ok(await page.getByLabel("展开左侧菜单", { exact: true }).isVisible());
  pass(
    "Collapsed navigation stays usable; eight-column preference and collapse state survive reload",
  );
  await page.setViewportSize({ width: 960, height: 640 });
  await pause(400);
  assert.ok(
    Number(await page.locator(".masonry-space").getAttribute("data-columns")) <
      8,
  );
  assert.ok(
    await page
      .locator(".file-area")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.setViewportSize({ width: 1360, height: 870 });
  await page.locator(".masonry-space[data-columns='8']").waitFor();
  pass(
    "Narrow windows reduce effective columns without overwriting the preferred count or overflowing",
  );
  for (let i = 0; i < 5; i++) {
    await page.locator(".file-area").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await pause(500);
  }
  await poll(
    () => page.locator(".load-more").count(),
    (count) => count === 0,
  );
  assert.ok((await page.locator(".masonry-card").count()) < 100);
  for (const columns of [3, 4, 8]) {
    await page
      .getByRole("slider", { name: "瀑布流列数" })
      .fill(String(columns));
    await assertLayout();
  }
  pass("Scrolling loads the next page while keeping the gallery virtualized");
  const search = await getSearch(page);
  await search.fill("画幅-001");
  const first = page.getByRole("option", { name: "画幅-001.png", exact: true });
  await first.waitFor();
  await poll(
    () => page.locator(".masonry-card").count(),
    (count) => count === 1,
  );
  assert.ok(
    await page.locator(".file-area").evaluate((el) => el.scrollTop < 5),
  );
  await first.hover();
  await pause(180);
  assert.equal(
    await first
      .locator(".gallery-caption")
      .evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  await first.click();
  await page.getByLabel("切换详情面板", { exact: true }).click();
  assert.equal(
    await page.locator(".detail-filename").innerText(),
    "画幅-001.png",
  );
  await first.focus();
  await page.keyboard.press("Space");
  await page.locator(".quick-preview").waitFor();
  await page.keyboard.press("Space");
  assert.equal(await page.locator(".quick-preview").count(), 0);
  pass(
    "Filtering resets scroll; hover caption, selection, details and Space preview still work",
  );
  await page.getByLabel("列表视图", { exact: true }).click();
  await page.locator(".file-list").waitFor();
  assert.equal(
    await page.getByRole("slider", { name: "瀑布流列数" }).count(),
    0,
  );
  await page.getByLabel("瀑布流视图", { exact: true }).click();
  await search.fill("损坏画幅");
  await page.locator(".masonry-card .preview-error").waitFor();
  pass(
    "List view remains available; damaged images degrade safely in the gallery",
  );
  await search.fill("");
  await page.getByLabel("切换详情面板", { exact: true }).click();
  await page.getByRole("slider", { name: "瀑布流列数" }).fill("4");
  await chooseSelect(page, "文件排序", "文件大小");
  await page.mouse.move(650, 30);
  await pause(900);
  await page.screenshot({
    path: path.join(root, `qa/gallery-${release}-light.png`),
  });
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await pause(350);
  await page.screenshot({
    path: path.join(root, `qa/gallery-${release}-dark.png`),
  });
  assert.deepEqual(errors, []);
  pass("Light and dark gallery renders have no frontend exceptions");
  fs.writeFileSync(
    path.join(root, `qa/gallery-results-${release}.json`),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
