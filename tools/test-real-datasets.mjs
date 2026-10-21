import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const source = JSON.parse(
  readFileSync(new URL("../.local/source-test.json", import.meta.url), "utf8"),
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function login() {
  await page.goto("http://localhost:5175/login");
  await page
    .getByLabel("账号", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_USER);
  await page
    .getByLabel("密码", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/overview");
}
async function requestPreview(action) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/datasets/preview") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: action, exact: true }).click();
  return pending;
}
async function successfulPreview(action) {
  const response = await requestPreview(action);
  if (!response.ok()) {
    const body = await response.json();
    throw new Error(
      "Preview failed: " + response.status() + " " + body.error?.code,
    );
  }
  return response;
}
async function runSql(sql) {
  await page.getByLabel("数据集 SQL 编辑器", { exact: true }).fill(sql);
  return requestPreview("运行 SQL");
}
async function nextProcessing() {
  await page
    .getByRole("button", { name: "确认取数，下一步", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "清洗与脱敏", exact: true })
    .waitFor();
}
async function nextDelivery() {
  await page
    .getByRole("button", { name: "确认处理，下一步", exact: true })
    .click();
  await page.getByLabel("数据集名称", { exact: true }).waitFor();
}
async function publish() {
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.waitForURL(/\/datasets\/\d+$/);
  await page.getByRole("button", { name: "发布版本", exact: true }).click();
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await page.getByText("v1", { exact: true }).first().waitFor();
}
async function checkViewport() {
  const editor = await page.locator(".dataset-editor").boundingBox();
  if (
    !editor ||
    editor.x !== 0 ||
    editor.y !== 0 ||
    editor.width !== 1280 ||
    editor.height !== 1000
  )
    throw new Error("Dataset editor does not occupy the full desktop viewport");
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.documentElement.scrollHeight > innerHeight,
  );
  if (overflow)
    throw new Error("The page scrolls outside the editor workspace");
  await expect(page.locator(".n-layout-sider")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "退出编辑", exact: true }),
  ).toBeVisible();
}
async function screenshot(name) {
  await expect(page.locator(".n-message")).toHaveCount(0, { timeout: 15000 });
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await page.screenshot({
    path: "/tmp/jiuzhang-fullscreen-" + name + "-1280.png",
  });
}

