// Use after auto-tags-desktop-smoke in the same isolated library.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => !p.url().includes("floating"));
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
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
      theme: "light",
      details: true,
      views: { all: "grid" },
      sidebarCollapsed: false,
    }))
      await api("settings.save", { key, value });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.reload();
    const photo = (await api("query", { text: "几何海报", limit: 100 }))
      .files[0];
    assert.ok(photo);
    await page.locator(`[data-file-id="${photo.id}"]`).click();
    const pending = photo.tags.find((t) => t.name === "构图分析");
    assert.ok(pending);
    await page.getByLabel("确认AI标签构图分析", { exact: true }).click();
    await page.waitForFunction(
      async (id) =>
        (
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "bootstrap",
          })
        ).tags.some((t) => t.id === id),
      pending.id,
    );
    await page.getByLabel("移除标签构图分析", { exact: true }).click();
    await page.waitForFunction(
      async ({ file, tag }) =>
        !(
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "file",
            payload: { id: file },
          })
        ).tags.some((t) => t.id === tag),
      { file: photo.id, tag: pending.id },
    );
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".inspector").count(), 1);
    assert.equal(
      await page
        .locator(`[data-file-id="${photo.id}"]`)
        .getAttribute("aria-selected"),
      "true",
    );
    assert.ok(!(await api("bootstrap")).tags.some((t) => t.id === pending.id));
    await page
      .locator(".inspector")
      .getByRole("textbox", { name: "添加标签", exact: true })
      .focus();
    assert.equal(
      await page
        .locator(".tag-options")
        .getByRole("button", { name: /构图分析/ })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    console.log(
      "PASS accepted AI labels leave the pool after their last removal and file details remain open",
    );
    const removeGlobally = async (tag) => {
      await page.getByRole("button", { name: "管理标签", exact: true }).click();
      await page.getByLabel(`删除${tag.name}`, { exact: true }).click();
      const confirm = page.getByRole("dialog", {
        name: "删除标签",
        exact: true,
      });
      await confirm
        .getByRole("button", { name: "删除标签", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      await page
        .getByRole("dialog", { name: "管理标签", exact: true })
        .getByLabel("关闭对话框", { exact: true })
        .click();
    };
    const global = await api("tag.create", { name: "详情删除验收" });
    await api("annotation.apply", { tagId: global.id, ids: [photo.id] });
    await page.getByLabel("移除标签详情删除验收", { exact: true }).waitFor();
    await removeGlobally(global);
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".inspector").count(), 1);
    assert.equal(
      await page
        .locator(`[data-file-id="${photo.id}"]`)
        .getAttribute("aria-selected"),
      "true",
    );
    console.log(
      "PASS deleting a global label does not reset the selected file or close its details",
    );
    const filtered = await api("tag.create", { name: "筛选删除验收" });
    await api("annotation.apply", { tagId: filtered.id, ids: [photo.id] });
    await page
      .locator(".sidebar-tag-filter")
      .filter({ hasText: filtered.name })
      .click();
    await page.locator(`[data-file-id="${photo.id}"]`).click();
    await removeGlobally(filtered);
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".inspector").count(), 1);
    assert.equal(
      await page
        .locator(`[data-file-id="${photo.id}"]`)
        .getAttribute("aria-selected"),
      "true",
    );
    assert.ok(!(await api("bootstrap")).tags.some((t) => t.id === filtered.id));
    console.log(
      "PASS deleting the active filter label removes that filter while retaining file details",
    );
    const other = (await api("query", { text: "项目需求", limit: 100 }))
      .files[0];
    await page
      .locator(`[data-file-id="${other.id}"]`)
      .click({ modifiers: ["Control"] });
    assert.equal(
      await page.locator('[data-file-id][aria-selected="true"]').count(),
      2,
    );
    const check = await page
      .locator(".is-selected .selection-check")
      .first()
      .evaluate((el) => ({
        radius: getComputedStyle(el).borderRadius,
        width: el.getBoundingClientRect().width,
        color: getComputedStyle(el).backgroundColor,
      }));
    assert.equal(check.radius, "7px");
    assert.equal(check.width, 23);
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
      "#2c6654",
    );
    assert.equal(
      await page
        .locator(".button.primary")
        .first()
        .evaluate((el) => getComputedStyle(el).borderRadius),
      "12px",
    );
    const out = path.join(root, "qa/apple-tags");
    fs.mkdirSync(out, { recursive: true });
    await page.mouse.move(700, 25);
    await page.screenshot({
      path: path.join(out, "workspace-multiselect-light.png"),
    });
    await page.getByRole("button", { name: "列表视图", exact: true }).click();
    assert.equal(
      await page.locator(".file-list.is-selected .selection-check").count(),
      2,
    );
    await page.getByRole("button", { name: "瀑布流视图", exact: true }).click();
    console.log(
      "PASS Apple-style buttons and multiselect checks in gallery/list preserve the original green theme",
    );
    await api("floating.open");
    const palette = ctx.pages().find((p) => p.url().includes("floating"));
    palette.setDefaultTimeout(12000);
    palette.on("pageerror", (e) => errors.push(String(e)));
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .waitFor();
    for (const name of [
      "操作记录一",
      "操作记录二",
      "操作记录三",
      "操作记录四",
    ]) {
      await palette
        .getByRole("button", { name: "添加标签", exact: true })
        .click();
      const dialog = palette.getByRole("dialog", {
        name: "添加标签",
        exact: true,
      });
      await dialog.getByLabel("标签名称", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "添加", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    const history = palette.getByRole("log", { name: "最近三步操作" });
    assert.equal(await history.locator("li").count(), 3);
    const recent = await history
      .locator("li > span:nth-child(2)")
      .allTextContents();
    assert.deepEqual(recent, [
      "已添加「操作记录四」",
      "已添加「操作记录三」",
      "已添加「操作记录二」",
    ]);
    assert.equal(
      await palette.getByLabel("撤销上一步标注操作", { exact: true }).count(),
      0,
    );
    await palette.reload();
    await history.waitFor();
    assert.deepEqual(
      await history.locator("li > span:nth-child(2)").allTextContents(),
      recent,
    );
    await palette.screenshot({
      path: path.join(out, "floating-history-light.png"),
    });
    console.log(
      "PASS floating palette retains exactly three recent operations after reload and has no undo control",
    );
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page
      .getByRole("dialog", { name: "偏好设置" })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await page.getByLabel("关闭对话框", { exact: true }).click();
    await palette.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await page.screenshot({
      path: path.join(out, "workspace-multiselect-dark.png"),
    });
    await palette.screenshot({
      path: path.join(out, "floating-history-dark.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS consistent light/dark Apple-style surfaces without uncaught UI errors",
    );
    await api("floating.close");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
