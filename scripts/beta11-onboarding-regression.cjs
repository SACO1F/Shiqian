const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const mock = process.env.BETA11_BROWSER === "1";
  const browser = mock
    ? await chromium.launch({ channel: "msedge", headless: true })
    : await chromium.connectOverCDP("http://127.0.0.1:9223");
  if (mock) {
    const ctx = await browser.newContext({
      viewport: { width: 1360, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(
      "http://127.0.0.1:1421/scripts/fixtures/beta11-onboarding.html",
    );
  }
  try {
    const p = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    p.setDefaultTimeout(15000);
    const api = (action, payload = {}) =>
      p.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const boot = await api("bootstrap");
    const qa = path.resolve(__dirname, "../qa/beta12-onboarding");
    assert.equal(
      path.resolve(boot.dataPath),
      mock
        ? path.resolve("C:/synthetic/beta12-onboarding")
        : path.join(qa, "library"),
    );
    assert.equal(boot.version, "0.3.0-beta.12");
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    const key = "shiqian-onboarding:v1:" + boot.dataPath;
    const intro = () =>
      p.getByRole("dialog", { name: "启用 AI 自动标注？", exact: true });
    const guide = () =>
      p.getByRole("dialog", { name: "快速上手拾签", exact: true });
    if (process.env.BETA11_PHASE === "restart") {
      await p
        .getByRole("heading", { name: "全部文件 0", exact: true })
        .waitFor();
      assert.equal(await p.getByRole("dialog").count(), 0);
      assert.equal(
        await p.evaluate((key) => localStorage.getItem(key), key),
        "done",
      );
      assert.equal(
        (await api("ai.settings")).config.model,
        "onboarding-synthetic-vision",
      );
      console.log(
        "PASS actual process restart retains completed onboarding and saved AI configuration",
      );
      return;
    }
    await intro().waitFor();
    assert.equal((await api("ai.settings")).config.enabled, false);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(qa, "ai-reminder.png") });
    await intro()
      .getByRole("button", { name: "暂不设置", exact: true })
      .click();
    await guide().waitFor();
    assert.equal(await guide().locator("li").count(), 4);
    assert.equal((await api("ai.settings")).config.enabled, false);
    await p.reload();
    await guide().waitFor();
    assert.equal(await intro().count(), 0);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(qa, "quick-guide-light.png") });
    await guide()
      .getByRole("button", { name: "开始使用", exact: true })
      .click();
    await p.reload();
    await p.getByRole("heading", { name: "全部文件 0", exact: true }).waitFor();
    assert.equal(await p.getByRole("dialog").count(), 0);
    console.log(
      "PASS first run AI reminder -> skip -> four-step guide; pending guide survives reload; completed flow does not repeat; AI stays disabled",
    );
    await p.getByRole("button", { name: "偏好设置", exact: true }).click();
    await p.getByRole("button", { name: "查看使用说明", exact: true }).click();
    await guide().waitFor();
    assert.equal(await p.getByRole("dialog").count(), 1);
    await p.keyboard.press("Escape");
    await guide().waitFor({ state: "detached" });
    console.log(
      "PASS preferences reopen usage guide, one dialog only, Escape dismisses it",
    );

    await p.evaluate((key) => localStorage.removeItem(key), key);
    await p.reload();
    await intro().waitFor();
    await intro()
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    await guide().waitFor();
    assert.equal(await guide().getAttribute("aria-hidden"), null);
    await guide()
      .getByRole("button", { name: "开始使用", exact: true })
      .click();
    await p.evaluate((key) => localStorage.removeItem(key), key);
    await p.reload();
    await intro().waitFor();
    await intro().getByRole("button", { name: "设置 AI", exact: true }).click();
    const config = p.getByRole("dialog", {
      name: "设置 AI 自动标注",
      exact: true,
    });
    await config
      .getByRole("textbox", { name: "AI 服务地址", exact: true })
      .fill("invalid-address");
    await config
      .getByRole("textbox", { name: "AI 模型名称", exact: true })
      .fill("onboarding-synthetic-vision");
    await config
      .getByRole("button", { name: "保存并继续", exact: true })
      .click();
    await config.locator(".ai-feedback.error").waitFor();
    assert.equal(await guide().count(), 0);
    console.log(
      "PASS closing AI reminder advances to interactive guide; invalid AI settings remain editable and do not advance",
    );
    await config
      .getByRole("textbox", { name: "AI 服务地址", exact: true })
      .fill("http://127.0.0.1:11434/v1");
    await config.getByRole("checkbox").last().check();
    if (mock) {
    await p.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke.bind(
        window.__TAURI_INTERNALS__,
      );
      window.__qaOriginalInvoke = original;
      const gate = new Promise((resolve) => (window.__qaReleaseSave = resolve));
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if (cmd === "api" && args?.action === "ai.settings.save") await gate;
        return original(cmd, args);
      };
    });
    }
    await config
      .getByRole("button", { name: "保存并继续", exact: true })
      .click();
    if (mock) {
    assert.equal(
      await config
        .getByRole("button", { name: "暂不设置", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await config
        .getByRole("button", { name: "关闭对话框", exact: true })
        .isDisabled(),
      true,
    );
    await p.keyboard.press("Escape");
    assert.equal(await config.isVisible(), true);
    await p.evaluate(() => window.__qaReleaseSave());

    await p.evaluate(() => {
      window.__TAURI_INTERNALS__.invoke = window.__qaOriginalInvoke;
    });
    }
    await guide().waitFor();
    const saved = await api("ai.settings");
    assert.equal(saved.config.enabled, true);
    assert.equal(saved.config.model, "onboarding-synthetic-vision");
    console.log(
      mock
        ? "BROWSER FIXTURE: AI save response simulated; no native IPC or model network request"
        : "NATIVE IPC: AI settings saved",
    );
    console.log(
      mock ? "PASS simulated pending save blocks skip/close/Escape" : "PASS real AI configuration save advances to guide; no model request or real file used",
    );
    await api("settings.save", { key: "theme", value: "dark" });
    await p.reload();
    await guide().waitFor();
    await p.waitForTimeout(350);
    await p.setViewportSize({ width: 960, height: 640 });
    const bounds = await guide().boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 961 &&
        bounds.y + bounds.height <= 641,
    );
    await p.screenshot({ path: path.join(qa, "quick-guide-dark.png") });
    await guide()
      .getByRole("button", { name: "开始使用", exact: true })
      .click();
    await p.reload();
    await p.getByRole("heading", { name: "全部文件 0", exact: true }).waitFor();
    assert.equal(await p.getByRole("dialog").count(), 0);
    if (!mock) {
      await api("floating.open");
      let floating;
      for (let i = 0; i < 100; i++) {
        floating = browser
          .contexts()[0]
          .pages()
          .find((p) => p.url().includes("floating"));
        if (floating) break;
        await p.waitForTimeout(50);
      }
      await floating
        .getByRole("button", { name: "打开工作台", exact: true })
        .waitFor();
      assert.equal(await floating.getByRole("dialog").count(), 0);
      await api("floating.close");
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS light/dark and 960x640 guide; completed reload does not show onboarding (floating tested only in native mode); no uncaught page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
