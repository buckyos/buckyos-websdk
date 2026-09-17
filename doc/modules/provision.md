# Provision 模块需求

> 状态：Partially implemented，2026-09-17 根据企业版 `src/active.ts` 补充并落地首版。
> 对应 module：`provision`。首版范围：单 OOD、`did:web`、无 SN/BNS 的本机首次激活。
> 已注册 CLI：`provision status`、`provision check`、`provision activate`；生产 API 位于 SDK `buckyos/provision`。

## 1. 目标与边界

为已经安装、尚未激活的 BuckyOS 建立首个 Zone、Owner 和 OOD 身份，完成首次启动所需的本机配置。
这是安装后、Zone 运行前的初始化能力；执行时不能要求目标 Zone 已有用户、verify-hub 或 TaskManager。
企业自动化部署和本机终端共用输入 schema、输出和激活实现。

与其它模块的分工：

| 模块 | 责任 |
| --- | --- |
| `provision` | 首次建立 Zone 与节点身份、生成并提交初始化材料、保存 Owner 恢复密钥 |
| [System / Node](system.md) | 激活后的启动、停止、运行检查、维护、升级；启动成功与否不由激活产物推断 |
| [User](user.md) | 已运行 Zone 内的用户管理；创建首个 Owner 不走 `user create` |
| [DID](did-object.md) | 解析、验证和对象协议；不承担整套 Host 激活事务 |
| [Backup](backup.md) | 系统一致性备份/恢复；一份 Owner 私钥恢复副本不是系统备份 |
| 安装器 | 安装/更新程序与运行时；本模块不下载安装包、不构建 rootfs |

`config` 管 Tool 自身配置，`pikg` 管发行物，均不拥有这套系统初始化状态。
本模块仅在明确激活目标下生成、签署必需身份材料，不扩展为通用私钥导出/任意签名工具。

## 2. 当前实现与发布前置条件

### 2.1 实际实现（2026-09-17）

| 层 | 位置 | 状态 |
| --- | --- | --- |
| 生产 API | [src/provision_activate.ts](../../src/provision_activate.ts)，经 `buckyos/provision` 导出 `inspectActivationRoot` / `checkOfflineActivation` / `activateOfflineZone` | 已实现，Node/Deno 共用，不 import 兄弟仓库 |
| CLI | [cli/modules/provision.ts](../../cli/modules/provision.ts)，[app.ts](../../cli/core/app.ts) 注册 | 已注册 `status` / `check` / `activate` |
| Host policy | [runtime/host.ts](../../cli/runtime/host.ts) 按 `provision` 的 `--root` / `--owner-key-backup` 授予最小读写路径，`network=false` | 已实现 |
| 测试 | [tests/provision_activate.test.ts](../../tests/provision_activate.test.ts)、[cli/tests/provision_test.ts](../../cli/tests/provision_test.ts) | 覆盖状态判定、无副作用预检、完整激活、二次激活拒绝、锁互斥、提交中断、密钥权限、无秘密输出 |

生产 API 在内存中生成全部文档（随机 Ed25519 Owner/device 密钥、当前时间 iat、`iat + 5 年` exp），
不再经过 make_config 的 dev 用户目录、`did:bns` 改写和临时目录，因此不会在通用临时目录留下私钥。
文档字段与 node-daemon Web 激活路径（`active_server.rs`）对齐：OwnerDocument 通过
`set_default_zone_did` 绑定到 Zone（`binded_zone_list` / `zone_binding_model_version=2`），
`start_config.json` 字段集与 `build_start_config` 相同；ZoneBoot 仍为最小 `id/oods/exp`。
与 active.ts 的差异：不再写 `etc/.buckycli/`（无内核消费方）；Owner 备份目录必须已存在（不递归创建）。

原 `buckyos/src/active.ts` 尚未切换到该 API（其 import 指向已发布的 dist），属于后续同步项。

### 2.2 尚未覆盖

- 与 node-daemon `--enable_active` Web 激活之间没有共享互斥：锁文件只对本 API/CLI 调用方有效，
  部署时必须保证 node-daemon 未处于激活服务模式，或由安装器保证排他。
