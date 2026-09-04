import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 900 } });
await page.goto('https://localhost:5173/login');
await page.fill('input[type="email"]', 'demo@lyftr.local');
await page.fill('input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
await page.goto('https://localhost:5173/stats');
await page.waitForTimeout(500);
// find and click "Heart" tab if present
const heartTab = page.getByText('Heart', { exact: false }).first();
if (await heartTab.count()) {
  await heartTab.click();
}
await page.waitForTimeout(2000);
await page.screenshot({ path: '/private/tmp/claude-502/-Users-dpw-Documents-Development-lyftr/e2643328-926c-4e04-a632-ca8bb960cb11/scratchpad/heart.png', fullPage: true });
await browser.close();
