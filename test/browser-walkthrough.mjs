import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: path.resolve('static/ui/vite.config.demo.ts'),
  configLoader: 'runner',
  logLevel: 'error',
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  assert.ok(url, 'Vite did not expose the walkthrough');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const offsite = [];
  await context.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === new URL(url).origin || requestUrl.protocol === 'blob:') return route.continue();
    offsite.push(requestUrl.href);
    return route.abort();
  });

  const page = await context.newPage();
  await page.goto(url);
  await page.getByLabel('Local walkthrough').waitFor();
  await page.getByRole('combobox', { name: 'Who is out?' }).fill('Priya');
  await page.getByRole('option', { name: 'Priya Shah' }).click();
  await page.getByLabel('Out from').fill('2026-12-08');
  await page.getByLabel('Back on').fill('2026-12-19');
  await page.getByRole('button', { name: 'Run the drill' }).click();

  await page.getByRole('main', { name: 'Drill for Priya Shah' }).waitFor();
  await page.waitForFunction(() =>
    [5, 3, 1].every((count, i) => document.querySelectorAll('.kpi-n')[i]?.textContent === String(count)),
  );
  const wallet = page.getByRole('listitem').filter({ hasText: 'Wallet token refresh' });
  assert.equal(await wallet.locator('.pill').textContent(), 'Thin');
  assert.match(await wallet.textContent(), /works on it too, per Teamwork Graph/);
  assert.match(await page.getByRole('list', { name: 'Where this came from' }).textContent(), /colleagues' graphs/);

  const backup = wallet.getByRole('combobox', { name: 'Backup for Wallet token refresh' });
  const nextBackup = await backup.locator('option').nth(1).textContent();
  await backup.selectOption({ index: 1 });
  assert.ok(nextBackup);
  await page.getByText('Handover brief', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy brief' }).click();
  await page.getByText('Handover brief copied.').waitFor();
  const brief = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(brief.split('\n').some((line, i, lines) => line.startsWith('- MOBL-31 ') && lines[i + 1]?.includes(`Suggested backup: ${nextBackup}`)));

  await wallet.getByRole('checkbox', { name: 'Reassign' }).check();
  await page.getByRole('button', { name: 'Reassign 1 issue' }).click();
  await page.getByRole('button', { name: 'Reassign in Jira' }).click();
  await page.getByText(`MOBL-31 now assigned to ${nextBackup}`).waitFor();

  await page.getByRole('button', { name: 'Draft handover page' }).click();
  const confirm = page.getByRole('dialog', { name: 'Create the handover draft?' });
  assert.match(await confirm.textContent(), /Mobile checkout/);
  await confirm.getByRole('button', { name: 'Create draft' }).click();
  const previewReady = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open it in Confluence' }).click();
  const preview = await previewReady;
  await preview.getByRole('heading', { name: 'Handover: Priya Shah, 2026-12-08 to 2026-12-19' }).waitFor();
  assert.ok((await preview.getByRole('row').filter({ hasText: 'MOBL-31' }).textContent()).includes(nextBackup));
  assert.equal(await preview.locator('a[href]').count(), 0, 'fixture sources must stay local');
  assert.deepEqual(offsite, []);
} finally {
  await browser?.close();
  await server.close();
}
