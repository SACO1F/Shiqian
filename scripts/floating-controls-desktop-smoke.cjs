// Real Tauri native window state, geometry, theme and UI hit testing.
// Native edge dragging is exposed but full Windows physical mouse gestures are
// separate manual verification; resizing here uses the same native size setter.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => !p.url().includes("floating"));
    main.setDefaultTimeout(12000);
    const errors = [];
    main.on("pageerror", (e) => errors.push(String(e)));
    const invoke = (page, action, payload = {}) =>
      page.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const plugin = (page, cmd, args) =>
      page.evaluate(
        ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
        { cmd, args },
      );
    const api = (action, payload) => invoke(main, action, payload);
    assert.ok(
      path
        .resolve((await api("bootstrap")).dataPath)
        .startsWith(path.join(root, "qa") + path.sep),
    );
    await api("floating.open");
    let palette;
    const findPalette = async () => {
      for (let i = 0; i < 80; i++) {
        const found = ctx
          .pages()
          .find((p) => !p.isClosed() && p.url().includes("floating"));
        if (found) {
          found.setDefaultTimeout(12000);
          await found.locator(".palette-tag").first().waitFor();
          found.on("pageerror", (e) => errors.push(String(e)));
          return found;
        }
        await main.waitForTimeout(50);
      }
      throw Error("No floating WebView");
    };
    palette = await findPalette();
    const wait = async (read, accept, label) => {
      for (let i = 0; i < 100; i++) {
        const result = await read();
        if (accept(result)) return result;
        await main.waitForTimeout(50);
      }
      throw Error("Timed out: " + label);
    };
    const size = async (width, height) => {
      await plugin(palette, "plugin:window|set_size", {
        label: "floating",
        value: { Logical: { width, height } },
      });
      await wait(
        () => api("floating.state"),
        (s) => Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1,
        "native size",
      );
      await palette.waitForFunction(
        ({ width, height }) =>
          Math.abs(innerWidth - width) < 1 &&
          Math.abs(innerHeight - height) < 1,
        { width, height },
      );
    };
    const saved = (width, height) =>
      wait(
        () => api("bootstrap"),
        (b) =>
          b.settings.floatingSize?.width === width &&
          b.settings.floatingSize?.height === height,
        "saved native size",
      );
    const nativeTheme = (label) =>
      plugin(main, "plugin:window|theme", { label });
    const selectTheme = async (theme) => {
      await main.getByRole("button", { name: "偏好设置", exact: true }).click();
      const dialog = main.getByRole("dialog", { name: "偏好设置" });
      await dialog
        .getByRole("button", {
          name: { dark: "深色", light: "浅色", system: "跟随系统" }[theme],
          exact: true,
        })
        .click();
      await main.getByLabel("关闭对话框", { exact: true }).click();
    };
    await selectTheme("dark");
    await wait(
      () => nativeTheme("main"),
      (t) => t === "dark",
      "dark Windows title bar",
    );
    await wait(
      () => nativeTheme("floating"),
      (t) => t === "dark",
      "dark native palette",
    );
    await palette.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    const topbar = await main
      .locator(".topbar")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(!topbar.startsWith("rgb(255") && !topbar.startsWith("rgba(255"));
    console.log(
      "PASS dark workspace and floating theme synchronize with native Windows title bar",
    );
    if ((await api("floating.state")).alwaysOnTop)
      await palette.getByLabel("取消置顶", { exact: true }).click();
    await wait(
      () => api("floating.state"),
      (s) => !s.alwaysOnTop,
      "disable topmost",
    );
    assert.equal((await api("bootstrap")).settings.floatingAlwaysOnTop, false);
    await palette.getByLabel("置顶浮窗", { exact: true }).click();
    assert.equal((await api("floating.state")).alwaysOnTop, true);
    await palette.getByLabel("取消置顶", { exact: true }).click();
    await palette.reload();
    await palette.getByLabel("置顶浮窗", { exact: true }).waitFor();
    assert.equal((await api("floating.state")).alwaysOnTop, false);
    console.log(
      "PASS pin/unpin controls change actual native topmost state and survive WebView reload",
    );
    await size(500, 560);
    await saved(500, 560);
    assert.equal((await api("floating.state")).resizable, true);
    assert.equal(await palette.locator(".float-resize").count(), 8);
    const columns = await palette
      .locator(".palette-chips")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
    assert.equal(columns, 3);
    const corner = palette.getByRole("button", {
      name: "调整标签浮窗大小",
      exact: true,
    });
    await corner.focus();
    await palette.keyboard.press("ArrowRight");
    await wait(
      () => api("floating.state"),
      (s) => s.width === 516,
      "keyboard width",
    );
    await palette.keyboard.press("ArrowDown");
    await wait(
      () => api("floating.state"),
      (s) => s.height === 576,
      "keyboard height",
    );
    await saved(516, 576);
    await palette.getByLabel("收起标签浮窗", { exact: true }).click();
    await wait(
      () => api("floating.state"),
      (s) => s.height === 64 && !s.resizable,
      "collapse",
    );
    await palette.reload();
    await palette.getByLabel("展开标签浮窗", { exact: true }).waitFor();
    await palette.getByLabel("展开标签浮窗", { exact: true }).click();
    await wait(
      () => api("floating.state"),
      (s) => s.width === 516 && s.height === 576 && s.resizable,
      "restore expanded size",
    );
    console.log(
      "PASS native resizing, adaptive columns, keyboard sizing and collapse/reload/expand preserve custom dimensions",
    );
    const tag = palette.locator(".palette-chip").first();
    await tag.locator(".palette-tag").click();
    const layer = await tag.evaluate((el) => {
      const button = el.querySelector(".palette-tag"),
        more = el.querySelector(".tag-more");
      const a = el.getBoundingClientRect(),
        b = button.getBoundingClientRect(),
        c = more.getBoundingClientRect();
      return {
        widthDiff: a.width - b.width,
        heightDiff: a.height - b.height,
        tagZ: Number(getComputedStyle(button).zIndex),
        editZ: Number(getComputedStyle(more).zIndex),
        editHit: !!document
          .elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)
          ?.closest(".tag-more"),
        chosen: el.classList.contains("chosen"),
      };
    });
    assert.ok(
      layer.widthDiff <= 2 &&
        layer.heightDiff <= 2 &&
        layer.editZ > layer.tagZ &&
        layer.editHit &&
        layer.chosen,
    );
    const second = palette.locator(".palette-chip").nth(1);
    assert.equal(
      await second.locator(".palette-tag").getAttribute("aria-pressed"),
      "false",
    );
    await second.locator(".tag-more").click();
    await palette.getByRole("menu").waitFor();
    assert.equal(
      await tag.locator(".palette-tag").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await second.locator(".palette-tag").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(await palette.locator(".drag-active").count(), 0);
    await palette.keyboard.press("Escape");
    const chosen = await tag.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const normal = await second.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    assert.notEqual(chosen, normal);
    console.log(
      "PASS full-card selection highlight and nine-dot button above label layer without selecting or dragging another tag",
    );
    await size(280, 320);
    await saved(280, 320);
    assert.equal(
      await palette.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    for (const name of [
      "置顶浮窗",
      "打开工作台",
      "收起标签浮窗",
      "关闭浮窗",
      "添加标签",
    ]) {
      const box = await palette
        .getByRole("button", { name, exact: true })
        .boundingBox();
      assert.ok(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 280 &&
          box.y + box.height <= 320,
        name,
      );
    }
    await size(500, 560);
    await saved(500, 560);
    const out = path.join(root, "qa/floating-controls");
    fs.mkdirSync(out, { recursive: true });
    await palette.mouse.move(8, 75);
    await palette.screenshot({
      path: path.join(out, "floating-dark-wide.png"),
    });
    await main.screenshot({ path: path.join(out, "workspace-dark.png") });
    await selectTheme("light");
    await wait(
      () => nativeTheme("main"),
      (t) => t === "light",
      "light native title bar",
    );
    await palette.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await palette.screenshot({
      path: path.join(out, "floating-light-wide.png"),
    });
    console.log(
      "PASS minimum size keeps controls visible; light and dark themes remain consistent",
    );
    // Destroy/recreate the native window rather than merely reloading its WebView.
    await plugin(palette, "plugin:window|destroy", { label: "floating" }).catch(
      () => {},
    );
    await wait(
      async () =>
        ctx.pages().filter((p) => p.url().includes("floating")).length,
      (n) => n === 0,
      "destroy palette",
    );
    await api("floating.open");
    palette = await findPalette();
    const restored = await api("floating.state");
    assert.equal(restored.width, 500);
    assert.equal(restored.height, 560);
    assert.equal(restored.alwaysOnTop, false);
    await palette.getByLabel("置顶浮窗", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS recreating native palette restores persisted geometry and topmost choice without uncaught UI errors",
    );
    await api("floating.close");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
