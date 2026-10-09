// Real floating/main WebViews and export copying. Uses the editable destination
// field with an isolated QA folder; no IPC or file operations are mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const ctx = browser.contexts()[0],
      main = ctx.pages().find((p) => !p.url().includes("floating"));
    const invoke = (p, action, payload = {}) =>
      p.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const boot = await invoke(main, "bootstrap");
    assert.ok(
      path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
    );
    await invoke(main, "floating.open");
    let palette;
    for (let i = 0; i < 50; i++) {
      palette = ctx.pages().find((p) => p.url().includes("floating"));
      if (palette) break;
      await main.waitForTimeout(100);
    }
    palette.setDefaultTimeout(15000);
    const errors = [];
    palette.on("pageerror", (e) => errors.push(String(e)));
    main.on("pageerror", (e) => errors.push(String(e)));
    await palette.locator(".glass-add").waitFor();
    assert.equal(
      await palette.getByLabel("管理预设标签", { exact: true }).count(),
      0,
    );
    assert.equal(
      await palette.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
      "rgba(0, 0, 0, 0)",
    );
    assert.ok(
      (
        await palette
          .locator(".floating-shell")
          .evaluate((el) => getComputedStyle(el).backgroundImage)
      ).includes("gradient"),
    );
    assert.equal(
      await palette.locator(".tag-more").first().locator("circle").count(),
      9,
    );
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .click();
    const add = palette.getByRole("dialog", { name: "添加标签", exact: true });
    await add.getByLabel("标签名称", { exact: true }).fill("打包验收");
    await add.getByRole("button", { name: "添加", exact: true }).click();
    await add.waitFor({ state: "hidden" });
    let tag = (await invoke(main, "bootstrap")).tags.find(
      (t) => t.name === "打包验收",
    );
    assert.ok(tag);
    const fixture = path.join(root, "qa/glass-export");
    fs.mkdirSync(fixture, { recursive: true });
    const files = [];
    for (const [folder, name, content] of [
      ["A", "同名.txt", "alpha"],
      ["B", "同名.txt", "beta"],
      ["C", "缺失.txt", "missing"],
      ["D", "_拾签导出清单.txt", "source manifest"],
    ]) {
      const dir = path.join(fixture, folder);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      fs.writeFileSync(file, content);
      files.push(file);
    }
    await invoke(palette, "annotation.apply", { tagId: tag.id, paths: files });
    fs.unlinkSync(files[2]);
    await palette.getByLabel("管理标签打包验收", { exact: true }).click();
    await palette
      .getByRole("menuitem", { name: "修改名称", exact: true })
      .click();
    const rename = palette.getByRole("dialog", {
      name: "修改标签",
      exact: true,
    });
    await rename.getByLabel("标签新名称").fill("交付素材");
    await rename.getByRole("button", { name: "保存", exact: true }).click();
    await rename.waitFor({ state: "hidden" });
    tag = (await invoke(main, "bootstrap")).tags.find((t) => t.id === tag.id);
    assert.equal(tag.name, "交付素材");
    const list = (
      await invoke(main, "query", { include: [tag.id], limit: 100 })
    ).files;
    assert.equal(list.length, 4);
    assert.ok(list.every((f) => f.tags.some((t) => t.name === "交付素材")));
    console.log(
      "PASS glass styling, explicit add, nine-dot actions and rename synchronizes all linked files",
    );
    const out = path.join(fixture, "exports");
    fs.mkdirSync(out, { recursive: true });
    await palette.getByLabel("管理标签交付素材", { exact: true }).click();
    await palette
      .getByRole("menuitem", { name: "导出标签文件", exact: true })
      .click();
    const exp = palette.getByRole("dialog", {
      name: "导出标签文件",
      exact: true,
    });
    await exp.getByLabel("导出位置", { exact: true }).fill(out);
    await exp.getByRole("button", { name: "导出文件夹", exact: true }).click();
    await exp
      .getByRole("status")
      .filter({ hasText: "已复制 3 个，失败 1 个" })
      .waitFor();
    const target = await exp.locator(".export-path").innerText();
    const contents = fs
      .readdirSync(target)
      .filter((n) => n !== "_拾签导出清单.txt")
      .map((n) => fs.readFileSync(path.join(target, n), "utf8"))
      .sort();
    assert.deepEqual(contents, ["alpha", "beta", "source manifest"]);
    const manifest = fs.readFileSync(
      path.join(target, "_拾签导出清单.txt"),
      "utf8",
    );
    assert.ok(manifest.includes("缺失.txt") && manifest.includes("失败：1"));
    assert.equal(fs.readFileSync(files[0], "utf8"), "alpha");
    assert.equal(fs.readFileSync(files[1], "utf8"), "beta");
    await palette.screenshot({ path: path.join(fixture, "export-result.png") });
    await exp.getByLabel("关闭对话框").click();
    console.log(
      "PASS UI export copies original content, keeps same-name files, preserves sources and reports missing files",
    );
    await main.getByLabel("管理标签", { exact: true }).click();
    await main.getByLabel("导出标签交付素材的文件", { exact: true }).click();
    await main.getByRole("dialog", { name: "导出标签文件" }).waitFor();
    await main.getByRole("dialog").getByLabel("关闭对话框").click();
    console.log("PASS main tag manager exposes the same folder-export action");
    await palette.getByLabel("管理标签交付素材", { exact: true }).click();
    await palette
      .getByRole("menuitem", { name: "从浮窗移除", exact: true })
      .click();
    await palette
      .getByRole("button", { name: "标签：交付素材", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      (await invoke(main, "query", { include: [tag.id], limit: 100 })).total,
      4,
    );
    await palette
      .getByRole("button", { name: "添加标签", exact: true })
      .click();
    await add.getByRole("button", { name: "交付素材", exact: true }).click();
    await add.waitFor({ state: "hidden" });
    await palette.getByLabel("管理标签交付素材", { exact: true }).click();
    await palette
      .getByRole("menuitem", { name: "删除标签", exact: true })
      .click();
    const del = palette.getByRole("dialog", { name: "删除标签", exact: true });
    await del.getByRole("button", { name: "删除标签", exact: true }).click();
    await del.waitFor({ state: "hidden" });
    assert.ok(
      !(await invoke(main, "bootstrap")).tags.some((t) => t.id === tag.id),
    );
    assert.ok(fs.existsSync(files[0]));
    assert.equal(await palette.getByLabel("撤销上一步标注操作").count(), 0);
    await main.getByLabel("撤销上一步", { exact: true }).click();
    await palette
      .getByRole("button", { name: "标签：交付素材", exact: true })
      .waitFor();
    assert.equal(
      (await invoke(main, "query", { include: [tag.id], limit: 100 })).total,
      4,
    );
    console.log(
      "PASS unpin preserves annotations, existing tags can be added, delete has confirmation and undo restores associations",
    );
    for (const theme of ["light", "dark"]) {
      await invoke(main, "settings.save", { key: "theme", value: theme });
      await palette.waitForFunction(
        (t) => document.documentElement.dataset.theme === t,
        theme,
      );
      assert.ok(
        await palette.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await palette.screenshot({
        path: path.join(fixture, `floating-${theme}.png`),
      });
    }
    await palette.getByLabel("管理标签交付素材", { exact: true }).click();
    await palette.screenshot({ path: path.join(fixture, "tag-menu.png") });
    await palette
      .getByRole("menuitem", { name: "修改名称", exact: true })
      .click();
    await rename.getByLabel("标签新名称").fill("参考素材");
    await rename.getByRole("button", { name: "保存", exact: true }).click();
    await rename.getByRole("alert").waitFor();
    assert.equal(
      await rename.getByLabel("标签新名称").inputValue(),
      "参考素材",
    );
    await rename.getByLabel("关闭对话框").click();
    assert.deepEqual(errors, []);
    console.log(
      "PASS light/dark glass layouts, rename conflicts keep input, no uncaught UI exceptions",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
