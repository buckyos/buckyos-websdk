const calls = {
  "get": "binding.get",
  "set": "binding.set",
  "reset": "binding.reset"
}

export default async function invoke(request, host) {
  return { result: await host.call(calls[request.method], request.params) }
}
