# buckyos-tool 的身份确定

本文回答一个问题：`buckyos` 这条命令在运行时，到底是"谁"在说话。

阅读前置：[`从开发者视角理解BuckyOS的分布式权限系统.md`](./从开发者视角理解BuckyOS的分布式权限系统.md)，
特别是 §6（调用语义和目标语义必须分开）、§9（owner / root / sudo）、§10.2（CLI / Agent 工具）、§11.3（Gateway 只看得到 appID）。

文中的行号对应 `buckyos-websdk` 当前实现，路径相对于 `buckyos-websdk/`。

---

## 0. 一句话结论

每次执行 buckyos-tool 都要同时确定三件事，它们互相正交、不能互相推导：

| 维度 | 含义 | 取值规则 | 现有实现 |
|---|---|---|---|
| **appid** | 以什么应用身份说话，Gateway 与 RBAC 真正看得到的主体 | 恒为 `buckycli`；外部注入 token 时由 token 自带 | `cli/core/auth.ts:80` |
| **认证主体（actor）** | 谁签的名、谁的私钥/密码被验证 | 按 P0 → P3 四级优先级解析 | `cli/core/auth.ts:165` |
| **业务主体（subject / target）** | 这次操作落在谁名下 | 由命令语义决定，**不等于**认证主体 | 见 §6 |

一句话：**appid 固定，actor 按优先级找，subject 按命令语义定。**
把三者混成一个"当前用户"，是这套系统里最常见的错误来源。

---

## 1. 身份解析的四级优先级

```
P0  命令行 / 环境显式指定        --session-token | --session-token-file | --identity | env
P1  本地身份                   先扫描常规运维目录 ~/.buckyos；开发模式开启后才扫描 ~/.buckycli
P2  本机设备密钥                 $BUCKYOS_ROOT 下按身份管理协议保存的 device key
P3  verify-hub LoginByPassword   默认用户 = zone-owner
```

命中即停，不向下回退（唯一例外见 §8 的候选轮换）。总览：

| 级别 | 来源 | `authentication` | 产物 | 可自动续期 | 交互 | 现状 |
|---|---|---|---|---|---|---|
| P0.1 | `--session-token` / `BUCKYOS_APPCLIENT_SESSION_TOKEN` | `session-token` / `environment` | 现成 token | 否 | 无 | ✅ 已实现 |
| P0.2 | `--session-token-file` | `session-token-file` | 现成 token | 否（`reconnect` 时重读文件） | 无 | ✅ 已实现 |
| P0.3 | `--identity <用户名或 DID>` | `identity` | 本地签 JWT → `login_by_jwt` | 是 | 无 | ✅ 先查 `~/.buckyos`；仅查 `~/.buckycli` 时受开发模式门控（§3） |
| P1.1 | `~/.buckyos` 中的常规运维身份 | `identity` | 同上 | 是 | 无 | ✅ 始终可扫描，不依赖开发模式 |
| P1.2 | `~/.buckycli` 中的开发者身份 | `identity` | 同上 | 是 | 无 | ✅ 已实现目标系统开发模式门控（§3） |
| P2 | 本机 device key | `identity` | 同上，target 为 system | 是 | 需 `--yes` 或交互确认 | ⚠️ 仅 system 发行版（§4） |
| P3 | `login_by_password` | `password` | verify-hub 签发 | 是，但需重新输密码 | 必须交互 | ⚠️ 无 zone-owner 默认值（§5） |

---

## 2. P0：命令行与环境显式指定

### 2.1 直接给 session-token

`--session-token` 与 `BUCKYOS_APPCLIENT_SESSION_TOKEN` 在配置层就合并（`cli/core/config.ts:248`），
在认证层是第一个被检查的分支（`cli/core/auth.ts:166`）。`--session-token-file` 次之（`cli/core/auth.ts:173`）。

三条重要性质：

1. **Tool 不解释、不改写 token，只解析 claims。**`sub`/`userid` 决定 principal，`appid`/`aud` 决定 appId
   （`cli/core/auth.ts:423-424`）。所以外部注入的 token 其 appid 可能**不是** `buckycli`，
   此时 `auth whoami` 必须如实显示，不得伪装成 `buckycli`。
