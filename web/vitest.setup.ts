import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount anything rendered via Testing Library after each test, so mounted
// hooks/components don't leak across cases (a leaked hook keeps reacting to
// shared store updates and skews call counts).
afterEach(() => {
  cleanup()
})

// jsdom doesn't implement the Blob URL APIs; stub them so code that turns a
// fetched Blob into an <img src> (e.g. useAuthedImage) doesn't throw in tests.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-url'
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {}
}
