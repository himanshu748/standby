// Drives the installed development app in the signed-in Chrome over CDP, records the screen
// with ffmpeg and writes captions.srt from the moments each scene starts. Real site data only.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const APP = 'https://one-atlas-obka.atlassian.net/jira/apps/689d38fb-0df1-46ef-8f81-be74c1ad79c2/ce3579a4-d9f6-4580-b248-0868f35301cb';
const SITE = 'https://one-atlas-obka.atlassian.net';
const PERSON = process.env.PERSON ?? 'Alana';
const record = process.argv.includes('--record');
const shots = process.argv.includes('--shots');
fs.mkdirSync('raw', { recursive: true });
fs.mkdirSync('../docs/screenshots', { recursive: true });

const b = await chromium.connectOverCDP('http://localhost:29229');
const page = b.contexts()[0].pages()[0];
await page.bringToFront();
const sleep = (ms) => page.waitForTimeout(ms);
const app = () => page.frames().find((f) => f.url().includes('cdn.prod.atlassian-dev.net'));
const shot = async (name) => shots && page.screenshot({ path: `../docs/screenshots/${name}.png` });

let ff, t0;
const cues = [];
const cue = (text) => { if (t0) cues.push({ at: (Date.now() - t0) / 1000, text }); console.log('cue', text); };

await page.goto(APP);
await page.waitForFunction(() => document.querySelector('iframe[data-testid="hosted-resources-iframe"]'));
await sleep(5000);
let f = app();
await f.waitForSelector('.picker-input');

if (record) {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', '2560x1440', '-i', ':0.0+0,176', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', 'raw/demo.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  await sleep(800);
  t0 = Date.now();
}

cue('Standby: if this person is out, what stalls?');
await sleep(3500);
await shot('01-start');
cue('Pick any real teammate on the site and the days they will be away');
await f.click('.picker-input');
await f.type('.picker-input', PERSON, { delay: 140 });
await f.waitForSelector('[role=option]');
await sleep(1200);
await f.click('[role=option]');
await sleep(1200);
cue('Standby reads their Jira issues, Confluence pages and Teamwork Graph, as you');
await f.click('.btn.run');
await f.waitForSelector('.kpis', { timeout: 60000 });
await sleep(2500);
cue('Every item lands on a ring: red means nobody else is on record, amber one other person, green covered');
await sleep(4000);
await shot('02-drill');
cue('Hover any node to see the work behind it');
const nodes = await f.$$('.node');
for (const n of nodes.filter((_, i) => i % 9 === 0).slice(0, 6)) { await n.hover(); await sleep(700); }
await shot('03-orbit-hover');
cue('Backups come from people who already work in the same projects, spaces and teams');
await f.hover('.bench');
await sleep(3500);
cue('Click a count to focus on what stalls');
await f.click('.kpi-stalls');
await sleep(2500);
cue('Each card says why it is urgent and who can pick it up');
await f.evaluate(() => window.scrollTo({ top: 520, behavior: 'smooth' }));
await sleep(3500);
await shot('04-cards');
const pick = await f.$('.toggle input');
if (pick) { await pick.check(); await sleep(1200); }
cue('Reassigning is opt-in per issue, and nothing changes without a confirmation');
await f.click('.dock .btn.hot');
await sleep(2500);
await shot('05-confirm-reassign');
await f.click('dialog .btn:not(.hot)');
if (pick) await pick.uncheck();
await sleep(800);
cue('Each source reports its own status, so a gap is never silent');
await f.click('.kpi-stalls');
await f.evaluate(() => window.scrollTo({ top: 760, behavior: 'smooth' }));
await sleep(3500);
await shot('06-sources');
cue('One confirmation drafts the handover page in Confluence');
await f.click('.dock .btn.ghost');
await sleep(2200);
await shot('07-confirm-handover');
await f.click('dialog .btn.hot');
await f.waitForSelector('.receipts', { timeout: 60000 });
await sleep(2500);
await shot('08-draft-created');

const auth = 'Basic ' + Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64');
const found = await (await fetch(`${SITE}/wiki/api/v2/pages?status=draft&sort=-created-date&limit=25`, { headers: { Authorization: auth } })).json();
const id = found.results?.find((r) => r.title.startsWith('Handover:'))?.id;
if (id) {
  cue('The draft lists every item with its suggested backup, ready to edit and publish');
  await page.goto(`${SITE}/wiki/pages/resumedraft.action?draftId=${id}`);
  await sleep(8000);
  for (const t of ['Done', 'Got it', 'Close']) { const b = page.getByRole('button', { name: t, exact: true }); if (await b.count()) await b.first().click().catch(() => {}); }
  await sleep(1000);
  await page.mouse.wheel(0, 500);
  await sleep(3000);
  await shot('09-handover-draft');
}
cue('Standby: a bus-factor fire drill for Jira and Confluence');
await sleep(3500);
if (ff) { ff.stdin.write('q'); await new Promise((r) => ff.on('close', r)); }

const ts = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
const end = (Date.now() - (t0 ?? Date.now())) / 1000;
fs.writeFileSync('captions.srt', cues.map((c, i) => `${i + 1}\n${ts(c.at)} --> ${ts(cues[i + 1]?.at ?? end)}\n${c.text}\n`).join('\n'));
console.log('draft', id);
await b.close();
