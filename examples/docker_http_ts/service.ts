import http from "node:http";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "18080", 10);

const server = http.createServer((request, response) => {
  const payload = JSON.stringify({
    runtime: "typescript",
    message: "hello from docker",
    path: request.url ?? "/",
  });

  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
});

server.listen(port, host, () => {
  console.log(`typescript server listening on http://${host}:${port}`);
});
