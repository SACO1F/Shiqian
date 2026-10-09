// Real Tauri WebViews and an isolated synthetic QA library.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const context = browser.contexts()[0];
    const main = context.pages().find((p) => !p.url().includes("floating"));
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
    const fixture = path.join(root, "qa/folder-tags-fixtures");
    await api("settings.save", { key: "folderAutoTagging", value: true });
    for (const name of ["设计参考", "项目材料"])
      fs.mkdirSync(path.join(fixture, name), { recursive: true });
    fs.copyFileSync(
      path.join(root, "qa/fixtures/品牌视觉参考.png"),
      path.join(fixture, "设计参考/视觉图.png"),
    );
    fs.writeFileSync(
      path.join(fixture, "项目材料/项目说明.txt"),
      "Synthetic project reference",
    );
    await api("import", {
      paths: [
        path.join(fixture, "设计参考/视觉图.png"),
        path.join(fixture, "项目材料/项目说明.txt"),
      ],
      recursive: false,
    });
    await main.waitForFunction(
      async () =>
        (
          await window.__TAURI_INTERNALS__.invoke("api", {
            action: "import.status",
          })
        )?.done,
    );
    const manual = await api("tag.create", { name: "普通分类验收" });
    for (const [key, value] of Object.entries({
      theme: "light",
      details: false,
      sidebarCollapsed: false,
      sidebarWidth: 216,
      views: { all: "grid" },
    }))
      await api("settings.save", { key, value });
    await main.setViewportSize({ width: 1360, height: 900 });
    await main.reload();
    const folders = main.getByRole("region", {
      name: "文件夹标签",
      exact: true,
    });
    const ordinary = main.getByRole("region", {
      name: "普通标签",
      exact: true,
    });
    await folders.getByTitle("设计参考", { exact: true }).waitFor();
    await ordinary.getByTitle(manual.name, { exact: true }).waitFor();
    const boot = await api("bootstrap");
    for (const tag of boot.tags) {
      const group = tag.createdBy === "folder" ? folders : ordinary;
      assert.equal(
        await group.getByTitle(tag.name, { exact: true }).count(),
        1,
      );
    }
    assert.equal(
      await ordinary.getByTitle("设计参考", { exact: true }).count(),
      0,
    );
    console.log(
      "PASS sidebar separates all folder and ordinary tags with distinct group labels",
    );
    const folder = boot.tags.find((t) => t.name === "设计参考");
    await folders.getByTitle(folder.name, { exact: true }).click();
    await main.waitForFunction(
      () => document.querySelectorAll("[data-file-id]").length === 1,
    );
    await api("tags.rename", {
      id: folder.id,
      version: folder.version,
      name: "设计参考已更新",
    });
    await folders.getByTitle("设计参考已更新", { exact: true }).waitFor();
    const filtered = await api("query", {
      include: [folder.id],
      mode: "all",
      limit: 100,
    });
    assert.equal(filtered.files.length, 1);
    assert.ok(
      filtered.files[0].tags.some(
        (t) =>
          t.id === folder.id &&
          t.name === "设计参考已更新" &&
          t.createdBy === "folder",
      ),
    );
    console.log(
      "PASS folder filtering and renaming preserve file associations and folder classification",
    );
    await api("floating.open");
    let palette;
    for (let i = 0; i < 80; i++) {
      palette = context.pages().find((p) => p.url().includes("floating"));
      if (palette) break;
      await main.waitForTimeout(50);
    }
    palette.setDefaultTimeout(12000);
    palette.on("pageerror", (e) => errors.push(String(e)));
    const before = await api("floating.presets");
    assert.ok(before.tags.every((t) => t.createdBy !== "folder"));
    await assert.rejects(
      () => api("floating.save", { ids: [...before.ids, folder.id] }),
      /FOLDER_TAG_NOT_ALLOWED/,
    );
    assert.deepEqual((await api("floating.presets")).ids, before.ids);
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .click();
    const dialog = palette.getByRole("dialog", {
      name: "添加标签",
      exact: true,
    });
    assert.equal(
      await dialog
        .getByRole("button", { name: "设计参考已更新", exact: true })
        .count(),
      0,
    );
    await dialog.getByLabel("标签名称", { exact: true }).fill("设计参考已更新");
    await dialog.getByRole("button", { name: "添加", exact: true }).click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "文件夹标签不能添加到标签浮窗" })
      .waitFor();
    assert.deepEqual((await api("floating.presets")).ids, before.ids);
    assert.equal(
      (await api("bootstrap")).tags.find((t) => t.id === folder.id).createdBy,
      "folder",
    );
    console.log(
      "PASS folder labels are absent from candidates and rejected by both save API and typed-name creation",
    );
    await dialog.getByLabel("标签名称", { exact: true }).fill(manual.name);
    await dialog
      .getByRole("button", { name: manual.name, exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await palette
      .getByRole("button", { name: `标签：${manual.name}`, exact: true })
      .waitFor();
    await palette.reload();
    await palette
      .getByRole("button", { name: `标签：${manual.name}`, exact: true })
      .waitFor();
    assert.equal(
      await palette
        .getByRole("button", { name: "标签：设计参考已更新", exact: true })
        .count(),
      0,
    );
    console.log(
      "PASS ordinary tags can still be added and persist across floating reload",
    );
    const out = path.join(root, "qa/folder-tags");
    fs.mkdirSync(out, { recursive: true });
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
    const checkButton = async () => {
      const shape = await palette.locator(".glass-add").evaluate((el) => {
        const r = el.getBoundingClientRect(),
          a = document.querySelector(".palette-stage").getBoundingClientRect(),
          history = document
            .querySelector(".floating-history")
            ?.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          right: innerWidth - r.right,
          inside: r.top >= a.top && r.bottom <= a.bottom,
          clear:
            r.bottom <=
              document.querySelector(".floating-assist").getBoundingClientRect()
                .top &&
            (!history || r.bottom <= history.top),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(
        shape.width >= 132 &&
          shape.width < 170 &&
          shape.height === 48 &&
          shape.right >= 12 &&
          shape.right <= 20 &&
          shape.inside &&
          shape.clear &&
          !shape.overflow,
        JSON.stringify(shape),
      );
    };
    await setSize(340, 460);
    await checkButton();
    await palette.screenshot({ path: path.join(out, "floating-light.png") });
    await main.getByRole("button", { name: "全部文件", exact: true }).click();
    await main.waitForTimeout(300);
    await main.screenshot({ path: path.join(out, "workspace-light.png") });
    await setSize(280, 320);
    await checkButton();
    await palette.screenshot({ path: path.join(out, "floating-minimum.png") });
    await setSize(520, 600);
    await checkButton();
    console.log(
      "PASS compact lower-right add button fits normal, minimum and wider native windows without covering history",
    );
    await setSize(340, 460);
    await main.getByRole("button", { name: "偏好设置", exact: true }).click();
    await main
      .getByRole("dialog", { name: "偏好设置" })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await main.getByLabel("关闭对话框", { exact: true }).click();
    await palette.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await checkButton();
    await palette.screenshot({ path: path.join(out, "floating-dark.png") });
    await main.screenshot({ path: path.join(out, "workspace-dark.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS consistent light/dark grouped sidebar and floating action without uncaught UI errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
