import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({
  configFile: path.resolve('static/ui/vite.config.demo.ts'),
  configLoader: 'runner',
  base: '/walkthrough/',
  logLevel: 'error',
  preview: { host: '127.0.0.1', port: 4186 },
});

async function checkWalkthrough(browser, url, viewport) {
  const page = await browser.newPage({ viewport });
  const requests = [];
  page.context().on('request', (request) => requests.push(request.url()));

  try {
    await page.goto(url);
    await page.getByLabel('Local walkthrough').waitFor();
    await page.getByRole('combobox', { name: 'Who is out?' }).fill('Priya');
    await page.getByRole('option', { name: 'Priya Shah' }).click();
    await page.getByLabel('Out from').fill('2026-12-08');
    await page.getByLabel('Back on').fill('2026-12-19');
    await page.getByRole('button', { name: 'Run the drill' }).click();
    await page.getByRole('main', { name: 'Drill for Priya Shah' }).waitFor();
    await page.waitForFunction(() =>
      ['5', '3', '1'].every((count, i) => document.querySelectorAll('.kpi-n')[i]?.textContent === count),
    );

    const backup = page.getByRole('combobox', { name: 'Backup for Wallet token refresh' });
    const nextBackup = await backup.locator('option').nth(1).textContent();
    assert.notEqual(await backup.inputValue(), await backup.locator('option').nth(1).getAttribute('value'));
    await backup.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Draft handover page' }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    const draftReady = page.context().waitForEvent('page');
    await page.getByRole('button', { name: 'Open it in Confluence' }).click();
    const draft = await draftReady;
    await draft.getByRole('heading', { name: 'Handover: Priya Shah, 2026-12-08 to 2026-12-19' }).waitFor();
    const draftBackup = draft.getByRole('row').filter({ hasText: 'MOBL-31' }).getByRole('cell').nth(3);
    assert.ok((await draftBackup.textContent())?.startsWith(`${nextBackup} (`), 'the draft must preserve the selected backup');
    assert.equal(await draft.locator('a[href]').count(), 0, 'sample draft links must stay local');
    assert.deepEqual(requests.filter((request) => !request.startsWith(url) && !request.startsWith('blob:')), []);
  } finally {
    await page.context().close();
  }
}

let browser;
try {
  const url = server.resolvedUrls?.local[0];
  assert.ok(url, 'Vite did not serve the built walkthrough');
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await checkWalkthrough(browser, url, viewport);
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
