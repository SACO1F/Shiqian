// Compatible with historical native selectors and current Glide Select.
exports.chooseSelect = async (page, name, label) => {
  const trigger = page.getByRole("combobox", { name, exact: true });
  if (await trigger.evaluate((el) => el.tagName === "SELECT"))
    await trigger.selectOption({ label });
  else {
    await trigger.click();
    await page
      .getByRole("listbox", { name, exact: true })
      .getByRole("option", { name: label, exact: true })
      .click();
    await page.waitForTimeout(150);
  }
};
