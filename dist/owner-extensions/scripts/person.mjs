const calls = {
  "who": "owner.who",
  "resolve": "owner.resolve",
  "notify": "notify.send",
  "ask": "notify.send",
  "notification_status": "notify.get"
}

export default async function invoke(request, host) {
  return { result: await host.call(calls[request.method], request.params) }
}
