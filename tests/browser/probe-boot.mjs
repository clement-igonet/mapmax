import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto(process.env.TARGET_URL || 'http://web/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 5000));
console.log('canvas:', await page.evaluate(() => !!document.querySelector('#map canvas')));
await browser.close();