2. **不可续期**（`renewable = false`）。过期后 `ensureValid()` 直接抛 `SESSION_EXPIRED`
   （`cli/core/auth.ts:119-125`），不会退回 P1/P2 悄悄换一个身份继续跑。这是刻意的：
   调用方给了 token 就是明确表达了"用这个身份"，静默降级会让审计链断掉。
3. **文件形式在显式 `reconnect()` 时重读**，因此 REPL 里外部续签的 token 能被接住，
   而单条命令不会中途换 token。

### 2.2 指定用户名或 DID

`--identity` 接受两种写法：DID（`did:` 前缀）或用户名。DID 会经 `DID.toFilename()` 直接定位目录，
用户名则遍历候选根目录、按 `did.json` 的 `id` 或 `name` 匹配（`cli/core/identity.ts:368`、`cli/core/identity.ts:400`）。

**显式指定只试一次，失败就报错，绝不回退到其它候选**（`cli/core/auth.ts:202-207`、`cli/core/auth.ts:265-280`）。
这条由 `cli/tests/auth_test.ts:274` 固化。原因同上：显式即意图。

`--identity` 只是选择身份，不是自定义身份根。Tool 先在常规运维目录 `~/.buckyos`
中定位；如果未找到，才读取目标系统的开发模式配置。只有严格验证为开启时，才会访问
`~/.buckycli` 定位开发者私钥。因此显式给出 DID 或用户名也不能绕过 `~/.buckycli`
的门控；但 `~/.buckyos` 身份不依赖该配置。

### 2.3 sudo：两个必须分开处理的含义

"注意处理 sudo"在这里有两层意思，二者都要处理，且**互不等价**。

#### (a) BuckyOS 内的提权 sudo

现状：**未实现**。登录 JWT 的 `sudo` 字段硬编码为 `false`（`cli/core/auth.ts:484`）；
SDK 侧 `VerifyHubClient.sudoByPassword` 已经就位（`src/verify-hub-client.ts:144`）但 CLI 从未调用。

按权限文档 §9.3 / §9.4，建议的目标形态：

- 新增全局开关 `--sudo`，只影响本次调用，不改变身份解析结果（actor 不变，只是要一张提权 token）。
- **手上有私钥时**（P0.3 / P1 / P2）：用同一把私钥本地签 `sudo: true` 的 JWT 走 `login_by_jwt`。
  TTL 应显著短于普通登录 JWT 的 600 秒（`cli/core/auth.ts:81`），建议 ≤120 秒。
- **手上没有私钥时**（P3，或普通管理员用户）：走 `sudo_by_password`，必须交互输密码。
- **sudo token 不进 `#session` 缓存，不参与 `ensureValid()` 自动续期。** 过期即失效，需重新提权。
  把提权态挂进长生命周期会话，等于把 sudo 变成常驻权限，与"高风险操作单次授权"的语义冲突。
- `--non-interactive --sudo` 且无本地私钥时，直接以 `SUDO_REQUIRED` 失败，不静默降级为普通 token
  ——否则用户会以为高危操作被拒是 RBAC 问题，实际是没提权。
- `auth whoami` / `auth session-status` 需增加 `sudo: true|false` 字段（当前 `ResolvedPrincipal`
  没有这个概念，`cli/core/auth.ts:35-41`）。

#### (b) 操作系统的 sudo

`sudo buckyos ...` 通常会把 `HOME` 改成 `/root`，于是：

- P1 的常规运维身份根和开发者身份根会分别漂移到 `/root/.buckyos` 和 `/root/.buckycli`；
- 结果是**同一条命令在 sudo 前后用的是完全不同的身份**，而输出里看不出差别。

反过来，`sudo -E` 可能把调用者的 `HOME` 或 `BUCKYOS_APPCLIENT_SESSION_TOKEN` 带进 root 环境，
使 root 进程读到普通用户的身份或 token。

规则：

1. `SUDO_USER` / `SUDO_UID` 目前**不在环境白名单里**（`cli/core/config.ts:62-74`），需要加入，
   否则 Tool 根本无法察觉自己跑在 sudo 下。
2. 检测到 `SUDO_USER` 且用户没有显式给 `--identity` / `--session-token` 时：
   **不要**静默改用 `SUDO_USER` 的 home 去扫描身份。悄悄读另一个用户的私钥是危险行为。
   正确做法是照常在当前 `HOME` 下解析；若候选为 0，则在错误信息里点明
   "当前运行在 sudo 下，身份候选来自 `/root/.buckyos` 和 `/root/.buckycli`；
   如需使用 `<SUDO_USER>` 的开发者身份，请退出 sudo 后以该用户运行"。