- 不提供 `--force`、重新激活、加入已有 Zone、多 OOD、SN 注册、BNS 交易、DNS/TLS 自动配置。
- Windows 上只做 `wx` 独占创建，不设置 ACL；POSIX 使用 0600/0700。
- 容器内路径不代表 Host；Jarvis/paios 内激活需另行定义 Host bridge。

## 3. 资源与首版范围

- target root：本机已安装的 BuckyOS 根，selector 为必填 `--root`，此时不要求已有 node_id。
  root 必须已存在 `bin/` 与 `etc/`，否则状态为 `not_installed`。
- 固定身份关系：Owner DID = Zone DID = `did:web:<domain>`，Device DID = `did:web:ood1.<domain>`。
- 拓扑为单 OOD、`wan`；rtcp_port 缺省 2980，guest_access 缺省 false。
  public_ip 可选，只用于 A/AAAA 说明，不配置 DNS、不证明域名控制权或公网可达。
- 产物遵循现有 IdentityRoots；提交顺序即下表顺序，`etc/node_identity.json` 最后写入：

| 相对路径 | role | 说明 |
| --- | --- | --- |
| `security/ood1.<domain>/authentication.private.pem` | device_private_key | 0600，目录 0700，secret |
| `local/identity/ood1.<domain>/did.json` | device_document | DeviceDocument JSON |
| `local/identity/ood1.<domain>/device_doc.jwt` | device_document_jwt | Owner 签名 |
| `local/identity/ood1.<domain>/device_mini_doc.jwt` | device_mini_document_jwt | Owner 签名 |
| `etc/<domain>.zone.json` | zone_boot_override | 最小 ZoneBoot，本地启动旁路读取 |
| `etc/zone_document.jwt` | zone_document_jwt | Owner 签名，< 4096 字节 |
| `etc/zone_dns_records.json` | dns_records | 可选说明文件，不作激活标记 |
| `etc/start_config.json` | start_config | 首次启动配置，含 admin_password_hash，不含任何私钥 |
| `etc/node_gateway_params.json` | gateway_params | `did:bns:unactivated.local` 占位不算激活标记 |
| `etc/node_identity.json` | node_identity | node-daemon 的激活开关，最后提交 |

Owner 恢复私钥另存到用户明确指定的路径（`wx` 独占创建，0600），不写入 start_config 或 Tool profile。
激活过程中 `etc/provision_activation.lock` 记录 trace_id、阶段和已提交文件，成功后删除。

首版不支持 nat/portmap/wan_dyn、多 OOD、加入已有 Zone、SN 注册、BNS 交易、DNS/TLS 自动配置或重新激活。

## 4. 命令与输入

均为 `execution=local`、`networkAccess=false`、`requiresSession=false`、`asyncMode=sync`。

| 命令 | 主要输入 | 访问级别 | 状态 |
| --- | --- | --- | --- |
| `provision status` | 必填 `--root` | read | 已实现，只读检查本地激活材料及完整性 |
| `provision check` | 必填 `--root/--domain/--owner-name/--owner-key-backup`；可选 `--public-ip/--rtcp-port/--guest-access` | read | 已实现，无副作用预检，不需要密码 |
| `provision activate` | 与 check 相同，加 secret `admin_password` | privileged | 已实现 |

activate 的非敏感字段为 root/domain/owner_name/owner_key_backup/public_ip/rtcp_port/guest_access。
`admin_password` 只能来自 `--input` JSON 中标为 secret 的字段或终端隐藏提示（输入两次并比对），
没有 `--admin-password` argv 选项；密码至少 8 个字符。
非交互模式缺密码返回 `SECRET_REQUIRED`，缺 `--yes` 返回 `CONFIRMATION_REQUIRED`（退出码 4）；
交互模式在 stderr 打印摘要后要求确认。`--yes` 不补全缺失的秘密。
`--profile/--zone/--endpoint/--identity/--session-token(-file)` 与本地命令冲突，返回 `ARGUMENT_CONFLICT`。

