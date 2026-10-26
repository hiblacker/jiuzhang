import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";

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
const base = "http://localhost:5175";
const output = new URL("../.local/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function screenshot(name) {
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
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: new URL("ui-" + name + "-1280.png", output).pathname,
    animations: "disabled",
  });
}

try {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).waitFor();
  await screenshot("login");
  await page
    .getByLabel("账号", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_USER);
  await page
    .getByLabel("密码", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/overview");
  await page
    .getByText("近 7 日 · 真实运行记录 · 上海时区", { exact: true })
    .waitFor();
  await page.locator(".trend-chart canvas").waitFor();
  await screenshot("overview-light");

  const collapse = page.getByRole("button", { name: "收起导航", exact: true });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.focus();
  await page.keyboard.press("Enter");
  const expand = page.getByRole("button", { name: "展开导航", exact: true });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await screenshot("navigation-collapsed");
  await expand.press("Enter");
  await expect(collapse).toHaveAttribute("aria-expanded", "true");

  const theme = page.getByRole("button", { name: "切换明暗主题", exact: true });
  const lightSurface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface"),
  );
  await theme.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          "--surface",
        ),
      ),
    )
    .not.toBe(lightSurface);
  await screenshot("overview-dark");
  await theme.click();

  for (const path of ["sources", "datasets"]) {
    await page.goto(base + "/" + path);
    await page.getByRole("table").waitFor();
    await screenshot(path);
    const search = page.getByRole("textbox", {
      name: "搜索名称、标签或负责人",
      exact: true,
    });
    await search.fill("__workspace_ui_no_match__");
    await expect(page).toHaveURL(/q=__workspace_ui_no_match__/);
    await page.getByText("暂无数据", { exact: true }).waitFor();
    await page.getByRole("button", { name: "重置筛选", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(page).toHaveURL(base + "/" + path);
    await page.getByRole("table").waitFor();
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/" + path &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    assert((await refreshed).ok());
  }

  // Exercise the shared error/retry state at the HTTP boundary of this test only.
  let failSources = true;
  const sourceRoute = "**/api/v1/sources?*";
  await page.route(sourceRoute, (route) =>
    failSources
      ? route.fulfill({
          status: 503,
          json: {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Workspace UI test",
            },
          },
        })
      : route.continue(),
  );
  await page.goto(base + "/sources");
  await page.getByText("数据加载失败", { exact: true }).waitFor();
  failSources = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByRole("table").waitFor();
  await expect(page.getByText("数据加载失败", { exact: true })).toHaveCount(0);
  await page.unroute(sourceRoute);

  // Only use the synthetic dataset created by the real dataset acceptance.
  const fixture = JSON.parse(
    readFileSync(new URL("dataset-test.json", output), "utf8"),
  );
  const response = await page.request.get(
    base + "/api/v1/datasets/" + fixture.sqlWarehouseId,
  );
  assert(
    response.ok(),
    "Run real dataset acceptance before workspace UI acceptance",
  );
  const dataset = (await response.json()).data;
  assert(
    dataset.name.startsWith("warehouse_sql_") && dataset.owner === "test",
    "Expected synthetic acceptance dataset",
  );
  await page.goto(base + "/tasks?q=" + encodeURIComponent(dataset.name));
  await page.getByRole("table").waitFor();
  const taskRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: dataset.name, exact: true }),
    });
  await expect(taskRow).toHaveCount(1);
  await taskRow.getByRole("button", { name: "配置", exact: true }).click();
  await page.waitForURL("**/tasks/" + dataset.id + "/edit");
  await expect(
    page.getByText("支持手动、Cron 和固定间隔计划", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "调度方式", exact: true }),
  ).toBeVisible();
  await page.goto(base + "/datasets/" + dataset.id + "?tab=schedule");
  await page
    .getByRole("button", { name: "进入任务中心", exact: true })
    .click();
  await page.waitForURL("**/tasks/" + dataset.id + "/edit");
  await page.goto(base + "/datasets?q=" + encodeURIComponent(dataset.name));
  const row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: dataset.name, exact: true }),
    });
  await expect(row).toHaveCount(1);
  const run = row.getByRole("button", { name: "运行", exact: true });
  const options = row.getByRole("button", { name: "运行选项", exact: true });
  const editBox = await row
    .getByRole("button", { name: "编辑", exact: true })
    .boundingBox();
  const runBox = await run.boundingBox();
  assert(
    editBox && runBox && Math.abs(editBox.y - runBox.y) < 2,
    "Row actions should stay on one line",
  );
  const posts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname ===
        "/api/v1/datasets/" + dataset.id + "/runs"
    )
      posts.push(request.postDataJSON());
  });
  await options.press("Enter");
  const allowEmpty = page.getByRole("checkbox", {
    name: "允许本次空结果覆盖",
    exact: true,
  });
  await expect(allowEmpty).toBeFocused();
  await expect(allowEmpty).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(allowEmpty).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(allowEmpty).not.toBeVisible();
  await expect(options).toBeFocused();
  await expect(options).toHaveAttribute("aria-pressed", "true");
  await run.click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  assert.equal(posts.length, 0, "Cancel must not enqueue a run");
  await options.click();
  await allowEmpty.uncheck();
  await page.keyboard.press("Escape");
  await expect(options).toHaveAttribute("aria-pressed", "false");
  await options.press("Space");
  await expect(allowEmpty).toBeFocused();
  await expect(allowEmpty).not.toBeChecked();
  await allowEmpty.check();
  await page.keyboard.press("Escape");
  await screenshot("run-options-selected");
  await run.click();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForURL(/\/runs\/\d+$/);
  assert.deepEqual(posts, [{ allowEmptySnapshot: true }]);
  await page
    .getByText("RUN_SUCCEEDED", { exact: false })
    .waitFor({ timeout: 60000 });
  await screenshot("run-detail");
  assert.deepEqual(errors, []);
  console.log(
    "PASS workspace UI 1280x1000: login, keyboard navigation, themes, list reset/refresh, empty/error/retry, compact run options, canceled confirmation, real synthetic run",
  );
} finally {
  await browser.close();
}
