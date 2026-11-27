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
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'],
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
  });
  // Late Saturday in Los Angeles, just before the spring clock change.
  await page.clock.setFixedTime(new Date('2026-03-08T07:30:00Z'));

  await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Out from').inputValue(), '2026-03-08');
  assert.equal(await page.getByLabel('Back on').inputValue(), '2026-03-19');
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

  await page.getByText('Handover brief', { exact: true }).click();
  const brief = page.getByRole('textbox', { name: 'Handover brief text' });
  assert.match(await brief.inputValue(), /Migration runbook v3.*\n {2}Suggested backup: Bharat Kumar/);
  await page.getByLabel('Backup for Migration runbook v3').selectOption('a-dmitri');
  assert.match(await brief.inputValue(), /Migration runbook v3.*\n {2}Suggested backup: Dmitri Volkov/);
  const copy = page.getByRole('button', { name: 'Copy brief' });
  await copy.click();
  await page.getByText('Handover brief copied.').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await brief.inputValue());

  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('Clipboard denied', 'NotAllowedError'));
  });
  await copy.click();
  await page.getByText('Text selected. Copy it with your keyboard or device menu.').waitFor();
  assert.equal(await brief.evaluate((field) => field.selectionEnd - field.selectionStart), (await brief.inputValue()).length);

  await page.getByRole('button', { name: 'Draft handover page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create the handover draft?' });
  await dialog.waitFor();
  assert.match(
    (await dialog.textContent()) ?? '',
    /Nobody sees it until you publish it/,
  );

  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await page.getByText('Handover draft created.').waitFor({ timeout: 10_000 });

  await page.goto(new URL('?partialDrill', url).href);
  await picker.fill('Alana');
  await alana.click();
  await page.getByRole('button', { name: 'Run the drill' }).click();
  const partial = page.getByRole('main', { name: 'Drill for Alana Rivera' });
  await partial.waitFor();
  assert.match(await partial.locator('.empty').textContent(), /Source coverage is incomplete/);
  assert.equal(await partial.getByText(/Standby found no open work/).count(), 0);

  await page.goto(new URL('?partialPanel', url).href);
  await page.getByRole('status').filter({ hasText: 'Source coverage is incomplete' }).waitFor({ timeout: 3000 });
  assert.match(await page.locator('.panel-kicker').textContent(), /Mar 8.*Mar 21/);
  assert.equal(await page.locator('.verdict-word').textContent(), 'Coverage unclear');
  await page.getByText('No backup found in the available data.').waitFor();
  assert.equal(await page.getByText('Nobody else has touched it in Jira or Teamwork Graph.').count(), 0);
  assert.match(await page.getByRole('list', { name: 'Where this came from' }).textContent(), /Graph unavailable/);

  await page.goto(new URL('?retryPanel', url).href);
  await page.getByRole('alert').filter({ hasText: 'Could not read the issue' }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Retry issue check' }).click({ timeout: 3000 });
  await page.getByRole('heading', { name: 'Who can pick it up' }).waitFor({ timeout: 3000 });
  assert.equal(await page.getByRole('alert').count(), 0);
  const reassign = page.getByRole('button', { name: /Reassign to/ });
  const confirmReassign = page.getByRole('dialog').getByRole('button', { name: 'Reassign', exact: true });
  await reassign.click();
  await confirmReassign.click();
  const oldReceipt = page.getByRole('status').filter({ hasText: 'Jira rejected the reassignment' });
  await oldReceipt.waitFor({ timeout: 3000 });
  await reassign.click();
  await confirmReassign.click();
  await page.getByRole('alert').filter({ hasText: 'Could not reassign the issue' }).waitFor({ timeout: 3000 });
  assert.equal(await oldReceipt.count(), 0);
  await reassign.click();
  await confirmReassign.click();
  await page.getByRole('status').filter({ hasText: /Reassigned SAL-91 to Celia Osei/ }).waitFor({ timeout: 3000 });
  assert.equal(await page.getByRole('alert').count(), 0);
} finally {
  await browser?.close();
  await server.close();
}
