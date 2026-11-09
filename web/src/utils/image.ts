/** Shared client-side image prep: every photo the app uploads goes through here. */

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.85

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Downscales an in-memory image (from a picked/captured file) to a JPEG
// data URL + base64 payload, mirroring NutritionLabelCamera's canvas
// pipeline so both photo entry points send the same shape of image.
export async function downscaleToJpeg(file: File, maxEdge = MAX_LONG_EDGE): Promise<{ dataUrl: string; base64: string }> {
  const bitmap = await createImageBitmap(file)
  const longEdge = Math.max(bitmap.width, bitmap.height)
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('image encode failed')
  const buffer = await blob.arrayBuffer()
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), base64: arrayBufferToBase64(buffer) }
}
