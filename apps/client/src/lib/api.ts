import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

// Typed helpers
export const sitesApi = {
  list:   ()         => api.get('/sites').then(r => r.data),
  create: (d: any)   => api.post('/sites', d).then(r => r.data),
  update: (id: string, d: any) => api.patch(`/sites/${id}`, d).then(r => r.data),
  remove: (id: string) => api.delete(`/sites/${id}`),
  test:   (id: string) => api.post(`/sites/${id}/test`).then(r => r.data),
}

export const sourcesApi = {
  list:       (p?: any) => api.get('/sources', { params: p }).then(r => r.data),
  create:     (d: any)  => api.post('/sources', d).then(r => r.data),
  update:     (id: string, d: any) => api.patch(`/sources/${id}`, d).then(r => r.data),
  remove:     (id: string) => api.delete(`/sources/${id}`),
  fetch:      (id: string) => api.post(`/sources/${id}/fetch`).then(r => r.data),
  fetchAll:   () => api.post('/sources/fetch-all').then(r => r.data),
  import:     (urls: string[]) => api.post('/sources/import', { urls }).then(r => r.data),
  categories: (id: string) => api.get(`/sources/${id}/categories`).then(r => r.data),
  detect:     (url: string) => api.post('/sources/detect', { url }).then(r => r.data),
  scanCustom: (endpoint: string) => api.post('/sources/scan-custom', { endpoint }).then(r => r.data),
  health:     (id: string) => api.get(`/sources/${id}/health`).then(r => r.data),
  reorder:    (id: string, beforeId: string | null, afterId: string | null) =>
    api.patch(`/sources/${id}/reorder`, { beforeId, afterId }).then(r => r.data),
}

export const postsApi = {
  list:       (p?: any) => api.get('/posts', { params: p }).then(r => r.data),
  categories: (sourceId?: string) =>
    api.get('/posts/categories', { params: sourceId ? { sourceId } : undefined }).then(r => r.data),
  approve: (id: string) => api.patch(`/posts/${id}/approve`).then(r => r.data),
  reject:  (id: string) => api.patch(`/posts/${id}/reject`).then(r => r.data),
  publish: (id: string, siteIds: string[], wpStatus: 'publish' | 'draft' | 'future' = 'publish', scheduledDate?: string) =>
    api.post(`/posts/${id}/publish`, { siteIds, wpStatus, ...(scheduledDate ? { scheduledDate } : {}) }).then(r => r.data),
  remove:  (id: string) => api.delete(`/posts/${id}`),
  update:  (id: string, d: any) => api.patch(`/posts/${id}`, d).then(r => r.data),
}

export const dashboardApi = {
  stats:  () => api.get('/dashboard/stats').then(r => r.data),
  queues: () => api.get('/dashboard/queues').then(r => r.data),
}

export const settingsApi = {
  get:        () => api.get('/settings').then(r => r.data),
  saveAiKeys: (d: { openaiKey?: string; anthropicKey?: string }) =>
    api.post('/settings/ai-keys', d),
  saveSchedule: (fetchInterval: number) =>
    api.post('/settings/schedule', { fetchInterval }),
  testAi:     (provider: 'openai' | 'anthropic') =>
    api.post('/settings/test-ai', { provider }).then(r => r.data),
  removeAiKey:    (provider: 'openai' | 'anthropic') =>
    api.delete(`/settings/ai-keys/${provider}`),
  getBlocklist:       () => api.get('/settings/blocklist').then(r => r.data),
  saveBlocklist:      (words: string[]) => api.post('/settings/blocklist', { words }),
  saveQualityThreshold: (threshold: number) => api.post('/settings/quality-threshold', { threshold }),
  exportData:       () => api.get('/settings/export', { responseType: 'blob' }).then(r => r.data),
  importData:       (data: any) => api.post('/settings/import', data).then(r => r.data),
  getWebhook:           () => api.get('/settings/webhook').then(r => r.data),
  saveWebhook:          (url: string) => api.post('/settings/webhook', { url }),
  getScheduledPublish:  () => api.get('/settings/scheduled-publish').then(r => r.data),
  saveScheduledPublish: (d: any) => api.post('/settings/scheduled-publish', d).then(r => r.data),
  getIpAllowlist:       () => api.get('/settings/ip-allowlist').then(r => r.data),
  saveIpAllowlist:      (ips: string[]) => api.post('/settings/ip-allowlist', { ips }),
}

export const auditApi = {
  list: (p?: any) => api.get('/audit-log', { params: p }).then(r => r.data),
}

export const authApi = {
  login:    (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),
  me:       () => api.get('/auth/me').then(r => r.data),
  sessions: () => api.get('/auth/sessions').then(r => r.data),
  revoke:   (jti: string) => api.delete(`/auth/sessions/${jti}`),
}

export const apiKeysApi = {
  list:   () => api.get('/api-keys').then(r => r.data),
  create: (name: string) => api.post('/api-keys', { name }).then(r => r.data),
  remove: (id: string) => api.delete(`/api-keys/${id}`),
}

export const usersApi = {
  list:   () => api.get('/users').then(r => r.data),
  create: (d: any) => api.post('/users', d).then(r => r.data),
  update: (id: string, d: any) => api.patch(`/users/${id}`, d).then(r => r.data),
  remove: (id: string) => api.delete(`/users/${id}`),
}
