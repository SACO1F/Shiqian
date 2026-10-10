const { chooseSelect } = require("./select-control.cjs");
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
    await p.getByRole("button", { name: "全部文件", exact: true }).waitFor();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    const api = (action, payload = {}) =>
      p.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const root = path.resolve(__dirname, "../qa/beta5-ui");
    const boot = await api("bootstrap");
    assert.equal(path.resolve(boot.dataPath), path.join(root, "library"));
    assert.equal(boot.version, "0.3.0-beta.5");
    await api("settings.save", { key: "folderAutoTagging", value: true });
    if (!(await api("query", { limit: 100 })).total) {
      await api("import", {
        paths: fs
          .readdirSync(root)
          .filter((n) => n.endsWith(".png"))
          .map((n) => path.join(root, n)),
      });
      for (let i = 0; i < 300; i++) {
        if ((await api("import.status"))?.done) break;
        await p.waitForTimeout(100);
      }
    }
    const other = path.join(root, "另一文件夹");
    fs.mkdirSync(other, { recursive: true });
    const otherFile = path.join(other, "另一目录资料.txt");
    fs.writeFileSync(otherFile, "synthetic folder candidate exclusion");
    await api("import", { paths: [otherFile] });
    for (let i = 0; i < 100; i++) {
      if ((await api("import.status"))?.done) break;
      await p.waitForTimeout(100);
    }
    const all = [
      ...(
        await api("query", {
          limit: 100,
          kinds: ["image"],
          sort: "name",
          direction: "asc",
        })
      ).files,
      ...(
        await api("query", {
          limit: 100,
          offset: 100,
          kinds: ["image"],
          sort: "name",
          direction: "asc",
        })
      ).files,
    ];
    assert.equal(all.length, 130);
    const folders = (await api("bootstrap")).tags.filter(
      (t) => t.createdBy === "folder",
    );
    assert.ok(folders.length);
    const group = await api("tag.create", { name: "同标签分组" });
    await api("files.tags", {
      ids: all.slice(0, 120).map((f) => f.id),
      versions: Object.fromEntries(
        all.slice(0, 120).map((f) => [f.id, f.version]),
      ),
      add: [group.id],
      remove: [],
    });
    await p.reload();
    await chooseSelect(p, "文件排序", "名称");
    const direction = p.getByRole("button", {
      name: "切换排序方向",
      exact: true,
    });
    if ((await direction.innerText()).includes("降序")) await direction.click();
    await p.getByRole("option", { name: all[0].name, exact: true }).click();
    const picker = p.getByRole("textbox", { name: "添加标签", exact: true });
    await picker.click();
    for (const t of folders)
      assert.equal(
        await p
          .locator(".inspector .tag-options")
          .getByRole("button", { name: "# " + t.name, exact: false })
          .count(),
        0,
      );
    const beforeFolderEnter = await api("file", { id: all[0].id });
    await picker.fill(folders[0].name);
    await picker.press("Enter");
    const afterFolderEnter = await api("file", { id: all[0].id });
    assert.equal(afterFolderEnter.version, beforeFolderEnter.version);
    assert.deepEqual(afterFolderEnter.tags, beforeFolderEnter.tags);
    await picker.press("Escape");
    console.log(
      "PASS folder tags absent from detail candidates and cannot be manually reapplied by Enter",
    );
    await p
      .getByRole("region", { name: "普通标签", exact: true })
      .getByRole("button", { name: "同标签分组 120", exact: true })
      .click();
    await p
      .getByRole("heading", { name: "全部文件 120", exact: true })
      .waitFor();
    await p.getByRole("button", { name: "全选当前结果", exact: true }).click();
    await p.waitForFunction(() =>
      document
        .querySelector(".content-meta")
        ?.textContent?.includes("已选 120 项"),
    );
    await p
      .getByRole("button", { name: "添加标签悬浮按钮", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "标签名称", exact: true })
      .fill("共同新标签");
    await p.getByRole("button", { name: "添加", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    const added = (await api("bootstrap")).tags.find(
      (t) => t.name === "共同新标签",
    );
    assert.ok(added);
    for (const f of all) {
      const current = await api("file", { id: f.id });
      assert.equal(
        current.tags.some((t) => t.id === added.id),
        all.indexOf(f) < 120,
      );
      assert.ok(current.tags.some((t) => folders.some((t2) => t.id === t2.id)));
    }
    console.log(
      "PASS all 120 matching files (across pagination) receive shared new tag; 10 nonmatching files unchanged; folder tags preserved",
    );
    await p.getByRole("button", { name: "全部文件", exact: true }).click();
    for (const theme of ["light", "dark"]) {
      await api("settings.save", { key: "theme", value: theme });
      await p.reload();
      await p
        .getByRole("button", { name: "收拢左侧菜单", exact: true })
        .click();
      await p.waitForTimeout(450);
      const buttons = p.locator(
        ".sidebar .main-nav button, .sidebar .sidebar-bottom > button",
      );
      for (let i = 0; i < (await buttons.count()); i++) {
        const button = buttons.nth(i);
        await button.hover();
        const geo = await button.evaluate((el) => {
          const a = el.getBoundingClientRect(),
            c = el.querySelector("svg").getBoundingClientRect(),
            s = getComputedStyle(el);
          return {
            dx: c.left + c.width / 2 - (a.left + a.width / 2),
            dy: c.top + c.height / 2 - (a.top + a.height / 2),
            radius: s.borderRadius,
            shadow: s.boxShadow,
          };
        });
        assert.ok(
          Math.abs(geo.dx) < 0.6 && Math.abs(geo.dy) < 0.6,
          JSON.stringify(geo),
        );
        assert.equal(geo.radius, "12px");
      }
      await p.screenshot({
        path: path.join(root, "sidebar-" + theme + ".png"),
      });
      await p
        .getByRole("button", { name: "展开左侧菜单", exact: true })
        .click();
      await p.waitForTimeout(450);
      for (let i = 0; i < (await buttons.count()); i++) {
        const dy = await buttons.nth(i).evaluate((el) => {
          const a = el.getBoundingClientRect(),
            c = el.querySelector("svg").getBoundingClientRect();
          return c.top + c.height / 2 - a.top - a.height / 2;
        });
        assert.ok(Math.abs(dy) < 0.6);
      }
    }
    console.log(
      "PASS all seven navigation/footer highlights centered on icons when collapsed, vertically centered when expanded, in both themes",
    );
    assert.deepEqual(errors, []);
    console.log("PASS no page errors");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
