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
    const fixtures = path.join(root, "qa/layout-motion-fixtures"),
      out = path.join(root, "qa/layout-motion");
    fs.mkdirSync(fixtures, { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    for (let i = 1; i <= 8; i++)
      fs.copyFileSync(
        path.join(
          root,
          "qa/gallery-fixtures",
          `画幅-${String(i).padStart(3, "0")}.png`,
        ),
        path.join(fixtures, `动效图片${i}.png`),
      );
    fs.writeFileSync(
      path.join(fixtures, "动效说明.txt"),
      "Synthetic motion document",
    );
    await api("import", { paths: [fixtures], recursive: false });
    await page.waitForFunction(
      async () =>
        (
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "import.status",
          })
        )?.done,
    );
    const document = (await api("query", { text: "动效说明", limit: 100 }))
      .files[0];
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
    await page.locator(".files-layout-motion").waitFor();
    await page.waitForTimeout(600);
    assert.equal(
      await page
        .locator(".files-layout-motion")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    const frames = async (selector) =>
      page.evaluate(async (selector) => {
        document.querySelector(selector).click();
        const frames = [],
          until = performance.now() + 380;
        while (performance.now() < until) {
          await new Promise(requestAnimationFrame);
          const layer = document.querySelector(".files-layout-motion"),
            area = document.querySelector(".file-area"),
            panel = document.querySelector(".inspector-reveal"),
            s = getComputedStyle(layer),
            transform = s.transform;
          const cards = [...area.querySelectorAll(".masonry-card")].map((el) =>
            el.getBoundingClientRect(),
          );
          let overlaps = 0;
          for (let i = 0; i < cards.length; i++)
            for (let j = i + 1; j < cards.length; j++) {
              const a = cards[i],
                b = cards[j];
              if (
                a.right > b.left + 1 &&
                b.right > a.left + 1 &&
                a.bottom > b.top + 1 &&
                b.bottom > a.top + 1
              )
                overlaps++;
            }
          frames.push({
            x: transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41,
            opacity: Number(s.opacity),
            width: panel.getBoundingClientRect().width,
            area: area.clientWidth,
            offset: area.scrollTop,
            overlaps,
          });
        }
        return frames;
      }, selector);
    const report = [];
    for (const view of ["list", "grid", "list", "grid"]) {
      const values = await frames(
        `[aria-label="${view === "list" ? "列表视图" : "瀑布流视图"}"]`,
      );
      const direction = view === "list" ? 1 : -1;
      assert.ok(values.some((f) => f.x * direction > 1 && f.opacity < 0.99));
      assert.ok(
        Math.abs(values.at(-1).x) < 0.05 && values.at(-1).opacity === 1,
      );
      assert.ok(values.every((f) => f.overlaps === 0));
      report.push({ view, values });
    }
    console.log(
      "PASS grid/list switch slides in opposite directions, fades to full opacity and leaves no animation on initial load",
    );
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 700));
    await page.waitForTimeout(300);
    const gridOffset = await page
      .locator(".file-area")
      .evaluate((el) => el.scrollTop);
    await frames('[aria-label="列表视图"]');
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 160));
    await page.waitForTimeout(100);
    const listOffset = await page
      .locator(".file-area")
      .evaluate((el) => el.scrollTop);
    await frames('[aria-label="瀑布流视图"]');
    assert.ok(
      Math.abs(
        (await page.locator(".file-area").evaluate((el) => el.scrollTop)) -
          gridOffset,
      ) < 2,
    );
    await frames('[aria-label="列表视图"]');
    assert.ok(
      Math.abs(
        (await page.locator(".file-area").evaluate((el) => el.scrollTop)) -
          listOffset,
      ) < 2,
    );
    await page.evaluate(() => {
      const list = document.querySelector('[aria-label="列表视图"]'),
        grid = document.querySelector('[aria-label="瀑布流视图"]');
      grid.click();
      setTimeout(() => list.click(), 50);
      setTimeout(() => grid.click(), 100);
    });
    await page.waitForTimeout(450);
    assert.equal(
      await page.locator(".files-layout-motion").getAttribute("data-layout"),
      "grid",
    );
    assert.equal(
      await page
        .locator(".files-layout-motion")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    console.log(
      "PASS rapid view switches cancel old motion and preserve each view's scroll offset",
    );
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(150);
    await page.locator(`[data-file-id="${document.id}"]`).click();
    const panel = page.locator(".inspector-reveal"),
      inspector = page.locator(".inspector");
    assert.equal(
      await panel.evaluate((el) => el.getBoundingClientRect().width),
      0,
    );
    const opening = await frames('[aria-label="切换详情面板"]');
    assert.ok(opening.some((f) => f.width > 1 && f.width < 285));
    assert.ok(Math.abs(opening.at(-1).width - 290) < 1);
    assert.ok(opening.every((f) => f.overlaps === 0));
    assert.ok(await inspector.isVisible());
    assert.equal(await panel.evaluate((el) => el.inert), false);
    await page
      .getByLabel("备注", { exact: true })
      .fill("Synthetic note survives animated close");
    const closing = await frames('[aria-label="切换详情面板"]');
    assert.ok(
      closing.some((f) => f.width > 1 && f.width < 285) &&
        closing.at(-1).width === 0,
    );
    assert.equal(await panel.evaluate((el) => el.inert), true);
    assert.equal(await inspector.isVisible(), false);
    await frames('[aria-label="切换详情面板"]');
    assert.equal(
      await page.getByLabel("备注", { exact: true }).inputValue(),
      "Synthetic note survives animated close",
    );
    const file = await api("file", { id: document.id });
    assert.equal(file.note, "Synthetic note survives animated close");
    assert.deepEqual(
      file.tags.map((t) => t.id),
      document.tags.map((t) => t.id),
    );
    await inspector.evaluate((el) => (el.scrollTop = 0));
    await page.locator(".file-area").evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(out, "details-expanded-light.png"),
    });
    report.push({ opening, closing });
    console.log(
      "PASS detail panel expands and collapses through intermediate widths without overlapping cards; hidden controls are inert and saved notes/tags survive",
    );
    await page.evaluate(() => {
      const b = document.querySelector('[aria-label="切换详情面板"]');
      b.click();
      setTimeout(() => b.click(), 70);
      setTimeout(() => b.click(), 120);
      setTimeout(() => b.click(), 170);
    });
    await page.waitForTimeout(550);
    assert.ok(
      Math.abs(
        (await panel.evaluate((el) => el.getBoundingClientRect().width)) - 290,
      ) < 1,
    );
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page
      .getByRole("dialog", { name: "偏好设置" })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await page.getByLabel("关闭对话框", { exact: true }).click();
    await page.screenshot({
      path: path.join(out, "details-expanded-dark.png"),
    });
    await page.setViewportSize({ width: 960, height: 640 });
    await page.waitForTimeout(450);
    assert.ok(
      Math.abs(
        (await panel.evaluate((el) => el.getBoundingClientRect().width)) - 260,
      ) < 1,
    );
    await page.screenshot({
      path: path.join(out, "details-expanded-narrow.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await panel.evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await page.getByLabel("切换详情面板", { exact: true }).click();
    assert.equal(
      await panel.evaluate((el) => el.getBoundingClientRect().width),
      0,
    );
    await page.getByLabel("列表视图", { exact: true }).click();
    assert.equal(
      await page
        .locator(".files-layout-motion")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS rapid detail reversals, dark theme, narrow window and reduced-motion preferences remain usable without browser errors",
    );
    fs.writeFileSync(
      path.join(out, "frames.json"),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
