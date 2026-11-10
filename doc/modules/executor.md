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

## Runtimes

A runtime is a sandbox with its own configuration (directories, read-only or
read-write, computer use, baseline, expiry). Assigning one to an Agent only
records that the Agent may use it; nothing about what it allows is set per
Agent. A device (`exec-<executor_id>`) is used by one Agent at a time; node
runtimes (`host`, `node-*`) are not exclusive.

```sh
buckyos --output table runtime list
buckyos runtime assign <runtime_id> --agent <agent_id> [--disabled]
buckyos runtime unassign <runtime_id> --agent <agent_id>
buckyos runtime revoke <exec-...|executor_id>
buckyos agent runtime list --agent <agent_id>
buckyos agent runtime enable|disable <runtime_id> --agent <agent_id>
buckyos agent runtime default <runtime_id|private> --agent <agent_id>
```

`runtime list`, `assign` and `revoke` talk to control-panel
(`agent.runtime_catalog`, `agent.update`, `executor.device.revoke`); the
`agent runtime` actions and `runtime unassign` talk to the Agent's own service
(`runtimes.list`, `runtimes.settings`, `runtimes.impact`,
`runtimes.settings_set`, `runtimes.remove`). JSON is the default output;
`--output table` gives one compact row per runtime.

- `assign` on a device another Agent has switched on fails with
  `RUNTIME_IN_USE` and prints the `agent runtime disable` command for that
  Agent; it is never switched off for you.
- `unassign` and `revoke` show what is in progress (sessions, waiting Todos,
  workspaces; none is moved) and always ask; the global `--yes` skips the
  question, and non-interactive runs without it fail with
  `CONFIRMATION_REQUIRED` carrying the impact in `details`.
- `agent runtime disable` asks only when something is in progress on the
  runtime.
- When the Agent's service cannot be reached, `agent runtime list` shows the
  control panel's assignments (`source: control-panel`) and `runtime unassign`
  changes nothing unless `--yes`, which removes the assignment through
  control-panel.
