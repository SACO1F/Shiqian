// Actual Tauri IPC, filesystem import and worker; only the model endpoint is simulated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, test, label) {
  for (let i = 0; i < 150; i++) {
    const v = await fn();
    if (test(v)) return v;
    await pause(100);
  }
  throw Error(`Timed out: ${label}`);
}
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => !p.url().includes("floating"));
  page.setDefaultTimeout(20000);
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
  assert.equal(boot.counts.all, 0, "Use a fresh isolated QA library");
  const folder = path.join(root, "qa", "auto-tags-fixtures", "设计素材");
  fs.mkdirSync(folder, { recursive: true });
  // Use a browser-generated, valid PNG with a distinguishable geometric subject.
  const pixels = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const x = c.getContext("2d");
    x.fillStyle = "#f1e6d1";
    x.fillRect(0, 0, 600, 400);
    x.fillStyle = "#548475";
    x.beginPath();
    x.arc(260, 195, 125, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#d1a358";
    x.fillRect(300, 195, 140, 140);
    return c.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(
    path.join(folder, "几何海报.png"),
    Buffer.from(pixels, "base64"),
  );
  fs.writeFileSync(
    path.join(folder, "项目需求.txt"),
    "品牌设计项目需求：绿色与金色几何图案，用于海报。",
    "utf8",
  );
  fs.writeFileSync(
    path.join(folder, "旧版文档.doc"),
    "synthetic unsupported Office fixture",
  );
  const existing = await api("tag.create", { name: "参考素材" });
  let mode = "first",
    requests = [],
    held = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer synthetic-desktop-key");
      const body = JSON.parse(Buffer.concat(chunks));
      if (
        typeof body.messages[0].content === "string" &&
        body.messages[0].content.includes("连接测试")
      ) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
        return;
      }
      const parts = body.messages.find((m) => m.role === "user").content;
      const metadata = JSON.parse(parts[0].text);
      assert.ok(!JSON.stringify(body).includes(folder));
      assert.ok(metadata.existingTags.some((t) => t.id === existing.id));
      assert.ok(
        parts.some(
          (p) =>
            p.type === "image_url" ||
            (p.type === "text" && p.text.includes("品牌设计")),
        ),
      );
      requests.push({ name: metadata.fileName, mode });
      const current = mode;
      const send = () => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    tags: [
                      {
                        id: existing.id,
                        name: "参考素材",
                        reason: "用于设计参考",
                      },
                      {
                        id: null,
                        name: current === "first" ? "几何图案" : "构图分析",
                        reason: "合成图案内容",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        );
      };
      if (current === "hold") held.push(send);
      else send();
    } catch (e) {
      res.statusCode = 500;
      res.end("synthetic-test-failure");
      console.error(e);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const checks = [];
  const pass = (name) => {
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  const query = {
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
  try {
    assert.equal((await api("ai.settings")).config.enabled, false);
    const config = {
      enabled: true,
      endpoint: `http://127.0.0.1:${server.address().port}/v1`,
      model: "synthetic-vision",
      allowNewTags: true,
    };
    await api("ai.settings.save", { config, apiKey: "synthetic-desktop-key" });
    assert.equal((await api("ai.test")).ok, true);
    await api("import", { paths: [folder], recursive: true });
    await poll(
      () => api("import.status"),
      (j) => j.done,
      "import",
    );
    let files = await poll(
      () => api("query", query),
      (r) =>
        r.total === 3 &&
        r.files.every((f) =>
          ["done", "unsupported"].includes(f.aiTask?.status),
        ),
      "AI import tasks",
    );
    assert.equal(
      files.files.filter((f) => f.aiTask.status === "done").length,
      2,
    );
    assert.equal(
      files.files.find((f) => f.extension === "doc").aiTask.status,
      "unsupported",
    );
    for (const f of files.files)
      assert.ok(
        f.tags.some((t) => t.name === "设计素材" && t.source === "folder"),
      );
    const photo = files.files.find((f) => f.kind === "image");
    assert.ok(
      photo.tags.some(
        (t) =>
          t.id === existing.id && t.source === "ai" && t.createdBy === "manual",
      ),
    );
    assert.ok(
      photo.tags.some(
        (t) =>
          t.name === "几何图案" && t.source === "ai" && t.createdBy === "ai",
      ),
    );
    pass(
      "real import -> folder tag -> extracted content -> worker -> existing/new AI associations; unsupported file keeps folder tag",
    );
    const previous = requests.length;
    await api("import", { paths: [folder], recursive: true });
    await poll(
      () => api("import.status"),
      (j) => j.done,
      "duplicate import",
    );
    await pause(700);
    assert.equal(requests.length, previous);
    pass("duplicate imports do not repeat AI requests");
    await api("ai.confirm", {
      id: photo.id,
      tagId: existing.id,
      version: photo.version,
    });
    let current = await api("file", { id: photo.id });
    const manual = await api("tag.create", { name: "人工保留" });
    await api("files.tags", {
      ids: [photo.id],
      versions: { [photo.id]: current.version },
      add: [manual.id],
      remove: [],
    });
    mode = "refresh";
    await api("ai.enqueue", { ids: [photo.id] });
    current = await poll(
      () => api("file", { id: photo.id }),
      (f) => f.aiTask.status === "done",
      "reanalysis",
    );
    assert.ok(current.tags.some((t) => t.id === existing.id && t.ai.confirmed));
    assert.ok(
      current.tags.some((t) => t.id === manual.id && t.source === "manual"),
    );
    assert.ok(current.tags.some((t) => t.name === "构图分析"));
    assert.ok(!current.tags.some((t) => t.name === "几何图案"));
    pass(
      "reanalysis retains manual/folder/confirmed tags and replaces unconfirmed AI tags",
    );
    mode = "hold";
    await api("ai.enqueue", { ids: [photo.id] });
    await poll(
      async () => held.length,
      (n) => n > 0,
      "pending response",
    );
    current = await api("file", { id: photo.id });
    await api("files.favorite", {
      ids: [photo.id],
      versions: { [photo.id]: current.version },
      value: true,
    });
    held.shift()();
    current = await poll(
      () => api("file", { id: photo.id }),
      (f) => f.aiTask.status === "failed",
      "stale response",
    );
    assert.ok(current.aiTask.error.startsWith("FILE_CHANGED"));
    pass(
      "a user edit during inference prevents a stale response overwriting tags",
    );
    await api("ai.enqueue", { ids: [photo.id] });
    await poll(
      async () => held.length,
      (n) => n > 0,
      "cancel pending response",
    );
    await api("ai.cancel");
    held.shift()();
    await pause(700);
    assert.equal(
      (await api("file", { id: photo.id })).aiTask.status,
      "cancelled",
    );
    pass("cancel discards an in-flight result");
    mode = "refresh";
    await api("ai.enqueue", { ids: [photo.id] });
    await poll(
      () => api("file", { id: photo.id }),
      (f) => f.aiTask.status === "done",
      "final reanalysis",
    );
    await page.reload();
    await page.setViewportSize({ width: 1360, height: 980 });
    await page.locator(`[data-file-id="${photo.id}"]`).click();
    await page
      .locator(".inspector")
      .getByLabel("AI 已确认", { exact: true })
      .waitFor();
    assert.ok(
      await page
        .locator(".inspector")
        .getByLabel("AI 待确认", { exact: true })
        .isVisible(),
    );
    fs.mkdirSync(path.join(root, "qa/auto-tags-desktop"), { recursive: true });
    await page.locator(`[data-file-id="${photo.id}"]`).hover();
    await page.waitForFunction((id) => {
      const mark = document.querySelector(
        `[data-file-id="${id}"] .gallery-ai-mark`,
      );
      return mark && getComputedStyle(mark).opacity === "0";
    }, photo.id);
    await page.mouse.move(700, 30);
    await page.screenshot({
      path: path.join(root, "qa/auto-tags-desktop/tags.png"),
    });
    await page.getByRole("button", { name: "偏好设置" }).click();
    const dialog = page.getByRole("dialog", { name: "偏好设置" });
    await dialog.getByLabel("AI 服务地址", { exact: true }).waitFor();
    assert.equal(
      await dialog.getByLabel("AI API Key", { exact: true }).inputValue(),
      "",
    );
    await dialog
      .getByLabel("启用 AI 自动标注，允许向上述服务发送分析内容")
      .scrollIntoViewIfNeeded();
    await dialog.locator(".modal-content").evaluate((el) => {
      el.scrollTop = 375;
    });
    await page.screenshot({
      path: path.join(root, "qa/auto-tags-desktop/settings.png"),
    });
    await page.getByLabel("关闭对话框", { exact: true }).click();
    pass(
      "real desktop displays AI badges, confirmation and settings without revealing stored key",
    );
    const backup = path.join(root, "qa/auto-tags-desktop/library.sqtagbackup");
    await api("backup.export", { path: backup });
    await api("backup.restore", { path: backup });
    const restored = await api("ai.settings");
    assert.equal(restored.config.enabled, false);
    assert.equal(restored.config.endpoint, "");
    assert.ok(
      (await api("file", { id: photo.id })).tags.some((t) => t.ai?.confirmed),
    );
    pass(
      "real backup round-trip preserves confirmed provenance and disables AI",
    );
    fs.writeFileSync(
      path.join(root, "qa/auto-tags-desktop/results.txt"),
      checks.map((s) => `PASS ${s}`).join("\n") + "\n",
    );
  } finally {
    for (const send of held) send();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
