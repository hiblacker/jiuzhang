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
const taskId = JSON.parse(
  readFileSync(new URL("../.local/dataset-test.json", import.meta.url), "utf8"),
).sqlWarehouseId;
const base = "http://localhost:5175";
const output = new URL("../.local/", import.meta.url);
mkdirSync(output, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let original;
let csrf;

async function api(method, path, data) {
  const response = await context.request[method](base + "/api/v1" + path, {
    ...(data === undefined ? {} : { data }),
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  return { response, payload: await response.json() };
}

async function scheduleInput(schedule) {
  return {
    name: original.name,
    description: original.description,
    owner: original.owner,
    tags: original.tags,
    schedule,
  };
}

try {
  await page.goto(base + "/login");
  await page
    .getByLabel("账号", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_USER);
  await page
    .getByLabel("密码", { exact: true })
    .fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/overview");

  const session = await api("get", "/session");
  assert.equal(session.response.status(), 200);
  csrf = session.payload.data.csrfToken;
  const taskResponse = await api("get", "/tasks/" + taskId);
  assert.equal(taskResponse.response.status(), 200);
  original = taskResponse.payload.data;

  await page.goto(base + "/tasks/" + taskId + "/edit");
  const mode = page.getByLabel("调度方式", { exact: true });
  await mode.click();
  await page.getByText("Cron", { exact: true }).click();
  const cron = page.getByLabel("Cron", { exact: true });
  await cron.fill("60 * * * *");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(cron).toHaveValue("60 * * * *");
  await expect(
    page.getByText("请输入合法的五字段数字 Cron", { exact: false }),
  ).toBeVisible();
  assert.equal(
    await page.getByLabel("最大重试次数", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("上游任务依赖", { exact: true }).count(),
    0,
  );

  await cron.fill("*/5 * * * *");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.waitForURL("**/tasks/" + taskId);
  await expect(
    page.getByText("Cron · */5 * * * *", { exact: true }),
  ).toBeVisible();
  const cronSaved = await api("get", "/tasks/" + taskId);
  assert.equal(cronSaved.payload.data.schedule.cron, "*/5 * * * *");
  assert.ok(Date.parse(cronSaved.payload.data.nextRunAt) > Date.now());
  await page.reload();
  await expect(
    page.getByText("Cron · */5 * * * *", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "编辑配置", exact: true }).click();
  await page.getByLabel("调度方式", { exact: true }).click();
  await page.getByText("固定间隔", { exact: true }).click();
  await page.getByLabel("间隔（分钟）", { exact: true }).fill("4");
  await page.getByLabel("超时（秒）", { exact: true }).fill("30");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.waitForURL("**/tasks/" + taskId);
  await expect(page.getByText("每 4 分钟", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("每 4 分钟", { exact: true })).toBeVisible();
  const intervalSaved = await api("get", "/tasks/" + taskId);
  assert.equal(intervalSaved.payload.data.schedule.intervalMinutes, 4);
  assert.equal(intervalSaved.payload.data.schedule.timeoutSeconds, 30);

  await page.getByRole("button", { name: "编辑配置", exact: true }).click();
  await page.getByLabel("超时（秒）", { exact: true }).fill("35");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByText("每 4 分钟", { exact: true })).toBeVisible();
  const afterCancel = await api("get", "/tasks/" + taskId);
  assert.equal(afterCancel.payload.data.schedule.timeoutSeconds, 30);

  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  const paused = await api("get", "/tasks/" + taskId);
  assert.equal(paused.payload.data.nextRunAt, null);
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  const resumed = await api("get", "/tasks/" + taskId);
  assert.equal(resumed.payload.data.enabled, true);
  assert.ok(resumed.payload.data.nextRunAt);
  assert.ok(Date.parse(resumed.payload.data.nextRunAt) > Date.now());
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );

  await page.screenshot({
    path: new URL("ui-task-schedule-1280.png", output).pathname,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS real schedule UI 1280x1000: Cron validation/save/reload, interval and timeout save/reload, cancel isolation, pause/resume",
  );
} catch (error) {
  if (page.isClosed() === false)
    console.log((await page.locator("body").innerText()).slice(0, 5000));
  throw error;
} finally {
  if (original) {
    const restored = await api(
      "patch",
      "/tasks/" + taskId,
      await scheduleInput(original.schedule),
    );
    assert.equal(restored.response.status(), 200);
    await api(
      "post",
      "/tasks/" + taskId + (original.enabled ? "/resume" : "/pause"),
    );
  }
  await browser.close();
}
