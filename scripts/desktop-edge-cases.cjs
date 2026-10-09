const { getSearch } = require("./search-control.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
process.env.TEMP = path.join(root, "qa/tmp");
process.env.TMP = process.env.TEMP;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(12000);
  const api = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("api", { action, payload }),
      { action, payload },
    );
  const checks = [];
  const pass = (s) => {
    checks.push(s);
    console.log(`PASS ${s}`);
  };
  const poll = async (fn, test) => {
    for (let i = 0; i < 100; i++) {
      const r = await fn();
      if (test(r)) return r;
      await sleep(100);
    }
    throw Error("State wait timed out");
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
  const boot = await api("bootstrap");
  assert.ok(
    path.resolve(boot.dataPath).startsWith(path.join(root, "qa") + path.sep),
  );
  const image = (await api("query", { ...query, text: "品牌视觉参考" }))
    .files[0];
  const requests = [];
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol.startsWith("http") &&
      !["tauri.localhost", "ipc.localhost", "127.0.0.1"].includes(url.hostname)
    ) {
      requests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.reload();
  await page.getByRole("option", { name: image.name, exact: true }).click();
  await page.locator(".file-area").focus();
  await page.keyboard.press("Space");
  await page.locator(".quick-preview img").waitFor();
  await page.keyboard.press("Space");
  await page.locator(".quick-preview").waitFor({ state: "hidden" });
  pass("Space opens and closes quick preview in the file context");
  const input = await getSearch(page);
  await input.dispatchEvent("compositionstart");
  await input.fill("unfinished-ime-token");
  await sleep(400);
  assert.ok((await page.locator(".file-card").count()) > 0);
  await input.dispatchEvent("compositionend", { data: "unfinished-ime-token" });
  await poll(
    () => page.locator(".file-card").count(),
    (n) => n === 0,
  );
  await input.fill("");
  await page.getByRole("option", { name: image.name, exact: true }).waitFor();
  pass("IME composition defers search until completion");
  await page.getByRole("option", { name: image.name, exact: true }).click();
  const note = page.getByLabel("备注", { exact: true });
  const old = await api("file", { id: image.id });
  await note.fill("保留我的本地草稿");
  await api("note.save", {
    id: image.id,
    text: "另一个已提交的版本",
    version: old.noteVersion,
  });
  await page.locator(".note-error").waitFor();
  assert.equal(await note.inputValue(), "保留我的本地草稿");
  assert.ok(
    (await page.evaluate(() => Object.values(localStorage).join(""))).includes(
      "保留我的本地草稿",
    ),
  );
  pass("Conflicting autosave keeps the draft and shows a recoverable error");
  await page.getByRole("button", { name: "重新读取备注", exact: true }).click();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  assert.equal(await note.inputValue(), "另一个已提交的版本");
  await note.fill(old.note);
  await poll(
    () => api("file", { id: image.id }),
    (f) => f.note === old.note,
  );
  pass("Explicit note recovery reloads the chosen persisted version");
  const grid = page.locator(".file-area");
  for (const [width, height] of [
    [960, 640],
    [1280, 800],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("option", { name: image.name, exact: true }).click();
    const layout = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      main: document.querySelector(".file-area").getBoundingClientRect().width,
      details: document.querySelector(".inspector").getBoundingClientRect()
        .width,
    }));
    assert.ok(layout.scroll <= width);
    assert.ok(layout.main >= 300 && layout.details >= 250);
    await page.screenshot({
      path: path.join(root, `qa/layout-${width}x${height}.png`),
    });
  }
  await page.setViewportSize({ width: 1360, height: 870 });
  pass(
    "960x640, 1280x800 and 1920x1080 layouts keep file and detail panels usable",
  );
  const folder = path.join(root, "qa/pagination");
  fs.mkdirSync(folder, { recursive: true });
  for (let i = 0; i < 275; i++)
    fs.writeFileSync(
      path.join(folder, `分页测试-${String(i).padStart(3, "0")}.txt`),
      `Synthetic pagination record ${i}`,
    );
  await api("import", { paths: [folder], recursive: true });
  await poll(
    () => api("import.status"),
    (j) => j.done,
  );
  await sleep(600);
  assert.equal((await api("query", query)).total, 284);
  assert.ok((await page.locator(".file-card").count()) < 100);
  pass("Virtualized rendering keeps a 284-file library bounded");
  for (let i = 0; i < 7; i++) {
    await grid.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await sleep(350);
    if ((await page.locator(".load-more").count()) === 0) break;
  }
  assert.equal(await page.locator(".load-more").count(), 0);
  await grid.focus();
  await page.keyboard.press("Control+a");
  await page
    .getByRole("heading", { name: "已选择 284 个文件", exact: true })
    .waitFor();
  pass("Scrolling loads all pages and Ctrl+A selects the loaded records");
  for (;;) {
    const r = await api("query", {
      ...query,
      directory: folder,
      recursive: true,
    });
    if (!r.files.length) break;
    await api("files.remove", {
      ids: r.files.map((f) => f.id),
      versions: Object.fromEntries(r.files.map((f) => [f.id, f.version])),
    });
  }
  await page.reload();
  await page.getByRole("option", { name: image.name, exact: true }).click();
  await page.screenshot({ path: path.join(root, "qa/desktop-final.png") });
  assert.deepEqual(requests, []);
  pass("Local workflows issue no external network requests");
  fs.writeFileSync(
    path.join(root, "qa/desktop-edge-results.json"),
    JSON.stringify({ checks, externalRequests: requests }, null, 2),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
