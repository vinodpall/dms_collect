import { lsGet, lsSet } from '@/utils'

export const TOKEN_KEY = 'dms_access_token'

export function getToken(): string | null {
  return lsGet(TOKEN_KEY)
}

export function setToken(token: string): void {
  lsSet(TOKEN_KEY, token)
}

export function removeToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  code: number
  data?: any
  constructor(message: string, code: number = -1, data?: any) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
  }
}

export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
  trace_id?: string
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, any>
  skipAuth?: boolean
}

export async function request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  let url = endpoint
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (!url.startsWith('/api')) {
      url = '/api/v1' + (url.startsWith('/') ? url : '/' + url)
    }
  }

  if (options.params) {
    const searchParams = new URLSearchParams()
    for (const [key, val] of Object.entries(options.params)) {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val))
      }
    }
    const queryString = searchParams.toString()
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString
    }
  }

  const headers = new Headers(options.headers || {})
  if (!options.skipAuth) {
    const token = getToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (res.status === 401 && !options.skipAuth) {
    removeToken()
    try {
      localStorage.removeItem('dms_user_profile')
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('dms:unauthorized'))
    // 路由采用 createWebHashHistory()，避免使用 history pathname 跳转导致 404 或产生 /login#/xxx
    if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
      window.history.replaceState(null, '', '/#/login')
    } else if (!window.location.hash.startsWith('#/login')) {
      window.location.hash = '#/login'
    }
    throw new ApiError('登录已过期，请重新登录', 401)
  }

  if (!res.ok) {
    let errMsg = `请求失败: HTTP ${res.status}`
    try {
      const errJson = await res.json()
      if (errJson.message) errMsg = errJson.message
      else if (errJson.detail) errMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail)
    } catch {
      // ignore
    }
    throw new ApiError(errMsg, res.status)
  }

  const result: ApiResponse<T> = await res.json()
  if (result.code !== 0) {
    throw new ApiError(result.message || '操作失败', result.code, result.data)
  }

  return result.data
}

export const api = {
  get: <T = any>(url: string, params?: Record<string, any>, options?: RequestOptions) =>
    request<T>(url, { method: 'GET', params, ...options }),
  post: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    request<T>(url, {
      method: 'POST',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      ...options,
    }),
  put: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    request<T>(url, {
      method: 'PUT',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      ...options,
    }),
  del: <T = any>(url: string, options?: RequestOptions) =>
    request<T>(url, { method: 'DELETE', ...options }),
}
