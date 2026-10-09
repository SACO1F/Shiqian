// Synthetic drag-position events exercise real Tauri routing and SQLite writes.
// This suite verifies visuals and annotations, not physical Windows mouse gestures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const ctx = browser.contexts()[0],
      page = ctx.pages().find((p) => !p.url().includes("floating"));
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
    const out = path.join(root, "qa/workspace-glass");
    fs.mkdirSync(out, { recursive: true });
    await api("settings.save", { key: "folderAutoTagging", value: false });
    await api("import", {
      paths: [
        path.join(root, "qa/fixtures"),
        path.join(root, "qa/gallery-fixtures/画幅-001.png"),
        path.join(root, "qa/gallery-fixtures/画幅-002.png"),
      ],
      recursive: true,
    });
    await page.waitForFunction(
      async () =>
        (
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "import.status",
            payload: {},
          })
        )?.done,
    );
    await api("settings.save", { key: "theme", value: "light" });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.reload();
    const image = (await api("query", { text: "品牌视觉参考", limit: 100 }))
      .files[0];
    assert.ok(image);
    const second = (await api("query", { text: "配色方案", limit: 100 }))
      .files[0];
    assert.ok(second);
    const tag = await api("tag.create", { name: "品牌素材" });
    await api("floating.open");
    for (
      let i = 0;
      i < 40 && !ctx.pages().find((p) => p.url().includes("floating"));
      i++
    )
      await page.waitForTimeout(50);
    const floating = ctx.pages().find((p) => p.url().includes("floating"));
    assert.ok(floating);
    const preset = await api("floating.presets");
    await api("floating.save", { ids: [...preset.ids, tag.id] });
    await page.getByRole("option", { name: image.name, exact: true }).waitFor();
    const emit = (event, payload) =>
      page.evaluate(
        ({ event, payload }) =>
          window.__TAURI_INTERNALS__.invoke("plugin:event|emit_to", {
            target: { kind: "AnyLabel", label: "main" },
            event,
            payload,
          }),
        { event, payload },
      );
    const point = async (id, drop = false) => {
      await page.locator(`[data-file-id="${id}"]`).scrollIntoViewIfNeeded();
      const b = await page.locator(`[data-file-id="${id}"]`).boundingBox();
      return {
        tagId: tag.id,
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        over: true,
        drop,
      };
    };
    const dimensions = () =>
      page.locator(`[data-file-id="${image.id}"]`).evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      }));
    await page
      .locator(`[data-file-id="${image.id}"] img`)
      .evaluate(async (img) => {
        if (!img.complete)
          await new Promise((resolve) =>
            img.addEventListener("load", resolve, { once: true }),
          );
      });
    await page.waitForTimeout(150);
    const before = await dimensions();
    await emit("tag-drag-point", await point(image.id));
    const frame = page.locator(".tag-drop-frame");
    await frame.waitFor();
    assert.equal(await frame.getAttribute("data-target-file"), image.id);
    await page
      .getByText("松手添加「品牌素材」", { exact: true })
      .first()
      .waitFor();
    await page
      .locator(`[data-file-id="${image.id}"].tag-drop-target`)
      .evaluate((el) => {
        window.__targetMutations = 0;
        window.__targetObserver = new MutationObserver(
          (records) => (window.__targetMutations += records.length),
        );
        window.__targetObserver.observe(el, {
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    for (let i = 0; i < 8; i++) {
      await emit("tag-drag-point", await point(image.id));
      await page.waitForTimeout(32);
    }
    assert.equal(
      await page.evaluate(() => window.__targetMutations),
      0,
      "Repeated native coordinates must not restart the target animation",
    );
    await page.evaluate(() => window.__targetObserver.disconnect());
    assert.deepEqual(await dimensions(), before);
    const geometry = await frame.boundingBox(),
      card = await page.locator(`[data-file-id="${image.id}"]`).boundingBox();
    assert.ok(
      Math.abs(geometry.x - card.x) < 1 &&
        Math.abs(geometry.y - card.y) < 1 &&
        Math.abs(geometry.height - card.height) < 1,
    );
    await page.screenshot({ path: path.join(out, "drag-target-light.png") });
    assert.ok(
      !(await api("file", { id: image.id })).tags.some((t) => t.id === tag.id),
    );
    console.log(
      "PASS stable hover animation, exact target frame, tag cursor, unchanged card geometry and no hover writes",
    );
    await emit("tag-drag-point", await point(second.id));
    await page
      .locator(`.tag-drop-frame[data-target-file="${second.id}"]`)
      .waitFor();
    assert.equal(await page.locator(".tag-drop-target").count(), 1);
    await emit("tag-drag-point", {
      tagId: tag.id,
      x: 7,
      y: 20,
      over: true,
      drop: false,
    });
    await page
      .locator(".tag-drop-feedback.no-target .tag-drag-cursor")
      .waitFor();
    assert.equal(await page.locator(".tag-drop-frame").count(), 0);
    await emit("tag-drag-point", {
      tagId: tag.id,
      x: 7,
      y: 20,
      over: true,
      drop: true,
    });
    await page.locator(".tag-drop-feedback.phase-error").waitFor();
    assert.ok(
      !(await api("file", { id: image.id })).tags.some((t) => t.id === tag.id),
    );
    await emit("tag-drag-point", await point(image.id));
    await frame.waitFor();
    await page.keyboard.press("Escape");
    await frame.waitFor({ state: "hidden" });
    await emit("tag-drag-point", await point(image.id));
    await frame.waitFor();
    await emit("tag-drag-point", { ...(await point(image.id)), over: false });
    await frame.waitFor({ state: "hidden" });
    console.log(
      "PASS switching targets, invalid-drop feedback, Escape and leaving the workspace clear the highlight",
    );
    for (const label of ["瀑布流视图", "列表视图"]) {
      await page.getByLabel(label, { exact: true }).click();
      await page
        .getByRole("option", { name: image.name, exact: true })
        .waitFor();
      const applied = await api("tag.create", { name: `反馈验证${label}` });
      const p = await point(image.id, true);
      p.tagId = applied.id;
      await emit("tag-drag-point", p);
      await emit("tag-drag-end", {});
      await page.locator(".tag-drop-feedback.phase-success").waitFor();
      assert.ok(
        (await api("file", { id: image.id })).tags.some(
          (t) => t.id === applied.id,
        ),
      );
      if (label === "瀑布流视图")
        await page.screenshot({
          path: path.join(out, "drop-success-light.png"),
        });
      await page.locator(".tag-drop-feedback").waitFor({ state: "hidden" });
    }
    const count = (await api("file", { id: image.id })).tags.length;
    await emit("tag-drag-point", {
      ...(await point(image.id, true)),
      tagId: "deleted-tag-id",
    });
    await page.locator(".tag-drop-feedback.phase-error.has-target").waitFor();
    assert.equal((await api("file", { id: image.id })).tags.length, count);
    await page.locator(".tag-drop-feedback").waitFor({ state: "hidden" });
    console.log(
      "PASS gallery/list successful annotation retains confirmation after drag-end, errors leave associations unchanged",
    );
    await page.getByLabel("瀑布流视图", { exact: true }).click();
    await page.getByRole("button", { name: "待整理", exact: true }).click();
    await page
      .getByRole("option", { name: second.name, exact: true })
      .waitFor();
    await emit("tag-drag-point", await point(second.id, true));
    await page
      .getByRole("option", { name: second.name, exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page
        .locator(`.tag-drop-frame[data-target-file="${second.id}"]`)
        .count(),
      0,
    );
    assert.ok(
      (await api("file", { id: second.id })).tags.some((t) => t.id === tag.id),
    );
    await page.getByRole("button", { name: "全部文件", exact: true }).click();
    await page.getByRole("option", { name: image.name, exact: true }).waitFor();
    console.log(
      "PASS completion feedback never highlights a different file after the tagged file leaves the active filter",
    );
    await page.locator(".tag-drop-feedback").waitFor({ state: "hidden" });
    await page.getByRole("option", { name: image.name, exact: true }).click();
    await page.mouse.move(1000, 90);
    if (await page.getByLabel("关闭通知", { exact: true }).count())
      await page.getByLabel("关闭通知", { exact: true }).click();
    await page.screenshot({ path: path.join(out, "workspace-light.png") });
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "偏好设置",
      exact: true,
    });
    await settings.getByRole("button", { name: "深色", exact: true }).click();
    await settings.getByLabel("关闭对话框", { exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await floating.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    assert.equal(
      await page
        .locator(".sidebar")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--glass-surface").trim(),
        ),
      await floating
        .locator(".floating-shell")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--glass-surface").trim(),
        ),
    );
    assert.notEqual(
      await page
        .locator(".sidebar")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
      "none",
    );
    await page.screenshot({ path: path.join(out, "workspace-dark.png") });
    await emit("tag-drag-point", await point(image.id));
    await frame.waitFor();
    await page.screenshot({ path: path.join(out, "drag-target-dark.png") });
    await emit("tag-drag-end", {});
    await page.setViewportSize({ width: 960, height: 640 });
    await page.getByLabel("收拢左侧菜单", { exact: true }).click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: path.join(out, "workspace-narrow.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await emit("tag-drag-point", await point(image.id));
    await frame.waitFor();
    assert.equal(
      await frame.evaluate(
        (el) => getComputedStyle(el, "::after").animationName,
      ),
      "none",
    );
    await emit("tag-drag-end", {});
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await api("floating.close");
    assert.deepEqual(errors, []);
    console.log(
      "PASS shared glass colors, light/dark/narrow layouts, reduced-motion feedback and no uncaught UI errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
