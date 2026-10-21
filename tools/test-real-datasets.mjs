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
const sourceRequests = [];
const sourceResponses = [];
const datasetWriteRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname === "/api/v1/sources" && request.method() === "GET")
    sourceRequests.push(url);
  if (
    /\/api\/v1\/datasets(?:\/\d+)?$/.test(url.pathname) &&
    ["POST", "PATCH"].includes(request.method())
  )
    datasetWriteRequests.push(request);
});
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (url.pathname === "/api/v1/sources" && response.ok()) {
    const result = await response.json();
    sourceResponses.push({ url, count: result.data.length });
  }
});
const editor = () => page.getByLabel("数据集 SQL 编辑器", { exact: true });
const saveDialog = () =>
  page.getByRole("dialog", { name: "保存数据集", exact: true });

async function preview(action) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/datasets/preview") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: action, exact: true }).click();
  return pending;
}
async function runSql(sql) {
  await editor().fill(sql);
  return preview("运行 SQL");
}
async function successful(response) {
  if (!response.ok())
    throw new Error(
      "API failed: " +
        response.status() +
        " " +
        (await response.json()).error?.code,
    );
  return response;
}
async function screenshot(name) {
  await expect(page.locator(".n-message")).toHaveCount(0, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "运行 SQL", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await page.screenshot({
    path: new URL("../.local/dataset-" + name + "-1280.png", import.meta.url)
      .pathname,
  });
}
async function checkViewport() {
  const box = await page.locator(".dataset-editor").boundingBox();
  if (
    !box ||
    box.x !== 0 ||
    box.y !== 0 ||
    box.width !== 1280 ||
    box.height !== 1000
  )
    throw new Error("Editor does not fill the viewport");
  if (
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    )
  )
    throw new Error("Workspace overflows the viewport");
  await expect(page.locator(".n-layout-sider")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "数据集配置步骤", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "确认取数，下一步", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "去除首尾空白", exact: true }),
  ).toHaveCount(0);
}
async function openSave() {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await saveDialog().waitFor();
}
async function save(doubleClick = false) {
  const previousWriteCount = datasetWriteRequests.length;
  const response = page.waitForResponse(
    (r) =>
      /\/api\/v1\/datasets(?:\/\d+)?$/.test(r.url()) &&
      ["POST", "PATCH"].includes(r.request().method()),
  );
  const saveButton = saveDialog().getByRole("button", {
    name: "保存草稿",
    exact: true,
  });
  if (doubleClick)
    await saveButton.evaluate((button) => {
      button.click();
      button.click();
    });
  else await saveButton.click();
  const saved = await successful(await response);
  await page.waitForURL(/\/datasets\/\d+$/);
  await expect
    .poll(() => datasetWriteRequests.length - previousWriteCount)
    .toBe(1);
  return (await saved.json()).data;
}
async function publish() {
  await page.getByRole("button", { name: "发布版本", exact: true }).click();
  const response = page.waitForResponse(
    (r) =>
      /\/api\/v1\/datasets\/\d+\/publish$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await successful(await response);
  await expect(
    page.getByRole("button", { name: "确认发布", exact: true }),
  ).toHaveCount(0);
}
async function setMode() {
  await page.getByRole("button", { name: "定义方式", exact: true }).click();
  await page.getByText("自定义 SQL", { exact: true }).click();
  await editor().waitFor();
}
async function selectSql(start, end) {
  await editor().focus();
  await editor().press("Control+Home");
  for (let i = 0; i < start; i++) await editor().press("ArrowRight");
  for (let i = start; i < end; i++) await editor().press("Shift+ArrowRight");
}
try {
  await page.goto("http://localhost:5175/login");
  await page
    .getByLabel("账号", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_USER);
  await page
    .getByLabel("密码", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/overview");
  const stamp = Date.now();
  const session = await (
    await page.request.get("http://localhost:5175/api/v1/session")
  ).json();
  const policyName = "browser_mask_" + stamp;
  await successful(
    await page.request.post("http://localhost:5175/api/v1/governance/masking", {
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
    }),
  );

  // Table creation saves identity fields without any processing step.
  await page.goto(
    "http://localhost:5175/datasets/new?sourceId=" +
      source.id +
      "&objectId=" +
      source.objectId,
  );
  await expect(
    page.getByRole("button", { name: "读取数据", exact: true }),
  ).toBeEnabled();
  await checkViewport();
  await expect(page.getByText("加载更多数据源", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".source-options-status")).toHaveCount(0);
  await page
    .getByRole("button", { name: "打开数据源选项", exact: true })
    .click();
  // Naive UI virtualizes the dropdown; validate the loaded page instead of rendered row count.
  await expect
    .poll(() =>
      sourceResponses.some(
        ({ url, count }) =>
          !url.searchParams.get("q") &&
          url.searchParams.get("pageSize") === "20" &&
          count === 20,
      ),
    )
    .toBe(true);
  const sourceName = (
    await (
      await page.request.get(
        "http://localhost:5175/api/v1/sources/" + source.id,
      )
    ).json()
  ).data.name;
  await page
    .getByRole("textbox", { name: "数据源", exact: true })
    .fill(sourceName);
  await expect
    .poll(() =>
      sourceRequests.some(
        (url) =>
          url.searchParams.get("q") === sourceName &&
          url.searchParams.get("pageSize") === "20",
      ),
    )
    .toBe(true);
  await expect(page.locator(".n-base-select-option")).toHaveCount(1);
  await page.locator(".n-base-select-option").click();
  await openSave();
  await saveDialog()
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  await saveDialog().getByText("请填写数据集名称", { exact: true }).waitFor();
  await saveDialog()
    .getByLabel("数据集名称", { exact: true })
    .fill("browser_visual_" + stamp);
  await saveDialog()
    .getByLabel("目标表", { exact: true })
    .fill("browser_visual_" + stamp);
  await saveDialog().getByRole("button", { name: "取消", exact: true }).click();
  await expect(saveDialog()).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeFocused();
  await openSave();
  const visual = await save(true);
  if (
    visual.definition.cleaning.length ||
    visual.definition.maskPolicyIds.length ||
    visual.definition.qualityRuleIds.length
  )
    throw new Error("Creation applied processing");
  await publish();
  const visualUrl = page.url();

  await page.goto("http://localhost:5175/datasets/new?sourceId=" + source.id);
  await setMode();
  // The reported STORY/story failure is reproduced with the local synthetic orders table.
  const objectCatalog = page.getByRole("complementary", {
    name: "对象目录",
    exact: true,
  });
  await objectCatalog.getByLabel("搜索表名", { exact: true }).fill("orders");
  await objectCatalog
    .getByRole("button", { name: "orders", exact: true })
    .click();
  const wrongCase = await runSql("SELECT * from ORDERS");
  if (wrongCase.status() !== 422)
    throw new Error(
      "Expected the case-sensitive local MySQL to reject the wrong table case",
    );
  await expect(
    page
      .locator(".n-message")
      .filter({ hasText: "表名大小写须与左侧目录一致" }),
  ).toHaveCount(1);
  await editor().fill("");
  await page
    .getByRole("button", {
      name: "插入表名（空 SQL 时生成 SELECT）",
      exact: true,
    })
    .click();
  await expect(editor()).toHaveText("SELECT * FROM `orders`");
  await successful(await preview("运行 SQL"));
  // Completion is driven by the chosen source, including table aliases.
  await editor().fill("SELECT * FROM ord");
  await editor().press("Control+Space");
  await page
    .locator(".cm-tooltip-autocomplete li")
    .filter({ hasText: /^orders/ })
    .first()
    .click();
  await expect(editor()).toHaveText("SELECT * FROM orders");
  await editor().fill("SELECT o. FROM orders o");
  await selectSql(9, 9);
  await editor().press("Control+Space");
  await expect(
    page
      .locator(".cm-tooltip-autocomplete li")
      .filter({ hasText: /^amount/ })
      .first(),
  ).toBeVisible();
  await editor().press("Escape");
  let response = await successful(
    await runSql("SELECT id, amount, phone FROM orders LIMIT 10"),
  );
  const request = response.request().postDataJSON();
  if (
    request.definition.fields.length ||
    request.definition.cleaning.length ||
    request.definition.maskPolicyIds.length
  )
    throw new Error("Raw preview applied downstream processing");
  await page.getByText("9007199254740993", { exact: true }).waitFor();
  await page.getByText("12345.6700", { exact: true }).waitFor();
  await checkViewport();
  const sidebar = await page.locator(".definition-sidebar").boundingBox();
  const workspace = await page.locator(".definition-workspace").boundingBox();
  const sqlBox = await editor().boundingBox();
  const resultsBox = await page
    .getByRole("region", { name: "取数结果", exact: true })
    .boundingBox();
  if (
    !sidebar ||
    !workspace ||
    !sqlBox ||
    !resultsBox ||
    sidebar.x !== 0 ||
    workspace.x !== 280 ||
    sqlBox.width < 900 ||
    resultsBox.height < 360 ||
    resultsBox.y <= sqlBox.y
  )
    throw new Error("Two-column workspace layout is incorrect");
  const separator = page.getByRole("separator", {
    name: "调整 SQL 编辑器与查询结果高度",
    exact: true,
  });
  await separator.focus();
  await separator.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "47");
  await separator.press("ArrowUp");
  const catalog = page.getByRole("complementary", {
    name: "对象目录",
    exact: true,
  });
  await catalog.getByLabel("搜索表名", { exact: true }).fill("orders");
  await expect(catalog.getByRole("listitem")).toHaveCount(1);
  await catalog.getByRole("button", { name: "orders", exact: true }).click();
  await expect(editor()).toHaveText(
    "SELECT id, amount, phone FROM orders LIMIT 10",
  );
  // Programmatic insertion uses a real editor transaction, without losing the cursor.
  await editor().fill("");
  await page
    .getByRole("button", {
      name: "插入表名（空 SQL 时生成 SELECT）",
      exact: true,
    })
    .click();
  await expect(editor()).toHaveText("SELECT * FROM `orders`");
  await editor().fill("SELECT  FROM orders");
  await selectSql(7, 7);
  await page
    .locator(".field-reference")
    .getByRole("button", { name: "amount", exact: true })
    .click();
  await expect(editor()).toHaveText("SELECT `amount` FROM orders");
  await successful(
    await runSql("SELECT id, amount, phone FROM orders LIMIT 10"),
  );
  await selectSql(7, 17);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().length))
    .toBe(10);
  await expect(page.locator(".cm-selectionBackground").first()).toHaveCSS(
    "background-color",
    "rgb(185, 206, 255)",
  );
  await screenshot("create-sql-light");
  await page.getByRole("button", { name: "切换明暗主题", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("dark");
  await selectSql(7, 17);
  await expect(page.locator(".cm-selectionBackground").first()).toHaveCSS(
    "background-color",
    "rgb(57, 90, 144)",
  );
  await screenshot("create-sql-dark");
  await page.getByRole("button", { name: "切换明暗主题", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("light");
  response = await runSql("SELECT missing_field FROM orders");
  if (response.ok()) throw new Error("Invalid SQL succeeded");
  await expect(
    page.locator(".n-message").filter({ hasText: "SQL 执行失败" }),
  ).toHaveCount(1);
  await expect(editor()).toHaveText("SELECT missing_field FROM orders");
  await expect(
    page
      .getByRole("region", { name: "取数结果", exact: true })
      .getByRole("columnheader"),
  ).toHaveCount(0);
  response = await runSql("SELECT FROM orders");
  if (response.ok()) throw new Error("Malformed SQL succeeded");
  await expect(
    page.locator(".n-message").filter({ hasText: "仅支持单条只读 SELECT" }),
  ).toHaveCount(1);
  await editor().fill("SELECT id, amount, phone FROM orders WHERE 1=0");
  const keyboardRequest = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/datasets/preview") &&
      r.request().method() === "POST",
  );
  await editor().press("Control+Enter");
  await successful(await keyboardRequest);
  await openSave();
  await saveDialog()
    .getByLabel("数据集名称", { exact: true })
    .fill("browser_sql_direct_" + stamp);
  await saveDialog()
    .getByRole("button", { name: "提供方式", exact: true })
    .click();
  await page.getByText("直连数据源", { exact: true }).click();
  const direct = await save(true);
  if (direct.definition.fields.length !== 3)
    throw new Error("Empty rows lost the result schema");
  const directUrl = page.url();

  // Detail owns processing; cancellation protects the saved draft.
  await page
    .getByRole("button", { name: "配置清洗与脱敏", exact: true })
    .click();
  await page
    .getByLabel("输出名 amount", { exact: true })
    .fill("cancelled_amount");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("输出名 amount", { exact: true })).toHaveValue(
    "cancelled_amount",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("输出名 amount", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "配置清洗与脱敏", exact: true })
    .click();
  await expect(page.getByLabel("输出名 amount", { exact: true })).toHaveValue(
    "amount",
  );
  // A normal definition edit never clears downstream settings.
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.goto(directUrl + "/edit");
  await successful(
    await runSql("SELECT id, amount, phone FROM orders LIMIT 10"),
  );
  await openSave();
  await save();
  await page
    .getByRole("button", { name: "配置清洗与脱敏", exact: true })
    .click();
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
  response = await successful(await preview("预览处理结果"));
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
      "Detail processing did not preserve precision, rename and mask",
    );
  await page.getByLabel("输出名 amount", { exact: true }).fill("income");
  await expect(
    page
      .getByRole("region", { name: "处理结果", exact: true })
      .getByRole("columnheader"),
  ).toHaveCount(0);
  await successful(await preview("预览处理结果"));
  await page.getByRole("button", { name: "保存处理配置", exact: true }).click();
  await expect(page.getByLabel("输出名 amount", { exact: true })).toHaveCount(
    0,
  );
  await publish();
  await page.getByRole("tab", { name: "样本预览", exact: true }).click();
  await page.getByText("12345.6700", { exact: true }).waitFor();
  await page.goto(directUrl + "/edit");
  await checkViewport();
  await openSave();
  await expect(
    saveDialog().getByRole("button", { name: "提供方式", exact: true }),
  ).toBeDisabled();
  await saveDialog().getByRole("button", { name: "取消", exact: true }).click();
  await editor().fill("SELECT id FROM orders");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await expect(editor()).toHaveText("SELECT id FROM orders");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await page.waitForURL(directUrl);
  await page.goto(directUrl + "/edit");
  await successful(
    await runSql("SELECT id, amount, phone FROM orders LIMIT 10"),
  );
  await openSave();
  await saveDialog()
    .getByLabel("数据集名称", { exact: true })
    .fill("browser_sql_updated_" + stamp);
  const updated = await save();
  if (
    updated.definition.fields.find((f) => f.name === "amount").target !==
      "income" ||
    !updated.definition.fields.find((f) => f.name === "phone").sensitive ||
    updated.definition.cleaning[0] !== "trim"
  )
    throw new Error("Definition save discarded downstream processing");
  await page.goto(visualUrl + "/edit");
  await openSave();
  await expect(
    saveDialog().getByLabel("目标表", { exact: true }),
  ).toBeDisabled();
  await expect(
    saveDialog().getByRole("button", { name: "提供方式", exact: true }),
  ).toBeDisabled();
  await saveDialog().getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await page.waitForURL(visualUrl);
  if (errors.length)
    throw new Error("Browser runtime errors: " + errors.join("; "));
  console.log(
    "PASS real dataset browser 1280x1000: single-page table/SQL creation, source search/20 options, completion/alias/insert, selection/themes, SQL shortcut/failure/retry/empty schema, single-write double save, detail processing/masking/cancel, direct/warehouse publish, edit locks/preserved processing",
  );
} catch (error) {
  await page.screenshot({
    path: new URL("../.local/dataset-failure-1280.png", import.meta.url)
      .pathname,
  });
  // Do not print page data: the configured source can contain private rows.
  throw error;
} finally {
  await browser.close();
}
