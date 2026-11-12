// Cloudflare Pages Function: 反向代理 /api 到后端服务器
export const onRequest = async (context: any) => {
  const url = new URL(context.request.url)
  // 将 /api/... 转发到实际后端地址
  const targetUrl = `http://39.185.83.71:8001${url.pathname}${url.search}`

  const reqHeaders = new Headers(context.request.headers)
  reqHeaders.delete('host')

  try {
    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers: reqHeaders,
      body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
      redirect: 'follow',
    })

    const resHeaders = new Headers(response.headers)
    // 允许跨域（如需要）
    resHeaders.set('Access-Control-Allow-Origin', '*')
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
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
