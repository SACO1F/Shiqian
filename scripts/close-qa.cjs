// Gracefully close only a library under the project's synthetic QA directory.
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.SHIQIAN_CDP_PORT || "9223"}`);
  try {
    const p = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
    const api = (action) =>
      p.evaluate(
        (action) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload: {} }),
        action,
      );
    const boot = await api("bootstrap");
    assert.ok(
      path
        .resolve(boot.dataPath)
        .startsWith(path.resolve(__dirname, "../qa") + path.sep),
    );
    assert.equal((await api("package.status")).busy, false);
    const importing = await api("import.status");
    assert.ok(!importing || importing.done);
    await api("floating.close");
    // The native close event flushes any UI drafts/settings before app exit.
    const closed = p.waitForEvent("close", { timeout: 15000 }).catch((error) => {
      if (!p.isClosed()) throw error;
    });
    await p.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', {label:'main'}));
    await closed;
    console.log(
      "PASS isolated QA instance gracefully exited after normal save/exit path",
    );
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
