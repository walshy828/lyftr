// Synthesized timer-complete chime — no bundled audio asset. One AudioContext
// is lazily created and reused (browsers require it to originate from a user
// gesture; "Start Timer" satisfies that). Two short oscillator tones with a
// gain envelope avoid the click a raw on/off would produce.
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

function tone(audio: AudioContext, freq: number, startAt: number, durationSec: number) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.3, startAt + 0.02)
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + durationSec)
}

export function playTimerCompleteBeep(): void {
  const audio = getCtx()
  if (!audio) return
  if (audio.state === 'suspended') audio.resume()
  const now = audio.currentTime
  tone(audio, 880, now, 0.15)
  tone(audio, 1320, now + 0.18, 0.2)
}
