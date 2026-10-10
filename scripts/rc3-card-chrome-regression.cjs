const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const api = (action, payload = {}) =>
      page.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const root = path.resolve(
      __dirname,
      "../qa",
      process.env.BETA_QA_DIR || "rc3-chrome",
    );
    const boot = await api("bootstrap");
    assert.equal(path.resolve(boot.dataPath), path.join(root, "library"));
    assert.equal(boot.version, process.env.BETA_VERSION || "0.3.0-rc.3");
    await page.getByRole("button", { name: "偏好设置", exact: true }).waitFor();
    const intro = page.getByRole("dialog", {
      name: "启用 AI 自动标注？",
      exact: true,
    });
    if (await intro.count())
      await intro
        .getByRole("button", { name: "暂不设置", exact: true })
        .click();
    const guide = page.getByRole("dialog", {
      name: "快速上手拾签",
      exact: true,
    });
    if (await guide.count())
      await guide
        .getByRole("button", { name: "开始使用", exact: true })
        .click();
    if (!boot.counts.all) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        path.join(root, "缩放检查.md"),
        "# Synthetic Markdown\nNo personal data.",
      );
      fs.copyFileSync(
        path.resolve(__dirname, "../qa/fixtures/品牌视觉参考.png"),
        path.join(root, "标签尺寸检查.png"),
      );
      await api("import", {
        paths: [
          path.join(root, "缩放检查.md"),
          path.join(root, "标签尺寸检查.png"),
        ],
      });
      for (let i = 0; i < 200; i++) {
        if ((await api("import.status"))?.done) break;
        await page.waitForTimeout(50);
      }
    }
    const files = (await api("query", { limit: 100 })).files;
    const tag = await api("tag.create", { name: "尺寸稳定" });
    await api("files.tags", {
      ids: files.map((f) => f.id),
      versions: Object.fromEntries(files.map((f) => [f.id, f.version])),
      add: [tag.id],
      remove: [],
    });
    await api("settings.save", { key: "details", value: true });
    await api("settings.save", { key: "views", value: "grid" });
    await api("settings.save", { key: "galleryColumns", value: 4 });
    await page.reload();
    await page.getByRole("button", { name: "偏好设置", exact: true }).waitFor();
    await page.locator(".masonry-card .extension-stamp").waitFor();
    await page.waitForTimeout(400);
    const md = files.find((f) => f.extension === "md"),
      image = files.find((f) => f.kind === "image");
    assert.ok(md && image);
    const sample = async (id) =>
      page.locator(`.masonry-card[data-file-id="${id}"]`).evaluate((card) => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height };
        };
        return {
          card: rect(card),
          icon: card.querySelector(".preview-placeholder > svg")
            ? rect(card.querySelector(".preview-placeholder > svg"))
            : null,
          tags: [...card.querySelectorAll(".gallery-tag")].map((tag) => ({
            name: tag.textContent,
            ...rect(tag),
          })),
          animations: card.getAnimations().length,
        };
      });
    for (const theme of ["light", "dark"]) {
      await api("settings.save", { key: "theme", value: theme });
      await page.waitForTimeout(200);
      for (const file of [md, image]) {
        const card = page.locator(`.masonry-card[data-file-id="${file.id}"]`);
        const initial = await sample(file.id);
        const widths = [];
        for (const phase of ["open", "close"]) {
          await card.click();
          let animated = false;
          for (let i = 0; i < 9; i++) {
            const current = await sample(file.id);
            animated ||= current.animations > 0;
            widths.push(current.card.w);
            if (current.icon) {
              assert.ok(
                Math.abs(current.icon.w - 40) < 0.35,
                `${theme}/${phase}: icon width ${current.icon.w}`,
              );
              assert.ok(
                Math.abs(current.icon.h - 40) < 0.35,
                `${theme}/${phase}: icon height ${current.icon.h}`,
              );
            }
            for (const currentTag of current.tags) {
              const original = initial.tags.find(
                (tag) => tag.name === currentTag.name,
              );
              assert.ok(original);
              assert.ok(
                Math.abs(original.w - currentTag.w) < 0.35,
                `${theme}/${phase}: tag width ${original.w} -> ${currentTag.w}`,
              );
              assert.ok(
                Math.abs(original.h - currentTag.h) < 0.35,
                `${theme}/${phase}: tag height ${original.h} -> ${currentTag.h}`,
              );
            }
            await page.waitForTimeout(35);
          }
          assert.ok(animated, "card/image transition remains animated");
          await page.waitForTimeout(150);
        }
        console.log(
          `PASS ${theme} ${file.extension}: open/close card transition retains 40x40 document icon and fixed tag dimensions; card widths ${widths.map((w) => w.toFixed(1)).join(",")}`,
        );
      }
      await page.screenshot({
        path: path.join(root, `stable-chrome-${theme}.png`),
      });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const card = page.locator(`.masonry-card[data-file-id="${md.id}"]`);
    await card.click();
    await page.waitForTimeout(150);
    const reduced = await sample(md.id);
    assert.equal(reduced.animations, 0);
    assert.equal(Math.round(reduced.icon.w), 40);
    assert.equal(Math.round(reduced.icon.h), 40);
    console.log(
      "PASS reduced-motion skips resize animation and preserves icon size",
    );
    assert.deepEqual(errors, []);
    console.log("PASS no uncaught page errors");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