```bash
buckyos provision status --root /opt/buckyos
buckyos provision check --root /opt/buckyos --domain corp.example.com --owner-name admin --owner-key-backup /secure-backup/corp-owner.pem
buckyos --non-interactive --yes --input activation.json provision activate --root /opt/buckyos --owner-key-backup /secure-backup/corp-owner.pem
```

`activation.json` 含 `domain`、`owner_name`、可选 `public_ip/rtcp_port/guest_access` 和 secret `admin_password`，
须由部署工具安全提供；输出/审计/REPL history 不回显。同一字段同时出现在 `--input` 和 argv 中报 `ARGUMENT_CONFLICT`。

**路径与权限**：launcher 只从 argv 读取 `--root` 与 `--owner-key-backup` 来授予最小文件权限
（status/check 只读 root 与备份目录；activate 读写 root 与备份目录），不授予网络。
只写在 `--input` 里的路径受策略根（cwd，system 发行版另加配对的 `BUCKYOS_ROOT`）限制，越界返回 `HOST_ACCESS_DENIED`。
Tool 不继承脚本的 `--allow-all`。

check 不生成密钥、不写备份、不改变目标目录、不产生可 apply 的 operation；activate 必须重新验证当前状态。
不提供远程 dry-run/apply、task_id、`--no-wait` 或幂等重放承诺。

## 5. 权限、密码与密钥

授权依据是本机安装目录及密钥目标的 OS/安装器权限，而非待创建 Zone 的 session/sudo。
执行路径绕开设备身份回退及 verify-hub 登录；激活完成后不自动将新 Owner 导入 Tool profile。

root 指 CLI 当前所在机器的目录。Jarvis/paios 容器中的路径不自动代表 Host。

私钥材料创建即限制访问：设备私钥 0600 / 目录 0700，Owner 备份 0600 且独占创建、禁止覆盖；
备份路径已存在（含悬空符号链接）返回 `OWNER_KEY_BACKUP_EXISTS`，父目录不存在返回 `OWNER_KEY_BACKUP_DIRECTORY_MISSING`。
不继承脚本的 `~/.buckycli/owner-keys` 默认路径。

密码编码沿用首次启动消费协议：base64 SHA-256(password + ownerName + ".buckyos")，
即 SDK `hashPassword` 无 nonce 分支（`hashAdminPassword` 直接复用其纯计算逻辑，不引入 localStorage）。
密码与 hash 不进入日志、错误、manifest 或结果；status 只报告 `admin_password_hash` 是否存在。
生产流程显式使用随机密钥、当前文档时间和所输入密码，不使用 provision 库的 dev/test 默认密钥、固定时间或默认密码。

## 6. 提交、失败与状态

`provision status` 返回 `state`：

| state | 含义 |
| --- | --- |
| `not_installed` | root 不存在或缺少 `bin/`、`etc/` |
| `unactivated` | 无任何激活标记、无锁；可以激活 |
| `partial` | 存在部分标记、锁文件或无法读取的 node_identity；拒绝激活，也不自动清理 |
| `configured` | 必需文件齐全、JWT 由 node_identity 中的 Owner 公钥验签通过、DID/主机名/设备密钥/本地 Boot 一致；`startup_required=true` |
| `invalid` | 文件齐全但校验失败；`problems` 列出原因 |

`configured` 不包含服务健康、DNS、TLS 或外部 DID 可发现性。

提交协议：precheck → 在内存生成全部材料 → `O_EXCL` 创建锁并在锁内重新检查目标 → 保存 Owner 备份 →
逐文件“临时文件 + rename、拒绝覆盖”提交，每提交一个文件更新锁中的 `committed` → 删除锁。
锁只对本 API/CLI 调用方互斥；与 node-daemon Web 激活的排他由部署方保证（见 2.2）。

失败语义：