3. 文档中必须写明：**OS root ≠ zone sudo**。`sudo buckyos` 不会让你在 BuckyOS 里获得任何额外权限，
   它只会换掉你的本地身份来源。

---

## 3. P1：本地常规运维身份与开发者身份

`~/.buckyos` 和 `~/.buckycli` 有不同语义：前者是常规运维身份目录，后者是开发者身份目录。
开发模式只决定是否能扫描后者，不能禁用常规运维身份。

### 3.1 目标系统的开发模式是硬门控

BuckyOS 已将 Zone 级开发模式保存在 System Config 的
`system/buckyos_dev_config` 中，并由 Control Panel 的公开读接口
`system.dev_mode.get` 返回。Tool 在解析 Zone / endpoint 后、访问 `~/.buckycli` 中任何开发者身份文件前，
会向 `<endpoint>/kapi/control-panel` 发起这个无 session-token 请求。这样不会形成“先用开发者
身份登录，才能判断是否允许开发者身份”的循环依赖。

返回值必须严格符合 `BuckyOSDevConfig` v1：

```json
{
  "schema_version": 1,
  "enabled": true,
  "enabled_at": 1800000000,
  "enabled_by": "alice"
}
```

Tool 不只检查 `enabled`：它还会验证 schema version、字段集以及
`enabled_at` / `enabled_by` 的成对约束。只有严格验证通过的 `enabled: true` 才算开启：

| 目标系统状态 | `~/.buckycli` 行为 |
|---|---|
| 开发模式明确为开 | 允许扫描开发者身份目录 |
| 开发模式为关 | 不列举、不读取、不尝试任何本地开发者身份 |
| 配置缺失、无法获取或无法验证 | **按关闭处理**（fail closed） |

无论上表是哪种状态，`~/.buckyos` 中的常规运维身份都可以扫描、登录和续期。
如果它已成功登录，Tool 不会为了身份确定而额外请求 dev config。

这个开关不得由 Tool 本地 profile、命令行参数或环境变量覆盖。切换 Zone / endpoint 后必须重新读取，
不得把一个开发系统的结果沿用到另一个目标。`--identity`、本地配置的默认身份以及自定义路径
都不能绕过该门控。

显式 `--identity` 未在 `~/.buckyos` 找到，且开发模式关闭时，返回 `DEVELOPER_IDENTITY_DISABLED`；
配置请求失败或返回值无法验证时返回 `DEVELOPER_MODE_UNAVAILABLE`。
自动候选扫描在这两种情况下都只跳过 `~/.buckycli`，不影响 `~/.buckyos`。

开发模式关闭时，Tool 在常规运维身份之后跳过开发者身份，再按语义进入 P2 或 P3；显式注入的 session-token（P0.1 / P0.2）
不属于“扫描开发者身份”，仍按显式意图处理。这条边界用于防止本机保存的高权限开发者身份
在连向生产或其他非开发系统时被自动选中，从而造成误操作。

### 3.2 两个固定目录，两种身份语义

本地身份只从下面两个固定根目录只读加载：

1. `~/.buckyos`：常规运维身份，始终可扫描；
2. `~/.buckycli`：开发者身份，仅目标系统开发模式明确开启时可扫描。

不允许从 Tool 自身的配置目录、任意环境变量路径或命令行指定的额外 root 中扫描本地身份。
`~/.buckycli` 在开关关闭时即使文件存在也不得列举或读取。

每个根目录内的材料布局遵循
[`buckyos-base/doc/did-identity-certificate-manager.md`](../../buckyos-base/doc/did-identity-certificate-manager.md) §6：

```text
<root>/local/identity/<DID.toFilename()>/did.json
<root>/security/<DID.toFilename()>/authentication.private.pem
```

- 私钥 usage 固定为 `authentication`，Ed25519 PKCS8 PEM。
- 只存在 `authentication.keyref.json` 而无私钥本体时，该候选被跳过并记为
  `key-reference-unsupported`（`cli/core/identity.ts:352-364`）——当前运行时不支持外部签名器。
- 私钥内容、token 内容在任何输出与错误信息里都不出现。

### 3.3 候选扫描顺序

没有显式身份时，按以下**冻结顺序**扫描；各根目录内按目录名排序，
最多取 8 个可用候选（当前上限定义于 `cli/core/identity.ts:34`）：

