# executor

`buckyos executor` manages lightweight devices through control-panel and accesses
command/file operations over the existing Node Executor Command Stream. The
target daemon needs no Node.js, Docker or complete Node installation.

```sh
buckyos executor create --input @executor-device.json
buckyos executor list
buckyos executor online
buckyos executor issue --executor-id exec-...
buckyos executor revoke --executor-id exec-...
```

The create JSON contains `name`, `profiles` and optional `expires_at_ms`/`limits`.
Each profile has absolute `workdir_roots`, exact Agent DIDs in `principals`,
`ops` containing `open_stream` and its permitted operations, and optional `env`.
Omit `run_as` for the ordinary user daemon. The response contains a secret access
URL; send it only to the intended target user. Expiry revokes an already online
daemon. Resetting the URL invalidates its previous active connection.

Copy `executor_id`, `generation`, `store_id` and a permitted `profile_id` from
`executor online`. Every operation names that complete target explicitly:

```sh
buckyos executor exec --executor-id exec-... --generation 3 --profile-id user --store-id ledger-... --locator ./operation.json --cmd 'printf hello' --cwd /home/user
buckyos executor query --executor-id exec-... --generation 3 --profile-id user --store-id ledger-... --locator ./operation.json --channel stdout --wait-ms 1000
```

`exec`, `read`, `write`, `edit` create a new locator file before dispatch. They
refuse to overwrite it. `query` and `cancel` read that file. A lost connection
does not trigger automatic command replay. After reconnection rediscover the
new generation; query the same executor/profile/store using the old locator.
A changed store rejects recovery rather than conflating different machines.
File contents returned by `query` use the protocol's `chunk.data_b64` field.

Use `buckyos command describe executor <verb>` for each command's schema.
Linux exposes command and file capability only; GUI remains unsupported.

SDK exports `ExecutorClient`, `ExecutorCommandStream`, `ExecutorTarget` and
`ExecutorOperationLocator` from `buckyos`, `buckyos/node` and `buckyos/browser`.
The client supports `listOnline` and an abortable `watchOnline` polling iterator.
Obtain the route and use the same authenticated App session token for stream
login. Persist the locator before calling a mutating method; after an unknown
outcome reconnect to a freshly discovered target and query the old locator.
