const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.SHIQIAN_CDP_PORT || "9223"}`),
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
  const root = path.resolve(__dirname, ".."),
    qa = path.join(root, "qa", process.env.BETA_UPGRADE_DIR || "alpha10-to-beta9");
  assert.ok(path.resolve(boot.dataPath).startsWith(qa + path.sep));
  fs.mkdirSync(qa, { recursive: true });
  if (process.env.BETA_PHASE === "seed") {
    assert.equal(
      boot.version,
      process.env.BETA_BASE_VERSION || "0.3.0-alpha.10",
    );
    assert.equal(boot.counts.all, 0);
    const source = path.join(qa, "升级验证.txt");
    fs.writeFileSync(source, "isolated upgrade content");
    await api("import", { paths: [source] });
    for (let i = 0; i < 200; i++) {
      if ((await api("import.status"))?.done) break;
      await p.waitForTimeout(30);
    }
    let f = (await api("query", { limit: 10 })).files[0];
    assert.ok(f);
    const t = await api("tag.create", { name: "升级保留" });
    await api("files.tags", {
      ids: [f.id],
      versions: { [f.id]: f.version },
      add: [t.id],
      remove: [],
    });
    await api("note.save", {
      id: f.id,
      text: "升级前保存的备注",
      version: f.noteVersion,
    });
    await api("settings.save", { key: "theme", value: "dark" });
    await api("settings.save", { key: "sidebarWidth", value: 260 });
    f = await api("file", { id: f.id });
    await api("files.favorite", { ids: [f.id], versions: { [f.id]: f.version }, value: true });
    await api("floating.save", { ids: [t.id] });
    f = await api("file", { id: f.id });
    fs.writeFileSync(path.join(qa, "expected.json"), JSON.stringify(f));
    await api("backup.export", {
      path: path.join(qa, "before-beta.sqtagbackup"),
    });
    console.log(
      `PASS ${boot.version} fixture: file/tag/note/theme/sidebar/backup persisted`,
    );
  } else {
    assert.equal(boot.version, process.env.BETA_VERSION || "0.3.0-beta.9");
    assert.equal(boot.counts.all, 1);
    assert.equal(boot.settings.theme, "dark");
    assert.equal(boot.settings.sidebarWidth, 260);
    const expected = JSON.parse(
      fs.readFileSync(path.join(qa, "expected.json")),
    );
    const f = await api("file", { id: expected.id });
    for (const field of [
      "id",
      "name",
      "note",
      "favorite",
      "path",
      "identity",
      "added",
    ]) {
      assert.equal(f[field], expected[field]);
    }
    assert.deepEqual(f.tags, expected.tags);
    assert.equal(f.favorite, true);
    const presets = await api("floating.presets");
    assert.ok(presets.tags.some(t => t.name === "升级保留"));
    const backup = await api("backup.inspect", {
      path: path.join(qa, "before-beta.sqtagbackup"),
    });
    assert.equal(backup.fileCount, 1);
    const restored = await api("backup.restore", {
      path: path.join(qa, "before-beta.sqtagbackup"),
    });
    assert.ok(fs.existsSync(restored.recoveryBackup));
    assert.equal((await api("file", { id: f.id })).note, expected.note);
    console.log(
      `PASS ${process.env.BETA_BASE_VERSION || "0.3.0-alpha.10"} -> ${boot.version}: identical persisted file annotations/settings + old backup inspect/restore + automatic safety backup`,
    );
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