try {
  await login();
  const stamp = Date.now();
  // Real, isolated policy for verifying the distinction between raw and masked output.
  const session = await (
    await page.request.get("http://localhost:5175/api/v1/session")
  ).json();
  const policyName = "browser_mask_" + stamp;
  const policy = await page.request.post(
    "http://localhost:5175/api/v1/governance/masking",
    {
      headers: {
        "X-CSRF-Token": session.data.csrfToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        name: policyName,
        description: "",
        owner: "test",
        tags: [],
        kind: "mask",
        parameter: "3,4",
        enabled: true,
      },
    },
  );
  if (!policy.ok())
    throw new Error("Unable to prepare masking policy: " + policy.status());

  await page.goto(
    "http://localhost:5175/datasets/new?sourceId=" +
      source.id +
      "&objectId=" +
      source.objectId,
  );
  await successfulPreview("读取数据");
  await page.getByText("9007199254740993", { exact: true }).waitFor();
  await page.getByText("12345.6700", { exact: true }).waitFor();
  await checkViewport();
  await nextProcessing();
  await expect(
    page.getByRole("button", { name: "确认处理，下一步", exact: true }),
  ).toBeDisabled();
  await successfulPreview("预览处理结果");
  await nextDelivery();
  await page
    .getByLabel("数据集名称", { exact: true })
    .fill("browser_visual_" + stamp);
  await page
    .getByLabel("目标表", { exact: true })
    .fill("browser_visual_" + stamp);
  await publish();
  const visualUrl = page.url();

  await page.goto("http://localhost:5175/datasets/new?sourceId=" + source.id);
  await page.getByRole("button", { name: "定义方式", exact: true }).click();
  await page.getByText("自定义 SQL", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认取数，下一步", exact: true }),
  ).toBeDisabled();
  let response = await runSql("SELECT id, amount, phone FROM orders LIMIT 10");
  if (!response.ok())
    throw new Error("SQL definition failed: " + response.status());
  if (response.request().postDataJSON().definition.fields.length)
    throw new Error("Definition query applied field mappings");
  await page.getByText("9007199254740993", { exact: true }).waitFor();
  await page.getByText("12345.6700", { exact: true }).waitFor();
  await checkViewport();
  const catalog = page.getByRole("complementary", {
    name: "对象目录",
    exact: true,
  });
  await catalog.getByLabel("搜索表名", { exact: true }).fill("orders");
  await expect(catalog.getByRole("listitem")).toHaveCount(1);
  await catalog.getByRole("button", { name: "orders", exact: true }).click();
  await expect(
    page.getByLabel("数据集 SQL 编辑器", { exact: true }),
  ).toHaveText("SELECT id, amount, phone FROM orders LIMIT 10");
  const separator = page.getByRole("separator", {
    name: "调整 SQL 编辑器与查询结果高度",
    exact: true,
  });
  await separator.focus();
  await separator.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "47");
  await separator.press("ArrowUp");
  const resultsBox = await page
    .getByRole("region", { name: "取数结果", exact: true })
    .boundingBox();
  const sqlBox = await page
    .getByLabel("数据集 SQL 编辑器", { exact: true })
    .boundingBox();
  if (
    !resultsBox ||
    resultsBox.height < 320 ||
    resultsBox.y + resultsBox.height > 936 ||
    !sqlBox ||
    sqlBox.width < 850
  )
    throw new Error(
      "The full-screen SQL workspace still has insufficient space",
    );
  await screenshot("sql-light");
  await page.getByRole("button", { name: "切换明暗主题", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("dark");
  await expect(page.locator(".preview-panel")).toHaveCSS(
    "background-color",
    "rgb(24, 37, 56)",
  );
  await expect(page.locator(".n-data-table-td").first()).toHaveCSS(
    "color",
    "rgba(255, 255, 255, 0.82)",
  );
  await screenshot("sql-dark");
  await page.getByRole("button", { name: "切换明暗主题", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("light");

  await nextProcessing();
  await page.getByLabel("输出名 id", { exact: true }).fill("order_id");
  await page.getByLabel("输出名 amount", { exact: true }).fill("revenue");
  await page
    .getByRole("checkbox", { name: "去除首尾空白", exact: true })
    .check();
  await page
    .getByRole("button", { name: "打开脱敏策略 phone选择", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "脱敏策略 phone", exact: true })
    .fill(policyName);
  await page.getByText(policyName, { exact: true }).last().click();
  await page.getByRole("checkbox", { name: "敏感 phone", exact: true }).check();
  response = await successfulPreview("预览处理结果");
  const processed = (await response.json()).data;
  if (
    !processed.rows.some(
      (row) =>
        row.order_id === "9007199254740993" &&
        row.revenue === "12345.6700" &&
        row.phone?.includes("*"),
    )
  )
    throw new Error(
      "Processing preview did not apply rename, precision and masking",
    );
  await page
    .getByRole("columnheader", { name: "revenue", exact: true })
    .waitFor();
  await page.locator(".processing-config").evaluate((element) => {
    element.scrollTop = 0;
  });
  await screenshot("processing");
  await page.getByLabel("输出名 amount", { exact: true }).fill("income");
  await expect(
    page.getByRole("button", { name: "确认处理，下一步", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("region", { name: "处理结果", exact: true })
      .getByRole("columnheader"),
  ).toHaveCount(0);
  await successfulPreview("预览处理结果");

  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认取数，下一步", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("columnheader", { name: "amount", exact: true })
    .waitFor();
  await expect(
    page.getByRole("columnheader", { name: "income", exact: true }),
  ).toHaveCount(0);
  const invalid = await runSql("SELECT missing_field FROM orders");
  if (invalid.ok()) throw new Error("Invalid SQL unexpectedly succeeded");
  await expect(
    page
      .locator(".n-message")
      .filter({ hasText: "SQL 执行失败，请检查语法、表名和字段名" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "确认取数，下一步", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("navigation", { name: "数据集配置步骤", exact: true })
      .getByRole("button", { name: "2 清洗与脱敏", exact: true }),
  ).toBeDisabled();
  const malformed = await runSql("SELECT FROM orders");
  if (malformed.ok()) throw new Error("Malformed SQL unexpectedly succeeded");
  await expect(
    page
      .locator(".n-message")
      .filter({ hasText: "仅支持单条只读 SELECT 查询，请检查 SQL" }),
  ).toHaveCount(1);

  response = await runSql(
    "SELECT id, amount AS total_amount, phone FROM orders LIMIT 10",
  );
  if (!response.ok()) throw new Error("SQL definition retry failed");
  await page
    .getByRole("columnheader", { name: "total_amount", exact: true })
    .waitFor();
  await page
    .getByText(
      "已移除不再返回的字段：amount。其余字段配置已保留，请检查“字段与清洗”及输出主键。",
      {
        exact: true,
      },
    )
    .waitFor();
  await nextProcessing();
  await expect(page.getByLabel("输出名 id", { exact: true })).toHaveValue(
    "order_id",
  );
  await expect(
    page.getByLabel("输出名 total_amount", { exact: true }),
  ).toHaveValue("total_amount");
  await expect(page.getByLabel("输出名 amount", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("checkbox", { name: "敏感 phone", exact: true }),
  ).toBeChecked();
  await successfulPreview("预览处理结果");
  await nextDelivery();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByText("请填写数据集名称", { exact: true }).waitFor();
  await page
    .getByLabel("数据集名称", { exact: true })
    .fill("browser_sql_direct_" + stamp);
  await page.getByRole("button", { name: "提供方式", exact: true }).click();
  await page.getByText("直连数据源", { exact: true }).click();
  await screenshot("output");
  await publish();
  const savedUrl = page.url();
  await expect(page.locator(".n-layout-sider")).toBeVisible();
  await page.getByRole("tab", { name: "样本预览", exact: true }).click();
  await page.getByText("9007199254740993", { exact: true }).waitFor();
  await page.getByText("12345.6700", { exact: true }).waitFor();

  // Editing uses the same full-screen flow; a cancelled exit must preserve the draft.
  await page.goto(savedUrl + "/edit");
  await checkViewport();
  await expect(
    page.getByRole("button", { name: "确认取数，下一步", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("数据集 SQL 编辑器", { exact: true })
    .fill("SELECT id FROM orders");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await expect(page).toHaveURL(savedUrl + "/edit");
  await expect(
    page.getByLabel("数据集 SQL 编辑器", { exact: true }),
  ).toHaveText("SELECT id FROM orders");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await page.waitForURL(savedUrl);
  await page.goto(savedUrl + "/edit");
  await expect(
    page.getByLabel("数据集 SQL 编辑器", { exact: true }),
  ).toHaveText("SELECT id, amount AS total_amount, phone FROM orders LIMIT 10");
  await nextProcessing();
  await successfulPreview("预览处理结果");
  await nextDelivery();
  await expect(
    page.getByRole("button", { name: "提供方式", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("数据集名称", { exact: true })
    .fill("browser_sql_updated_" + stamp);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.waitForURL(savedUrl);
  await page
    .getByRole("heading", { name: "browser_sql_updated_" + stamp, exact: true })
    .waitFor();
  await page.goto(visualUrl + "/edit");
  await nextProcessing();
  await successfulPreview("预览处理结果");
  await nextDelivery();
  await expect(page.getByLabel("目标表", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "提供方式", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await page.waitForURL(visualUrl);
  if (errors.length)
    throw new Error("Browser runtime errors: " + errors.join("; "));
  console.log(
    "PASS real dataset browser 1280x1000: full-screen table/SQL definition, staged gating, raw/processed separation, rename/precision/masking, schema refresh, failure recovery, themes/resize, direct and warehouse publish, edit locks and discard/cancel",
  );
} catch (error) {
  await page.screenshot({ path: "/tmp/jiuzhang-fullscreen-failure-1280.png" });
  console.log((await page.locator("body").innerText()).slice(0, 7000));
  throw error;
} finally {
  await browser.close();
}