```text
~/.buckyos  →  [仅开发模式开启] ~/.buckycli
```

显式 `--identity` 也只能在这两个根目录中定位：查 `~/.buckyos` 时不受开发模式门控，
查 `~/.buckycli` 前必须通过门控。
`$BUCKYOS_ROOT` 下的设备密钥属于 P2，不是第三个开发者身份目录。

`principalKind` 的判据目前是“`did.json` 里有没有 `device_type` 字段”（`cli/core/identity.ts:340`）。
这个判据偏脆弱：它依赖文档里一个可选字段的存在性，而不是 DID 在 zone 内的实际角色。
建议后续改为由 `did.json` 显式声明主体类型，或由 DID 方法 + zone 拓扑判定。

---

## 4. P2：本机设备密钥

OOD 上没有开发者密钥时，用设备自己的密钥登录。

### 4.1 触发条件很窄，而且是刻意的

`applyImplicitDeviceIdentity` 只在 `sessionToken`、`sessionTokenFile`、`identity`、`zone`、`endpoint`
**全部为空**时才生效（`cli/core/identity.ts:58-68`）。只要用户表达了任何连接或身份意图，就不再隐式使用设备身份。

生效后它会一次性钉死四件事（`cli/core/identity.ts:70-86`）：

```
identity      = <device did>
zone          = <node_identity.json 的 zone_did>
endpoint      = http://127.0.0.1:3180     # 本机 node-gateway
protocol      = http://
identity/security root = $BUCKYOS_ROOT/local/identity | $BUCKYOS_ROOT/security
```

`endpoint` 钉到本机 gateway 是关键：设备密钥只用于**本机**，不应该拿着它去连别的 zone。

### 4.2 只在 system 发行版可用

developer 发行版的环境白名单把 `BUCKYOS_ROOT` 剔除了（`cli/runtime/host.ts:233-234`），
因此 `readCurrentDeviceIdentity` 的第一道守卫直接返回 `undefined`（`cli/core/identity.ts:90-96`），
本地身份根也永远不会包含 `$BUCKYOS_ROOT`（`cli/core/identity.ts:143-173`）。

即：**`npx buckyos` 永远不会去读 `/opt/buckyos` 下的设备密钥**。这条边界应当保持。

### 4.3 必须确认

使用设备身份需要交互确认或 `--yes`；`--non-interactive` 且无 `--yes` 时以
`CONFIRMATION_REQUIRED` 失败（`cli/core/app.ts:408-429`）。
设备密钥是本机权限最高的材料之一，默认不该被脚本无声使用。

### 4.4 target 是 system 而不是 app

设备身份登录时 target 为 `{ kind: 'system', service_id: 'buckycli' }`，
用户身份则是 `{ kind: 'app', app_instance_id: 'buckycli@<username>' }`（`cli/core/auth.ts:395-408`）。
这条差异直接引出 §6。

---

## 5. P3：LoginByPassword 兜底

本地什么密钥都没有时，向 verify-hub 用密码换一张 session-token。

### 5.1 现状

只在"候选扫描结果为 0 且允许交互"时触发（`cli/core/auth.ts:234-262`）。
用户名来自 `--identity`（非 `did:` 前缀时）或现场询问；密码经
`hashPassword(username, password, nonce)`（`src/account.ts:93`）处理后连同 `login_nonce` 发送。
target 恒为 `buckycli@<username>`。

### 5.2 缺口：没有 zone-owner 默认值

思路要求"默认用户为 zone-owner"，当前实现没有 zone-owner 的概念——只会空着提示符问用户名。

zone owner 的用户名可以推出来：`node_identity.json`（`buckyos.node_identity.v2`）里有 `owner_did`，
用户名即 `DID.fromStr(owner_did).id`。这个算法在 `src/provision.ts:720` 已经在用。
但 `readCurrentDeviceIdentity` 目前只读了 `device_did` / `device_name` / `zone_did`
（`cli/core/identity.ts:119-123`），没有取 `owner_did`。

建议的默认用户名解析顺序：

1. `--identity` 给出的用户名（显式优先）；
2. `node_identity.json` 的 `owner_did` → `DID.id`（需先在 `readCurrentDeviceIdentity` 中补读该字段）；
3. 已解析的 zone DID document 中的 owner；
4. 都拿不到时才空着问。

