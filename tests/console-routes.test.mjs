import test from 'node:test';
import assert from 'node:assert/strict';
import { appRoutes, routes } from '../apps/console/src/router/routes.ts';

test('the login page is the only public route, and every page lives under the application shell', () => {
  const publicRoutes = routes.filter((route) => route.meta?.public).map((route) => route.path);
  assert.deepEqual(publicRoutes, []);
  const login = routes.find((route) => route.path === '/login');
  assert.equal(login.children[0].meta.public, true);
  const shell = routes.find((route) => route.path === '/');
  assert.equal(shell.redirect, '/overview');
  assert.ok(shell.children.length >= appRoutes.length);
});

test('the sidebar is derived from routes that opt in with a title', () => {
  const menu = appRoutes.filter((route) => route.meta?.menu);
  assert.deepEqual(menu.map((route) => route.meta.title), [
    '工作台', '接入管理', '资产目录', '数据开发', '服务数据集', '运行中心', '项目与设置',
  ]);
  for (const route of menu) assert.equal(route.meta.menu, true);
});

test('数据开发 is the only role-gated page, so a viewer cannot reach it by URL', () => {
  const gated = appRoutes.filter((route) => route.meta?.roles);
  assert.deepEqual(gated.map((route) => route.path), ['models']);
  assert.deepEqual(gated[0].meta.roles, ['OWNER', 'ENGINEER']);
});

test('every page has exactly one name and an unknown path lands on the not-found page', () => {
  const names = appRoutes.map((route) => route.name);
  assert.equal(new Set(names).size, names.length);
  const shell = routes.find((route) => route.path === '/');
  const catchAll = shell.children.at(-1);
  assert.equal(catchAll.path, ':pathMatch(.*)*');
  assert.equal(catchAll.name, 'not-found');
});
