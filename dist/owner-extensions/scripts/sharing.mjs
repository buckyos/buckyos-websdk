const calls = {
  "grant": "sharing.grant",
  "revoke": "sharing.revoke"
}

export default async function invoke(request, host) {
  return { result: await host.call(calls[request.method], request.params) }
}
