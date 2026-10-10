// Real WebView pointer gestures and persistent preferences in an isolated library.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const api = (action, payload = {}) =>
      page.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    assert.ok(
      path
        .resolve((await api("bootstrap")).dataPath)
        .startsWith(path.join(root, "qa") + path.sep),
    );
    for (const [key, value] of Object.entries({
      sidebarWidth: 216,
      sidebarCollapsed: false,
      details: false,
      theme: "light",
      views: { all: "grid" },
    }))
      await api("settings.save", { key, value });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.reload();
    const intro = page.getByRole("dialog", { name: "启用 AI 自动标注？", exact: true });
    if (await intro.count()) await intro.getByRole("button", { name: "暂不设置", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "快速上手拾签", exact: true });
    if (await guide.count()) await guide.getByRole("button", { name: "开始使用", exact: true }).click();
    const handle = page.getByRole("separator", { name: "调整左侧菜单宽度" });
    await handle.waitFor();
    const width = () =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().width);
    const move = async (delta, release = true) => {
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 140);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + 140, {
        steps: 12,
      });
      if (release) await page.mouse.up();
    };
    const saved = (value, collapsed = false) =>
      page.waitForFunction(
        async ({ value, collapsed }) => {
          const boot = await window.__TAURI_INTERNALS__.invoke("api", {
            action: "bootstrap",
          });
          return (
            boot.settings.sidebarWidth === value &&
            boot.settings.sidebarCollapsed === collapsed
          );
        },
        { value, collapsed },
      );
    const settled = (value) =>
      page.waitForFunction(
        (value) =>
          Math.abs(
            (document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0) -
              value,
          ) < 1,
        value,
      );
    await move(80);
    await saved(296);
    await settled(296);
    await page.reload();
    await settled(296);
    console.log(
      "PASS pointer width adjustment and persisted width after reload",
    );
    await move(-170);
    await settled(68);
    assert.equal(
      await page
        .getByRole("button", { name: "展开左侧菜单", exact: true })
        .count(),
      1,
    );
    const remembered = (await api("bootstrap")).settings.sidebarWidth;
    assert.ok(remembered >= 180 && remembered <= 296);
    await page
      .getByRole("button", { name: "展开左侧菜单", exact: true })
      .click();
    await settled(remembered);
    const motion = await page
      .locator(".sidebar")
      .evaluate((el) => ({
        duration: getComputedStyle(el).transitionDuration,
        easing: getComputedStyle(el).transitionTimingFunction,
      }));
    assert.ok(
      motion.duration.includes("0.26s") &&
        motion.easing.includes("cubic-bezier"),
    );
    console.log(
      "PASS below-threshold auto collapse, eased expansion and remembered width",
    );
    await page
      .getByRole("button", { name: "收拢左侧菜单", exact: true })
      .click();
    await settled(68);
    await move(170);
    await settled(238);
    await saved(238);
    await move(300);
    await settled(360);
    await saved(360);
    await move(-90, false);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await settled(360);
    await saved(360);
    console.log(
      "PASS drag-to-expand, maximum width and Escape restores uncommitted drag",
    );
    await handle.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await handle.focus();
    const originalRing = await handle.evaluate(el => {
      for (const sheet of document.styleSheets) {
        for (let i = 0; i < sheet.cssRules.length; i++) {
          const rule = sheet.cssRules[i];
          if (rule.selectorText !== ".app-shell .sidebar-resize-handle:focus-visible") continue;
          const text = rule.cssText;
          sheet.deleteRule(i);
          const original = getComputedStyle(el).outlineWidth;
          sheet.insertRule(text, i);
          return original;
        }
      }
      throw Error("Missing separator focus override");
    });
    assert.equal(originalRing, "2px");
    console.log("PASS original CSS cascade reproduces the 2px rectangular focus ring");
    const focusStyle = await handle.evaluate(el => ({
      outline: getComputedStyle(el).outlineStyle,
      rail: getComputedStyle(el, "::after").backgroundColor,
    }));
    assert.equal(focusStyle.outline, "none");
    assert.notEqual(focusStyle.rail, "rgba(0, 0, 0, 0)");
    console.log("PASS keyboard-visible focus uses the resize rail, without rectangular green outline");
    await page.keyboard.press("Home");
    await settled(68);
    await page.keyboard.press("ArrowRight");
    await settled(360);
    await page.keyboard.press("ArrowLeft");
    await settled(336);
    await saved(336);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".sidebar")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(300);
    console.log(
      "PASS keyboard separator controls and reduced-motion preference",
    );
    const out = path.join(root, "qa/sidebar-ai");
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, "sidebar-wide.png") });
    await page.setViewportSize({ width: 960, height: 700 });
    await move(-145);
    await settled(191);
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: path.join(out, "sidebar-narrow.png") });
    const geometry = await page.locator(".file-card").evaluateAll((els) => {
      const boxes = els.map((el) => el.getBoundingClientRect());
      return boxes.every((a, i) =>
        boxes.every(
          (b, j) =>
            i === j ||
            Math.min(a.right, b.right) - Math.max(a.left, b.left) < 1 ||
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 1,
        ),
      );
    });
    assert.ok(geometry);
    assert.deepEqual(errors, []);
    console.log(
      "PASS narrow viewport without page overflow, overlapping cards or uncaught UI errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
