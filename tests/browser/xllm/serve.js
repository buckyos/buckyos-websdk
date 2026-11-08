// A static file server for the built example pages (no Zone).
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json', '.css': 'text/css' }

async function serve(root, buildHint) {
  if (!fs.existsSync(root)) throw new Error(`build the example first: ${buildHint} (${root})`)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)))
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

module.exports = { serve }
