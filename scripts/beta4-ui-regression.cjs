const { chooseSelect } = require("./select-control.cjs");
// Tests operate exclusively on a guarded synthetic library through the actual Tauri app.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const p = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    p.setDefaultTimeout(12000);
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
      "../qa/" + (process.env.BETA_QA_DIR || "beta4-ui"),
    );
    const boot = await api("bootstrap");
    assert.equal(path.resolve(boot.dataPath), path.join(root, "library"));
    assert.equal(boot.version, process.env.BETA_VERSION || "0.3.0-beta.4");
    await api("settings.save", { key: "folderAutoTagging", value: false });
    if (!(await api("query", { limit: 100 })).total) {
      await api("import", {
        paths: fs
          .readdirSync(root)
          .filter((n) => n.endsWith(".png"))
          .map((n) => path.join(root, n)),
      });
      for (let i = 0; i < 200; i++) {
        if ((await api("import.status"))?.done) break;
        await p.waitForTimeout(100);
      }
    }
    const tags = [];
    for (let i = 0; i < 18; i++)
      tags.push(
        await api("tag.create", {
          name: `回归标签 ${String(i).padStart(2, "0")}`,
        }),
      );
    const f = (await api("query", { limit: 100 })).files[0];
    await api("files.tags", {
      ids: [f.id],
      versions: { [f.id]: f.version },
      add: tags.slice(0, 2).map((t) => t.id),
      remove: tags.slice(2).map((t) => t.id),
    });
    await api("settings.save", { key: "details", value: true });
    await p.reload();
    await p.getByRole("option", { name: f.name, exact: true }).click();
    await p.getByRole("textbox", { name: "添加标签", exact: true }).click();
    const candidates = p.locator(".inspector .tag-options");
    for (const t of tags.slice(0, 2))
      assert.equal(
        await candidates
          .getByRole("button", { name: `# ${t.name}`, exact: false })
          .count(),
        0,
      );
    for (const t of tags.slice(2))
      assert.equal(
        await candidates
          .getByRole("button", { name: `# ${t.name}`, exact: false })
          .count(),
        1,
      );
    await candidates
      .getByRole("button", { name: "# 回归标签 17", exact: false })
      .click();
    assert.ok(
      (await api("file", { id: f.id })).tags.some((t) => t.id === tags[17].id),
    );
    console.log(
      "PASS applied tags excluded; all 16 unused candidates available; last candidate scrolls into view and applies",
    );
    const picker = p.getByRole("textbox", { name: "添加标签", exact: true });
    await picker.fill(tags[0].name);
    await picker.press("Enter");
    assert.equal(
      (await api("file", { id: f.id })).tags.filter((t) => t.id === tags[0].id)
        .length,
      1,
    );
    await picker.press("Escape");
    const second = (await api("query", { limit: 100 })).files[1];
    await p
      .getByRole("option", { name: second.name, exact: true })
      .click({ modifiers: ["Control"] });
    await picker.fill("");
    await picker.click();
    for (const t of tags.slice(0, 2))
      assert.equal(
        await candidates
          .getByRole("button", { name: `# ${t.name}`, exact: false })
          .count(),
        1,
      );
    await picker.press("Escape");
    await p
      .getByRole("option", { name: second.name, exact: true })
      .click({ modifiers: ["Control"] });
    console.log(
      "PASS Enter cannot reapply an existing tag; batch candidates keep tags missing from some selected files",
    );
    const area = p.getByRole("listbox", { name: "文件结果" });
    await area.evaluate((el) => {
      el.scrollTop = 1800;
    });
    await p.waitForTimeout(700);
    const before = await area.evaluate((el) => el.scrollTop);
    assert.ok(before > 1000);
    const values = [];
    for (let i = 0; i < 12; i++) {
      await p
        .getByRole("button", { name: "切换详情面板", exact: true })
        .click();
      await p.waitForTimeout(450);
      await p
        .getByRole("button", { name: "切换详情面板", exact: true })
        .click();
      await p.waitForTimeout(450);
      values.push(await area.evaluate((el) => el.scrollTop));
    }
    assert.ok(
      values.every((x) => Math.abs(x - before) <= 2),
      JSON.stringify({ before, values }),
    );
    console.log(
      "PASS 12 complete details toggle cycles at scroll offset " +
        before +
        ": " +
        values.join(","),
    );
    await p.screenshot({ path: path.join(root, "masonry-scroll.png") });
    await p.getByRole("button", { name: "取消选择", exact: true }).click();
    const signature = async (loc) => {
      await p.mouse.move(0, 0);
      await p.waitForTimeout(200);
      return loc.evaluate((el) => {
        const c = getComputedStyle(el);
        return [
          "borderRadius",
          "minHeight",
          "padding",
          "fontSize",
          "backgroundColor",
          "appearance",
        ].map((k) => c[k]);
      });
    };
    await area.evaluate((el) => (el.scrollTop = 0));
    for (const theme of ["light", "dark"]) {
      await api("settings.save", { key: "theme", value: theme });
      await p.reload();
      await p.waitForTimeout(350); // Let the existing theme color transition settle.
      const reference = await signature(
        p.getByLabel("文件排序", { exact: true }),
      );
      await p.getByRole("button", { name: "筛选", exact: true }).click();
      for (const name of ["文件状态筛选", "标签匹配方式"])
        assert.deepEqual(
          await signature(p.getByLabel(name, { exact: true })),
          reference,
        );
      await p.getByRole("button", { name: "偏好设置", exact: true }).click();
      const density = p.getByLabel("文件卡片密度", { exact: true });
      assert.deepEqual(await signature(density), reference);
      await chooseSelect(p, "文件卡片密度", "紧凑");
      assert.equal((await api("bootstrap")).settings.density, "compact");
      await chooseSelect(p, "文件卡片密度", "舒展");
      await p.screenshot({ path: path.join(root, `selectors-${theme}.png`) });
      await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
    }
    console.log(
      "PASS light/dark filter and density selectors match workspace sorting; density saves",
    );
    assert.deepEqual(errors, []);
    console.log("PASS no page errors");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
