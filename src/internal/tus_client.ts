export * from 'tus-js-client'
import type { HttpRequest, HttpResponse, HttpStack } from 'tus-js-client'

/** Keep the same TUS engine in Node/Deno, where XMLHttpRequest is absent. */
export const fetchHttpStack: HttpStack = {
    getName: () => 'FetchHttpStack',
    createRequest(method, url): HttpRequest {
        const headers = new Headers()
        const controller = new AbortController()
        let progress: ((bytesSent: number) => void) | undefined
        let response: Response | undefined
        return {
            getMethod: () => method,
            getURL: () => url,
            setHeader: (name, value) => { headers.set(name, value) },
            getHeader: name => headers.get(name) ?? undefined,
            setProgressHandler: handler => { progress = handler },
            async send(body = null): Promise<HttpResponse> {
                response = await fetch(url, { method, headers, body, signal: controller.signal, credentials: 'include' })
                const text = await response.text()
                if (response.ok && body instanceof Blob) progress?.(body.size)
                const received = response
                return {
                    getStatus: () => received.status,
                    getHeader: name => received.headers.get(name) ?? undefined,
                    getBody: () => text,
                    getUnderlyingObject: () => received,
                }
            },
            async abort() { controller.abort() },
            getUnderlyingObject: () => response,
        }
    },
}
