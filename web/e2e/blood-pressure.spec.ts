import { test, expect } from './fixtures'
import { API_BASE as API } from './config'
import { cleanupSeed } from './seedHelpers'

const SEED_NOTE = 'E2E seed bp'
const FORM_NOTE = 'E2E form bp test'

let authToken: string

test.describe('Blood pressure', () => {
  test.beforeAll(async ({ request, workerAuth }) => {
    authToken = workerAuth.token
    const headers = { Authorization: `Bearer ${authToken}` }

    // Idempotent seed (beforeAll runs in both projects on the shared workers:1 user).
    await cleanupSeed(
      request, authToken,
      `${API}/blood-pressure?limit=200`, `${API}/blood-pressure`,
      r => r.notes === SEED_NOTE || r.notes === FORM_NOTE,
    )

    // Three consecutive days of morning readings, ending yesterday, so the
    // averages, the gauge, and the trend all have something to render.
    for (let daysAgo = 3; daysAgo >= 1; daysAgo--) {
      const date = new Date(Date.now() - daysAgo * 86400000)
      date.setHours(8, 0, 0, 0)
      await request.post(`${API}/blood-pressure`, {
        headers,
        data: {
          systolic: 128 + daysAgo,
          diastolic: 82,
          pulse: 64,
          context: 'morning',
          rested: true,
          notes: SEED_NOTE,
          tz_offset: -date.getTimezoneOffset(),
          logged_at: date.toISOString(),
        },
      })
    }
  })

  test.afterAll(async ({ request }) => {
    await cleanupSeed(
      request, authToken,
      `${API}/blood-pressure?limit=200`, `${API}/blood-pressure`,
      r => r.notes === SEED_NOTE || r.notes === FORM_NOTE,
    )
  })

  // @mobile: the deep link is how the bottom nav and any shared link land here,
  // and a cold load is the case the query-param tab design is most exposed to.
  test('deep link to ?tab=bp renders the blood pressure panel', { tag: '@mobile' }, async ({ page }) => {
    await page.goto('/health?tab=bp')

    await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log Reading' })).toBeVisible()
    // The heading, not loose text: "average" also appears in the coaching copy
    // ("Where your average falls", "Based on your average, ...").
    await expect(page.getByRole('heading', { name: 'Your Average' })).toBeVisible()
  })

  test('shows the latest reading with its category', async ({ page }) => {
    await page.goto('/health?tab=bp')

    // 129/82 — stage 1 on both numbers.
    await expect(page.getByText('129/82')).toBeVisible()
    await expect(page.getByText('Stage 1').first()).toBeVisible()
  })

  test('/weight redirects into the hub', async ({ page }) => {
    await page.goto('/weight')

    await expect(page).toHaveURL(/\/health\?tab=weight/)
    await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible()
  })

  test('switching tabs updates the query string', async ({ page }) => {
    await page.goto('/health?tab=weight')

    await page.getByRole('button', { name: 'Blood Pressure' }).click()

    await expect(page).toHaveURL(/tab=bp/)
    await expect(page.getByRole('button', { name: 'Log Reading' })).toBeVisible()
  })

  // @mobile: logging a reading is the core on-phone action (numeric keypad).
  test('logs a reading through the entry sheet', { tag: '@mobile' }, async ({ page }) => {
    await page.goto('/health?tab=bp')

    await page.getByRole('button', { name: 'Log Reading' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByLabel('Systolic').fill('118')
    await page.getByLabel('Diastolic').fill('76')

    // The category appears live, before anything is saved.
    await expect(page.getByTestId('bp-live-category')).toHaveText('Normal')

    const saved = page.waitForResponse(
      r => r.url().includes('/blood-pressure') && r.request().method() === 'POST' && r.status() === 201,
    )
    await page.getByRole('button', { name: 'Save Reading' }).click()
    await saved

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('118/76')).toBeVisible()
  })

  test('warns on a crisis reading without blocking the save', async ({ page }) => {
    await page.goto('/health?tab=bp')

    await page.getByRole('button', { name: 'Log Reading' }).click()
    await page.getByLabel('Systolic').fill('190')
    await page.getByLabel('Diastolic').fill('125')

    await expect(page.getByTestId('bp-crisis-warning')).toBeVisible()
    // Recording your own reading must never be blocked.
    await expect(page.getByRole('button', { name: 'Save Reading' })).toBeEnabled()
  })

  test('insight page reads without generating', async ({ page }) => {
    await page.goto('/health/bp/insight')

    await expect(page.getByRole('heading', { name: 'Blood Pressure Insight' })).toBeVisible()
    // Opening the page must not spend an AI call — the button is the only trigger.
    await expect(page.getByRole('button', { name: /run insight/i })).toBeVisible()
  })
})
