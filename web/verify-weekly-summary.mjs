import { chromium } from '@playwright/test'

const OUT = '/private/tmp/claude-502/-Users-dpw-Documents-Development-lyftr/dc58c6c1-648f-4acf-9845-0b4680f41691/scratchpad'
const BASE = 'https://localhost:5175'

const browser = await chromium.launch()
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1400 } })

const errors = []
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', err => errors.push(String(err)))

await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'demo@lyftr.local')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 15000 })

await page.goto(`${BASE}/stats/weekly`)
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/weekly-summary-12w.png`, fullPage: true })

// Try switching preset to 26 weeks
const btn26 = page.getByRole('button', { name: '26w' })
if (await btn26.count()) {
  await btn26.click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/weekly-summary-26w.png`, fullPage: true })
}

console.log('CONSOLE_ERRORS:', JSON.stringify(errors, null, 2))
await browser.close()
