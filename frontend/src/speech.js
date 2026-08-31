import api from './api'

let currentAudio = null

function playBuffer(buf) {
  return new Promise((resolve) => {
    try {
      stop()
      // Edge TTS returns mp3 (audio/mpeg), try mpeg first then wav fallback
      const blob = new Blob([buf], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio
      audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve() }
      audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve() }
      const p = audio.play()
      if (p && p.catch) p.catch(() => { URL.revokeObjectURL(url); currentAudio = null; resolve() })
    } catch {
      resolve()
    }
  })
}

function browserSpeak(text, lang = 'en-IN') {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve()
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = lang
    utter.rate = 0.95
    utter.onend = () => resolve()
    utter.onerror = () => resolve()
    window.speechSynthesis.speak(utter)
  })
}

const Speech = {
  async speak(text, lang = 'en-IN') {
    if (!text) return
    stop() // Ensure only one voice at a time — prevents double speak
    const code = lang.split("-")[0].toLowerCase()
    try {
      const res = await api.post('/voice/tts', { text, lang: code }, { responseType: 'arraybuffer', timeout: 20000 })
      if (res.data && res.data.byteLength > 512) return playBuffer(res.data)
    } catch { /* Edge TTS unavailable - fall back to browser */ }
    return browserSpeak(text, lang)
  },
  stop() {
    if (currentAudio) {
      try { currentAudio.pause() } catch { /* already stopped */ }
      currentAudio = null
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  },
}

export class Dictation {
  constructor(onResult, onEnd, onError, lang = 'en-IN') {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      if (onError) onError('Voice input needs Chrome or Edge browser')
      throw new Error('SpeechRecognition unsupported')
    }
    this.rec = new SR()
    this.rec.lang = lang || 'en-IN'
    this.rec.interimResults = false
    this.rec.maxAlternatives = 1
    this.rec.continuous = false
    this.rec.onresult = (e) => onResult(e.results[0][0].transcript)
    this.rec.onend = onEnd
    this.rec.onerror = (e) => {
      if (onError) {
        const msgs = {
          'not-allowed': 'Mic blocked - click the lock icon in address bar and allow microphone',
          'service-not-allowed': 'Mic blocked by browser settings',
          'no-speech': 'No speech heard - try again',
          'network': 'Voice service needs internet',
          'audio-capture': 'No microphone found',
        }
        onError(msgs[e.error] || `Mic error: ${e.error}`)
      }
      onEnd()
    }
  }
  start() {
    this.rec.start()
  }
  stop() {
    try { this.rec.stop() } catch { /* already stopped */ }
  }
}

export default Speech
