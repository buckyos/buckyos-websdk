# 在单点环境 `test.buckyos.io` 中实现真实登录

本文档记录 2026-03-20 在当前单点测试环境中的实际登录细节，目标是让 `Web`、`AppClient`、`AppService` 三种 runtime type 的测试都能按真实环境跑通。

## 0. 已核验的共享环境信息

- Zone host: `test.buckyos.io`
- 默认测试 appid: `buckycli`
- 共享测试账号:
  - username: `devtest`
  - password: `bucky2025`
- 实测结果:
  - 2026-03-20 22:24 UTC 通过 `login_by_password` 登录成功
  - 返回 `user_id=devtest`
  - 返回 `user_name=Liu Zhicong`
  - 返回 `user_type=user`
  - 返回了 `session_token` 和 `refresh_token`

## 1. 实际可用的服务 URL

在当前单点环境里，`kapi` 实际要走 app host prefix，而不是直接打 `https://test.buckyos.io/kapi/...`。

- `verify-hub`: `https://buckycli.test.buckyos.io/kapi/verify-hub/`
- `system_config`: `https://buckycli.test.buckyos.io/kapi/system_config/`
- `task-manager`: `https://buckycli.test.buckyos.io/kapi/task-manager/`

注意:

- `https://test.buckyos.io/kapi/verify-hub` 当前返回的是静态页面，不是 RPC 入口
- `https://test.buckyos.io/kapi/system_config` 当前返回 `405`
- Node 环境直连 HTTPS 时会遇到测试证书链校验问题
  - 最简单的处理方式是设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`
  - 测试里现在也提供了自定义 insecure fetch helper

证书信息:

- subject: `CN=test.buckyos.io`
- issuer: `CN=buckyos_test_ca`

## 2. Web runtime

### 正确的登录方式

对于 Web runtime 的真实密码登录测试，应使用:

- `buckyos.initBuckyOS(... RuntimeType.Browser ...)`
- 然后调用 `buckyos.doLogin(username, password)`

不要把 Browser 下的 `buckyos.login()` 当成密码登录:

- `doLogin()` 走的是 `verify-hub.login_by_password`
- `login()` 在 Browser runtime 下走的是 `AuthClient` 的 SSO / popup 路径

### 建议的测试配置

- `runtimeType=RuntimeType.Browser`
- `zoneHost=test.buckyos.io`
- `defaultProtocol=https://`
- `verifyHubServiceUrl=https://buckycli.test.buckyos.io/kapi/verify-hub/`

### 对应测试

- `tests/integration/web_runtime_test.ts`

## 3. AppClient runtime

### 正确的登录方式

对于 AppClient，应使用:

- `buckyos.initBuckyOS(... RuntimeType.AppClient ...)`
- 然后调用 `buckyos.login()`

这条路径不是用户名密码登录，而是:

1. 本地查找私钥
2. 本地生成 JWT
3. 用 `verify-hub.login_by_jwt` 交换正式 session token

### 当前 WebSDK 中实际的私钥查找顺序

以当前 `src/runtime.ts` 为准，搜索根目录顺序是:

1. `config.privateKeySearchPaths`
2. `BUCKYOS_APP_CLIENT_DIR`
3. `$HOME/.buckyos`
4. `$HOME/.buckycli`
5. `BUCKYOS_ROOT` 或 `/opt/buckyos`
6. `$BUCKYOS_ROOT/etc` 或 `/opt/buckyos/etc`

在每个根目录内:

1. 先找 `user_private_key.pem`
2. 找不到再尝试 `node_private_key.pem`

### 当前单点环境中的公开测试密钥信息

#### 用户私钥路径

- `/opt/buckyos/etc/.buckycli/user_private_key.pem`
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJBRONAzbwpIOwm0ugIQNyZJrDXxZF7HoPWAZesMedOr
-----END PRIVATE KEY-----

对应公开密钥:

```json
{
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "T4Quc1L6Ogu4N2tTKOvneV1yYnBcmhP89B_RsuFsJZ8"
}
```

对应用户配置:

- DID: `did:bns:devtest`
- name: `devtest`
- full_name: `devtest`

#### 设备私钥路径

- `/opt/buckyos/etc/node_private_key.pem`