无论走到哪一步，**默认值只作为提示符的预填值，回车即接受**，不静默替用户决定身份。
另外注意：developer 发行版读不到 `node_identity.json`，第 2 步在那里必然落空，只能靠第 3、4 步。

### 5.3 P3 不适合非交互批处理

P3 产物 `renewable = true`，但它的"续期"方式是**再问一次密码**
（`cli/core/auth.ts:254` 的 `'Password (reconnect): '`）。
长任务跑到一半 token 过期会阻塞在密码提示上。所以：

- 批处理场景应当用 P0（外部注入 token）或 P1/P2（本地私钥，可无交互重签）；
- `--non-interactive` 下走到 P3 应直接以 `AUTH_REQUIRED` 失败，这一点现状已经正确
  （`cli/core/auth.ts:234-243`）。

---

## 6. 身份 ≠ 业务所需的 session-token

这是整篇文档最容易被跳过、也最容易出事的一节。

### 6.1 典型场景

在 OOD 上用设备密钥执行 `buckyos app install`：

- 认证主体是设备：`sub = ood1`，target = `system:buckycli`；
- 但**应用必须安装在某个用户名下**：`app fetch` / `app install` 的计划里 `owner_user_id` 是必填字段
  （`cli/modules/app.ts:1121`、`cli/modules/app.ts:1155`），而命令行上它是可选项
  （`cli/modules/app.ts:1587-1592`），不传时交由服务端按调用者推断。

调用者是设备，服务端推不出用户——要么失败，要么落到一个错误的 owner 上。

### 6.2 两条规则

**规则一：凡是"资源归属于某用户"的命令，业务主体必须显式，不依赖服务端从 `sub` 猜。**

这正是权限文档 §6.1 说的"什么时候必须把 userID / appID 明确写在参数里"。
Tool 侧的做法应当是：当认证主体是设备（`principalKind === 'device'`）而命令需要 owner 时，
若用户未给 `--owner`，直接以明确的错误要求补齐，而不是发一个语义残缺的请求出去。

**规则二：用设备密钥为用户业务构造 token，是一次显式的主体切换。**

设备密钥可以签发 `sub = <user>` 的 session-token：

```
appid  = buckycli
iss    = <device did>          # 谁签的
sub    = <user>                # 业务主体
userid = <user>
target = { kind: 'app', app_instance_id: 'buckycli@<user>' }
```

信任来源是设备文档里的 owner 关系（`node_identity.json` 的 `owner_did` / `owner_public_key`），
由 verify-hub 校验"该设备是否有权代表该用户"——不是设备自称就算数。

### 6.3 Tool 内部需要区分两个字段

当前 `ResolvedPrincipal` 只有一个 `id`（`cli/core/auth.ts:35-41`），把 actor 和 subject 压成了一个值。
建议拆成：

| 字段 | 含义 | 来源 |
|---|---|---|
| `actor` | 认证主体，谁签的名 | 身份解析结果（P0–P3） |
| `subject` | 业务主体，`sub` claim | 可能 = actor，也可能是被代表的用户 |
| `appId` | 恒 `buckycli`（外部 token 除外） | token claims |

`auth whoami` 应当同时输出三者。今天只输出一个 `principal`，
在"设备代表用户"的场景里会给出误导性的答案。

### 6.4 场景速查

| 场景 | actor | 需要的 subject | target | 现状 |
|---|---|---|---|---|
| 开发者查询自己的数据 | user | 同 actor | `app:buckycli@<user>` | ✅ |
| 开发者装应用到自己名下 | user | 同 actor | `app:buckycli@<user>` | ✅ |
| OOD 上做设备级运维（`system status` 等） | device | 设备自身 | `system:buckycli` | ✅ |
| OOD 上把应用装到用户名下 | device | `<user>`，与 actor 不同 | `app:buckycli@<user>` | ❌ 未实现（§6.2 规则二） |
| CI 用注入 token 操作 | token 签发方 | token 的 `sub` | token 自带 | ✅ |

---

## 7. appid 恒为 `buckycli`

`LOGIN_APP_ID = 'buckycli'`（`cli/core/auth.ts:80`），继承自 Rust 时代的 buckycli，是一个全权限工具 appid。

几点必须说清楚：

- **appid 是被鉴权的主体，不能由被鉴权方自选。** 所以**不提供** `--appid` 覆盖。
  要收窄某类工具的权限，正确做法是发一个新的 appid 并在 RBAC 里配置，而不是加一个 flag 让调用方自报家门。
