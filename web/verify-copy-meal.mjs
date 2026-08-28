import { chromium } from '@playwright/test'

const OUT = '/private/tmp/claude-502/-Users-dpw-Documents-Development-lyftr/976ef634-0d45-4952-ba0b-def51e5f853d/scratchpad/verify'
const BASE = 'https://localhost:5174'

const browser = await chromium.launch()
const page = await browser.newPage({ ignoreHTTPSErrors: true })
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text()) })
page.on('pageerror', e => console.log('PAGE ERROR:', e.message))

await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'demo@lyftr.local')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL(/dashboard|\/$/, { timeout: 10000 }).catch(() => {})
await page.waitForTimeout(1000)

await page.goto(`${BASE}/food`)
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/1-food-page.png`, fullPage: true })

// Log a breakfast item today so we have something to copy from "yesterday" later;
// first let's just try the per-meal Copy button on breakfast.
const copyBtn = page.getByLabel(/Copy from a previous day into Breakfast/i)
await copyBtn.click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/2-copy-modal-open.png`, fullPage: true })

await browser.close()
console.log('done')
