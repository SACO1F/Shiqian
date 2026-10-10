const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { chooseSelect } = require("./select-control.cjs");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const ctx = b.contexts()[0],
      p = ctx.pages().find((p) => !p.url().includes("floating"));
    p.setDefaultTimeout(12000);
    await p.getByRole("button", { name: "全部文件", exact: true }).waitFor();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    const api = (action, payload = {}) =>
      p.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const root = path.resolve(__dirname, "../qa/beta6-ui");
    assert.equal(
      path.resolve((await api("bootstrap")).dataPath),
      path.join(root, "library"),
    );
    assert.equal((await api("bootstrap")).version, "0.3.0-beta.6");
    if (!(await api("query", { limit: 100 })).total) {
      await api("import", {
        paths: fs
          .readdirSync(root)
          .filter((n) => n.startsWith("合成图片-") && n.endsWith(".png"))
          .map((n) => path.join(root, n)),
      });
      for (let i = 0; i < 200; i++) {
        if ((await api("import.status"))?.done) break;
        await p.waitForTimeout(100);
      }
    }
    const f = (await api("query", { limit: 100 })).files[0];
    await p.reload();
    await api("floating.open");
    let palette;
    for (let i = 0; i < 100; i++) {
      palette = ctx
        .pages()
        .find((p) => !p.isClosed() && p.url().includes("floating"));
      if (palette) break;
      await p.waitForTimeout(50);
    }
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .waitFor();
    palette.on("pageerror", (e) => errors.push(String(e)));
    const previousSync = (await api("bootstrap")).tags.find(tag => tag.name === "工作台同步标签");
    if (previousSync) await api("tags.delete", { id: previousSync.id, version: previousSync.version });
    await p
      .getByRole("button", { name: "添加标签悬浮按钮", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "标签名称", exact: true })
      .fill("工作台同步标签");
    await p.getByRole("button", { name: "创建", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await palette
      .getByRole("button", { name: "标签：工作台同步标签", exact: true })
      .waitFor();
    const synced = (await api("bootstrap")).tags.find(
      (t) => t.name === "工作台同步标签",
    );
    const keep = (await api("floating.presets")).ids.filter(
      (id) => id !== synced.id,
    );
    await api("floating.save", { ids: keep });
    const detailsToggle = p.getByRole("button", { name: "切换详情面板", exact: true });
    if (await detailsToggle.getAttribute("aria-pressed") !== "true") await detailsToggle.click();
    await p.getByRole("option", { name: f.name, exact: true }).click();
    await p.getByRole("textbox", { name: "添加标签", exact: true }).click();
    await p
      .locator(".inspector .tag-options")
      .getByRole("button", { name: "# 工作台同步标签", exact: false })
      .click();
    await palette
      .getByRole("button", { name: "标签：工作台同步标签", exact: true })
      .waitFor();
    const pins = (await api("floating.presets")).ids;
    assert.equal(pins.filter((id) => id === synced.id).length, 1);
    assert.ok(keep.every((id) => pins.includes(id)));
    console.log(
      "PASS workspace creation without a file and applying an existing tag both synchronize the open native palette; prior shortcuts preserved without duplicates",
    );
    const emit = (payload) =>
      p.evaluate(
        (payload) =>
          window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
            event: "tag-drag-point",
            payload,
          }),
        payload,
      );
    for (const details of [true, false]) {
      const toggle = p.getByRole("button", {
        name: "切换详情面板",
        exact: true,
      });
      if (((await toggle.getAttribute("aria-pressed")) === "true") !== details)
        await toggle.click();
      await p.waitForTimeout(400);
      const box = await p.locator(".masonry-card").first().boundingBox();
      assert.ok(box);
      const viewport = await p.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      const xs = [
        viewport.width - 160,
        viewport.width - 110,
        viewport.width - 60,
      ];
      const positions = [];
      for (const x of xs) {
        await emit({
          tagId: synced.id,
          x,
          y: box.y + 50,
          over: true,
          drop: false,
        });
        await p.waitForTimeout(70);
        const rect = await p.locator(".tag-drag-cursor").boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1);
        positions.push(rect.x);
      }
      assert.ok(
        positions[2] > positions[1] + 40,
        JSON.stringify({ xs, positions }),
      );
      const cardBox = await p.locator(".masonry-card").nth(2).boundingBox();
      await emit({
        tagId: synced.id,
        x: cardBox.x + cardBox.width / 2,
        y: cardBox.y + Math.min(30, cardBox.height / 2),
        over: true,
        drop: false,
      });
      await p.locator(".tag-drop-frame[data-target-file]").waitFor();
      await p.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event: "tag-drag-end",
          payload: {},
        }),
      );
    }
    console.log(
      "PASS real Tauri drag-point events: badge follows near right edge with details open/closed, stays in bounds and still highlights a file",
    );
    await p.getByRole("button", { name: "取消选择", exact: true }).click();
    for (const theme of ["light", "dark"]) {
      await api("settings.save", { key: "theme", value: theme });
      await p.reload();
      await p.waitForTimeout(350);
      await p.getByRole("combobox", { name: "文件排序", exact: true }).click();
      const sort = p.getByRole("listbox", { name: "文件排序", exact: true });
      await sort.getByRole("option", { name: "名称", exact: true }).hover();
      await p.waitForTimeout(240);
      assert.equal(await sort.evaluate(el => el.scrollHeight - el.clientHeight), 0, "short selector menu should not acquire a rounding scrollbar");
      assert.ok(
        await sort
          .locator(".glide-select-highlight")
          .evaluate((el) => getComputedStyle(el).transform !== "none"),
      );
      await p.screenshot({ path: path.join(root, "glide-" + theme + ".png") });
      await p
        .getByRole("combobox", { name: "文件排序", exact: true })
        .press("Escape");
      await chooseSelect(p, "文件排序", "名称");
      await p.getByRole("button", { name: "筛选", exact: true }).click();
      await chooseSelect(p, "文件状态筛选", "可用");
      await chooseSelect(p, "标签匹配方式", "满足任一标签");
      const state = p.getByRole("combobox", {
        name: "文件状态筛选",
        exact: true,
      });
      await state.focus();
      await state.press("ArrowDown");
      await state.press("Home");
      await state.press("Enter");
      assert.equal(await state.innerText(), "全部状态");
      await p.getByRole("button", { name: "偏好设置", exact: true }).click();
      await chooseSelect(p, "文件卡片密度", "紧凑");
      assert.equal((await api("bootstrap")).settings.density, "compact");
      const density = p.getByRole("combobox", {
        name: "文件卡片密度",
        exact: true,
      });
      await density.click();
      await density.press("Escape");
      assert.ok(
        await p
          .getByRole("dialog", { name: "偏好设置", exact: true })
          .isVisible(),
      );
      await chooseSelect(p, "文件卡片密度", "舒展");
      await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
      for (const [page, selector] of [
        [p, ".tag-fab"],
        [palette, ".glass-add"],
      ]) {
        const style = await page.locator(selector).evaluate((el) => {
          const c = getComputedStyle(el);
          return { border: c.borderTopColor, shadow: c.boxShadow };
        });
        assert.equal(style.border, "rgba(0, 0, 0, 0)");
        assert.ok(!style.shadow.includes("inset"), JSON.stringify(style));
      }
    }
    console.log(
      "PASS all four custom selectors in both themes: click selection, gliding highlight, keyboard selection and Escape focus behavior; both glass add buttons have transparent edges and no white inset ring",
    );
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.getByRole("combobox", { name: "文件排序", exact: true }).click();
    assert.equal(
      await p
        .locator(".glide-select-menu")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await p
      .getByRole("combobox", { name: "文件排序", exact: true })
      .press("Escape");
    assert.deepEqual(errors, []);
    console.log("PASS reduced-motion mode and no page errors");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
