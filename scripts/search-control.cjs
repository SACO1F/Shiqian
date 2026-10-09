// Use the same search entry point as a user after each reload.
async function getSearch(page) {
  const toggle = page.getByRole("button", { name: /^(展开|收起)搜索栏$/ });
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  const input = page.getByLabel("搜索文件", { exact: true });
  await input.waitFor({ state: "visible" });
  return input;
}
module.exports = { getSearch };
