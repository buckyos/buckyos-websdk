# beta2.2 相对 main 的大块改动对比

本文基于当前仓库中 `main...beta2.2` 的差异整理。

- `main` 提交：`99e0504f4d31a8582bd703628beca11270af3749`
- `beta2.2` 提交：`e1b9d9bf318a852871572cb99a968b50fb1cfabd`
- 分支关系：`main` 是 `beta2.2` 的 merge-base，`beta2.2` 相对 `main` 线性新增 38 个提交
- 总体规模：159 个文件变化，约 34,607 行新增、5,978 行删除
- 排除 `dist/` 等构建产物后，源码、测试、文档、示例和配置层面约 83 个文件变化，约 20,513 行新增、2,416 行删除

## 总览

`beta2.2` 不是小修小补分支，而是一次 SDK 能力扩展和测试体系重组。核心变化可以概括为：

1. SDK 版本从 `1.4.2` 提升到 `1.5.17`。
2. 删除旧的 `OpenDanClient` 入口，新增 AICC、KEvent、消息队列、消息中心、Repo、NDN/NDM 相关能力。
3. Runtime 从原来的条件分支式实现，重构为按运行环境 profile 分发的结构，强化 Browser、AppRuntime、AppClient、AppService 的差异处理。
4. 浏览器登录从弹窗/postMessage 模式改为当前窗口 SSO 跳转，并拆分登录 API。
5. kRPC 和 SystemConfigClient 增强 token 刷新/同步能力，减少不同登录态之间的缓存污染。
6. 测试体系从 jsdom 为主改为 node Jest、真实浏览器 Playwright、AppClient/AppService 集成测试分层。
7. 新增 SDK 设计说明、NDM 文档、权限系统说明和本地调试示例。

## Public API 变化

### 新增导出

入口文件 `src/index.ts`、`src/browser.ts`、`src/node.ts` 增加了多组公开 API：

- KEvent：
  - `getKEventClient`
  - `createEventReader`
  - `create_event_reader`
  - `subscribeKEvent`
- 登录：
  - `loginByPassword`
  - `loginByBrowserSSO`
  - `loginByRuntimeSession`
- 服务 client：
  - `getAiccClient`
  - `getMsgQueueClient`
  - `getMsgCenterClient`
  - `getRepoClient`
- 命名空间导出：
  - `types`
  - `ndn`，来自 `src/ndn_types.ts`
  - `ndm`，来自 `src/ndm_client.ts`
  - `ndm_proxy`，来自 `src/ndm_proxy.ts`

### 删除或替换

- `getOpenDanClient` 从入口导出中移除。
- `src/opendan_client.ts` 和对应测试、类型产物被删除。
- 原 `doLogin(username, password)` 不再作为入口导出，改为语义更明确的 `loginByPassword(username, password)`。

这意味着依赖 `getOpenDanClient` 或 `doLogin` 的调用方需要迁移。

## Runtime 和登录链路重构

`src/runtime.ts` 和 `src/sdk_core.ts` 是本分支最关键的改动区。

### Runtime profile 化

`BuckyOSRuntime` 新增 `RuntimeProfile` 抽象，并按运行环境拆分行为：

- `BrowserRuntimeProfile`
- `AppRuntimeProfile`
- `AppClientRuntimeProfile`
- `AppServiceRuntimeProfile`

主要影响：

- 服务 URL、SystemConfig URL、settings 路径、session 初始化、token 续期不再散落在大量 `if runtimeType` 分支里。
- `AppClient` 通过 zone gateway 访问服务，缺少 `zoneHost` 时会更早暴露错误。
- `AppService` 通过 `BUCKYOS_HOST_GATEWAY` 或默认 `host.docker.internal` 访问 node gateway。
- `BuckyOSConfig` 增加 `userid`，并与 `ownerUserId` 做归一化。

### Token 生命周期增强

- `kRPCClient` 新增 `sessionTokenProvider` 和 `onSessionTokenChanged` 选项。
- Runtime 创建 RPC client 时会传入 token provider，使 RPC 调用前可以确保 session token 可用或完成续期。
- RPC response 的 `sys` 中如果带回新 token，会同步更新 runtime。
- `SystemConfigClient` 从静态缓存改为实例缓存，避免不同登录态、不同 RBAC 上下文共享同一份配置缓存。

### 浏览器登录变化

浏览器登录逻辑变化较大：

- `AuthClient` 从弹窗 + `postMessage` 获取 token 改为当前窗口跳转。
- SSO URL 从旧的 `/sso/login` 语义调整为 `sys.$zone/login`，并由 `redirect_url` 的 Gateway 路由确定登录目标。
- `loginByBrowserSSO()` 触发跳转，本身不再返回 account/token。
- SSO 回跳后，调用方通过 `getAccountInfo()` 读取当前登录态。
- 浏览器侧新增 `user_info` localStorage 解析/缓存，`AccountInfo.user_type` 变为可选。

