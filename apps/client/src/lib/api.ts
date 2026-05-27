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
  list:     ()         => api.get('/sites').then(r => r.data),
  create:   (d: any)   => api.post('/sites', d).then(r => r.data),
  update:   (id: string, d: any) => api.patch(`/sites/${id}`, d).then(r => r.data),
  remove:   (id: string) => api.delete(`/sites/${id}`),
  test:     (id: string) => api.post(`/sites/${id}/test`).then(r => r.data),
  fetchJwt: (id: string) => api.post(`/sites/${id}/fetch-jwt`).then(r => r.data),
  clearJwt: (id: string) => api.delete(`/sites/${id}/jwt`),
}

export const sourcesApi = {
  list:       (p?: any) => api.get('/sources', { params: p }).then(r => r.data),
  create:     (d: any)  => api.post('/sources', d).then(r => r.data),
  update:     (id: string, d: any) => api.patch(`/sources/${id}`, d).then(r => r.data),
  remove:     (id: string) => api.delete(`/sources/${id}`),
  fetch:      (id: string) => api.post(`/sources/${id}/fetch`).then(r => r.data),
  fetchAll:   () => api.post('/sources/fetch-all').then(r => r.data),
  import:     (urls: string[]) => api.post('/sources/import', { urls }).then(r => r.data),
  importOpml: (content: string) => api.post('/sources/import-opml', { content }).then(r => r.data),
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
  languages:  () => api.get('/posts/languages').then(r => r.data),
  publish: (id: string, sites: Array<{ siteId: string; wpStatus?: 'publish' | 'draft' | 'future'; scheduledDate?: string; categoryOverride?: string; tagOverrides?: string[] }>) =>
    api.post(`/posts/${id}/publish`, { sites }).then(r => r.data),
  bulkPublish: (d: { postIds: string[]; siteId: string; categoryOverride?: string }) =>
    api.post('/posts/bulk-publish', d).then(r => r.data),
  remove:  (id: string) => api.delete(`/posts/${id}`),
  update:  (id: string, d: any) => api.patch(`/posts/${id}`, d).then(r => r.data),
  publishTasks:     (p?: any) => api.get('/publish-tasks', { params: p }).then(r => r.data),
  retryPublishTask: (id: string) => api.post(`/publish-tasks/${id}/retry`).then(r => r.data),
}

export const dashboardApi = {
  stats:    () => api.get('/dashboard/stats').then(r => r.data),
  queues:   () => api.get('/dashboard/queues').then(r => r.data),
  trending: () => api.get('/dashboard/trending').then(r => r.data),
  activity: () => api.get('/dashboard/activity').then(r => r.data),
}

export const settingsApi = {
  get:        () => api.get('/settings').then(r => r.data),
  save:       (d: Record<string, string>) => api.post('/settings', d),
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
  getUnsplashKey:       () => api.get('/settings/unsplash-key').then(r => r.data),
  saveUnsplashKey:      (key: string) => api.post('/settings/unsplash-key', { key }),
  removeUnsplashKey:    () => api.delete('/settings/unsplash-key'),
  getFeedToken:         () => api.get('/settings/feed-token').then(r => r.data),
  regenerateFeedToken:  () => api.post('/settings/feed-token').then(r => r.data),
  revokeFeedToken:      () => api.delete('/settings/feed-token'),
  exportData:           () => api.get('/settings/export', { responseType: 'blob' }).then(r => r.data),
  importData:       (data: any) => api.post('/settings/import', data).then(r => r.data),
  getWebhook:           () => api.get('/settings/webhook').then(r => r.data),
  saveWebhook:          (url: string) => api.post('/settings/webhook', { url }),
  getWebhookLog:        () => api.get('/settings/webhook-log').then(r => r.data),
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

export const captionTemplatesApi = {
  list:   () => api.get('/social/caption-templates').then(r => r.data),
  create: (data: any) => api.post('/social/caption-templates', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/social/caption-templates/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/social/caption-templates/${id}`),
}

export const imageTemplatesApi = {
  list:       () => api.get('/image-templates').then(r => r.data),
  create:     (data: any) => api.post('/image-templates', data).then(r => r.data),
  update:     (id: string, data: any) => api.patch(`/image-templates/${id}`, data).then(r => r.data),
  remove:     (id: string) => api.delete(`/image-templates/${id}`),
  uploadLogo: (id: string, logoBase64: string, mimeType: string) =>
    api.post(`/image-templates/${id}/logo`, { logoBase64, mimeType }).then(r => r.data),
  preview:    (id: string, postId: string) =>
    api.post(`/image-templates/${id}/preview`, { postId }, { responseType: 'blob' }).then(r => r.data),
}

export const socialApi = {
  accounts:       () => api.get('/social-accounts').then(r => r.data),
  discoverPages:  (data: { appId: string; appSecret: string; shortLivedToken: string }) =>
    api.post('/social-accounts/discover', data).then(r => r.data),
  createAccountBatch: (data: any) => api.post('/social-accounts/batch', data).then(r => r.data),
  updateAccount:  (id: string, data: any) => api.patch(`/social-accounts/${id}`, data).then(r => r.data),
  deleteAccount:  (id: string) => api.delete(`/social-accounts/${id}`),
  testAccount:    (id: string) => api.post(`/social-accounts/${id}/test`).then(r => r.data),
  rotateToken:    (id: string) => api.post(`/social-accounts/${id}/rotate`).then(r => r.data),
  publish:        (data: any) => api.post('/social/publish', data).then(r => r.data),
  history:        (params?: any) => api.get('/social/history', { params }).then(r => r.data),
  retryPost:      (id: string) => api.post(`/social/history/${id}/retry`).then(r => r.data),
  cancelPost:     (id: string) => api.delete(`/social/history/${id}`),
  analytics:      () => api.get('/social/analytics').then(r => r.data),
  analyticsTop:   () => api.get('/social/analytics/top').then(r => r.data),
  previewCaption: (postId: string, accountId: string, template: string) =>
    api.post('/social/preview-caption', { postId, accountId, template }).then(r => r.data),
}
