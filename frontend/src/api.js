import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({ baseURL: API_BASE })

export const startInterview = (payload) => api.post('/interview/start', payload)
export const submitAnswer = (sessionId, payload) => api.post(`/interview/${sessionId}/answer`, payload)
export const askAssistant = (sessionId, text) => api.post(`/interview/${sessionId}/assistant`, { text })
export const uploadDocument = (sessionId, files) => {
  const form = new FormData()
  Array.from(files).forEach((f) => form.append('files', f))
  return api.post(`/documents/${sessionId}/upload`, form)
}
export const generateSummary = (sessionId) => api.post('/summary/generate', { session_id: sessionId })
export const generateVideoSummary = (sessionId) => api.post('/summary/from-video', { session_id: sessionId })
export const getInteractions = (sessionId) => api.get(`/documents/${sessionId}/interactions`)
export const pushToHis = (sessionId) => api.post(`/summary/${sessionId}/push-his`)
export const getDocumentsTimeline = (sessionId) => api.get(`/documents/${sessionId}/timeline`)
export const getDocumentsReport = (sessionId) => api.get(`/documents/${sessionId}/report-json`)
export const downloadReportPdf = (sessionId) => api.get(`/documents/${sessionId}/report-pdf`, { responseType: 'blob' })
export const getConsentNotice = (language) => api.get('/consent/notice', { params: { language } })
export const normalizeSign = (label) => api.post('/sign/normalize', { label })
export const getSignVocabulary = () => api.get('/sign/vocabulary')

export default api
