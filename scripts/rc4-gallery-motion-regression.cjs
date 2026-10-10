// Actual WebView geometry + masonry motion; synthetic QA library only.
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const p = browser
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
      process.env.BETA_QA_DIR || "rc4-layout",
    );
    const boot = await api("bootstrap");
    assert.equal(path.resolve(boot.dataPath), path.join(root, "library"));
    assert.equal(boot.version, "0.3.0-rc.4");
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
    await api("settings.save", { key: "details", value: false });
    await api("settings.save", { key: "views", value: "grid" });
    await api("settings.save", { key: "galleryColumns", value: 4 });
    await p.reload();
    await p.getByRole("button", { name: "偏好设置", exact: true }).waitFor();
    // Native set_size is deliberately outside the app's ACL. Use CDP viewport
    // sizes in the actual WebView; this exercises window.resize + observers,
    // but does not claim a physical Windows drag test.
    const size = (width) => p.setViewportSize({ width, height: 900 });
    await size(1360);
    await p.waitForTimeout(1200);
    const snapshot = () =>
      p.locator(".masonry-item").evaluateAll((items) =>
        items.map((el) => {
          const c = el.querySelector(".masonry-card"),
            r = c.getBoundingClientRect();
          return {
            id: c.dataset.fileId,
            lane: Number(el.dataset.lane),
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            animations: c
              .getAnimations()
              .filter((a) => a.playState === "running").length,
          };
        }),
      );
    const noOverlap = async () => {
      const cards = await snapshot();
      for (let i = 0; i < cards.length; i++)
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i],
            b = cards[j];
          const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
            dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          assert.ok(
            dx <= 1 || dy <= 1,
            `overlap ${a.id} / ${b.id}: ${dx},${dy}`,
          );
        }
    };
    for (const name of ["增加列数", "减少列数"]) {
      await p.getByRole("button", { name, exact: true }).click();
      await p.waitForTimeout(65);
      const shifts = await p.locator(".masonry-card").evaluateAll((cards) =>
        cards.flatMap((c) =>
          c
            .getAnimations()
            .filter((a) => a.playState === "running")
            .map((a) => String(a.effect.getKeyframes()[0].transform)),
        ),
      );
      assert.ok(
        shifts.some((s) => {
          const m = s.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
          return (
            m && (Math.abs(Number(m[1])) > 2 || Math.abs(Number(m[2])) > 2)
          );
        }),
        `${name}: position transition must run`,
      );
      await p.waitForTimeout(350);
      await noOverlap();
      console.log(
        `PASS ${name}: translated card animation and settled non-overlapping masonry`,
      );
    }
    const baseline = await snapshot();
    let previous = new Map(baseline.map((c) => [c.id, c]));
    let checks = 0;
    for (const direction of ["shrink", "grow"]) {
      const widths = Array.from({ length: 31 }, (_, i) =>
        direction === "shrink" ? 1360 - i * 6 : 1180 + i * 6,
      );
      for (const width of widths) {
        await size(width);
        await p.waitForTimeout(40);
        const cards = await snapshot();
        assert.equal(
          Number(
            await p.locator(".masonry-space").getAttribute("data-columns"),
          ),
          4,
        );
        for (const card of cards) {
          const old = previous.get(card.id);
          if (old) {
            assert.equal(
              card.lane,
              old.lane,
              "continuous resizing must preserve lane identity",
            );
            const delta = card.w - old.w;
            assert.ok(
              direction === "shrink" ? delta <= 1 : delta >= -1,
              "card width must follow the resize direction",
            );
            checks++;
          }
          assert.equal(
            card.animations,
            0,
            "continuous viewport resize must not restart card transitions",
          );
        }
        previous = new Map(cards.map((c) => [c.id, c]));
        await noOverlap();
      }
    }
    await p.waitForTimeout(250);
    console.log(
      `PASS slow WebView viewport resizing 1360→1180→1360: 62 size updates, ${checks} stable-lane/monotonic-size observations, no restarted card animations or overlap`,
    );
    for (const width of [1100, 960, 1360]) {
      await size(width);
      await p.waitForTimeout(250);
      await noOverlap();
    }
    await p.screenshot({ path: path.join(root, "layout-after-resize.png") });
    console.log("PASS narrow-window/capacity changes settle without overlap");
    const slider = p.getByRole("slider", { name: "瀑布流列数", exact: true });
    await slider.focus();
    await slider.press("End");
    await p.waitForTimeout(350);
    assert.equal(
      Number(await p.locator(".masonry-space").getAttribute("data-columns")),
      8,
    );
    await size(960);
    await p.waitForTimeout(250);
    const limited = Number(
      await p.locator(".masonry-space").getAttribute("data-columns"),
    );
    assert.ok(limited < 8 && limited >= 2, "narrow viewport limits columns");
    await noOverlap();
    await size(1360);
    await p.waitForTimeout(250);
    assert.equal(
      Number(await p.locator(".masonry-space").getAttribute("data-columns")),
      8,
    );
    await noOverlap();
    console.log(
      `PASS eight-column capacity resize 8→${limited}→8 without overlap`,
    );
    await p.emulateMedia({ reducedMotion: "reduce" });
    await slider.focus();
    await slider.press("Home");
    await p.waitForTimeout(60);
    await p.getByRole("button", { name: "增加列数", exact: true }).click();
    await p.waitForTimeout(60);
    assert.ok((await snapshot()).every((c) => c.animations === 0));
    await noOverlap();
    console.log(
      "PASS reduced-motion column changes skip animations; no uncaught page errors",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
