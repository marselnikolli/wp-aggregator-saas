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
}

export const postsApi = {
  list:       (p?: any) => api.get('/posts', { params: p }).then(r => r.data),
  categories: (sourceId?: string) =>
    api.get('/posts/categories', { params: sourceId ? { sourceId } : undefined }).then(r => r.data),
  approve: (id: string) => api.patch(`/posts/${id}/approve`).then(r => r.data),
  reject:  (id: string) => api.patch(`/posts/${id}/reject`).then(r => r.data),
  publish: (id: string, siteIds: string[]) =>
    api.post(`/posts/${id}/publish`, { siteIds }).then(r => r.data),
  remove:  (id: string) => api.delete(`/posts/${id}`),
  update:  (id: string, d: any) => api.patch(`/posts/${id}`, d).then(r => r.data),
}

export const dashboardApi = {
  stats:  () => api.get('/dashboard/stats').then(r => r.data),
  queues: () => api.get('/dashboard/queues').then(r => r.data),
}

export const authApi = {
  login:  (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),
  me:     () => api.get('/auth/me').then(r => r.data),
}
