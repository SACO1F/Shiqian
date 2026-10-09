// Real Tauri UI + SQLite regression. Only isolated QA libraries are allowed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => !p.url().includes("floating"));
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
    assert.equal(boot.version, require("../package.json").version);
    const output = path.join(root, "qa", "tag-polish");
    fs.mkdirSync(output, { recursive: true });
    const fixture = path.join(output, "随手记录.txt");
    fs.writeFileSync(fixture, "Synthetic QA document");
    await api("settings.save", { key: "folderAutoTagging", value: false });
    await api("import", {
      paths: [fixture, path.join(root, "qa/fixtures/品牌视觉参考.png")],
      recursive: false,
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
    await page.reload();
    const fab = page.getByRole("button", {
      name: "添加标签悬浮按钮",
      exact: true,
    });
    await fab.click();
    let modal = page.getByRole("dialog", { name: "添加标签", exact: true });
    await modal.getByLabel("标签名称", { exact: true }).fill("项目资料");
    await modal.getByRole("button", { name: "创建", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    let tag = (await api("bootstrap")).tags.find((t) => t.name === "项目资料");
    assert.ok(tag);
    assert.equal(tag.count, 0);
    console.log(
      "PASS floating action creates a library tag without selecting a file",
    );
    const q = {
      scope: "all",
      text: "",
      include: [],
      exclude: [],
      mode: "all",
      kinds: [],
      status: "",
      directory: "",
      recursive: true,
      sort: "name",
      direction: "asc",
      offset: 0,
      limit: 100,
    };
    const files = (await api("query", q)).files;
    assert.equal(files.length, 2);
    await page.locator(`[data-file-id="${files[0].id}"]`).click();
    await page
      .locator(`[data-file-id="${files[1].id}"]`)
      .click({ modifiers: ["Control"] });
    await fab.click();
    await modal.getByRole("button", { name: "项目资料", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    for (const f of files)
      assert.ok(
        (await api("file", { id: f.id })).tags.some((t) => t.id === tag.id),
      );
    console.log("PASS existing tag applies to multiple selected files");
    await fab.click();
    await modal.getByLabel("标签名称", { exact: true }).fill("灵感收集");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    for (const f of files)
      assert.ok(
        (await api("file", { id: f.id })).tags.some(
          (t) => t.name === "灵感收集",
        ),
      );
    console.log("PASS create-and-apply adds a new tag to all selected files");
    const presets = await api("floating.presets");
    await api("floating.save", { ids: [...new Set([...presets.ids, tag.id])] });
    await page.getByRole("button", { name: "标签浮窗", exact: true }).click();
    await page.waitForTimeout(500);
    const palette = context.pages().find((p) => p.url().includes("floating"));
    assert.ok(palette);
    await palette
      .getByRole("button", { name: "标签：项目资料", exact: true })
      .waitFor();
    await page
      .locator(".sidebar-tag-filter")
      .filter({ hasText: "项目资料" })
      .click();
    await page
      .getByRole("button", { name: "编辑标签项目资料", exact: true })
      .click();
    const manager = page.getByRole("dialog", { name: "管理标签", exact: true });
    const input = manager.getByLabel("标签新名称", { exact: true });
    await input.fill("工作素材");
    await manager.getByLabel("确认重命名", { exact: true }).click();
    await input.waitFor({ state: "hidden" });
    await manager.getByLabel("关闭对话框").click();
    for (const f of files) {
      const saved = await api("file", { id: f.id });
      assert.equal(saved.tags.find((t) => t.id === tag.id).name, "工作素材");
      assert.ok(!saved.tags.some((t) => t.name === "项目资料"));
    }
    await page
      .locator(".active-filters")
      .getByRole("button", { name: /工作素材/ })
      .waitFor();
    await palette
      .getByRole("button", { name: "标签：工作素材", exact: true })
      .waitFor();
    assert.equal((await api("query", { ...q, include: [tag.id] })).total, 2);
    console.log(
      "PASS rename synchronizes files, active filter, sidebar and the open floating palette",
    );
    await page
      .getByRole("button", { name: "编辑标签工作素材", exact: true })
      .click();
    await input.fill("灵感收集");
    await manager.getByLabel("确认重命名").click();
    await manager.getByRole("alert").waitFor();
    assert.equal(await input.inputValue(), "灵感收集");
    assert.equal(
      (await api("file", { id: files[0].id })).tags.find((t) => t.id === tag.id)
        .name,
      "工作素材",
    );
    await input.fill("");
    assert.ok(await manager.getByLabel("确认重命名").isDisabled());
    await input.fill("放弃修改");
    await input.press("Escape");
    await manager.waitFor();
    assert.equal(await input.count(), 0);
    await manager.getByLabel("关闭对话框").click();
    await page.getByLabel("撤销上一步", { exact: true }).click();
    await page
      .getByRole("button", { name: "编辑标签项目资料", exact: true })
      .waitFor();
    for (const f of files)
      assert.equal(
        (await api("file", { id: f.id })).tags.find((t) => t.id === tag.id)
          .name,
        "项目资料",
      );
    console.log(
      "PASS duplicate-name error retains input, blank name is blocked, Escape cancels and undo restores all associations",
    );
    await api("floating.close");
    await page.getByRole("button", { name: "清除条件", exact: true }).click();
    await page
      .locator(`[data-file-id="${files.find((f) => f.kind === "image").id}"]`)
      .click();
    await page.setViewportSize({ width: 1360, height: 900 });
    const fabBox = await fab.boundingBox();
    const inspectorBox = await page.locator(".inspector").boundingBox();
    assert.ok(
      fabBox.x + fabBox.width < inspectorBox.x,
      "FAB must not overlap inspector controls",
    );
    await page.mouse.move(750, 100);
    await page.waitForTimeout(3400);
    await page.screenshot({ path: path.join(output, "workspace-light.png") });
    await fab.click();
    await page.screenshot({ path: path.join(output, "quick-tag.png") });
    await modal.getByLabel("关闭对话框").click();
    await api("settings.save", { key: "theme", value: "dark" });
    await page.reload();
    await fab.waitFor();
    await page.screenshot({ path: path.join(output, "workspace-dark.png") });
    await page.setViewportSize({ width: 960, height: 640 });
    await page.getByLabel("收拢左侧菜单", { exact: true }).click();
    await fab.click();
    await modal.waitFor();
    assert.ok(
      await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({ path: path.join(output, "quick-tag-narrow.png") });
    await modal.getByLabel("关闭对话框").click();
    const box = await fab.boundingBox();
    assert.ok(
      box.x >= 0 && box.x + box.width <= 960 && box.y + box.height <= 640,
    );
    assert.equal((await page.locator(".brand").textContent()).trim(), "拾签");
    assert.equal(
      await page.getByText("文件在原处，线索在这里。", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS light/dark/narrow layouts, collapsed sidebar, accessible floating action and no uncaught UI errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
