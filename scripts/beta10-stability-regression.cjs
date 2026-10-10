// Real production WebView; mutations are restricted to an isolated QA library.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const p = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    p.setDefaultTimeout(15000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    const invoke = (cmd, args = {}) =>
      p.evaluate(
        ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
        { cmd, args },
      );
    const api = (action, payload = {}) => invoke("api", { action, payload });
    const boot = await api("bootstrap");
    assert.equal(boot.version, "0.3.0-beta.10");
    assert.equal(
      path.resolve(boot.dataPath),
      path.resolve(__dirname, "../qa/beta10-ui/library"),
    );
    const wait = async (fn, accept) => {
      for (let i = 0; i < 150; i++) {
        const value = await fn();
        if (accept(value)) return value;
        await p.waitForTimeout(50);
      }
      throw Error("State did not settle");
    };
    await api("settings.save", { key: "details", value: false });
    await p.reload();
    const query = await api("query", { limit: 1 });
    assert.ok(query.total > 100 && query.total <= 1000);
    const list = p.getByRole("listbox", { name: "文件结果" });
    await list.waitFor();
    await list.focus();
    await p.keyboard.press("Control+a");
    await wait(
      () => p.locator(".content-meta").innerText(),
      (t) => t.includes(`已选 ${query.total} 项`),
    );
    assert.equal(
      await p
        .getByRole("button", { name: "全选当前结果", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await p.getByRole("button", { name: "取消选择", exact: true }).click();
    await p.getByRole("button", { name: "展开搜索栏", exact: true }).click();
    const search = p.getByRole("textbox", { name: "搜索文件", exact: true });
    await search.fill("画幅");
    await search.press("Control+a");
    assert.equal(
      await search.evaluate((el) => el.selectionEnd - el.selectionStart),
      2,
    );
    assert.ok(!(await p.locator(".content-meta").innerText()).includes("已选"));
    await search.fill("");
    await search.press("Escape");
    console.log(
      `PASS Ctrl+A selects all ${query.total} paginated results; text input retains native select-all behavior`,
    );

    // Delay package status to observe repeated native close events while one
    // close sequence is in progress. Native close/hide itself remains real.
    await api("floating.open");
    await p.evaluate(() => {
      const original = window.fetch.bind(window);
      window.__qaOriginalFetch = window.fetch;
      window.__qaCloseCalls = 0;
      const gate = new Promise((resolve) => {
        window.__qaReleaseClose = resolve;
      });
      window.fetch = async (url, options) => {
        let payload;
        try {
          payload = JSON.parse(options?.body);
        } catch {}
        if (
          String(url).includes("ipc.localhost/api") &&
          payload?.action === "package.status"
        ) {
          window.__qaCloseCalls++;
          await gate;
        }
        return original(url, options);
      };
    });
    await p.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await wait(
      () => p.evaluate(() => window.__qaCloseCalls),
      (n) => n === 1,
    );
    for (let i = 0; i < 4; i++)
      await invoke("plugin:window|close", { label: "main" });
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => window.__qaCloseCalls), 1);
    await p.evaluate(() => window.__qaReleaseClose());
    await wait(
      () => invoke("plugin:window|is_visible", { label: "main" }),
      (value) => value === false,
    );
    await p.evaluate(() => {
      window.fetch = window.__qaOriginalFetch;
    });
    await api("main.show");
    await wait(
      () => invoke("plugin:window|is_visible", { label: "main" }),
      Boolean,
    );
    console.log(
      "PASS five native close requests share one save/status/close sequence; main hides and can reopen from palette",
    );

    await p.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (url, options) => {
        let payload;
        try {
          payload = JSON.parse(options?.body);
        } catch {}
        const mode = sessionStorage.getItem("qa-bootstrap-mode");
        if (
          String(url).includes("ipc.localhost/api") &&
          payload?.action === "bootstrap" &&
          mode
        ) {
          sessionStorage.removeItem("qa-bootstrap-mode");
          if (mode === "fail")
            return Promise.resolve(
              new Response(JSON.stringify("Synthetic bootstrap failure"), {
                headers: {
                  "content-type": "application/json",
                  "Tauri-Response": "error",
                },
              }),
            );
          return new Promise((resolve) => {
            window.__qaReleaseBootstrap = () => resolve(original(url, options));
          });
        }
        return original(url, options);
      };
    });
    await p.evaluate(() => sessionStorage.setItem("qa-bootstrap-mode", "hold"));
    await p.reload();
    await p.locator(".startup-window").waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: "关闭窗口", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await p
        .locator(".startup-topbar")
        .evaluate((el) => el.getBoundingClientRect().height),
      32,
    );
    await p.getByRole("button", { name: "最大化窗口", exact: true }).click();
    await wait(
      () => invoke("plugin:window|is_maximized", { label: "main" }),
      Boolean,
    );
    await p.getByRole("button", { name: "还原窗口", exact: true }).click();
    await wait(
      () => invoke("plugin:window|is_maximized", { label: "main" }),
      (v) => !v,
    );
    await p.evaluate(() => window.__qaReleaseBootstrap());
    await p
      .getByRole("heading", { name: `全部文件 ${query.total}`, exact: true })
      .waitFor();
    console.log(
      "PASS held startup retains 32px titlebar with native maximize/restore and completes bootstrap",
    );
    await p.evaluate(() => sessionStorage.setItem("qa-bootstrap-mode", "fail"));
    await p.reload();
    await p
      .getByRole("heading", { name: "资料库暂时无法打开", exact: true })
      .waitFor();
    await p.getByRole("button", { name: "最小化窗口", exact: true }).click();
    await wait(
      () => invoke("plugin:window|is_minimized", { label: "main" }),
      Boolean,
    );
    await api("main.show");
    await p.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await wait(
      () => invoke("plugin:window|is_visible", { label: "main" }),
      (v) => !v,
    );
    await api("main.show");
    await p.getByRole("button", { name: "重新尝试", exact: true }).click();
    await p
      .getByRole("heading", { name: `全部文件 ${query.total}`, exact: true })
      .waitFor();
    await api("floating.close");
    assert.deepEqual(errors, []);
    console.log(
      "PASS synthetic bootstrap failure retains native minimize/close/reopen and retry recovery; no uncaught page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