同时，`login()` 变成按 runtime 自动选择默认登录方式：

- `AppClient` / `AppService`：走 `loginByRuntimeSession()`
- Browser / AppRuntime：走 `loginByBrowserSSO()`

## 新增服务 Client

### AICC

新增 `src/aicc_client.ts`，面向 `aicc` 服务，覆盖多类 AI 能力：

- LLM chat/completion
- embedding
- rerank
- image
- vision
- audio
- video
- agent/computer-use
- quota、provider、method status、cancel 等控制面接口

Runtime 中新增 `getAiccClient()`，入口文件同步导出。

### KEvent

新增 `src/kevent_client.ts`，提供事件读取和订阅能力：

- 浏览器模式通过 HTTP stream 访问 `/kapi/kevent`
- native 模式通过本地 daemon 协议访问 `127.0.0.1:3183`
- 支持 `createEventReader()`、`subscribe()`、自动重连、AbortSignal、keepalive 等机制

SDK 层增加 `getKEventClient()`、`createEventReader()`、`subscribeKEvent()` 等便捷入口。

### 消息队列和消息中心

新增：

- `src/msg_queue_client.ts`：面向 `kmsg` 服务，提供 queue create/open/push/subscribe/ack/stats 等能力。
- `src/msg_center_client.ts`：面向 `msg-center` 服务，覆盖 inbox/outbox、read receipt、contact/access/group subscriber 等消息中心能力。

Runtime 中新增 `getMsgQueueClient()` 和 `getMsgCenterClient()`。

### Repo

新增 `src/repo_client.ts`，面向 `repo-service`：

- repo record 列表和状态
- proof 查询
- stat 查询
- serve 请求处理
- collection/download/install 等 proof 类型常量

Runtime 中新增 `getRepoClient()`。

## NDN / NDM 能力

这是 `beta2.2` 中最大的一块新增能力。

### NDN 类型系统

新增 `src/ndn_types.ts`，实现 Named Data Network 相关基础类型和对象：

- `ObjId`、`ChunkId`
- hash method、chunk type、base32/hex/varint 工具
- canonical JSON/JCS 处理
- `FileObject`、`DirObject`、`PathObject`、`InclusionProof`、`RelationObject`
- `SimpleObjectMap`、`SimpleChunkList`
- named object build/verify/load 相关工具

新增依赖 `canonicalize` 用于规范化 JSON。

### NDM client

新增 `src/ndm_client.ts`，提供浏览器侧文件/目录导入、对象生成、快速查询、上传和缩略图能力：

- 文件、目录、多文件、混合导入
- 基于 QCID 的 lookup 支持
- chunk/object 状态查询
- TUS 上传流程
- per-object 和 session 级进度
- thumbnail 生成
- 可替换的 `ImportProvider`，便于测试和适配不同运行时

新增依赖 `tus-js-client`，并新增 `src/internal/tus_client.ts` 作为内部封装入口。

### NDM proxy

新增 `src/ndm_proxy.ts`，提供 `/ndm/proxy/v1` 的 proxy API 封装：

- object/chunk 查询
- reader/writer client
- pin/unpin
- anchor/materialization 状态
- forced GC
- 代理错误类型封装

入口文件同时以 `ndm` 和 `ndm_proxy` 命名空间导出这些能力。

## BuckyOS DID / 配置类型

新增 `src/types.ts`，补充 BuckyOS DID document 和配置文档类型：

- W3C DID document 基础类型
- owner/user config document
- device mini/device document
- agent document
- zone document
- 解析和 type guard 工具
- DID method 和 identifier 解析工具

Runtime 会使用这些解析函数从本地配置中解析 zone host、zone DID、device metadata 等信息。

## 测试体系重组

### Jest 从 jsdom 切换到 node

`jest.config.ts` 的 `testEnvironment` 从 `jsdom` 改为 `node`，并移除了 `jest.setup.ts`。

原因在配置注释里写得很明确：浏览器 runtime 的真实行为，尤其 session token 和 SSO，不能靠 jsdom 可靠模拟。

### 测试目录重新分层

新增或重组为：

- `tests/app-client/**`
- `tests/app-service/**`
- `tests/browser/real-browser/**`
- `tests/helpers/**`
- 根目录下各 service client 单元测试

删除或迁移了旧的：

- `tests/integration/**`
- `tests/runtime.browser.test.ts`
- `tests/runtime.unit.test.ts`
- `tests/account.test.ts`
- `tests/opendan_client.test.ts`
- `tests/sdk_settings.test.ts`

### 新增真实浏览器测试

新增 Playwright 驱动的真实浏览器测试：

