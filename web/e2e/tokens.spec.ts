import { test, expect } from './fixtures'

// Authenticated spec — relies on the shared storage state from fixtures.ts.

test('creates, uses, and revokes a personal access token', async ({ page, request }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: /manage/i }).click()
  await expect(page).toHaveURL(/\/settings\/tokens$/)
  await expect(page.getByText(/no tokens yet/i)).toBeVisible()

  // Create
  await page.getByRole('button', { name: /new token/i }).first().click()
  await page.getByPlaceholder(/claude mcp server/i).fill('E2E MCP token')
  await page.getByRole('button', { name: /^create$/i }).click()

  const tokenField = page.locator('code')
  await expect(tokenField).toBeVisible()
  const plaintext = (await tokenField.textContent())?.trim()
  expect(plaintext).toMatch(/^lyftr_pat_/)

  // The backend PAT auth path genuinely works end-to-end, not just the UI.
  const meRes = await request.get('/api/v1/me', { headers: { Authorization: `Bearer ${plaintext}` } })
  expect(meRes.ok()).toBeTruthy()

  await page.getByRole('button', { name: /^done$/i }).click()
  await expect(page.getByText('E2E MCP token')).toBeVisible()
  // Only the prefix is ever shown after the reveal step closes.
  await expect(page.getByText(plaintext!)).toHaveCount(0)

  // Revoke
  await page.getByRole('button', { name: /revoke e2e mcp token/i }).click()
  await page.getByRole('button', { name: /^revoke$/i }).click()
  await expect(page.getByText('E2E MCP token')).toHaveCount(0)
  await expect(page.getByText(/no tokens yet/i)).toBeVisible()

  const revokedRes = await request.get('/api/v1/me', { headers: { Authorization: `Bearer ${plaintext}` } })
  expect(revokedRes.status()).toBe(401)
})
