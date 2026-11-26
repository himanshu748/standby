import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: path.resolve('static/ui/vite.config.e2e.ts'),
  logLevel: 'error',
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  assert.ok(url, 'Vite did not expose a local URL');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto(url, { waitUntil: 'networkidle' });
  const picker = page.getByRole('combobox', { name: 'Who is out?' });
  const alana = page.getByRole('option', { name: 'Alana Rivera' });
  await picker.fill('Alana');
  await alana.waitFor();
  await picker.fill('No match');
  assert.equal(await alana.count(), 0, 'the previous query must not leave a selectable result');
  await picker.press('Enter');
  assert.equal(await picker.inputValue(), 'No match');
  await picker.fill('A');
  await page.locator('.picker-spin').waitFor({ state: 'hidden' });
  await picker.fill('Alana');
  await alana.click();
  await page.getByRole('button', { name: 'Run the drill' }).click();

  await page.getByRole('main', { name: 'Drill for Alana Rivera' }).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('.kpi-stalls .kpi-n')?.textContent === '3');

  assert.equal(await page.locator('.kpi-stalls .kpi-n').textContent(), '3');
  assert.equal(await page.locator('.kpi-thin .kpi-n').textContent(), '2');
  assert.equal(await page.locator('.kpi-covered .kpi-n').textContent(), '3');
  assert.match(
    (await page.getByRole('list', { name: 'Where this came from' }).textContent()) ?? '',
    /Teamwork Graph\s+4 items/,
  );

  await page.getByRole('button', { name: 'Draft handover page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create the handover draft?' });
  await dialog.waitFor();
  assert.match(
    (await dialog.textContent()) ?? '',
    /Nobody sees it until you publish it/,
  );

  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await page.getByText('Handover draft created.').waitFor({ timeout: 10_000 });
} finally {
  await browser?.close();
  await server.close();
}
