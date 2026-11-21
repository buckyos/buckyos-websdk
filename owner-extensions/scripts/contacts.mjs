const calls = {
  "find": "contact.find",
  "get": "contact.get",
  "update": "contact.update"
}

export default async function invoke(request, host) {
  return { result: await host.call(calls[request.method], request.params) }
}
