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
    const api = (action, payload = {}) =>
      main.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    assert.ok(
      path
        .resolve((await api("bootstrap")).dataPath)
        .startsWith(path.join(root, "qa") + path.sep),
    );
    const first = (await api("query", { text: "视觉图", limit: 100 })).files[0];
    const second = (await api("query", { text: "项目说明", limit: 100 }))
      .files[0];
    assert.ok(first && second);
    const a = await api("tag.create", { name: "单选甲" });
    const b = await api("tag.create", { name: "单选乙" });
    await api("annotation.apply", { tagId: a.id, ids: [first.id] });
    await api("annotation.apply", { tagId: b.id, ids: [second.id] });
    await api("settings.save", { key: "theme", value: "light" });
    await main.setViewportSize({ width: 1360, height: 900 });
    await main.reload();
    const sidebar = main.locator(".sidebar-tags");
    const active = sidebar.locator('.sidebar-tag-filter[aria-pressed="true"]');
    await sidebar.getByTitle(a.name, { exact: true }).click();
    await main.waitForFunction(
      (id) =>
        document.querySelectorAll("[data-file-id]").length === 1 &&
        document.querySelector("[data-file-id]")?.dataset.fileId === id,
      first.id,
    );
    await sidebar.getByTitle(b.name, { exact: true }).click();
    await main.waitForFunction(
      (id) =>
        document.querySelectorAll("[data-file-id]").length === 1 &&
        document.querySelector("[data-file-id]")?.dataset.fileId === id,
      second.id,
    );
    assert.equal(await active.count(), 1);
    assert.equal(await active.getAttribute("title"), b.name);
    const folder = (await api("bootstrap")).tags.find(
      (t) => t.createdBy === "folder" && t.name === "设计参考已更新",
    );
    await sidebar.getByTitle(folder.name, { exact: true }).click();
    await main.waitForFunction(
      (id) =>
        document.querySelectorAll("[data-file-id]").length === 1 &&
        document.querySelector("[data-file-id]")?.dataset.fileId === id,
      first.id,
    );
    assert.equal(await active.count(), 1);
    assert.equal(await active.getAttribute("title"), folder.name);
    await sidebar.getByTitle(folder.name, { exact: true }).click();
    await main.waitForFunction(
      () => document.querySelectorAll("[data-file-id]").length > 1,
    );
    assert.equal(await active.count(), 0);
    console.log(
      "PASS sidebar switches one tag at a time across both groups and clicking it again clears the tag filter",
    );
    const shape = async (label) => {
      const el = main
        .locator(".sidebar-bottom")
        .getByRole("button", { name: label, exact: true });
      await el.hover();
      await main.waitForTimeout(200);
      const result = await el.evaluate((el) => {
        const style = getComputedStyle(el),
          r = el.getBoundingClientRect(),
          icon = el.querySelector("svg").getBoundingClientRect();
        return {
          radius: style.borderRadius,
          shadow: style.boxShadow,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          centerOffset: Math.abs(icon.y + icon.height / 2 - r.y - r.height / 2),
        };
      });
      assert.equal(result.radius, "12px");
      assert.ok(result.shadow.includes("inset"));
      assert.equal(result.paddingTop, result.paddingBottom);
      assert.ok(result.centerOffset < 1);
    };
    await shape("标签浮窗");
    await shape("偏好设置");
    const out = path.join(root, "qa/floating-overlay");
    fs.mkdirSync(out, { recursive: true });
    await main.screenshot({ path: path.join(out, "sidebar-hover-light.png") });
    await main
      .getByRole("button", { name: "收拢左侧菜单", exact: true })
      .click();
    await main.waitForTimeout(350);
    await shape("标签浮窗");
    await shape("偏好设置");
    await main
      .getByRole("button", { name: "展开左侧菜单", exact: true })
      .click();
    await main.waitForTimeout(350);
    console.log(
      "PASS bottom sidebar actions have rounded inset hover highlights and centered icons when expanded or collapsed",
    );
    const tags = [];
    for (let i = 1; i <= 20; i++)
      tags.push(
        await api("tag.create", {
          name: `常用标签 ${String(i).padStart(2, "0")}`,
        }),
      );
    await api("floating.save", { ids: tags.map((t) => t.id) });
    await api("floating.open");
    let palette;
    for (let i = 0; i < 80; i++) {
      palette = ctx.pages().find((p) => p.url().includes("floating"));
      if (palette) break;
      await main.waitForTimeout(50);
    }
    palette.setDefaultTimeout(12000);
    palette.on("pageerror", (e) => errors.push(String(e)));
    await palette
      .locator(".palette-chip")
      .nth(19)
      .waitFor({ state: "attached" });
    const setSize = async (width, height) => {
      await palette.evaluate(
        ({ width, height }) =>
          window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
            label: "floating",
            value: { Logical: { width, height } },
          }),
        { width, height },
      );
      await palette.waitForFunction(
        ({ width, height }) =>
          Math.abs(innerWidth - width) < 1 &&
          Math.abs(innerHeight - height) < 1,
        { width, height },
      );
    };
    await setSize(340, 460);
    await palette.waitForTimeout(200);
    const before = await palette.locator(".glass-add").boundingBox();
    const movement = await palette.evaluate(() => {
      const list = document.querySelector(".palette-chips"),
        tag = list.children[11],
        button = document.querySelector(".glass-add"),
        r = button.getBoundingClientRect(),
        t = tag.getBoundingClientRect();
      const beforeTag = t.y;
      list.scrollTop += t.y + t.height / 2 - r.y - r.height / 2;
      return {
        beforeTag,
        afterTag: tag.getBoundingClientRect().y,
        scroll: list.scrollTop,
      };
    });
    assert.ok(
      movement.scroll > 0 &&
        Math.abs(movement.beforeTag - movement.afterTag) > 40,
    );
    const after = await palette.locator(".glass-add").boundingBox();
    assert.deepEqual(after, before);
    const layer = await palette.evaluate(() => {
      const button = document.querySelector(".glass-add"),
        r = button.getBoundingClientRect(),
        assist = document
          .querySelector(".floating-assist")
          .getBoundingClientRect();
      const x = r.x + r.width / 2,
        y = r.y + r.height / 2,
        tag = document.querySelectorAll(".palette-chip")[11],
        t = tag.getBoundingClientRect();
      return {
        above: r.bottom < assist.top,
        under: t.left < x && t.right > x && t.top < y && t.bottom > y,
        hit: document.elementFromPoint(x, y)?.closest(".glass-add") === button,
      };
    });
    assert.ok(layer.above && layer.under && layer.hit, JSON.stringify(layer));
    const oldScroll = await palette
      .locator(".palette-chips")
      .evaluate((el) => el.scrollTop);
    await palette.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    await palette.mouse.wheel(0, -104);
    await palette.waitForFunction(
      (old) => document.querySelector(".palette-chips").scrollTop < old,
      oldScroll,
    );
    assert.deepEqual(await palette.locator(".glass-add").boundingBox(), before);
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .click();
    await palette
      .getByRole("dialog", { name: "添加标签", exact: true })
      .waitFor();
    await palette.getByLabel("关闭对话框", { exact: true }).click();
    await palette.screenshot({
      path: path.join(out, "floating-overlay-light.png"),
    });
    console.log(
      "PASS scrolling moves tags behind a stationary foreground add button above the file-annotation bar; button still opens its dialog",
    );
    const cleanEdges = async () => {
      const background = await palette
        .locator(".glass-add")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const alpha = background.match(/(?:,|\/)\s*(0?\.\d+|1)\)$/)?.[1];
      assert.ok(alpha === undefined || Number(alpha) >= 0.9, background);
      const styles = await palette
        .locator(".palette-chip:not(.chosen)")
        .evaluateAll((els) =>
          els.map((el) => ({
            border: getComputedStyle(el).borderTopColor,
            shadow: getComputedStyle(el).boxShadow,
          })),
        );
      assert.ok(
        styles.length > 0 &&
          styles.every(
            (s) => s.border === "rgba(0, 0, 0, 0)" && s.shadow === "none",
          ),
        JSON.stringify(styles),
      );
    };
    await cleanEdges();
    await main.getByRole("button", { name: "偏好设置", exact: true }).click();
    await main
      .getByRole("dialog", { name: "偏好设置" })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await main.getByLabel("关闭对话框", { exact: true }).click();
    await palette.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await palette.waitForTimeout(200);
    await cleanEdges();
    await palette.screenshot({
      path: path.join(out, "floating-overlay-dark.png"),
    });
    await shape("偏好设置");
    await main.screenshot({ path: path.join(out, "sidebar-hover-dark.png") });
    console.log(
      "PASS light/dark tag cards have no white perimeter or inset white highlight while selection remains visible",
    );
    await setSize(280, 320);
    const minimum = await palette.evaluate(() => {
      const b = document.querySelector(".glass-add").getBoundingClientRect(),
        a = document.querySelector(".floating-assist").getBoundingClientRect(),
        stage = document
          .querySelector(".palette-stage")
          .getBoundingClientRect();
      return {
        above: b.bottom < a.top,
        inside: b.top >= stage.top,
        visible: b.width > 0 && b.right <= innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(
      minimum.above && minimum.inside && minimum.visible && !minimum.overflow,
      JSON.stringify(minimum),
    );
    await palette.screenshot({
      path: path.join(out, "floating-overlay-minimum.png"),
    });
    await palette.getByLabel("收起标签浮窗", { exact: true }).click();
    await palette.locator(".glass-add").waitFor({ state: "hidden" });
    await palette.getByLabel("展开标签浮窗", { exact: true }).click();
    await palette.locator(".glass-add").waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS minimum native size, collapse and expand retain accessible foreground action without overflow or uncaught UI errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
