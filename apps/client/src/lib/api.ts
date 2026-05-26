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
  publish: (id: string, sites: Array<{ siteId: string; wpStatus?: 'publish' | 'draft' | 'future'; scheduledDate?: string; categoryOverride?: string; tagOverrides?: string[] }>) =>
    api.post(`/posts/${id}/publish`, { sites }).then(r => r.data),
  remove:  (id: string) => api.delete(`/posts/${id}`),
  update:  (id: string, d: any) => api.patch(`/posts/${id}`, d).then(r => r.data),
}

export const dashboardApi = {
  stats:    () => api.get('/dashboard/stats').then(r => r.data),
  queues:   () => api.get('/dashboard/queues').then(r => r.data),
  trending: () => api.get('/dashboard/trending').then(r => r.data),
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
  saveTranslation:      (translateTo: string) => api.post('/settings/translation', { translateTo }),
  exportData:       () => api.get('/settings/export', { responseType: 'blob' }).then(r => r.data),
  importData:       (data: any) => api.post('/settings/import', data).then(r => r.data),
  getWebhook:           () => api.get('/settings/webhook').then(r => r.data),
  saveWebhook:          (url: string) => api.post('/settings/webhook', { url }),
  getScheduledPublish:  () => api.get('/settings/scheduled-publish').then(r => r.data),
  saveScheduledPublish: (d: any) => api.post('/settings/scheduled-publish', d).then(r => r.data),
  getIpAllowlist:       () => api.get('/settings/ip-allowlist').then(r => r.data),
  saveIpAllowlist:      (ips: string[]) => api.post('/settings/ip-allowlist', { ips }),
  getPublishPipeline:   () => api.get('/settings/publish-pipeline').then(r => r.data),
  savePublishPipeline:  (d: any) => api.post('/settings/publish-pipeline', d),
  getStorage:           () => api.get('/settings/storage').then(r => r.data),
  saveStorage:          (d: any) => api.post('/settings/storage', d),
  testStorage:          () => api.post('/settings/storage/test').then(r => r.data),
}

export const auditApi = {
  list: (p?: any) => api.get('/audit-log', { params: p }).then(r => r.data),
}

export const authApi = {
  login:         (email: string, password: string, totpCode?: string) =>
    api.post('/auth/login', { email, password, ...(totpCode ? { totpCode } : {}) }).then(r => r.data),
  me:            () => api.get('/auth/me').then(r => r.data),
  sessions:      () => api.get('/auth/sessions').then(r => r.data),
  revoke:        (jti: string) => api.delete(`/auth/sessions/${jti}`),
  setupTotp:     () => api.post('/auth/totp/setup').then(r => r.data),
  enableTotp:    (code: string) => api.post('/auth/totp/enable', { code }).then(r => r.data),
  disableTotp:   (code: string) => api.post('/auth/totp/disable', { code }).then(r => r.data),
}

export const apiKeysApi = {
  list:   () => api.get('/api-keys').then(r => r.data),
  create: (name: string) => api.post('/api-keys', { name }).then(r => r.data),
  remove: (id: string) => api.delete(`/api-keys/${id}`),
}

export const pipelinesApi = {
  list:   ()                    => api.get('/pipelines').then(r => r.data),
  create: (d: any)              => api.post('/pipelines', d).then(r => r.data),
  update: (id: string, d: any)  => api.patch(`/pipelines/${id}`, d).then(r => r.data),
  remove: (id: string)          => api.delete(`/pipelines/${id}`),
  run:    (id: string)          => api.post(`/pipelines/${id}/run`).then(r => r.data),
}

export const usersApi = {
  list:   () => api.get('/users').then(r => r.data),
  create: (d: any) => api.post('/users', d).then(r => r.data),
  update: (id: string, d: any) => api.patch(`/users/${id}`, d).then(r => r.data),
  remove: (id: string) => api.delete(`/users/${id}`),
}
