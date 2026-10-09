const { getSearch } = require("./search-control.cjs");
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
    const fixtures = path.join(root, "qa/inline-tags-fixtures");
    fs.mkdirSync(fixtures, { recursive: true });
    fs.copyFileSync(
      path.join(root, "qa/fixtures/品牌视觉参考.png"),
      path.join(fixtures, "悬停全标签.png"),
    );
    fs.writeFileSync(
      path.join(fixtures, "悬停全标签.txt"),
      "Synthetic tagged file",
    );
    const importPaths = async (paths) => {
      await api("import", { paths, recursive: false });
      await main.waitForFunction(
        async () =>
          (
            await window.__TAURI_INTERNALS__.invoke("api", {
              action: "import.status",
            })
          )?.done,
      );
    };
    await importPaths([
      path.join(fixtures, "悬停全标签.png"),
      path.join(fixtures, "悬停全标签.txt"),
    ]);
    const files = (await api("query", { text: "悬停全标签", limit: 100 }))
      .files;
    const photo = files.find((f) => f.kind === "image"),
      text = files.find((f) => f.extension === "txt");
    const tags = [];
    for (let i = 1; i <= 35; i++)
      tags.push(
        await api("tag.create", {
          name:
            i <= 8
              ? `完整标签 ${i}`
              : i === 9
                ? "这是一个用于验证标签名称自动换行和完整显示的四十字符长标签".padEnd(
                    40,
                    "长",
                  )
                : `长标签${i}用于验证自动换行与完整显示而非省略号`,
        }),
      );
    for (const [f, ids] of [
      [photo, tags.slice(0, 8).map((t) => t.id)],
      [text, tags.map((t) => t.id)],
    ])
      await api("files.tags", {
        ids: [f.id],
        versions: { [f.id]: f.version },
        add: ids,
        remove: [],
      });
    await api("settings.save", { key: "folderAutoTagging", value: false });
    fs.writeFileSync(
      path.join(fixtures, "悬停无标签.txt"),
      "Synthetic untagged file",
    );
    await importPaths([path.join(fixtures, "悬停无标签.txt")]);
    for (const [key, value] of Object.entries({
      theme: "light",
      details: false,
      views: { all: "grid" },
      galleryColumns: 3,
      sidebarCollapsed: false,
    }))
      await api("settings.save", { key, value });
    await main.setViewportSize({ width: 1360, height: 900 });
    await main.reload();
    await (await getSearch(main)).fill("悬停");
    await main.waitForFunction(
      () => document.querySelectorAll("[data-file-id]").length === 3,
    );
    const out = path.join(root, "qa/inline-tags");
    fs.mkdirSync(out, { recursive: true });
    const card = (f) => main.locator(`[data-file-id="${f.id}"]`);
    const panel = (f) =>
      main.getByRole("region", { name: `${f.name}的全部标签`, exact: true });
    const verify = async (f) => {
      await panel(f).waitFor();
      await main.waitForTimeout(200);
      const current = await api("file", { id: f.id });
      const names = await panel(f)
        .locator(
          ".gallery-tag > span:first-child, .file-tag-hover-tag > span:first-child",
        )
        .allTextContents();
      assert.deepEqual(
        names,
        current.tags.map((t) => t.name),
      );
      const box = await panel(f).boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 1360 &&
          box.y + box.height <= 900,
      );
      if (
        await card(f).evaluate((el) => el.classList.contains("masonry-card"))
      ) {
        const art = await card(f).locator(".masonry-art").boundingBox();
        assert.ok(
          box.x >= art.x &&
            box.y >= art.y - 1 &&
            box.x + box.width <= art.x + art.width + 1 &&
            box.y + box.height <= art.y + art.height + 1,
        );
        assert.equal(await main.locator(".file-tag-hover").count(), 0);
      }
      return current;
    };
    const hide = async () => {
      await main.mouse.move(700, 25);
      await main
        .locator(".file-tag-hover, .gallery-caption:visible")
        .first()
        .waitFor({ state: "hidden" });
    };
    await main.waitForFunction(() =>
      [...document.querySelectorAll(".masonry-art img")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await main.waitForTimeout(500);
    const before = await card(photo).boundingBox();
    const version = (await api("file", { id: photo.id })).version;
    await card(photo).hover();
    await verify(photo);
    assert.equal(await panel(photo).locator(".source-folder").count(), 1);
    assert.deepEqual(await card(photo).boundingBox(), before);
    assert.equal((await api("file", { id: photo.id })).version, version);
    assert.equal(
      await main.locator('[data-file-id][aria-selected="true"]').count(),
      0,
    );
    await main.screenshot({ path: path.join(out, "image-all-tags-light.png") });
    await hide();
    console.log(
      "PASS image hover shows every tag and folder provenance without changing card geometry, selection or file metadata",
    );
    await card(text).hover();
    await verify(text);
    assert.ok(
      await panel(text)
        .locator(".gallery-tag, .file-tag-hover-tag")
        .evaluateAll((els) =>
          els.some((el) => el.getBoundingClientRect().height > 35),
        ),
    );
    await panel(text).hover();
    await main.mouse.wheel(0, 280);
    await main.waitForFunction(
      (id) =>
        document.querySelector(`[data-file-id="${id}"] .gallery-tags`)
          ?.scrollTop > 0,
      text.id,
    );
    assert.equal(
      await panel(text).locator(".gallery-tag, .file-tag-hover-tag").count(),
      36,
    );
    assert.ok(await panel(text).isVisible());
    await main.screenshot({
      path: path.join(out, "document-all-tags-light.png"),
    });
    await hide();
    console.log(
      "PASS ordinary document preview contains all 36 tags; long names wrap and tags scroll inside the preview",
    );
    await main.getByRole("button", { name: "列表视图", exact: true }).click();
    await card(photo).hover();
    await verify(photo);
    await hide();
    await card(text).hover();
    await verify(text);
    await main.screenshot({ path: path.join(out, "list-all-tags-light.png") });
    await hide();
    console.log(
      "PASS list rows show the complete label set on hover, beyond the two-label summary",
    );
    await card(photo).focus();
    await verify(photo);
    await (await getSearch(main)).focus();
    await main.locator(".file-tag-hover").waitFor({ state: "hidden" });
    const empty = (await api("query", { text: "悬停无标签", limit: 100 }))
      .files[0];
    assert.equal(empty.tags.length, 0);
    await card(empty).hover();
    await main.waitForTimeout(250);
    assert.equal(await main.locator(".file-tag-hover").count(), 0);
    console.log(
      "PASS keyboard focus exposes the same labels and untagged files do not open an empty panel",
    );
    await main.getByRole("button", { name: "偏好设置", exact: true }).click();
    await main
      .getByRole("dialog", { name: "偏好设置" })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await main.getByLabel("关闭对话框", { exact: true }).click();
    await main.getByRole("button", { name: "瀑布流视图", exact: true }).click();
    await card(photo).hover();
    await verify(photo);
    await main.screenshot({ path: path.join(out, "image-all-tags-dark.png") });
    await hide();
    console.log(
      "PASS dark-mode full tag panel remains inside the viewport and below modal layers",
    );
    await api("floating.save", { ids: tags.slice(0, 8).map((t) => t.id) });
    await api("floating.open");
    let palette;
    for (let i = 0; i < 80; i++) {
      palette = ctx.pages().find((p) => p.url().includes("floating"));
      if (palette) break;
      await main.waitForTimeout(50);
    }
    palette.setDefaultTimeout(12000);
    palette.on("pageerror", (e) => errors.push(String(e)));
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
    for (const [width, height] of [
      [340, 460],
      [280, 320],
      [520, 600],
    ]) {
      await setSize(width, height);
      const geometry = await palette.evaluate(() => {
        const b = document.querySelector(".glass-add").getBoundingClientRect(),
          t = document.querySelector(".palette-chip").getBoundingClientRect(),
          s = document.querySelector(".palette-stage").getBoundingClientRect(),
          a = document
            .querySelector(".floating-assist")
            .getBoundingClientRect();
        return {
          height: b.height,
          tagHeight: t.height,
          width: b.width,
          visible: b.top >= s.top && b.right <= innerWidth,
          above: b.bottom < a.top,
        };
      });
      assert.ok(
        geometry.height === 48 &&
          geometry.tagHeight === 43 &&
          geometry.width >= 132 &&
          geometry.visible &&
          geometry.above,
        JSON.stringify(geometry),
      );
      if (width === 280)
        await palette.screenshot({
          path: path.join(out, "floating-large-add-minimum.png"),
        });
    }
    await setSize(340, 460);
    for (const theme of ["light", "dark"]) {
      await main.getByRole("button", { name: "偏好设置", exact: true }).click();
      await main
        .getByRole("dialog", { name: "偏好设置" })
        .getByRole("button", {
          name: theme === "light" ? "浅色" : "深色",
          exact: true,
        })
        .click();
      await main.getByLabel("关闭对话框", { exact: true }).click();
      await main.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      await palette.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      await card(photo).hover();
      await verify(photo);
      for (const tag of tags.slice(1, 8)) {
        const tone =
          [...tag.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6;
        const gallery = await card(photo)
          .locator(
            `.gallery-tag.tone-${["sage", "blue", "rose", "amber", "violet", "teal"][tone]}`,
          )
          .first()
          .evaluate((el) => ({
            bg: getComputedStyle(el).backgroundColor,
            ink: getComputedStyle(el).color,
          }));
        const floating = await palette
          .locator(`[data-preset-id="${tag.id}"]`)
          .evaluate((el) => ({
            bg: getComputedStyle(el).backgroundColor,
            ink: getComputedStyle(el).color,
          }));
        assert.deepEqual(gallery, floating);
      }
      const distinct = await palette
        .locator(".palette-chip:not(.chosen)")
        .evaluateAll(
          (els) =>
            new Set(els.map((el) => getComputedStyle(el).backgroundColor)).size,
        );
      assert.ok(distinct >= 3);
      await main.screenshot({
        path: path.join(out, `image-all-tags-${theme}.png`),
      });
      await palette.screenshot({
        path: path.join(out, `floating-colors-${theme}.png`),
      });
      await hide();
    }
    console.log(
      "PASS light and dark picture tags match floating tag colors; palette has multiple distinct colors",
    );
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .click();
    await palette
      .getByRole("dialog", { name: "添加标签", exact: true })
      .waitFor();
    await palette.getByLabel("关闭对话框", { exact: true }).click();
    await palette.screenshot({
      path: path.join(out, "floating-large-add-dark.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS enlarged 48px add button is taller than 43px tag cards and stays usable above the annotation bar at three native sizes",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
