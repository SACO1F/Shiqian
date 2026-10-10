const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223"),
    p = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
  p.setDefaultTimeout(20000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const api = (action, payload = {}) =>
    p.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const boot = await api("bootstrap"),
    root = path.resolve(__dirname, ".."),
    qa = path.join(root, "qa", process.env.BETA_QA_DIR || "beta-transfer");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  assert.equal(boot.counts.all, 0);
  fs.mkdirSync(qa, { recursive: true });
  const wait = async (fn, predicate) => {
    for (let i = 0; i < 200; i++) {
      const v = await fn();
      if (predicate(v)) return v;
      await p.waitForTimeout(50);
    }
    throw Error("Wait timed out");
  };
  const hash = (f) =>
    crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const phase = process.env.BETA_PHASE || "send";
  if (phase === "send") {
    const folder = path.join(qa, "发送端");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "交接说明.md"),
      "合成项目资料，不含个人信息。\n",
    );
    fs.copyFileSync(
      path.join(root, "qa/fixtures/品牌视觉参考.png"),
      path.join(folder, "品牌图.png"),
    );
    await api("import", { paths: [folder], recursive: true });
    await wait(
      () => api("import.status"),
      (s) => s?.done,
    );
    const files = (await api("query", { scope: "all", limit: 100 })).files;
    assert.equal(files.length, 2);
    const tag = await api("tag.create", { name: "同事交接" });
    await api("files.tags", {
      ids: files.map((f) => f.id),
      versions: Object.fromEntries(files.map((f) => [f.id, f.version])),
      add: [tag.id],
      remove: [],
    });
    const first = await api("file", { id: files[0].id });
    await api("note.save", {
      id: first.id,
      text: "跨设备保留的备注",
      version: first.noteVersion,
    });
    await api("files.favorite", {
      ids: [first.id],
      versions: { [first.id]: first.version },
      value: true,
    });
    await p.getByRole("button", { name: "偏好设置", exact: true }).click();
    await p.getByRole("dialog").getByRole("button", { name: "导出资料包", exact: true }).click();
    await p
      .getByLabel("资料包路径", { exact: true })
      .fill(path.join(qa, "交接资料.sqtagpack"));
    await p.getByText("2 个文件", { exact: true }).waitFor();
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(qa, "export-light.png") });
    await p.getByRole("dialog").getByRole("button", { name: "导出资料包", exact: true }).click();
    await p.getByText("已导出 2 个文件", { exact: true }).waitFor();
    assert.ok(fs.existsSync(path.join(qa, "交接资料.sqtagpack")));
    const expected = [];
    for (const f of files) {
      const current = await api("file", { id: f.id });
      expected.push({
        name: current.name,
        note: current.note,
        favorite: current.favorite,
        tags: current.tags.map((t) => ({ name: t.name, source: t.source })),
        hash: hash(current.path),
      });
    }
    fs.writeFileSync(path.join(qa, "expected.json"), JSON.stringify(expected));
    await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
    // Tag-scope and selected-file export use the same IPC contract.
    const selected = await api("package.plan", { ids: [first.id] });
    assert.equal(selected.fileCount, 1);
    const tagPlan = await api("package.plan", { tagId: tag.id });
    assert.equal(tagPlan.fileCount, 2);
    console.log(
      "PASS sender: UI preview/export, original hashes, metadata manifest, selected/tag scopes",
    );
  } else {
    const expected = JSON.parse(
      fs.readFileSync(path.join(qa, "expected.json")),
    );
    const existing = path.join(qa, "已有资料.txt");
    fs.writeFileSync(existing, "existing library content");
    await api("import", { paths: [existing] });
    await wait(
      () => api("import.status"),
      (s) => s?.done,
    );
    const old = (await api("query", { limit: 100 })).files[0];
    await api("note.save", {
      id: old.id,
      text: "接收端已有备注",
      version: old.noteVersion,
    });
    const existingTag = await api("tag.create", { name: "同事交接" });
    await p.getByRole("button", { name: "偏好设置", exact: true }).click();
    await p.getByRole("button", { name: "导入资料包", exact: true }).click();
    await p
      .getByLabel("资料包路径", { exact: true })
      .fill(path.join(qa, "交接资料.sqtagpack"));
    await p.getByRole("button", { name: "校验并预览", exact: true }).click();
    await p.getByText("2 个文件", { exact: true }).waitFor();
    const destination = path.join(qa, "接收端-复验");
    fs.mkdirSync(destination, { recursive: true });
    await p.getByLabel("资料包接收目录", { exact: true }).fill(destination);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(qa, "import-light.png") });
    await p.getByRole("button", { name: "确认导入", exact: true }).click();
    await p.getByText("已导入 2 个文件", { exact: true }).waitFor();
    const records = (await api("query", { limit: 100 })).files;
    assert.equal(records.length, 3);
    for (const wanted of expected) {
      const actual = records.find((f) => f.name === wanted.name);
      assert.ok(actual);
      assert.equal(actual.note, wanted.note);
      assert.equal(actual.favorite, wanted.favorite);
      assert.equal(hash(actual.path), wanted.hash);
      assert.deepEqual(
        actual.tags
          .map((t) => ({ name: t.name, source: t.source }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        wanted.tags.sort((a, b) => a.name.localeCompare(b.name)),
      );
      assert.equal(
        actual.tags.find((t) => t.name === "同事交接").id,
        existingTag.id,
      );
      assert.equal(actual.aiTask, null);
    }
    assert.equal((await api("file", { id: old.id })).note, "接收端已有备注");
    console.log(
      "PASS recipient: independent library, additive import, names/hashes/notes/favorites/tag origins, no AI task",
    );
    await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await p.getByRole("button", { name: "偏好设置", exact: true }).click();
    await p.getByRole("button", { name: "导入资料包", exact: true }).click();
    await p
      .getByLabel("资料包路径", { exact: true })
      .fill(path.join(qa, "交接资料.sqtagpack"));
    await p.getByRole("button", { name: "校验并预览", exact: true }).click();
    await p.getByText("2 个文件", { exact: true }).waitFor();
    await p.getByLabel("资料包接收目录", { exact: true }).fill(destination);
    await p.getByRole("button", { name: "确认导入", exact: true }).click();
    await p.getByRole("alert").filter({ hasText: "本库已导入" }).waitFor();
    assert.equal((await api("bootstrap")).counts.all, 3);
    console.log("PASS repeat import: rejected without duplicates");
    await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await api("settings.save", { key: "theme", value: "dark" });
    await p.reload();
    await p.getByRole("button", { name: "偏好设置", exact: true }).click();
    await p.getByRole("button", { name: "导入资料包", exact: true }).click();
    await p
      .getByLabel("资料包路径", { exact: true })
      .fill(path.join(qa, "交接资料.sqtagpack"));
    await p.getByRole("button", { name: "校验并预览", exact: true }).click();
    await p.getByText("2 个文件", { exact: true }).waitFor();
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(qa, "import-dark.png") });
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.setViewportSize({ width: 960, height: 690 });
    const dialog = p.getByRole("dialog");
    assert.ok(await dialog.isVisible());
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    console.log("PASS dark/reduced-motion/narrow dialog");
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log("PASS no JavaScript errors");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