- Gateway 侧通常只看得到 appid（权限文档 §11.3），因此 **`buckycli` 在 RBAC 里的条目就是 Tool 的能力上限**。
  排查"命令被拒"时，先确认是 Gateway 按 appid 拒的，还是服务内部按 `sub` + 资源路径拒的。
- 权限文档 §10.2 提出的"方向 A（共享 Agent appid）vs 方向 B（工具独立 appid）"在这里是悬而未决的：
  当前所有 Agent 工具共用 `buckycli`，权限边界偏宽。这是已知的设计债，不是本文能单方面收敛的。
- 唯一例外是外部注入的 token：它的 appid 由签发方决定，Tool 只读不改（`cli/core/auth.ts:424`）。

---

## 8. 会话生命周期与候选轮换

| 来源 | `renewable` | 续期方式 | 交互 |
|---|---|---|---|
| P0.1 / env | false | 无，过期即 `SESSION_EXPIRED` | — |
| P0.2 文件 | false | 仅显式 `reconnect()` 时重读文件 | — |
| P0.3 / P1 / P2 | true | 缓存 `#acceptedIdentity`，用同一把私钥重签 JWT 再登录 | 无 |
| P3 密码 | true | 重新提示输入密码 | 有 |

只有来自 `~/.buckycli` 的开发者身份在自动续期前会重新读取当前目标系统配置。
如果开关已关闭、无法获取或无法验证，Tool 会清除缓存的开发者身份并终止续期。
来自 `~/.buckyos` 的常规运维身份以及本机设备身份都不受该门控影响。

登录 JWT 的 TTL 是 600 秒（`cli/core/auth.ts:81`），它只是**登录凭据**，不是会话 token；
会话 token 的有效期由 verify-hub 决定，Tool 在 `exp - 15s` 时触发续期（`cli/core/auth.ts:114-127`）。

**候选轮换的边界**：只在会话建立阶段发生，且只对 `IDENTITY_KIND_NOT_ACCEPTED` 与
`AUTHENTICATION_REJECTED` 两种错误轮换（`cli/core/auth.ts:283-300`、`cli/core/identity.ts:35-38`）。
超时、网络错误、能力不匹配、RBAC 拒绝一律不轮换，直接抛出。

这条边界很重要：**对 RBAC 拒绝轮换身份重试，等价于拿着一串密钥挨个试权限。**
被拒的原因是权限不够，不是身份选错了。

---

## 9. 完整解析流程

```text
resolve(argv, env, host):
  cfg = resolveConfig(argv, env)                              # 先确定 Zone / endpoint

  # ---------- P0 ----------
  if cfg.sessionToken:      return external(cfg.sessionToken)        # auth.ts:166
  if cfg.sessionTokenFile:  return external(read(file))              # auth.ts:173
  if env.BUCKYOS_APPCLIENT_SESSION_TOKEN: return external(...)       # auth.ts:192

  if cfg.identity:                                                    # P0.3
      material = tryResolveIdentityMaterial(cfg.identity, roots = [~/.buckyos])
      if material is None:
          # 公开读取 system.dev_mode.get；只有严格验证通过的 enabled: true 才算开启
          devMode = readTargetDevelopmentMode(cfg.zone, cfg.endpoint)
          if devMode == disabled: raise DEVELOPER_IDENTITY_DISABLED
          if devMode == unavailable: raise DEVELOPER_MODE_UNAVAILABLE
          material = resolveIdentityMaterial(cfg.identity, roots = [~/.buckycli])
      return loginByJwt(sign(material), targetOf(material))

  # ---------- P1.1：常规运维身份 ----------
  for candidate in scanIdentityCandidates([~/.buckyos]):
      try:    return loginByJwt(sign(candidate), targetOf(candidate))
      except IDENTITY_KIND_NOT_ACCEPTED | AUTHENTICATION_REJECTED: continue
      except *: raise                                     # 其它错误不轮换

  # ---------- P1.2：开发者身份，严格门控 ----------
  if readTargetDevelopmentMode(cfg.zone, cfg.endpoint) == true:
      for candidate in scanIdentityCandidates([~/.buckycli], 总候选上限 = 8):
          try:    return loginByJwt(sign(candidate), targetOf(candidate))
          except IDENTITY_KIND_NOT_ACCEPTED | AUTHENTICATION_REJECTED: continue
          except *: raise
  if 有过尝试: raise IDENTITY_CANDIDATES_REJECTED

  # ---------- P2：本机设备身份，不属于开发者目录 ----------
  if 命令需要会话 and canApplyImplicitDeviceIdentity(cfg, env):
      device = readCurrentDeviceIdentity($BUCKYOS_ROOT)
      确认设备身份或 --yes
      return loginByJwt(sign(device), system:buckycli)

  # ---------- P3 ----------
  if cfg.nonInteractive: raise AUTH_REQUIRED                         # auth.ts:235
  username = cfg.identity | zoneOwner() | prompt()      # zoneOwner() 待实现，见 §5.2
  return loginByPassword(username, prompt_password(), app:buckycli@username)

# 与身份解析正交：
#   --sudo    → 见 §2.3(a)，单次提权，不进会话缓存
#   subject   → 见 §6，由命令语义决定，不由 actor 推导
```

