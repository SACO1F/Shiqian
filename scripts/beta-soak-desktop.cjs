const assert = require("node:assert/strict"),
  path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9223"),
    p = b
      .contexts()[0]
      .pages()
      .find((p) => !p.url().includes("floating"));
  const api = (action, payload = {}) =>
    p.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const boot = await api("bootstrap");
  assert.ok(
    path
      .resolve(boot.dataPath)
      .startsWith(path.join(path.resolve(__dirname, ".."), "qa") + path.sep),
  );
  assert.equal(boot.version, "0.3.0-beta.1");
  const ids = (await api("query", { limit: 100 })).files.map((f) => f.id);
  assert.ok(ids.length > 0);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const sample = async () => {
    const m = (await cdp.send("Performance.getMetrics")).metrics;
    return {
      heap: m.find((x) => x.name === "JSHeapUsedSize").value,
      nodes: (await cdp.send("Memory.getDOMCounters")).nodes,
    };
  };
  const first = await sample();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  let cycles = 0;
  const start = Date.now(),
    duration = Number(process.env.SOAK_MS || 180000);
  while (Date.now() - start < duration) {
    const f = await api("file", { id: ids[cycles % ids.length] });
    await api("note.save", {
      id: f.id,
      text: `合成持续操作 ${cycles}`,
      version: f.noteVersion,
    });
    const q = await api("query", {
      scope: "all",
      text: cycles % 2 ? "合成" : "",
      limit: 100,
    });
    assert.ok(Number.isInteger(q.total));
    if (cycles % 10 === 0) {
      await p
        .getByRole("button", {
          name: cycles % 20 ? "瀑布流视图" : "列表视图",
          exact: true,
        })
        .click();
      await api("settings.save", {
        key: "theme",
        value: cycles % 20 ? "light" : "dark",
      });
    }
    if (cycles % 50 === 0) {
      await api("floating.open");
      await api("floating.presets");
      await api("floating.close");
      await p.reload();
      await p.getByRole("button", { name: "偏好设置", exact: true }).waitFor();
    }
    cycles++;
    await p.waitForTimeout(150);
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const last = await sample();
  assert.deepEqual(errors, []);
  assert.equal((await api("bootstrap")).counts.all, boot.counts.all);
  console.log(
    `PASS continuous-operation baseline: ${(Date.now() - start) / 1000}s, ${cycles} note/query cycles, grid/list/theme + floating open/close + reload, stable file count`,
  );
  console.log(
    `WebView main-page after-GC JS heap: ${first.heap} -> ${last.heap} bytes; DOM nodes ${first.nodes} -> ${last.nodes}. Observational baseline, not an all-day memory-leak certification.`,
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
