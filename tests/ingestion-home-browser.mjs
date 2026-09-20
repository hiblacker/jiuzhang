// UI regression with synthetic API responses; never creates records in a live database.
import assert from "node:assert/strict";
import { chromium } from "../apps/console/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const base = process.env.CONSOLE_TEST_URL || "http://127.0.0.1:4187";
const server = process.env.CONSOLE_TEST_URL
  ? null
  : spawn(process.execPath, ["apps/console/server.mjs"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "4187",
        CONSOLE_API_ORIGIN: "http://127.0.0.1:60283",
      },
      stdio: "ignore",
    });
const browser = await chromium.launch({ headless: true });
const connection = {
  id: 11,
  name: "合成数据源",
  code: "fixture",
  instance_id: 2,
  kind: "FILE_SCAN",
  lifecycle: "ACTIVE",
  active_version: 1,
  revision: 1,
};
const dataset = {
  id: 21,
  source_id: 21,
  name: "合成采集数据集",
  code: "orders",
  instance_id: 2,
  connection_id: 11,
  lifecycle: "DRAFT",
  active_version: 1,
  revision: 1,
  config: {},
};
const pageOf = (items) => ({ items, total: items.length });
const tabByName = (page, name) =>
  page
    .locator(".ingestion-home > .n-tabs .n-tabs-tab")
    .filter({ hasText: new RegExp(`^${name}$`) });
await mkdir("work/ingestion-home", { recursive: true });
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const role of ["OWNER", "ENGINEER", "VIEWER"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors = [],
      calls = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("requestfailed", (request) =>
      console.error("Failed", request.url(), request.failure()),
    );
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname;
      calls.push(path);
      const project = { id: 1, name: "合成项目", code: "fixture", role };
      let result;
      if (path.endsWith("/auth/csrf"))
        result = { headerName: "X-CSRF-TOKEN", token: "synthetic" };
      else if (path.endsWith("/warehouse/me"))
        result = {
          identity: "fixture",
          platformAdmin: false,
          projects: [project],
        };
      else if (path.endsWith("/catalog/projects")) result = pageOf([project]);
      else if (path.endsWith("/catalog/projects/1/connections"))
        result = pageOf([connection]);
      else if (path.endsWith("/catalog/projects/1/channels"))
        result = pageOf([dataset]);
      else if (path.endsWith("/instances/2/connections")) result = [connection];
      else if (path.endsWith("/connections/11/channels")) result = [dataset];
      else if (path.endsWith("/connections/11")) result = connection;
      else if (path.endsWith("/channels/21")) result = dataset;
      else if (path.endsWith("/systems")) result = pageOf([]);
      else if (/agreements|probes/.test(path)) result = [];
      else result = {};
      await route.fulfill({ json: result });
    });
    await page.goto(base + "/systems");
    console.log("Opened", role, page.url());
    for (const name of ["数据源", "采集数据集", "业务系统"]) {
      const tab = tabByName(page, name);
      await tab
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(async (error) => {
          await page.screenshot({
            path: "work/ingestion-home/failure.png",
            fullPage: true,
          });
          throw error;
        });
      assert.ok(
        (await tab.boundingBox()).y < 300,
        "Tabs must be above the fold",
      );
    }
    if (role === "VIEWER") {
      await page.getByText(/当前项目角色无接入管理权限/).waitFor();
      await tabByName(page, "采集数据集").click();
      assert.equal(
        calls.some((path) =>
          /catalog\/projects\/1\/(connections|channels)/.test(path),
        ),
        false,
      );
    } else {
      await page
        .getByRole("button", { name: "合成数据源", exact: true })
        .waitFor();
      await tabByName(page, "采集数据集").click();
      await page
        .getByRole("button", { name: "合成采集数据集", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "合成采集数据集", exact: true })
        .click();
      await page.getByText("配置采集数据集", { exact: true }).waitFor();
      assert.ok(calls.some((path) => path.endsWith("/channels/21")));
      await page.keyboard.press("Escape");
      await page
        .getByText("配置采集数据集", { exact: true })
        .waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "返回列表", exact: true }).click();
      await tabByName(page, "数据源").click();
      await page
        .getByRole("button", { name: "合成数据源", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "基于此数据源新增采集数据集",
          exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "返回列表", exact: true }).click();
      await page
        .getByRole("button", { name: "合成数据源", exact: true })
        .waitFor();
    }
    await page.screenshot({
      path: "work/ingestion-home/" + role + ".png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "work/ingestion-home/mobile-layout.png",
      fullPage: true,
    });
    for (const name of ["数据源", "采集数据集", "业务系统"]) {
      await tabByName(page, name).waitFor({ state: "visible" });
      const box = await tabByName(page, name).boundingBox();
      assert.ok(
        box.x >= 0 && box.x + box.width <= 390 && box.y + box.height < 844,
        `Mobile tabs must fit viewport: ${name} ${JSON.stringify(box)}`,
      );
    }
    await page.screenshot({
      path: "work/ingestion-home/" + role + "-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: first-viewport tabs, project lists, open/back, OWNER/ENGINEER/VIEWER and mobile; synthetic API.",
  );
} finally {
  await browser.close();
  server?.kill();
}
