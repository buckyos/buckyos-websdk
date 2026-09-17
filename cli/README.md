# BuckyOS Tool internals

This directory is the single source for the `buckyos` command shipped in the npm `buckyos` package
and in BuckyOS system images. CLI modules are internal implementation details; the package's public
JavaScript exports remain the SDK exports declared in `package.json`.

## Two distributions, one command registry

- `cli/launcher.mjs` starts the prebuilt `cli/dist/cli.mjs` on Node for `npx buckyos`. The developer
  package contains no second runtime.
- `cli/system_bootstrap.ts` starts `cli/system_launcher.ts` with the Deno binary bundled in
  `$BUCKYOS_ROOT/libexec/buckyos-tool/runtime/`. The bootstrap derives Deno permissions from the
  same system policy enforced by the host.
- `main.ts`, `core/`, and `modules/` depend only on the typed host in `runtime/host.ts`. Runtime
  APIs are confined to `host_node.ts` and `host_deno.ts`; the boundary check blocks regressions.

Neither distribution discovers, invokes, overwrites, or updates the other. Use
`buckyos --version --verbose` or `buckyos pikg doctor` to see the selected executable, host,
distribution, policy, artifact versions, target and identity candidate order.

## Local development

Build the Node CLI before using its launcher:

```bash
pnpm run build
node cli/launcher.mjs --version
node cli/launcher.mjs command describe pikg build
```

The PIKG-first App workflow is:

```bash
node cli/launcher.mjs --non-interactive pikg init . \
  --owner did:bns:root --kind static-web --source ./web/dist
node cli/launcher.mjs pikg build ./dapp_meta
node cli/launcher.mjs pikg pack ./dapp_dist
node cli/launcher.mjs pikg info ./dapp_dist/example-0.1.0.pikg
node cli/launcher.mjs --non-interactive --yes pikg clean ./dapp_meta
```

`pikg` consumes existing build output; it does not replace an App's Vite, Webpack, Cargo, or Docker
build scripts. Set `SOURCE_DATE_EPOCH` for byte-reproducible Node/Deno PIKG builds.

## Provision (first activation of an installed root)

`provision status|check|activate` initialise an installed, not yet activated BuckyOS root on this
machine (single OOD, `did:web`, no SN/BNS). They are local commands: no Zone session, no network, no
TaskManager. The activation itself is the SDK API exported from `buckyos/provision`
(`inspectActivationRoot`, `checkOfflineActivation`, `activateOfflineZone`); the module only adds
argv, host-policy checks, the hidden password prompt / secret `--input` field, confirmation and
output. See `doc/modules/provision.md` for the commit protocol and error codes.

```bash
buckyos provision status --root /opt/buckyos
buckyos provision check --root /opt/buckyos --domain corp.example.com --owner-name admin \
  --owner-key-backup /secure-backup/corp-owner.pem
buckyos --non-interactive --yes --input activation.json provision activate \
  --root /opt/buckyos --owner-key-backup /secure-backup/corp-owner.pem
```

The launcher grants filesystem permissions only for the `--root` and `--owner-key-backup` paths
given on the command line; `admin_password` is accepted only as the secret field of `--input` JSON
or from a terminal prompt.

## Policy and identity

The developer policy grants the package root, cwd, Tool config, the read-only `~/.buckyos` and
`~/.buckycli` roots, and explicit non-identity input/output paths. It does not include
`$BUCKYOS_ROOT` or scan system credentials. The system policy additionally grants its paired BuckyOS
root. Both policies constrain environment names and subprocesses; only PIKG Docker inputs may invoke
`docker`.

`~/.buckyos` is the regular operations identity root and is always eligible. Before touching the
developer-only `~/.buckycli` root, the Tool reads `system.dev_mode.get` from the target Zone and
requires a valid `BuckyOSDevConfig` with `enabled: true`. Automatic discovery tries `~/.buckyos`
first and consults developer mode only if no operations identity succeeds; the combined search is
limited to eight usable candidates. An explicitly selected identity is tried once. Rotation occurs
only during session creation and only for `IDENTITY_KIND_NOT_ACCEPTED` or `AUTHENTICATION_REJECTED`;
timeouts, network errors, capability mismatches and RBAC denial never rotate. Private keys and
tokens are never shown.

## Verification

```bash
pnpm run check:cli
pnpm run test:cli
pnpm run test:cli-conformance
pnpm run test:tarball
pnpm run test:release-manifest
```

The conformance test executes registry/error cases and a complete PIKG lifecycle under both hosts,
then compares normalized stdout/stderr, exit codes and every generated file digest. The tarball test
installs the real package with npm and pnpm in paths containing spaces and non-ASCII characters and
runs the developer workflow with Node only. The release-manifest smoke also creates a deterministic
CycloneDX SBOM containing the production dependency graph, npm tarball hashes, lockfile hash, and
the pinned system Deno version and digest.
