const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { getSearch } = require("./search-control.cjs");
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
    const fixture = path.join(root, "qa/search-caption-fixtures");
    const out = path.join(root, "qa/search-caption");
    fs.mkdirSync(fixture, { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(
      path.join(root, "qa/fixtures/品牌视觉参考.png"),
      path.join(fixture, "合成搜索图片.png"),
    );
    fs.writeFileSync(
      path.join(fixture, "合成搜索文档.txt"),
      "Synthetic search document",
    );
    await api("import", { paths: [fixture], recursive: false });
    await page.waitForFunction(
      async () =>
        (
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "import.status",
          })
        )?.done,
    );
    const photo = (await api("query", { text: "合成搜索图片", limit: 100 }))
      .files[0];
    const tag = await api("tag.create", { name: "搜索配色验证" });
    await api("annotation.apply", { tagId: tag.id, ids: [photo.id] });
    for (const [key, value] of Object.entries({
      theme: "light",
      details: false,
      views: { all: "grid" },
      galleryColumns: 3,
      sidebarCollapsed: false,
    }))
      await api("settings.save", { key, value });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.reload();
    const input = page.getByLabel("搜索文件", { exact: true });
    const toggle = page.locator(".search-toggle");
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await input.isVisible(), false);
    assert.equal(await page.locator(".toolbar .search-box").count(), 0);
    assert.ok(
      await page.locator("#workspace-search").evaluate((el) => el.inert),
    );
    const titleBox = await page.locator(".page-heading h1").boundingBox(),
      iconBox = await toggle.boundingBox();
    assert.ok(
      iconBox.x >= titleBox.x + titleBox.width &&
        iconBox.x - titleBox.x - titleBox.width < 24,
    );
    await page.screenshot({
      path: path.join(out, "search-collapsed-light.png"),
    });
    console.log(
      "PASS default search is one icon next to the title; collapsed input is hidden and inert",
    );
    const before = await page.locator(".file-area").boundingBox();
    const widths = await page.evaluate(async () => {
      document.querySelector(".search-toggle").click();
      const widths = [];
      for (let i = 0; i < 20; i++) {
        await new Promise(requestAnimationFrame);
        widths.push(
          document.querySelector(".search-reveal").getBoundingClientRect()
            .width,
        );
      }
      return widths;
    });
    const final = widths.at(-1);
    assert.ok(
      final > 160 && widths.some((w) => w > 0 && w < final - 5),
      String(widths),
    );
    assert.equal(
      await input.evaluate((el) => document.activeElement === el),
      true,
    );
    assert.deepEqual(await page.locator(".file-area").boundingBox(), before);
    await page.screenshot({
      path: path.join(out, "search-expanded-light.png"),
    });
    console.log(
      "PASS search expands with intermediate animation frames, focuses input and leaves file grid geometry unchanged",
    );
    await input.fill("搜索配色验证");
    await page.waitForFunction(
      (id) =>
        document.querySelectorAll("[data-file-id]").length === 1 &&
        document.querySelector("[data-file-id]").dataset.fileId === id,
      photo.id,
    );
    await input.dispatchEvent("compositionstart");
    await input.fill("正在拼写的搜索词");
    await page.waitForTimeout(350);
    assert.equal(await page.locator("[data-file-id]").count(), 1);
    await input.dispatchEvent("compositionend");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-file-id]").length === 0,
    );
    await input.fill("合成搜索图片");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-file-id]").length === 1,
    );
    await input.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await input.isVisible(), false);
    assert.equal(await input.inputValue(), "合成搜索图片");
    assert.equal(await page.locator("[data-file-id]").count(), 1);
    await page.keyboard.press("Control+f");
    await input.waitFor({ state: "visible" });
    assert.deepEqual(
      await input.evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [0, "合成搜索图片".length],
    );
    await page.getByLabel("清空搜索", { exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-file-id]").length === 2,
    );
    assert.equal(
      await input.evaluate((el) => document.activeElement === el),
      true,
    );
    console.log(
      "PASS search matches tags and filenames, respects IME composition; Escape preserves search, Ctrl+F selects text and clear restores results",
    );
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    assert.equal(await page.locator(".filter-panel").isVisible(), true);
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await page.getByRole("button", { name: "列表视图", exact: true }).click();
    assert.equal(await page.locator(".file-list").count(), 2);
    await page.getByRole("button", { name: "瀑布流视图", exact: true }).click();
    console.log(
      "PASS filter, grid and list controls continue to work after removing the toolbar search field",
    );
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "偏好设置", exact: true }).click();
      await page
        .getByRole("dialog", { name: "偏好设置" })
        .getByRole("button", {
          name: theme === "light" ? "浅色" : "深色",
          exact: true,
        })
        .click();
      await page.getByLabel("关闭对话框", { exact: true }).click();
      await page.locator(`[data-file-id="${photo.id}"]`).hover();
      const caption = page.locator(
        `[data-file-id="${photo.id}"] .gallery-caption`,
      );
      assert.equal(await caption.isVisible(), true);
      const style = await caption.evaluate((el) => ({
        background: getComputedStyle(el).backgroundImage,
        shadow: getComputedStyle(el.querySelector(".file-name")).textShadow,
      }));
      assert.ok(
        style.background.includes("0.4") && !style.background.includes("0.91"),
        style.background,
      );
      assert.notEqual(style.shadow, "none");
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(out, `caption-lightened-${theme}.png`),
      });
    }
    console.log(
      "PASS picture overlay uses a lighter 40% maximum gradient with filename shadow in both themes",
    );
    await api("settings.save", { key: "sidebarWidth", value: 360 });
    await page.setViewportSize({ width: 960, height: 640 });
    await page.reload();
    await getSearch(page);
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(() => ({
      input: document
        .querySelector(".search-box")
        .getBoundingClientRect()
        .toJSON(),
      add: document
        .querySelector(".add-wrapper")
        .getBoundingClientRect()
        .toJSON(),
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    assert.ok(
      geometry.input.right <= geometry.add.left - 8 &&
        geometry.width <= geometry.viewport,
      String(JSON.stringify(geometry)),
    );
    await page.screenshot({
      path: path.join(out, "search-expanded-narrow.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".search-reveal")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS search fits a narrow window and honors reduced-motion preferences; no browser exceptions",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
