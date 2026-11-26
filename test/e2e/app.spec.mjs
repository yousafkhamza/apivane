// Browser tests (Playwright). Public APIs are mocked so CI never depends on third-party uptime.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|CORS|Cross-Origin|blocked|NetworkError/i.test(m.text())) errors.push(`console: ${m.text()}`); });
    await use(page);
    expect(errors, errors.join('\n')).toEqual([]);
  },
});

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function mockApis(page) {
  const pre = (fn) => (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : fn(route));
  await page.route('https://api.open-meteo.com/**', pre((r) => json(r, 200, { current: { temperature_2m: 30, wind_speed_10m: 12, wind_direction_10m: 270 } })));
  await page.route('https://dummyjson.com/auth/login', pre((r) => json(r, 200, { accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.sig', username: 'emilys' })));
  await page.route('https://dummyjson.com/auth/me', pre((r) => {
    const ok = (r.request().headers().authorization || '').startsWith('Bearer eyJ');
    return json(r, ok ? 200 : 401, ok ? { username: 'emilys' } : { message: 'Invalid token' });
  }));
  await page.route('https://example.com/**', (r) => r.abort('failed'));
}
const onboarded = (page, extra = {}) => page.addInitScript((x) => {
  localStorage.setItem('apivane.onboarded', '1');
  for (const [k, v] of Object.entries(x)) localStorage.setItem('apivane.' + k, v);
}, extra);
const isPhone = (page) => page.viewportSize().width <= 720;
async function openItem(page, name) {
  if (isPhone(page)) await page.click('.rail [data-k="lib"]');
  await page.click(`#libBody .item:has-text("${name}")`);
}
const status = (page) => page.locator(isPhone(page) ? '.resbar .status' : '#resTabs .summary .status');

test.use({ reducedMotion: 'reduce' });

test('first visit: walkthrough, choices are saved, never shown again', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#steps')).toBeVisible();
  await page.click('#tourNext'); // welcome -> look
  await page.click('[data-act="tour-theme"][data-k="dark"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#tourNext'); // -> engine
  await page.click('#tourNext'); // -> keep work
  await page.click('[data-act="tour-save"][data-k="0"]');
  await page.click('#tourNext'); // -> tips
  await page.click('#tourNext'); // -> ready
  await page.click('#tourNext'); // open library
  await expect(page.locator('#boot')).toBeHidden();
  expect(await page.evaluate(() => [localStorage.getItem('apivane.autosave'), localStorage.getItem('apivane.theme')])).toEqual(['0', 'dark']);
  await page.reload();
  await expect(page.locator('#boot')).toBeHidden();
});

test('skip closes the walkthrough', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-act="tour-skip"]');
  await expect(page.locator('#boot')).toBeHidden();
  await expect(page.locator('button.send')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test(`theme follows the device (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await onboarded(page);
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await ctx.close();
  });
}

test('send, tests and security tabs', async ({ page }) => {
  await mockApis(page);
  await onboarded(page);
  await page.goto('./');
  await openItem(page, 'Dubai weather now');
  await page.click('button.send');
  await expect(status(page)).toContainText('200');
  await expect(page.locator('#resTabs [data-k="tests"] .n')).toHaveText('4/4');
  await expect(page.locator('#resBody')).toContainText('wind_direction_10m');
  await page.click('#resTabs [data-k="security"]');
  await expect(page.locator('#resBody')).toContainText('skipped');
});

test('login flow: token is captured and reused; missing variable explains what to do', async ({ page }) => {
  await mockApis(page);
  await onboarded(page);
  await page.goto('./');
  await openItem(page, 'Who am I');
  await page.click('button.send');
  await expect(page.locator('.err h3')).toHaveText('A variable has no value');
  await page.click('.err a:has-text("Log in")');
  await page.click('button.send');
  await expect(status(page)).toContainText('200');
  await expect(page.locator('#toast')).toContainText('{{token}}');
  await openItem(page, 'Who am I');
  await page.click('button.send');
  await expect(status(page)).toContainText('200');
  await expect(page.locator('#resTabs [data-k="tests"] .n')).toHaveText('2/2');
});

test('blocked request shows the one-step fix', async ({ page }) => {
  await mockApis(page);
  await onboarded(page);
  await page.goto('./');
  await openItem(page, 'API without CORS');
  await page.click('button.send');
  await expect(page.locator('.err h3')).toHaveText('The browser blocked this request');
  await expect(page.locator('.err')).toContainText('npx apivane');
});

test('autosave keeps changes after reload', async ({ page }) => {
  await onboarded(page);
  await page.goto('./');
  await expect(page.locator('#saveBtn')).toHaveText('Sample data');
  await page.fill('[data-f="name"]', 'My weather');
  await expect(page.locator('#saveBtn')).toHaveText('✓ Saved');
  await page.reload();
  await expect(page.locator('[data-f="name"]')).toHaveValue('My weather');
});

test('manual save: forgotten changes are offered back next time', async ({ page, context }) => {
  await onboarded(page, { autosave: '0' });
  await page.goto('./');
  await page.fill('[data-f="name"]', 'Draft name');
  await expect(page.locator('#saveBtn')).toHaveText('Unsaved · Save');
  await page.waitForTimeout(2000); // recovery copy is written ~1.2 s after the last change
  const next = await context.newPage();
  await onboarded(next, { autosave: '0' });
  await next.goto('./');
  await expect(next.locator('#restore')).toBeVisible();
  await next.click('[data-act="restore"]');
  await expect(next.locator('[data-f="name"]')).toHaveValue('Draft name');
  await next.keyboard.press('Control+s');
  await expect(next.locator('#saveBtn')).toHaveText('✓ Saved');
});

test('import a cURL command', async ({ page }) => {
  await onboarded(page);
  await page.goto('./');
  if (isPhone(page)) await page.click('.rail [data-k="lib"]');
  await page.click('[data-act="import"]');
  await page.fill('#importText', `curl -X POST 'https://api.example.com/things?x=1' -H 'Content-Type: application/json' -d '{"a":1}'`);
  await page.click('#dlgBody [data-act="import-paste"]');
  await expect(page.locator('[data-f="name"]')).toHaveValue('POST /things');
  await expect(page.locator('select[data-f="method"]')).toHaveValue('POST');
});

test('export backup leaves secrets out by default', async ({ page }) => {
  await onboarded(page);
  await page.goto('./');
  await page.click('.rail [data-k="settings"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlgBody [data-act="export"]')]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(data.apivane).toBe('backup');
  const staging = data.workspace.envs.find((e) => e.name.startsWith('Staging'));
  expect(staging.vars.find((v) => v.k === 'apiKey').v).toBe('');
});

test('layout: no horizontal scroll; phone has bottom navigation', async ({ page }) => {
  await onboarded(page);
  await page.goto('./');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (isPhone(page)) {
    const box = await page.locator('.rail').boundingBox();
    expect(box.y).toBeGreaterThan(page.viewportSize().height - 100);
  }
});
