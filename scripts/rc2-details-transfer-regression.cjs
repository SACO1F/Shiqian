// RC.2 regression; synthetic QA library only.
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const p = b
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    p.setDefaultTimeout(15000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    const api = (action, payload = {}) =>
      p.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const root = path.resolve(
      __dirname,
      "../qa",
      process.env.BETA_QA_DIR || "rc2-ui",
    );
    const boot = await api("bootstrap");
    assert.equal(path.resolve(boot.dataPath), path.join(root, "library"));
    assert.equal(boot.version, process.env.BETA_VERSION || "0.3.0-rc.2");
    await p.getByRole("button", { name: "偏好设置", exact: true }).waitFor();
    const intro = p.getByRole("dialog", {
      name: "启用 AI 自动标注？",
      exact: true,
    });
    if (await intro.count())
      await intro
        .getByRole("button", { name: "暂不设置", exact: true })
        .click();
    const guide = p.getByRole("dialog", { name: "快速上手拾签", exact: true });
    if (await guide.count())
      await guide
        .getByRole("button", { name: "开始使用", exact: true })
        .click();
    if (!boot.counts.all) {
      await api("import", {
        paths: fs
          .readdirSync(root)
          .filter((n) => n.endsWith(".png"))
          .map((n) => path.join(root, n)),
      });
      for (let i = 0; i < 200; i++) {
        if ((await api("import.status"))?.done) break;
        await p.waitForTimeout(50);
      }
    }
    await api("settings.save", { key: "details", value: true });
    await api("settings.save", { key: "views", value: "grid" });
    await api("settings.save", { key: "galleryColumns", value: 4 });
    await p.reload();
    await p.getByRole("button", { name: "偏好设置", exact: true }).waitFor();
    await p.getByRole("button", { name: "全选当前结果", exact: true }).click();
    await p.getByRole("button", { name: "取消选择", exact: true }).click();
    await p.waitForTimeout(400);
    const area = p.getByRole("listbox", { name: "文件结果", exact: true });
    await area.evaluate((el) => (el.scrollTop = 1800));
    await p.waitForTimeout(300);
    const card = await area.locator(".masonry-card").evaluateAll((cards) => {
      const r = cards[0].closest(".file-area").getBoundingClientRect();
      return cards.find((c) => {
        const x = c.getBoundingClientRect();
        return x.top > r.top + 40 && x.bottom < r.bottom - 30;
      })?.dataset.fileId;
    });
    assert.ok(card, "visible card fixture");
    const target = p.locator(`.masonry-card[data-file-id="${card}"]`);
    const count = p.locator(".result-count");
    const beforeCount = await count.boundingBox();
    await target.click();
    const samples = [];
    let animated = false;
    for (let i = 0; i < 10; i++) {
      const sample = await target.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        animations: el.getAnimations().map((a) => a.effect.getTiming().easing),
      }));
      samples.push(sample.width);
      animated ||= sample.animations.includes("cubic-bezier(0.42, 0, 0.58, 1)");
      const pos = await count.boundingBox();
      assert.ok(
        Math.abs(pos.x - beforeCount.x) < 1,
        "selection count left edge must stay fixed",
      );
      await p.waitForTimeout(35);
    }
    await p.waitForTimeout(350);
    const bounds = await target.boundingBox(),
      viewport = await area.boundingBox();
    assert.ok(
      bounds.y >= viewport.y - 1 &&
        bounds.y + bounds.height <= viewport.y + viewport.height + 1,
      "selected card remains focused in visible viewport",
    );
    assert.ok(animated, "ease-in-out animation ran");
    const direction = Math.sign(samples.at(-1) - samples[0]);
    for (let i = 1; i < samples.length; i++)
      assert.ok(
        (samples[i] - samples[i - 1]) * direction >= -1,
        "card width changes monotonically, without oscillation",
      );
    assert.equal(await count.innerText(), "已选 1 项");
    await p.screenshot({ path: path.join(root, "focused-details.png") });
    console.log(
      `PASS selected card stays visible after details resize; ease-in-out animation and monotonic widths ${samples.map((n) => n.toFixed(1)).join(",")}; count position stable`,
    );
    await p.getByRole("button", { name: "取消选择", exact: true }).click();
    await p.waitForTimeout(400);
    const baseline = await area.evaluate((el) => el.scrollTop);
    const toggle = p.getByRole("button", { name: "切换详情面板", exact: true });
    for (let i = 0; i < 6; i++) {
      await toggle.click();
      await p.waitForTimeout(350);
    }
    assert.ok(
      Math.abs((await area.evaluate((el) => el.scrollTop)) - baseline) < 1,
      "empty selection detail toggles preserve scroll",
    );
    await p.getByRole("button", { name: "偏好设置", exact: true }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "导出资料包", exact: true })
      .click();
    const select = p.getByRole("combobox", { name: "资料包范围", exact: true });
    await select.click();
    const menu = p.getByRole("listbox", { name: "资料包范围", exact: true });
    await menu.waitFor();
    assert.ok((await menu.getAttribute("class")).includes("glide-select-menu"));
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Enter");
    assert.equal(await select.getAttribute("aria-expanded"), "false");
    await select.click();
    await p.keyboard.press("Escape");
    await p.waitForTimeout(180);
    assert.equal(await menu.count(), 0);
    await p.screenshot({ path: path.join(root, "transfer-scope-light.png") });
    console.log(
      "PASS transfer range uses Glide Select; keyboard selection, Escape and focus; empty selection toggles preserve scroll",
    );
    assert.deepEqual(errors, []);
    console.log("PASS no uncaught page errors");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