---

## 10. 现状与本文设计的差距

| # | 差距 | 现状 | 位置 |
|---|---|---|---|
| 1 | 提权 sudo 完全未实现 | 登录 JWT 硬编码 `sudo: false`；SDK 的 `sudoByPassword` 未被调用 | `cli/core/auth.ts:484`、`src/verify-hub-client.ts:144` |
| 2 | 未处理操作系统 sudo | `SUDO_USER` / `SUDO_UID` 不在环境白名单，Tool 察觉不到身份来源漂移 | `cli/core/config.ts:62-74` |
| 5 | 无 zone-owner 默认用户名 | `readCurrentDeviceIdentity` 未读 `owner_did`；P3 空着问用户名 | `cli/core/identity.ts:119-123` |
| 6 | actor / subject 未分离 | `ResolvedPrincipal` 只有一个 `id`，`whoami` 只输出一个 principal | `cli/core/auth.ts:35-41`、`cli/modules/auth.ts:24` |
| 7 | 设备代表用户的 token 未实现 | 设备身份只能拿 `system:buckycli`，无法为 `app install` 构造用户 sub | `cli/core/auth.ts:395-401` |
| 8 | `principalKind` 判据脆弱 | 靠 `did.json` 有无 `device_type` 字段判断 user/device | `cli/core/identity.ts:340` |
| 9 | 设备身份下 owner 未强制 | `--owner` 可选，缺省交服务端推断，设备调用时会推错 | `cli/modules/app.ts:1587-1592` |

开发模式门控与开发者身份目录收紧已完成。下一步建议处理 5 → 6 → 7 → 9
（把“谁在调用”和“落在谁名下”彻底分开），最后处理 2 → 1 → 8。

---

## 附录 A：verify-hub target 速查

| 认证主体 | target | 构造位置 |
|---|---|---|
| user | `{ kind: 'app', app_instance_id: 'buckycli@<username>' }` | `cli/core/auth.ts:404-408` |
| device | `{ kind: 'system', service_id: 'buckycli' }` | `cli/core/auth.ts:395-401` |
| device 代表 user（待实现） | `{ kind: 'app', app_instance_id: 'buckycli@<user>' }` | — |

## 附录 B：参与身份解析的环境变量

定义于 `cli/core/config.ts:62`，developer 发行版会剔除 `BUCKYOS_ROOT`（`cli/runtime/host.ts:233-234`）。

| 变量 | 作用 | 级别 |
|---|---|---|
| `BUCKYOS_APPCLIENT_SESSION_TOKEN` | 直接注入 session-token | P0 |
| `BUCKYOS_TOOL_IDENTITY` | 等价于 `--identity`；只有解析 `~/.buckycli` 时受目标系统开发模式门控 | P0.3 |
| `BUCKYOS_ROOT` | 推导当前设备身份的文档与私钥根；仅 system 发行版可见 | P2 |
| `HOME` / `USERPROFILE` | 用于推导常规运维根 `~/.buckyos` 和开发者根 `~/.buckycli` | P1 |
| `SUDO_USER` / `SUDO_UID` | **建议新增**，用于识别 OS sudo 下的身份来源漂移 | §2.3(b) |

P1 不接受任意身份根的环境变量覆盖。用于允许扫描 `~/.buckycli` 的信号只能来自目标系统的
BuckyOS 开发模式配置，不得新增本地环境变量作为替代开关。