| 错误码 | 退出码 | 含义 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | 2 | 域名/名称/端口/IP/密码不合法 |
| `TARGET_NOT_INSTALLED` / `TARGET_ALREADY_ACTIVATED` / `TARGET_PARTIALLY_ACTIVATED` | 6 | 目标状态不允许激活 |
| `ACTIVATION_IN_PROGRESS` | 6 | 锁文件存在（进行中或被中断） |
| `OWNER_KEY_BACKUP_EXISTS` / `OWNER_KEY_BACKUP_DIRECTORY_MISSING` / `OWNER_KEY_BACKUP_FAILED` | 6 | 备份失败时目标目录未写入，锁已释放 |
| `ACTIVATION_PRECHECK_FAILED` | 6 | 多个预检问题，`details.problems` 逐项列出 |
| `ACTIVATION_COMMIT_FAILED` | 7 | 备份已保存、部分文件已提交；`details` 含 stage、`owner_key_backup`、`committed_files`、`lock_file`、`recovery` |
| `CONFIRMATION_REQUIRED` / `CONFIRMATION_DECLINED` / `HOST_ACCESS_DENIED` | 4 | 未确认或越出 Host policy |

Owner 备份成功而后续失败时保留已生成身份，不自动删密钥或重新生成另一套身份；
恢复步骤要求人工检查 `provision status`、清理列出的文件与锁（或重装）后再 `check`。
重复激活和 partial 状态均拒绝直接覆盖；首版不提供 `--force`；未知提交结果不自动重试。

## 7. 输出与启动交接

成功结果包括 root、Owner/Zone/Device DID、`state=configured`、`startup_required=true`、
`owner_key_backup.saved`、`dns_records` 与 `dns_notes`、`committed_files`（非 secret 文件带 sha256）、
`document_iat/exp`、`next_steps` 和 `audit`（module/verb/trace_id/tool_version/非敏感输入指纹）；
不返回私钥、密码、hash 或完整 start_config。
activation 与后续启动分开：提示通过安装器/受控 node 控制入口重启，再用 `system status` 观察运行状态。
stdout 不声称 Zone 已上线，也不访问 3182、SN、BNS、DNS 或证书服务。

## 8. SDK 与实现归属

生产 API 以 [namelib](../../src/namelib.ts)、[device_identity](../../src/device_identity.ts)、
[cert IdentityRoots](../../src/cert.ts) 的文档构造/签名/路径能力为基础，独立于 dev/test 的
`createUserEnv`/`createNodeConfigs`。Tool 作为薄入口只做 argv、Host policy 断言、秘密输入、确认与输出映射。
`buckyos/src/active.ts` 与安装器可在下一次 SDK 发布后切换到 `activateOfflineZone`。
分发包不 import 兄弟仓库脚本、不要求源码 checkout。

## 9. 验收

- 无 Zone、无 profile、禁止网络、未运行 3182 时可检查/激活；从未调用 verify-hub 或 TaskMgr（CLI 测试注入的 session/client 工厂会直接抛错）。
- 保持 did:web 身份、Owner 签名 JWT、Boot 最小字段、密码编码、无 SN/BNS、拒绝二次激活。
- check 不写盘；参数冲突、秘密输入与非交互确认按 Tool schema 执行。
- 覆盖并发锁、备份存在/目录缺失、逐阶段写入失败、partial/invalid 识别、私钥权限和无秘密日志。
- Node/Deno 两个宿主行为一致（`test:cli-conformance` 覆盖注册表与错误用例，provision 测试在 Deno host 下执行完整流程）。

依据：[现有无 SN 激活说明](../../../buckyos/product/node_active/Node_Active_无SN命令行激活.md)、
[激活脚本](../../../buckyos/src/active.ts)、[node-daemon 激活开关](../../../buckyos/src/kernel/node_daemon/src/node_daemon.rs)、
[Web 激活落盘](../../../buckyos/src/kernel/node_daemon/src/active_server.rs)。

## 10. 交付顺序

首版已交付生产 API 与 status/check/activate。后续：
1. `buckyos/src/active.ts` 切换到 SDK API，删除重复实现。
2. 与安装器/node-daemon 商定激活期间的排他边界（或让 Web 激活识别锁文件）。
3. 加入已有 Zone、增加 OOD、替换节点和身份轮换分别确定信任引导、授权与回滚协议后，再决定归入 provision 的命令。
