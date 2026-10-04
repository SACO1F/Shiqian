const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const p = b
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
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  const emit = (payload) =>
    p.evaluate(
      (payload) =>
        window.__TAURI_INTERNALS__.invoke("plugin:event|emit_to", {
          target: { kind: "AnyLabel", label: "main" },
          event: "tag-drag-point",
          payload,
        }),
      payload,
    );
  const file = (await api("query", { text: "品牌视觉参考", limit: 100 }))
    .files[0];
  const checks = [];
  await p.getByLabel("搜索文件", { exact: true }).fill("品牌视觉参考");
  await p.getByRole("option", { name: file.name, exact: true }).waitFor();
  for (const view of ["瀑布流视图", "列表视图"]) {
    await p.getByLabel(view, { exact: true }).click();
    const tag = await api("tag.create", { name: `目标测试${view}` });
    const box = await p.locator(`[data-file-id="${file.id}"]`).boundingBox();
    await emit({
      tagId: tag.id,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      over: true,
      drop: false,
    });
    await p.locator(`[data-file-id="${file.id}"].tag-drop-target`).waitFor();
    await emit({
      tagId: tag.id,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      over: true,
      drop: true,
    });
    for (let i = 0; i < 50; i++) {
      if (
        (await api("file", { id: file.id })).tags.some((t) => t.id === tag.id)
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(
      (await api("file", { id: file.id })).tags.some((t) => t.id === tag.id),
    );
    checks.push(
      `${view}: tag-drop routing highlights and annotates the exact card`,
    );
  }
  const before = (await api("file", { id: file.id })).tags.length;
  const tag = await api("tag.create", { name: "空白目标测试" });
  await emit({ tagId: tag.id, x: 5, y: 5, over: true, drop: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await api("file", { id: file.id })).tags.length, before);
  checks.push("Dropping on workspace chrome rejects annotation");
  await p.getByLabel("瀑布流视图", { exact: true }).click();
  await p.getByLabel("搜索文件", { exact: true }).fill("");
  fs.writeFileSync(
    path.join(root, "qa/tag-target-results.json"),
    JSON.stringify({ checks }, null, 2),
  );
  console.log(checks.map((s) => "PASS " + s).join("\n"));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
