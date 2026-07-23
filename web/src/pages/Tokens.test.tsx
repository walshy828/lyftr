import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Tokens from './Tokens'

vi.mock('../services/api', () => ({
  tokenAPI: {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
  },
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}))

import { tokenAPI } from '../services/api'

const renderTokens = () => render(<MemoryRouter><Tokens /></MemoryRouter>)

describe('Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an empty state when there are no tokens', async () => {
    ;(tokenAPI.list as any).mockResolvedValue([])
    renderTokens()
    await waitFor(() => expect(screen.getByText(/no tokens yet/i)).toBeTruthy())
  })

  it('renders token metadata only, never a plaintext value, in the list', async () => {
    ;(tokenAPI.list as any).mockResolvedValue([
      { id: 1, name: 'MCP server', token_prefix: 'lyftr_pat_AbCd12', created_at: '2026-01-01T00:00:00Z', last_used_at: null, expires_at: null },
    ])
    renderTokens()
    await waitFor(() => expect(screen.getByText('MCP server')).toBeTruthy())
    expect(screen.getByText(/lyftr_pat_AbCd12/)).toBeTruthy()
    expect(screen.queryByText(/^lyftr_pat_(?!AbCd12)/)).toBeNull()
  })

  it('create flow reveals the plaintext token once, then lists it on close', async () => {
    ;(tokenAPI.list as any).mockResolvedValue([])
    ;(tokenAPI.create as any).mockResolvedValue({
      token: { id: 2, name: 'New token', token_prefix: 'lyftr_pat_Xyz123', created_at: '2026-01-02T00:00:00Z', last_used_at: null, expires_at: null },
      value: 'lyftr_pat_Xyz123FullSecretValue',
    })
    renderTokens()
    await waitFor(() => expect(screen.getByText(/no tokens yet/i)).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /new token/i })[0])
    fireEvent.change(screen.getByPlaceholderText(/claude mcp server/i), { target: { value: 'New token' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(screen.getByText('lyftr_pat_Xyz123FullSecretValue')).toBeTruthy())
    expect(tokenAPI.create).toHaveBeenCalledWith('New token', null)

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }))
    await waitFor(() => expect(screen.getByText('lyftr_pat_Xyz123…')).toBeTruthy())
  })

  it('revoking a token removes it from the list', async () => {
    ;(tokenAPI.list as any).mockResolvedValue([
      { id: 1, name: 'MCP server', token_prefix: 'lyftr_pat_AbCd12', created_at: '2026-01-01T00:00:00Z', last_used_at: null, expires_at: null },
    ])
    ;(tokenAPI.revoke as any).mockResolvedValue({})
    renderTokens()
    await waitFor(() => expect(screen.getByText('MCP server')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /revoke mcp server/i }))
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }))

    await waitFor(() => expect(tokenAPI.revoke).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('MCP server')).toBeNull())
  })

  it('surfaces a load error', async () => {
    ;(tokenAPI.list as any).mockRejectedValue(new Error('boom'))
    renderTokens()
    await waitFor(() => expect(screen.getByText(/failed to load tokens/i)).toBeTruthy())
  })
})
