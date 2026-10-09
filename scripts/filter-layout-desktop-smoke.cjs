const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const baseline = process.argv.includes("--baseline");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    page.setDefaultTimeout(15000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
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
    await api("import", {
      paths: Array.from({ length: 35 }, (_, i) =>
        path.join(
          root,
          "qa/gallery-fixtures",
          `画幅-${String(i + 1).padStart(3, "0")}.png`,
        ),
      ),
      recursive: false,
    });
    await page.waitForFunction(
      async () =>
        (
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "import.status",
          })
        )?.done,
    );
    for (const [key, value] of Object.entries({
      theme: "light",
      views: { all: "grid" },
      details: false,
      galleryColumns: 3,
      sidebarCollapsed: false,
      sidebarWidth: 216,
    }))
      await api("settings.save", { key, value });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.reload();
    const out = path.join(root, "qa/filter-layout");
    fs.mkdirSync(out, { recursive: true });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".masonry-card").length >= 3 &&
        [...document.querySelectorAll(".masonry-card img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
    );
    await page.waitForTimeout(500);
    if (!baseline) {
      const filter = page.getByRole("button", { name: /^筛选/ });
      const reveal = page.locator(".filter-reveal");
      assert.equal(
        await reveal.evaluate((el) => el.getBoundingClientRect().height),
        0,
      );
      assert.ok(await reveal.evaluate((el) => el.inert));
      const heights = async () =>
        page.evaluate(async () => {
          const el = document.querySelector(".filter-reveal");
          document.querySelector(".filter-button").click();
          const values = [];
          const until = performance.now() + 340;
          while (performance.now() < until) {
            await new Promise(requestAnimationFrame);
            values.push(el.getBoundingClientRect().height);
          }
          return values;
        });
      const open = await heights(),
        height = open.at(-1);
      assert.ok(
        height > 80 && open.some((v) => v > 1 && v < height - 5),
        String(open),
      );
      assert.equal(await filter.getAttribute("aria-expanded"), "true");
      await page.getByRole("button", { name: "图片", exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(out, "filter-expanded-light.png"),
      });
      const close = await heights();
      assert.ok(
        close.some((v) => v > 1 && v < height - 5) && close.at(-1) < 1,
        String(close),
      );
      assert.ok(await reveal.evaluate((el) => el.inert));
      await filter.click();
      await page.waitForTimeout(300);
      assert.equal(
        await page
          .getByRole("button", { name: "图片", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.getByRole("button", { name: "图片", exact: true }).click();
      await filter.click();
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const b = document.querySelector(".filter-button");
        b.click();
        setTimeout(() => b.click(), 70);
        setTimeout(() => b.click(), 130);
      });
      await page.waitForTimeout(500);
      assert.equal(await filter.getAttribute("aria-expanded"), "true");
      await filter.click();
      await page.waitForTimeout(300);
      console.log(
        "PASS filter expands and collapses through intermediate heights; conditions persist and rapid reversals settle correctly",
      );
    }
    const sample = async (view) =>
      page.evaluate(async (view) => {
        document
          .querySelector(
            `[aria-label="${view === "grid" ? "瀑布流视图" : "列表视图"}"]`,
          )
          .click();
        const frames = [];
        for (let i = 0; i < 20; i++) {
          await new Promise(requestAnimationFrame);
          const area = document.querySelector(".file-area"),
            r = area.getBoundingClientRect();
          const transform = getComputedStyle(
            area.querySelector(".files-layout-motion") || area,
          ).transform;
          const translation =
            transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
          const cards = [...area.querySelectorAll("[data-file-id]")].map(
            (el) => {
              const b = el.getBoundingClientRect();
              return {
                id: el.dataset.fileId,
                x: b.x - r.x - translation,
                y: b.y - r.y,
                w: b.width,
                h: b.height,
              };
            },
          );
          frames.push({
            area: { x: r.x, y: r.y, width: r.width, height: r.height },
            offset: area.scrollTop,
            width: area.clientWidth,
            cards,
            loading: area.querySelectorAll(".preview-placeholder .spin").length,
          });
        }
        return frames;
      }, view);
    const stable = (frames, label) => {
      const final = frames.at(-1),
        movements = [];
      for (const [index, frame] of frames.entries()) {
        for (const card of frame.cards) {
          const last = final.cards.find((c) => c.id === card.id);
          if (
            last &&
            ["x", "y", "w", "h"].some((k) => Math.abs(card[k] - last[k]) > 1)
          )
            movements.push({ index, id: card.id });
        }
      }
      if (baseline)
        console.log(
          "BASELINE",
          label,
          "moving cards",
          movements.length,
          "loading frames",
          frames.filter((f) => f.loading).length,
        );
      else {
        assert.deepEqual(movements, [], label);
        assert.ok(
          frames.every((f) => f.cards.length > 0),
          label + " blank frame",
        );
      }
      return { label, movements, frames };
    };
    const report = [];
    const areaBefore = await page.locator(".file-area").boundingBox();
    for (let i = 0; i < 4; i++) {
      report.push(stable(await sample("list"), `list-${i}`));
      report.push(stable(await sample("grid"), `grid-${i}`));
    }
    if (!baseline) {
      for (const result of report)
        for (const frame of result.frames) {
          for (const field of ["x", "y", "width", "height"])
            assert.ok(
              Math.abs(frame.area[field] - areaBefore[field]) < 1,
              `workspace moved: ${result.label} ${field}`,
            );
        }
    }
    if (!baseline)
      console.log(
        "PASS four grid/list round trips keep card positions stable from the first painted frame",
      );
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 1100));
    await page.waitForTimeout(700);
    const gridOffset = await page
      .locator(".file-area")
      .evaluate((el) => el.scrollTop);
    report.push(stable(await sample("list"), "list-first-scrolled-switch"));
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 450));
    await page.waitForTimeout(300);
    const listOffset = await page
      .locator(".file-area")
      .evaluate((el) => el.scrollTop);
    report.push(stable(await sample("grid"), "grid-restored-scroll"));
    const restoredGrid = await page
      .locator(".file-area")
      .evaluate((el) => el.scrollTop);
    report.push(stable(await sample("list"), "list-restored-scroll"));
    const restoredList = await page
      .locator(".file-area")
      .evaluate((el) => el.scrollTop);
    if (!baseline) {
      assert.ok(
        Math.abs(restoredGrid - gridOffset) < 2,
        `grid ${gridOffset} -> ${restoredGrid}`,
      );
      assert.ok(
        Math.abs(restoredList - listOffset) < 2,
        `list ${listOffset} -> ${restoredList}`,
      );
      console.log(
        "PASS each view restores its own scroll offset without transient displaced cards",
      );
    }
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(200);
    await sample("grid");
    if (!baseline) {
      const theme = page.getByRole("button", { name: "偏好设置", exact: true });
      await theme.click();
      await page
        .getByRole("dialog", { name: "偏好设置" })
        .getByRole("button", { name: "深色", exact: true })
        .click();
      await page.getByLabel("关闭对话框", { exact: true }).click();
      const filter = page.getByRole("button", { name: /^筛选/ });
      await filter.click();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(out, "filter-expanded-dark.png"),
      });
      await filter.click();
      await page.waitForTimeout(300);
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".filter-reveal")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page.setViewportSize({ width: 960, height: 640 });
      await page.waitForTimeout(500);
      report.push(stable(await sample("list"), "narrow-list"));
      report.push(stable(await sample("grid"), "narrow-grid"));
      await filter.click();
      await page.screenshot({
        path: path.join(out, "filter-expanded-narrow.png"),
      });
      await filter.click();
      console.log(
        "PASS dark theme, narrow viewport and reduced motion keep filtering and view transitions usable",
      );
      assert.deepEqual(errors, []);
    }
    fs.writeFileSync(
      path.join(out, baseline ? "baseline-frames.json" : "frames.json"),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
