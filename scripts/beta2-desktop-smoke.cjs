// Real Tauri/WebView2 integration with synthetic data only. Native save picker is not exercised.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const expectedVersion = process.env.BETA_VERSION || "0.3.0-beta.2";
const imagePrefix = process.env.BETA_IMAGE_PREFIX || "beta2";
const qa = path.join(root, "qa", process.env.BETA2_QA_DIR || "beta2");
(async () => {
  let browser;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${process.env.SHIQIAN_CDP_PORT || "9223"}`,
      );
      break;
    } catch (e) {
      if (attempt === 39) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    page.setDefaultTimeout(20000);
    await page
      .getByRole("button", { name: "偏好设置", exact: true })
      .waitFor({ timeout: 60000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const api = (action, payload = {}) =>
      page.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const wait = async (fn, predicate, count = 500) => {
      for (let i = 0; i < count; i++) {
        const value = await fn();
        if (predicate(value)) return value;
        await page.waitForTimeout(20);
      }
      throw new Error("Timed out");
    };
    const boot = await api("bootstrap");
    assert.equal(boot.version, expectedVersion);
    assert.equal(path.resolve(boot.dataPath), path.join(qa, "library"));
    fs.mkdirSync(qa, { recursive: true });
    if (process.env.BETA2_PHASE === "reopen") {
      const expected = JSON.parse(
        fs.readFileSync(path.join(qa, "expected.json")),
      );
      const current = await api("file", { id: expected.id });
      assert.equal(current.note, expected.note);
      assert.equal(current.identity, expected.identity);
      assert.equal(
        (await api("support.status")).lastBackup.kind,
        "beforeRestore",
      );
      assert.equal(boot.notice, "");
      await page
        .getByRole("button", { name: "查看后台任务", exact: true })
        .click();
      await page.getByText("暂无记录", { exact: true }).waitFor();
      assert.equal(errors.length, 0);
      console.log(
        "PASS release restart: committed metadata/identity/protective backup persist, dismissed recovery stays dismissed, session history resets",
      );
      return;
    }
    if (process.env.BETA2_PHASE !== "continue") {
      assert.ok(boot.notice.includes("上次资料包导入中断"));
      await page.getByRole("button", { name: "恢复提示", exact: true }).click();
      await page.getByRole("button", { name: "已了解", exact: true }).click();
      await wait(
        () => api("bootstrap"),
        (b) => !b.notice,
      );
      const original = path.join(qa, "合成资料.txt");
      fs.writeFileSync(original, "synthetic beta2 original");
      const missing = path.join(qa, "缺失文件.txt");
      await api("import", { paths: [original, missing] });
      const job = await wait(
        () => api("import.status"),
        (j) => j?.done,
      );
      assert.equal(job.failed, 1);
      assert.deepEqual(job.failedPaths, [missing]);
      fs.writeFileSync(missing, "synthetic retry original");
      await page
        .getByRole("button", { name: "查看后台任务", exact: true })
        .click();
      await page
        .getByRole("button", { name: "重试失败项", exact: true })
        .click();
      await wait(
        () => api("import.status"),
        (j) => j?.done && j.added === 1,
      );
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
      const files = (await api("query", { limit: 100 })).files;
      const file = files.find((f) => f.name === "合成资料.txt");
      assert.ok(file);
      // Real bytes afford time to operate the UI during hash/copy stages (128 MB default).
      const large = path.join(qa, "合成大文件.bin");
      const fd = fs.openSync(large, "w");
      const buffer = Buffer.alloc(1024 * 1024, 37);
      const megabytes = Number(process.env.BETA2_MEGABYTES || 128);
      assert.ok(
        Number.isInteger(megabytes) && megabytes >= 128 && megabytes <= 1024,
      );
      for (let i = 0; i < megabytes; i++) fs.writeSync(fd, buffer);
      fs.closeSync(fd);
      await api("import", { paths: [large] });
      await wait(
        () => api("import.status"),
        (j) => j?.done,
      );
      const largeFile = (await api("query", { text: "合成大文件", limit: 10 }))
        .files[0];
      const plan = await api("package.plan", { ids: [largeFile.id] });
      const pack = path.join(qa, "完整资料.sqtagpack");
      await api("package.export", {
        ids: [largeFile.id],
        path: pack,
        fingerprint: plan.fingerprint,
      });
      const destination = path.join(qa, "接收");
      fs.mkdirSync(destination, { recursive: true });
      await page.getByRole("button", { name: "偏好设置", exact: true }).click();
      await page
        .getByRole("button", { name: "导入资料包", exact: true })
        .click();
      await page.getByLabel("资料包路径", { exact: true }).fill(pack);
      await page
        .getByRole("button", { name: "校验并预览", exact: true })
        .click();
      await page
        .getByRole("button", { name: "确认导入", exact: true })
        .waitFor({ timeout: 120000 });
      await page
        .getByLabel("资料包接收目录", { exact: true })
        .fill(destination);
      await page.getByRole("button", { name: "确认导入", exact: true }).click();
      await page.getByRole("button", { name: "后台运行", exact: true }).click();
      const samples = [];
      for (let i = 0; i < 6; i++) {
        const start = Date.now();
        await api("query", { text: "合成", limit: 100 });
        samples.push(Date.now() - start);
        const status = await api("package.status");
        assert.equal(status.busy, true);
        await page.waitForTimeout(35);
      }
      const record = await api("file", { id: file.id });
      await api("note.save", {
        id: file.id,
        text: "复制期间保存的备注",
        version: record.noteVersion,
      });
      await assert.rejects(
        api("backup.restore", {
          path: path.join(qa, "nonexistent.sqtagbackup"),
        }),
        /TRANSFER_BUSY/,
      );
      await assert.rejects(api("main.close"), /TRANSFER_BUSY/);
      if (process.env.BETA_NATIVE_CLOSE === "1") {
        await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
        await page.getByRole("dialog", { name: "后台任务", exact: true }).waitFor();
        assert.equal(page.isClosed(), false);
        assert.equal((await api("package.status")).busy, true);
        console.log("PASS native close request kept active transfer and main window alive, task feedback visible");
      } else {
        await page.getByRole("button", { name: "查看后台任务", exact: true }).click();
      }
      await page
        .getByRole("progressbar", { name: "当前阶段进度", exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(root, `docs/images/${imagePrefix}-tasks-light.png`),
      });
      await page.getByRole("button", { name: "取消任务", exact: true }).click();
      await wait(
        () => api("package.status"),
        (s) => !s.busy,
      );
      assert.equal((await api("package.status")).history[0].state, "cancelled");
      assert.equal(
        (await api("file", { id: file.id })).note,
        "复制期间保存的备注",
      );
      assert.equal(fs.readdirSync(destination).length, 0);
      assert.ok(
        !fs.existsSync(path.join(boot.dataPath, "transfer-state.json")),
      );
      console.log(
        `PASS native background import: query latencies ${samples.join(", ")} ms, note edit retained, restore/exit gated, cancel rollback`,
      );
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
      const smallPlan = await api("package.plan", { ids: [file.id] });
      const smallPack = path.join(qa, "小资料.sqtagpack");
      await api("package.export", {
        ids: [file.id],
        path: smallPack,
        fingerprint: smallPlan.fingerprint,
      });
      const inspected = await api("package.inspect", { path: smallPack });
      const result = await api("package.import", {
        path: smallPack,
        destination,
        fingerprint: inspected.fingerprint,
      });
      assert.equal(result.fileCount, 1);
      await assert.rejects(
        api("package.import", {
          path: smallPack,
          destination,
          fingerprint: inspected.fingerprint,
        }),
        /PACKAGE_ALREADY_IMPORTED/,
      );
    }
    const file = (await api("query", { limit: 100 })).files.find(
      (f) => f.name === "合成资料.txt",
    );
    const backup = path.join(qa, "beta2.sqtagbackup");
    await api("backup.export", { path: backup });
    assert.equal((await api("support.status")).lastBackup.kind, "manual");
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.getByText(/最近标注备份：/).waitFor();
    await page
      .getByRole("button", { name: "预览诊断报告", exact: true })
      .click();
    const diagnostic = await page.getByLabel("诊断报告预览").textContent();
    assert.ok(diagnostic.includes(expectedVersion));
    for (const secret of [
      "合成资料.txt",
      qa,
      boot.dataPath,
      "复制期间保存的备注",
    ])
      assert.ok(!diagnostic.includes(secret));
    assert.equal(
      await page
        .getByRole("button", { name: "导出当前诊断", exact: true })
        .isEnabled(),
      true,
    );
    await api("diagnostics.export", { path: path.join(qa, "诊断报告.md") });
    assert.ok(
      fs
        .readFileSync(path.join(qa, "诊断报告.md"), "utf8")
        .includes(expectedVersion),
    );
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(root, `docs/images/${imagePrefix}-diagnostics-light.png`),
    });
    await api("settings.save", { key: "theme", value: "dark" });
    await page.reload();
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page
      .getByRole("button", { name: "预览诊断报告", exact: true })
      .click();
    await wait(
      () => page.evaluate(() => document.documentElement.dataset.theme),
      (theme) => theme === "dark",
    );
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(root, `docs/images/${imagePrefix}-diagnostics-dark.png`),
    });
    await page.setViewportSize({ width: 960, height: 680 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({
      path: path.join(root, `docs/images/${imagePrefix}-diagnostics-960.png`),
    });
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await api("backup.restore", { path: backup });
    assert.equal(
      (await api("support.status")).lastBackup.kind,
      "beforeRestore",
    );
    const finalRecord = await api("file", { id: file.id });
    fs.writeFileSync(
      path.join(qa, "expected.json"),
      JSON.stringify(finalRecord),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS task failure retry, small additive transfer/dedup, backup status/restore, diagnostic privacy/preview/export IPC, light/dark/960px/reduced-motion; no page errors; native save picker not exercised",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
