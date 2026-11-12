// Cloudflare Pages Function: 反向代理 /api 到后端服务器
export const onRequest = async (context: any) => {
  // 处理 OPTIONS 预检请求
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  const url = new URL(context.request.url)

  // Cloudflare 禁止直接使用裸 IP (报 error code: 1003 Direct IP access not allowed)
  // 使用 sslip.io 自动通配域名 (39-185-83-71.sslip.io 解析到 39.185.83.71)
  const backendBase = context.env?.BACKEND_URL || 'http://39-185-83-71.sslip.io:8001'
  const targetUrl = `${backendBase}${url.pathname}${url.search}`

  const reqHeaders = new Headers(context.request.headers)
  reqHeaders.delete('host')
  reqHeaders.delete('cf-connecting-ip')
  reqHeaders.delete('cf-ray')
  reqHeaders.delete('cf-visitor')

  try {
    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers: reqHeaders,
      body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
      redirect: 'follow',
    })

    const resHeaders = new Headers(response.headers)
    resHeaders.set('Access-Control-Allow-Origin', '*')
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    resHeaders.set('Access-Control-Allow-Headers', '*')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders,
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ code: -1, message: `代理转发失败: ${err.message}` }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
