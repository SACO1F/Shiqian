// Production Tauri geometry, persistence and native controls. Synthetic library only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${process.env.SHIQIAN_CDP_PORT || "9223"}`,
  );
  try {
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => !p.url().includes("floating"));
    const api = (action, payload = {}) =>
      main.evaluate(
        ({ action, payload }) =>
          window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
        { action, payload },
      );
    const plugin = (cmd, args) =>
      main.evaluate(
        ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
        { cmd, args },
      );
    await main.getByRole("button", { name: "全部文件", exact: true }).waitFor();
    const boot = await api("bootstrap");
    const root = path.resolve(__dirname, "..");
    const qa = path.join(root, "qa", process.env.BETA2_QA_DIR || "beta3-final");
    assert.equal(path.resolve(boot.dataPath), path.join(qa, "library"));
    assert.equal(boot.version, process.env.BETA_VERSION || "0.3.0-beta.3");
    const errors = [];
    main.on("pageerror", (e) => errors.push(String(e)));
    const wait = async (read, accept) => {
      for (let i = 0; i < 100; i++) {
        const value = await read();
        if (accept(value)) return value;
        await main.waitForTimeout(50);
      }
      throw Error("Native geometry did not settle");
    };
    const palette = async () => {
      const p = await wait(
        async () =>
          ctx
            .pages()
            .find((p) => !p.isClosed() && p.url().includes("floating")),
        Boolean,
      );
      await p.getByRole("button", { name: "添加标签", exact: true }).waitFor();
      p.on("pageerror", (e) => errors.push(String(e)));
      return p;
    };
    const monitor = await plugin("plugin:window|primary_monitor", {
      label: "main",
    });
    const area = monitor.workArea;
    if (process.env.BETA3_WINDOW_PHASE === "reopen") {
      const expected = JSON.parse(
        fs.readFileSync(path.join(qa, "window-expected.json")),
      );
      await api("floating.open");
      await palette();
      const actual = await api("floating.state");
      for (const field of ["x", "y", "width", "height", "alwaysOnTop"])
        assert.equal(actual[field], expected[field], field);
      await api("floating.close");
      console.log(
        "PASS release process restart restores floating position, expanded size and topmost choice",
      );
      return;
    }
    // Seed a detached monitor coordinate, then build an actual native window.
    await api("settings.save", {
      key: "floatingPosition",
      value: { x: 1000000, y: -1000000 },
    });
    await api("floating.open");
    let p = await palette();
    let state = await api("floating.state");
    assert.ok(state.x >= area.position.x && state.y >= area.position.y);
    assert.ok(
      state.x + state.width * monitor.scaleFactor <=
        area.position.x + area.size.width + 2,
    );
    assert.ok(
      state.y + state.height * monitor.scaleFactor <=
        area.position.y + area.size.height + 2,
    );
    console.log(
      "PASS detached-monitor coordinate corrected into actual primary work area",
    );
    await api("floating.close");
    await plugin("plugin:window|destroy", { label: "floating" });
    await wait(
      async () =>
        ctx.pages().filter((p) => !p.isClosed() && p.url().includes("floating"))
          .length,
      (n) => n === 0,
    );
    const point = { x: area.position.x + 80, y: area.position.y + 80 };
    await api("settings.save", { key: "floatingPosition", value: point });
    await api("settings.save", {
      key: "floatingSize",
      value: { width: 340, height: 460 },
    });
    await api("floating.open");
    p = await palette();
    state = await api("floating.state");
    assert.equal(state.x, point.x);
    assert.equal(state.y, point.y);
    await api("floating.topmost", { value: false });
    await api("floating.resize", { collapsed: true });
    await wait(
      () => api("floating.state"),
      (s) => s.height === 64,
    );
    await main.waitForTimeout(350);
    assert.equal((await api("bootstrap")).settings.floatingSize.height, 460);
    await api("floating.resize", { collapsed: false });
    await wait(
      () => api("floating.state"),
      (s) => s.height === 460,
    );
    await api("floating.close");
    const saved = (await api("bootstrap")).settings;
    assert.deepEqual(saved.floatingPosition, point);
    const expected = await api("floating.state");
    fs.writeFileSync(
      path.join(qa, "window-expected.json"),
      JSON.stringify(expected),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS valid native position restored; collapse preserves expanded size; close persists geometry and pin choice; no page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
