// Real WebView + IPC + isolated library. Model requests use a local deterministic server.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223"),
    ctx = browser.contexts()[0],
    p = ctx.pages().find((p) => !p.url().includes("floating"));
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.setDefaultTimeout(15000);
  const api = (action, payload = {}) =>
    p.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const boot = await api("bootstrap");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  assert.equal(boot.counts.all, 0, "Use a fresh QA library");
  let mode = "hold",
    held = [];
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      const parts = [];
      for await (const c of req) parts.push(c);
      const body = JSON.parse(Buffer.concat(parts)),
        metadata = JSON.parse(
          body.messages.find((m) => m.role === "user").content[0].text,
        );
      requests.push(metadata.fileName);
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
                        id: null,
                        name: `建议-${metadata.fileName.replace(".txt", "")}`,
                        reason: "合成资料测试",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        );
      };
      if (mode === "hold") held.push({ send, name: metadata.fileName });
      else if (mode === "fail") {
        res.statusCode = 500;
        res.end("Synthetic model failure");
      } else send();
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const out = path.join(root, "qa/micro-experience");
  fs.mkdirSync(out, { recursive: true });
  const wait = async (fn, test, label) => {
    for (let i = 0; i < 160; i++) {
      const value = await fn();
      if (test(value)) return value;
      await p.waitForTimeout(75);
    }
    throw Error(`Timeout: ${label}`);
  };
  const observe = async (page, selectors) =>
    page.evaluate((selectors) => {
      window.__motionEvidence = {};
      window.__motionObserver?.disconnect();
      const scan = () => {
        for (const s of selectors) {
          const els = document.querySelectorAll(s);
          for (const el of els)
            if (el.getAnimations().some((a) => a.playState === "running"))
              window.__motionEvidence[s] = true;
        }
      };
      window.__motionObserver = new MutationObserver(() =>
        requestAnimationFrame(scan),
      );
      window.__motionObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }, selectors);
  const seen = async (page, selector) =>
    page.evaluate((selector) => !!window.__motionEvidence[selector], selector);
  try {
    const fixture = path.join(root, "qa/micro-experience-fixtures");
    fs.mkdirSync(fixture, { recursive: true });
    fs.copyFileSync(
      path.join(root, "qa/fixtures/品牌视觉参考.png"),
      path.join(fixture, "视觉参考.png"),
    );
    for (const name of ["识别甲.txt", "识别乙.txt"])
      fs.writeFileSync(
        path.join(fixture, name),
        "Synthetic brand design reference content",
      );
    await api("import", { paths: [fixture], recursive: false });
    await wait(
      () => api("import.status"),
      (j) => j?.done,
      "import",
    );
    for (const [key, value] of Object.entries({
      theme: "light",
      sidebarWidth: 216,
      sidebarCollapsed: false,
      details: false,
      views: { all: "grid" },
      galleryColumns: 3,
    }))
      await api("settings.save", { key, value });
    await p.setViewportSize({ width: 1360, height: 900 });
    await p.reload();
    await p.locator(".tag-fab").waitFor();
    await p.emulateMedia({ reducedMotion: "no-preference" });
    const initialArea = await p.locator(".file-area").boundingBox();
    await p.locator(".tag-fab").focus();
    const entry = await p.evaluate(async () => {
      document.querySelector(".tag-fab").click();
      const values = [];
      const until = performance.now() + 240;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        const el = document.querySelector(".modal");
        if (el) values.push(+getComputedStyle(el).opacity);
      }
      return values;
    });
    assert.ok(entry.some((v) => v > 0 && v < 1));
    const dialog = p.getByRole("dialog", { name: "添加标签", exact: true });
    await dialog.getByLabel("标签名称", { exact: true }).waitFor();
    await p.keyboard.press("Tab");
    assert.ok(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    );
    await p.evaluate(() => {
      const b = document.querySelector(".modal-header button");
      b.click();
      b.click();
    });
    await p.locator(".modal-backdrop").waitFor({ state: "detached" });
    assert.ok(
      await p
        .locator(".tag-fab")
        .evaluate((el) => el === document.activeElement),
    );
    assert.deepEqual(await p.locator(".file-area").boundingBox(), initialArea);
    console.log(
      "PASS dialogs animate in/out, trap keyboard focus, deduplicate dismissal and return focus without changing file layout",
    );
    const files = (await api("query", { limit: 100 })).files,
      photo = files.find((f) => f.kind === "image"),
      a = files.find((f) => f.name === "识别甲.txt"),
      b = files.find((f) => f.name === "识别乙.txt");
    const selection = await p.evaluate(async (id) => {
      const button = document.querySelector(`[data-file-id="${id}"]`),
        check = button.querySelector(".selection-check"),
        before = button.getBoundingClientRect();
      button.click();
      const v = [],
        until = performance.now() + 230;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        v.push(+getComputedStyle(check).opacity);
      }
      const after = button.getBoundingClientRect();
      return {
        v,
        same: check === button.querySelector(".selection-check"),
        size: [before.width, before.height, after.width, after.height],
      };
    }, photo.id);
    assert.ok(selection.same && selection.v.some((v) => v > 0 && v < 1));
    assert.equal(selection.size[0], selection.size[2]);
    assert.equal(selection.size[1], selection.size[3]);
    await p
      .locator(`[data-file-id="${a.id}"]`)
      .click({ modifiers: ["Control"] });
    assert.equal(
      await p.locator('[data-file-id][aria-selected="true"]').count(),
      2,
    );
    await p
      .locator(`[data-file-id="${a.id}"]`)
      .click({ modifiers: ["Control"] });
    assert.equal(
      await p.locator('[data-file-id][aria-selected="true"]').count(),
      1,
    );
    await p.getByLabel("列表视图", { exact: true }).click();
    await p.locator(".file-list").first().waitFor();
    await p.getByLabel("瀑布流视图", { exact: true }).click();
    await p.locator(".masonry-card").first().waitFor();
    console.log(
      "PASS persistent selection checks have intermediate frames without resizing cards; Ctrl add/remove and both layouts retain correct selection",
    );
    await api("floating.open");
    const floating = await wait(
      () => ctx.pages().find((page) => page.url().includes("floating")),
      Boolean,
      "floating window",
    );
    floating.setDefaultTimeout(15000);
    floating.on("pageerror", (e) => errors.push(String(e)));
    await floating.locator(".glass-add").waitFor();
    await floating.emulateMedia({ reducedMotion: "no-preference" });
    await floating.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
        label: "floating",
        value: { Logical: { width: 340, height: 620 } },
      }),
    );
    await floating.waitForFunction(() => innerHeight === 620);
    await observe(floating, [
      ".palette-chip",
      ".floating-history li",
      ".history-ghost",
    ]);
    await observe(p, [".sidebar-tag-row"]);
    for (let i = 1; i <= 4; i++) {
      await floating
        .getByRole("button", { name: "添加标签", exact: true })
        .click();
      const d = floating.getByRole("dialog", { name: "添加标签", exact: true });
      await d.getByLabel("标签名称", { exact: true }).fill(`体验标签 ${i}`);
      await d.getByRole("button", { name: "添加", exact: true }).click();
      await floating.locator(".modal-backdrop").waitFor({ state: "detached" });
      await floating
        .getByRole("button", { name: `标签：体验标签 ${i}`, exact: true })
        .waitFor();
      await floating.waitForTimeout(80);
    }
    await floating.waitForTimeout(240);
    assert.equal(await floating.locator(".floating-history li").count(), 3);
    assert.ok(
      (
        await floating.locator(".floating-history li").first().textContent()
      ).includes("体验标签 4"),
    );
    assert.ok(
      !(await floating.locator(".floating-history").textContent()).includes(
        "体验标签 1",
      ),
    );
    assert.ok(await seen(floating, ".palette-chip"));
    assert.ok(await seen(floating, ".floating-history li"));
    assert.ok(await seen(floating, ".history-ghost"));
    assert.ok(await seen(p, ".sidebar-tag-row"));
    assert.equal(await floating.locator(".history-ghost").count(), 0);
    const savedIds = await floating
      .locator(".floating-history li")
      .evaluateAll((els) => els.map((el) => el.dataset.operationId));
    await floating.reload();
    await floating.locator(".floating-history li").first().waitFor();
    assert.deepEqual(
      await floating
        .locator(".floating-history li")
        .evaluateAll((els) => els.map((el) => el.dataset.operationId)),
      savedIds,
    );
    assert.equal(await floating.getByLabel("撤销上一步标注操作").count(), 0);
    console.log(
      "PASS new tags animate in workspace and floating palette; latest three records animate with outgoing cleanup and persist across reload without an undo button",
    );
    const trigger = floating.getByLabel("管理标签体验标签 4", { exact: true });
    await trigger.click();
    await floating.getByRole("menu").waitFor();
    await floating.keyboard.press("ArrowDown");
    assert.equal(
      await floating.evaluate(() => document.activeElement.textContent.trim()),
      "从浮窗移除",
    );
    await floating.keyboard.press("Home");
    assert.equal(
      await floating.evaluate(() => document.activeElement.textContent.trim()),
      "修改名称",
    );
    const glide = await floating.evaluate(async () => {
      const menu = document.querySelector(".float-tag-menu"),
        item = menu.querySelectorAll('[role="menuitem"]')[3],
        v = [],
        until = performance.now() + 220;
      item.focus();
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        v.push(
          new DOMMatrixReadOnly(
            getComputedStyle(menu.querySelector(".menu-glide")).transform,
          ).m42,
        );
      }
      return v;
    });
    assert.ok(glide.some((v, i) => i && v !== glide[i - 1]));
    await floating.keyboard.press("Escape");
    await floating.locator(".float-tag-menu").waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate((el) => document.activeElement === el));
    await trigger.click();
    await floating
      .getByRole("menuitem", { name: "修改名称", exact: true })
      .click();
    await floating.getByRole("dialog", { name: "修改标签" }).waitFor();
    await floating.keyboard.press("Escape");
    await floating.locator(".modal-backdrop").waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate((el) => document.activeElement === el));
    await floating.evaluate(() => {
      const t = document.querySelector('[aria-label="管理标签体验标签 4"]');
      t.click();
      setTimeout(
        () => document.querySelector(".float-menu-dismiss")?.click(),
        35,
      );
      setTimeout(() => t.click(), 70);
    });
    await floating.waitForTimeout(300);
    assert.equal(await floating.locator(".float-tag-menu").count(), 1);
    await floating.keyboard.press("Escape");
    await floating
      .locator(".float-menu-dismiss")
      .waitFor({ state: "detached" });
    console.log(
      "PASS nine-dot menu supports animated highlight, keyboard navigation, dialog focus return and reopening during dismissal without stale overlays",
    );
    await api("ai.settings.save", {
      config: {
        enabled: true,
        endpoint: `http://127.0.0.1:${server.address().port}/v1`,
        model: "synthetic-experience",
        allowNewTags: true,
      },
      apiKey: "",
    });
    await api("ai.enqueue", { ids: [a.id, b.id] });
    await wait(
      () => held.length,
      (n) => n === 1,
      "held request",
    );
    const running = (await api("query", { limit: 100 })).files.find(
        (f) => f.aiTask?.status === "running",
      ),
      other = running.id === a.id ? b : a;
    await p.getByLabel("切换详情面板", { exact: true }).click();
    await p.locator(`[data-file-id="${running.id}"]`).click();
    await p.locator(".task-lattice").waitFor();
    assert.ok(
      await p
        .getByRole("button", { name: "AI 识别中", exact: true })
        .isDisabled(),
    );
    await p.getByRole("button", { name: "取消识别", exact: true }).click();
    await wait(
      () => api("file", { id: running.id }),
      (f) => f.aiTask?.status === "cancelled",
      "cancel target",
    );
    assert.equal((await api("file", { id: other.id })).aiTask.status, "queued");
    mode = "auto";
    held.splice(0).forEach((r) => r.send());
    await wait(
      () => api("file", { id: other.id }),
      (f) => f.aiTask?.status === "done",
      "other finishes",
    );
    assert.ok(
      !(await api("file", { id: running.id })).tags.some(
        (t) => t.source === "ai",
      ),
    );
    await p.locator(`[data-file-id="${other.id}"]`).click();
    await p.locator('.ai-task-status[data-task-state="review"]').waitFor();
    const current = await api("file", { id: other.id }),
      suggestion = current.tags.find((t) => t.source === "ai");
    assert.ok(
      !(await api("bootstrap")).tags.some((t) => t.id === suggestion.id),
    );
    await observe(p, [".editable-tag"]);
    await observe(floating, [".palette-chip"]);
    await p.getByLabel(`确认AI标签${suggestion.name}`, { exact: true }).click();
    await floating
      .getByRole("button", { name: `标签：${suggestion.name}`, exact: true })
      .waitFor();
    await p.locator('.ai-task-status[data-task-state="done"]').waitFor();
    assert.equal(await p.getByLabel("AI 待确认", { exact: true }).count(), 0);
    assert.ok(await seen(p, ".editable-tag"));
    assert.ok(await seen(floating, ".palette-chip"));
    console.log(
      "PASS running AI has lattice feedback; cancelling selected file leaves other job queued; late response is discarded; accepting suggestion removes badge, updates pool/palette and animates locally",
    );
    mode = "fail";
    await p.locator(`[data-file-id="${running.id}"]`).click();
    await p.getByRole("button", { name: "AI 重试识别", exact: true }).click();
    await p.locator('.ai-task-status[data-task-state="error"]').waitFor();
    mode = "auto";
    await p.getByRole("button", { name: "AI 重试识别", exact: true }).click();
    await p.locator('.ai-task-status[data-task-state="review"]').waitFor();
    await p
      .locator(`[data-file-id="${other.id}"]`)
      .click({ modifiers: ["Control"] });
    await p.waitForFunction(() =>
      document.querySelector(".ai-task-status")?.textContent.includes("完成 2"),
    );
    console.log(
      "PASS failed AI visibly offers retry, retry completes, and batch selection shows actual per-state counts and pending labels",
    );
    await p.locator(`[data-file-id="${other.id}"]`).click();
    for (const theme of ["light", "dark"]) {
      await p.getByRole("button", { name: "偏好设置", exact: true }).click();
      await p
        .getByRole("dialog", { name: "偏好设置" })
        .getByRole("button", {
          name: theme === "light" ? "浅色" : "深色",
          exact: true,
        })
        .click();
      await p.getByLabel("关闭对话框", { exact: true }).click();
      await p.locator(".modal-backdrop").waitFor({ state: "detached" });
      await floating.waitForFunction(
        (t) => document.documentElement.dataset.theme === t,
        theme,
      );
      await p.mouse.move(700, 30);
      await floating.mouse.move(5, 70);
      await p.waitForTimeout(240);
      await p.screenshot({ path: path.join(out, `workspace-${theme}.png`) });
      await floating.screenshot({
        path: path.join(out, `floating-${theme}.png`),
      });
    }
    await p.emulateMedia({ reducedMotion: "reduce" });
    await floating.emulateMedia({ reducedMotion: "reduce" });
    await p.locator(".tag-fab").click();
    assert.equal(
      await p
        .locator(".modal")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await p.keyboard.press("Escape");
    await p.locator(".modal-backdrop").waitFor({ state: "detached" });
    await trigger.click();
    assert.equal(
      await floating
        .locator(".menu-glide")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await floating.keyboard.press("Escape");
    await floating.locator(".float-tag-menu").waitFor({ state: "detached" });
    await p.setViewportSize({ width: 960, height: 700 });
    await floating.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
        label: "floating",
        value: { Logical: { width: 340, height: 460 } },
      }),
    );
    await floating.waitForFunction(() => innerHeight === 460);
    assert.equal(await floating.locator(".floating-history li").count(), 3);
    assert.ok(
      await floating.evaluate(
        () =>
          document.querySelector(".glass-add").getBoundingClientRect().bottom <
          document.querySelector(".floating-assist").getBoundingClientRect()
            .top,
      ),
    );
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS light/dark themes, reduced motion, narrow windows and fixed glass-action layering without uncaught UI errors",
    );
  } finally {
    held.splice(0).forEach((r) => r.send());
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