- 基础 browser SDK 页面
- `ndn_types` 浏览器测试
- `ndm_client` 浏览器测试
- `ndm_client` 上传集成测试

新增 `vite.test-browser.config.ts` 和 `tests/scripts/prepare_real_browser_test.mjs`，用于把浏览器测试 runner 打包到 `dist-tests/` 并复制到 systest 的 dist 目录。

### 新增 AppService 本地调试/集成测试脚本

新增：

- `tests/scripts/debug_systest.sh`
- `tests/scripts/service_debug.tsx`
- `tests/scripts/test_app_service_debug.sh`
- `tests/app-service/systest/main.ts`
- `run_all_test.sh`

`run_all_test.sh` 将测试拆成四个阶段：

1. 普通 Jest 单元测试
2. AppClient 集成测试
3. AppService 本地 systest 集成测试
4. 真实浏览器 Playwright 测试

脚本会从 `${BUCKYOS_ROOT:-/opt/buckyos}/etc/node_gateway_info.json` 解析 `buckyos-systest.buckyos.bns.did` 实际端口，不再依赖硬编码默认端口。

## 示例、文档和配置

新增文档：

- `SDK.md`：描述 SDK 通用流程、runtime 差异、登录方式、AuthClient 边界和 NDN/kevent/kmsgqueue 方向。
- `doc/ndm_client.md`：NDM client 使用文档。
- `doc/从开发者视角理解BuckyOS的分布式权限系统.md`：权限系统说明。
- `tests/测试环境构造.md`
- `tests/测试用例组织.md`

新增示例：

- `examples/app_service_local_debug.ts`
- `examples/docker_http_py/main.py`
- `examples/docker_http_ts/service.ts`

配置变化：

- `.gitignore` 新增 `test-results/` 和 `dist-tests/`。
- `tsconfig.json` 开启 `resolveJsonModule`。
- `package.json` 新增测试、调试脚本，并新增 `canonicalize`、`tus-js-client` 依赖。

## 构建产物变化

`dist/` 下有大量 `.d.ts`、`.mjs`、`.cjs` 和 sourcemap 变化。这些主要是新增源码能力的构建产物同步：

- 新增 AICC、KEvent、MsgQueue、MsgCenter、Repo、NDN、NDM、NDM proxy 类型产物。
- 删除 OpenDan 类型产物。
- 删除旧的 `sdk_core-*` chunk。
- 新增 `tus_client-*` 和 `ndm_proxy-*` chunk。

文档阅读时建议把 `dist/` 视为源码变化的派生结果，真正需要 review 的主要是 `src/`、`tests/`、`package.json` 和新增文档/脚本。

## 兼容性和迁移关注点

1. `doLogin` 调用方需要迁移到 `loginByPassword`，或按 runtime 使用 `login()` / `loginByBrowserSSO()`。
2. `getOpenDanClient` 调用方需要迁移到新的服务 client，具体取决于原来使用 OpenDan 的业务语义。
3. 浏览器 SSO 不再返回 token，调用方要适配“跳转登录，回跳后 `getAccountInfo()`”的流程。
4. `getAccountInfo()` 现在是异步接口，依赖同步返回的旧代码需要调整。
5. `AccountInfo.user_type` 变为可选，使用方不应再假设一定存在。
6. Jest 默认运行环境变为 node，浏览器相关测试要放到真实浏览器 harness 中。
7. `SystemConfigClient` 缓存变为实例级，依赖跨实例共享缓存的代码行为会变化。
8. 当前 diff 中包含 `__pycache__/run_script_in_docker.cpython-314.pyc`，这是 Python 字节码产物，通常不应进入源码分支；建议在合并前确认是否需要删除并加入忽略规则。
9. AppService 不再从 `app_instance_config.app_spec.app_doc.name` 推导 AppId，也不再读取动态 `<OWNER>_<APP>_TOKEN`；调用方应使用固定 `BUCKYOS_APP_*` / `BUCKYOS_OWNER_USER_ID` 环境契约。
10. `loginByPassword` 现在必须在 SDK 初始化配置中提供 `appInstanceId`，并会把它作为 `app_instance_id` 发送给 verify-hub。

## 建议 review 顺序

1. 先 review `src/runtime.ts`、`src/sdk_core.ts`、`src/auth_client.ts`、`src/account.ts`，确认登录和 token 生命周期符合预期。
2. 再 review 公开 API 入口 `src/index.ts`、`src/browser.ts`、`src/node.ts`，确认兼容性和命名。
3. 然后按新增能力分别 review `aicc_client`、`kevent_client`、`msg_*_client`、`repo_client`、`ndn_types`、`ndm_client`、`ndm_proxy`。
4. 最后 review 测试脚本和真实浏览器测试链路，确认本地/CI 环境具备 Deno、BuckyOS systest、Playwright 等前置条件。
