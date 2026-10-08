// Run with a Vite development server. This uses synthetic browser IPC, not Tauri.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const output = path.join(root, "qa", "auto-tags");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1360, height: 900 },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(
      `${process.env.QA_URL || "http://127.0.0.1:1421"}/scripts/fixtures/auto-tags.html`,
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    await page.locator('[data-file-id="f1"]').click();
    assert.equal(
      await page
        .locator(".inspector")
        .getByLabel("AI 待确认", { exact: true })
        .count(),
      2,
    );
    await page.getByLabel("确认AI标签参考素材", { exact: true }).click();
    await page
      .locator(".inspector")
      .getByLabel("AI 已确认", { exact: true })
      .waitFor();
    assert.ok(
      await page
        .locator(".inspector")
        .getByText("文件夹", { exact: true })
        .isVisible(),
    );
    await page.screenshot({ path: path.join(output, "tags-light.png") });
    console.log(
      "PASS folder / reused AI / generated AI badges and confirmation",
    );
    await page.getByRole("button", { name: "偏好设置" }).click();
    const dialog = page.getByRole("dialog", { name: "偏好设置" });
    const folder = dialog.getByLabel("导入时使用所在文件夹名称作为标签");
    await folder.uncheck();
    assert.ok(
      await dialog
        .getByRole("button", { name: "为已有文件补齐标签" })
        .isDisabled(),
    );
    await folder.check();
    await dialog.getByRole("button", { name: "为已有文件补齐标签" }).click();
    await dialog.getByRole("status").filter({ hasText: "4 个文件" }).waitFor();
    await dialog
      .getByLabel("AI 服务地址", { exact: true })
      .fill("http://localhost:11434/v1");
    await dialog.getByLabel("AI 模型名称", { exact: true }).fill("test-vision");
    await dialog
      .getByLabel("AI API Key", { exact: true })
      .fill("synthetic-ui-key");
    assert.equal(
      await dialog
        .getByLabel("AI API Key", { exact: true })
        .getAttribute("type"),
      "password",
    );
    assert.ok(
      await dialog
        .getByRole("button", { name: "测试连接", exact: true })
        .isDisabled(),
    );
    await dialog
      .getByLabel("启用 AI 自动标注，允许向上述服务发送分析内容")
      .check();
    await dialog
      .getByRole("button", { name: "保存 AI 设置", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="AI API Key"]').value === "",
    );
    await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
    await dialog.getByRole("status").filter({ hasText: "连接成功" }).waitFor();
    await dialog
      .locator(".modal-content")
      .evaluate((el) => (el.scrollTop = 390));
    await page.screenshot({ path: path.join(output, "settings-light.png") });
    await dialog.getByRole("button", { name: "深色", exact: true }).click();
    await dialog
      .locator(".modal-content")
      .evaluate((el) => (el.scrollTop = 390));
    await page.screenshot({ path: path.join(output, "settings-dark.png") });
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await page.setViewportSize({ width: 960, height: 700 });
    assert.equal(
      await dialog.evaluate(
        (el) => el.getBoundingClientRect().right <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: path.join(output, "settings-narrow.png") });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.getByLabel("关闭对话框", { exact: true }).click();
    console.log(
      "PASS folder toggle/backfill; explicit AI enable/save; masked key; connection UI; light/dark/narrow layouts",
    );
    await page
      .locator(".inspector")
      .getByRole("button", { name: "AI 重新识别", exact: true })
      .click();
    await page.getByText("等待 AI 分析", { exact: true }).waitFor();
    await page.evaluate(() => window.qa.fail("f1"));
    await page.locator(".ai-task-status.status-failed").waitFor();
    assert.match(
      await page.locator(".ai-task-status.status-failed").textContent(),
      /AI 分析失败，可重新识别/,
    );
    console.log("PASS reanalysis queue and failure status");
    await page.getByLabel("切换详情面板", { exact: true }).click();
    const scroll = page.locator(".file-area");
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForFunction(() =>
      window.qa.calls.some(
        (c) => c.action === "query" && c.payload.offset === 100,
      ),
    );
    await scroll.evaluate((el) => (el.scrollTop = 10500));
    // Find a mounted item from a page beyond the initial 100 records.
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-file-id]")].some(
        (el) => Number(el.dataset.fileId.slice(1)) > 100,
      ),
    );
    const id = await page
      .locator("[data-file-id]")
      .evaluateAll(
        (els) =>
          els.find((el) => Number(el.dataset.fileId.slice(1)) > 100).dataset
            .fileId,
      );
    await page.locator(`[data-file-id="${id}"]`).click();
    await page.getByLabel("切换详情面板", { exact: true }).click();
    await page
      .locator(".detail-filename")
      .filter({ hasText: `图案-${id.slice(1)}.png` })
      .waitFor();
    await page.evaluate(() => window.qa.notify());
    await page.waitForFunction(
      () =>
        window.qa.calls.filter(
          (c) => c.action === "query" && c.payload.offset === 100,
        ).length >= 2,
    );
    assert.equal(
      await page.locator(".detail-filename").textContent(),
      `图案-${id.slice(1)}.png`,
    );
    console.log(
      "PASS background updates preserve loaded pages and selection after item 100",
    );
    assert.deepEqual(errors, []);
    console.log("PASS no browser runtime errors (mock IPC only)");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