-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMDp9endjUnT2o4ImedpgvhVFyZEunZqG+ca0mka8oRp
-----END PRIVATE KEY-----

对应公开密钥:

```json
{
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "gubVIszw-u_d5PVTh-oc8CKAhM9C-ne5G_yUK5BDaXc"
}
```

对应设备信息:

- device DID: `did:dev:gubVIszw-u_d5PVTh-oc8CKAhM9C-ne5G_yUK5BDaXc`
- device name: `ood1`
- owner: `did:bns:devtest`

### 一个容易忽略的当前实现细节

当前 WebSDK 在读到 `user_private_key.pem` 时，本地 JWT 的 `iss/sub` 仍然写成 `root`，不是 `devtest`。

这意味着:

- 用 AppClient 路径登录时，最后拿到的会是 app 级 token
- 当前测试里观察到的 `accountInfo.user_id` 是 `root`
- 如果你要验证“用户名密码是否正确”和“用户身份是否是 devtest”，应该用 Web runtime 的 `doLogin()` 路径

### 对应测试

- `tests/integration/app_client_test.ts`

## 4. AppService runtime

### 正确的测试思路

`AppService` 在容器里运行，不能直接读取宿主机上的私钥文件，所以不能直接复用 AppClient 的登录路径。

测试时应该模拟 Rust `node_daemon::app_loader` 的行为:

1. 准备 `app_instance_config`
2. 用宿主机上的 `node_private_key.pem` 生成 app 专用 session token
3. 按 Rust 的 env 规则注入环境变量
4. 用 `RuntimeType.AppService` 初始化并调用 `buckyos.login()`

### 必要环境变量

Rust `app_loader.rs` 当前会注入:

- `app_instance_config`
- `BUCKYOS_HOST_GATEWAY=host.docker.internal`
- `OWNER_APP_TOKEN`

其中 token env key 的规则与 Rust `get_session_token_env_key(get_full_appid(...), true)` 一致:

- full appid = `{owner_user_id}-{app_id}`
- 全部转成大写
- `-` 替换为 `_`
- 最后追加 `_TOKEN`

例如:

- `owner_user_id=owner-user`
- `app_id=notes-app`
- env key = `OWNER_USER_NOTES_APP_TOKEN`

注意:

- Rust `app_loader` 当前只注入 owner+app 这一种 key
- WebSDK 运行时仍然保留了 `APP_TOKEN` fallback，但这只是兼容逻辑，不是 Rust 的标准下发方式

### Rust 当前构造的 token 语义

Rust `app_loader` 生成 AppService session token 时，claim 大意如下:

- `appid = app_id`
- `sub = config.app_spec.user_id`
- `iss = device_doc.name`
- `session = 当前时间戳`
- `jti = 当前时间戳字符串`
- `exp = now + VERIFY_HUB_TOKEN_EXPIRE_TIME * 2`

所以 AppService 的测试如果要和 Rust 严格一致，不能只随便塞一个任意 JWT 字符串，而应该尽量保持这些字段结构一致。

### 对应测试

- `tests/runtime.appservice.test.ts`
- `tests/integration/app_service_test.ts`

## 5. 当前测试文件和 runtime type 的对应关系

- Web runtime:
  - `tests/runtime.browser.test.ts`
  - `tests/integration/web_runtime_test.ts`
- AppClient runtime:
  - `tests/runtime.unit.test.ts`
  - `tests/integration/app_client_test.ts`
- AppService runtime:
  - `tests/runtime.appservice.test.ts`
  - `tests/integration/app_service_test.ts`
- VerifyHub client 合约:
  - `tests/verify_hub_client.test.ts`
  - `tests/integration/verify_hub_test.ts`

## 6. 推荐的最小执行方式

只跑默认单元和 mock 测试:

```bash
pnpm exec jest --runInBand
```

启用真实环境测试:

```bash
BUCKYOS_RUN_INTEGRATION_TESTS=1 pnpm exec jest --runInBand
```

只验证 Web runtime 真实密码登录:

```bash
BUCKYOS_RUN_INTEGRATION_TESTS=1 pnpm exec jest --runInBand tests/integration/web_runtime_test.ts
```

只验证 AppClient:

```bash
BUCKYOS_RUN_INTEGRATION_TESTS=1 pnpm exec jest --runInBand tests/integration/app_client_test.ts
```
