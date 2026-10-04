// Run against an isolated QA WebView, never a personal library.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const baseline = process.argv.includes("--baseline");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => !p.url().includes("floating"));
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const api = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
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
    paths: Array.from({ length: 7 }, (_, i) =>
      path.join(
        root,
        "qa/gallery-fixtures",
        `画幅-${String(i + 1).padStart(3, "0")}.png`,
      ),
    ),
    recursive: false,
  });
  for (let i = 0; i < 100; i++) {
    if ((await api("import.status"))?.done) break;
    await pause(100);
  }
  await page.setViewportSize({ width: 1360, height: 870 });
  await page.reload();
  await page.locator(".masonry-space").waitFor();
  // Filtering also permits reruns after the larger gallery suite has populated this QA library.
  await page.getByLabel("搜索文件", { exact: true }).fill("画幅-00");
  const snapshots = [];
  const inspect = async (label) => {
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll(".masonry-card")];
      return (
        cards.length >= 2 &&
        cards.every((card) => {
          const image = card.querySelector("img");
          return image?.complete && image.naturalWidth > 0;
        })
      );
    });
    // Sample several painted frames; do not only check the first layout on mount.
    await pause(200);
    const result = await page.evaluate(async () => {
      const frames = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame);
        const space = document
          .querySelector(".masonry-space")
          .getBoundingClientRect();
        const cards = [...document.querySelectorAll(".masonry-card")].map(
          (el) => {
            const r = el.getBoundingClientRect();
            return {
              id: el.dataset.fileId,
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
            };
          },
        );
        const overlaps = [];
        for (let i = 0; i < cards.length; i++)
          for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i],
              b = cards[j];
            if (
              a.x + a.w > b.x + 1 &&
              b.x + b.w > a.x + 1 &&
              a.y + a.h > b.y + 1 &&
              b.y + b.h > a.y + 1
            )
              overlaps.push([i, j]);
          }
        frames.push({
          overlaps,
          overflow: Math.max(...cards.map((r) => r.y + r.h)) - space.bottom,
        });
      }
      return {
        columns: Number(
          document.querySelector(".masonry-space").dataset.columns,
        ),
        frames,
      };
    });
    const passed = result.frames.every(
      (frame) => !frame.overlaps.length && frame.overflow < 2,
    );
    snapshots.push({ label, passed, ...result });
    console.log(
      `${passed ? "PASS" : "FAIL"} ${label} (${result.columns} columns)`,
    );
    if (!passed && !snapshots.some((s) => s !== snapshots.at(-1) && !s.passed))
      await page.screenshot({
        path: path.join(
          root,
          `qa/layout-${baseline ? "baseline" : "failure"}.png`,
        ),
      });
  };
  await inspect("Initial loaded images");
  const slider = page.getByRole("slider", { name: "瀑布流列数" });
  for (const columns of [2, 3, 4, 3, 2, 4, 6, 3, 4, 2, 3, 4]) {
    await slider.fill(String(columns));
    await inspect(`Switch to ${columns}`);
  }
  for (const columns of [3, 4, 2, 5, 3, 4]) await slider.fill(String(columns));
  await inspect("Rapid consecutive column changes");
  if (!baseline) {
    await page.getByLabel("增加列数", { exact: true }).click();
    assert.equal(await slider.inputValue(), "5");
    await inspect("Plus increases columns");
    await page.getByLabel("减少列数", { exact: true }).click();
    assert.equal(await slider.inputValue(), "4");
    await inspect("Minus decreases columns");
    await slider.fill("2");
    assert.ok(await page.getByLabel("减少列数", { exact: true }).isDisabled());
    await slider.fill(await slider.getAttribute("max"));
    assert.ok(await page.getByLabel("增加列数", { exact: true }).isDisabled());
    await slider.fill("4");
  }
  await page.getByLabel("收拢左侧菜单", { exact: true }).click();
  await inspect("Collapse sidebar");
  await page.getByLabel("展开左侧菜单", { exact: true }).click();
  await inspect("Expand sidebar");
  for (const width of [1190, 960, 1920, 1360]) {
    await page.setViewportSize({ width, height: 870 });
    await inspect(`Resize to ${width}px`);
  }
  await page.locator(".masonry-card").first().click();
  await page.getByLabel("切换详情面板", { exact: true }).click();
  await inspect("Open details");
  await page.getByLabel("切换详情面板", { exact: true }).click();
  await inspect("Close details");
  await page.getByLabel("列表视图", { exact: true }).click();
  await page.getByLabel("瀑布流视图", { exact: true }).click();
  await inspect("Return from list view with cached images");
  await page.reload();
  await page.locator(".masonry-space[data-columns='4']").waitFor();
  await page.getByLabel("搜索文件", { exact: true }).fill("画幅-00");
  await inspect("Reload saved four-column layout");
  await page.mouse.move(650, 30);
  await page.screenshot({
    path: path.join(
      root,
      `qa/layout-${baseline ? "baseline-final" : "fixed"}.png`,
    ),
  });
  if (!baseline) {
    await api("import", {
      paths: [path.join(root, "qa/layout-fixtures")],
      recursive: false,
    });
    for (let i = 0; i < 100; i++) {
      if ((await api("import.status"))?.done) break;
      await pause(100);
    }
    await page.getByLabel("搜索文件", { exact: true }).fill("布局-");
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll(".masonry-card")];
      return (
        cards.length > 0 &&
        cards.every((card) =>
          card.getAttribute("aria-label").startsWith("布局-"),
        )
      );
    });
    for (const columns of [2, 3, 4, 6, 3, 4]) {
      await slider.fill(String(columns));
      await inspect(`Extreme portrait and panorama at ${columns} columns`);
    }
    await page.locator(".file-area").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await slider.fill("3");
    await inspect("Change columns while scrolled down");
    await page.setViewportSize({ width: 1190, height: 870 });
    await inspect("Change width while scrolled down");
    await page.locator(".file-area").evaluate((el) => {
      el.scrollTop = 0;
    });
    await slider.fill("4");
    await inspect("Return to top after scrolled geometry changes");
    await page.screenshot({
      path: path.join(root, "qa/layout-extreme-v022.png"),
    });
  }
  const report = { baseline, snapshots, errors };
  fs.writeFileSync(
    path.join(root, `qa/gallery-layout-${baseline ? "baseline" : "v022"}.json`),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  assert.deepEqual(errors, []);
  assert.ok(
    snapshots.every((s) => s.passed),
    `${snapshots.filter((s) => !s.passed).length} layout scenarios failed`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
