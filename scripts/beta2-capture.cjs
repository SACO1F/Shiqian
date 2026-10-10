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
    const root = path.resolve(__dirname, "..");
    const api = (action, payload = {}) =>
      p.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    assert.ok(
      path
        .resolve((await api("bootstrap")).dataPath)
        .startsWith(path.join(root, "qa") + path.sep),
    );
    await p.setViewportSize({ width: 1360, height: 870 });
    await p.emulateMedia({ reducedMotion: "no-preference" });
    const close = async () => {
      const button = p.getByRole("button", { name: "关闭对话框", exact: true });
      if (await button.count()) await button.click();
      await p.waitForTimeout(200);
    };
    const shot = async (name) => {
      await p.waitForTimeout(500);
      assert.equal(
        await p.locator(".modal").evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      await p.screenshot({ path: path.join(root, "docs/images/" + name) });
    };
    for (const theme of ["light", "dark"]) {
      await close();
      await p.getByRole("button", { name: "偏好设置", exact: true }).click();
      await p
        .getByRole("button", {
          name: theme === "light" ? "浅色" : "深色",
          exact: true,
        })
        .click();
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.theme),
        theme,
      );
      await close();
      await p
        .getByRole("button", { name: "查看后台任务", exact: true })
        .click();
      await shot(`beta2-tasks-${theme}.png`);
      await close();
      await p.getByRole("button", { name: "偏好设置", exact: true }).click();
      await p
        .getByRole("button", { name: "预览诊断报告", exact: true })
        .click();
      await shot(`beta2-diagnostics-${theme}.png`);
    }
    await p.setViewportSize({ width: 960, height: 680 });
    await p.emulateMedia({ reducedMotion: "reduce" });
    await shot("beta2-diagnostics-960.png");
    await close();
    console.log(
      "PASS settled modal captures: light/dark tasks and diagnostics, 960px reduced motion; opacity=1",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
