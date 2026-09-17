# 未实现模块设计 Review

> Review 日期：2026-09-17。这里只修改需求设计，不表示相应 CLI 已实现或服务已通过线上验收。

依据当前工作区实现核对：`buckyos-websdk`（HEAD `afdc5fd`）、`buckyos`（`ffbfa5fa`）、
`buckyos-base`（`33bb855`）、`cyfs-ndn`（`00847d7`）、`cyfs-gateway`（`28ee6dc`）。
这些提交号仅用于定位 Review 基线，不是依赖固定版本。各模块末尾链接具体源码；兄弟仓库需在同级目录。

## 1. Review 结论与实现顺序

| 模块 | 当前可复用基础 | 设计修正 / 发布前置条件 |
| --- | --- | --- |
| [Provision](provision.md) | SDK `buckyos/provision` 生产激活 API 与 CLI `provision status/check/activate`（2026-09-17 已交付） | 本机 Host 授权、无 session/网络、锁 + 最后写 node_identity 的提交边界已实现；剩余 active.ts 切换与 Web 激活排他 |
| [User](user.md) | Control Panel 已注册账户、Profile、邀请和 tunnel 元数据接口 | 直接创建仅支持普通 User；邀请接受不要求先登录；密码重新认证、session 撤销、分页不能视为已完成 |
| [Message](message.md) | MsgCenterClient、发送、box/会话查询、记录状态 | 查询不能调用领取队列接口；record、message、delivery、receipt 分开；补齐可见性和 SDK 会话协议 |
| [Files](files.md) | 真实 nfs-server、NFSP HTTP、桌面 TS client、TaskMgr copy | 改为适配 `/nfs/v1`；补齐普通文件请求鉴权；分开 delete/unlink；复制使用已有任务协议 |
| [Object](object.md) | NDM proxy 与 RepoClient/RepoService | 上传 bytes 与 Repo 记账分开；pin 不下载；stat 不能用 Repo 汇总统计；补齐查询分页与授权 |
| [Contact](contact.md) | 联系人读写、导入、合并和临时准入 | 服务端绑定 owner；导入目前仅汇总报告；forget/archive 尚无协议 |
| [Group](group.md) | GroupMgr 与成员、策略、subgroup 协议 | actor/owner 必须由认证约束；proof 结构检查不等于验签；expand 会持久化快照 |
| [DID / DID Object](did-object.md) | Rust 解析/验证库、HTTP resolver、DIDObjectClient | TS 适配与可信解析链仍需实现；动态 action 风险不能统一标为 write |
| [Content](content.md) | publish handler 源码、NFSP grant/revoke | publish 未挂载为运行服务；grant 数据面未执行 capability；不能直接宣称分享/发布可用 |
| [System](system.md) | CLI status、Control Panel 指标、Rust node-control | status 不是完整 Zone 健康；update 仍占位；节点/服务控制需要正式 API/host bridge |
| [Storage](storage.md) | 本地路径工具、NFS 导出、局部磁盘指标 | 没有正式 mount 管理服务；必须明确目标节点、Host resource 和原子预演/执行契约 |
| [Backup](backup.md) | 可复用 Task/NamedData 底座 | 缺一致性备份与恢复服务；升级 gate 必须是已完成并验证的备份，不能是预演结果 |
| [BNS](bns.md) | BnsClient 与 Rust BNS 协议 | 原文件为空；先明确与 DID 解析边界，独立交易命令未纳入本轮范围 |

建议先完成共享执行约束，再适配 User 基础管理、Message 有权限的读写、NFSP 与 NDM 传输；
Contact/Group 在服务端身份绑定完成后接入，DID 在可信解析适配完成后接入。
Content、Storage、Backup、系统升级按各自服务依赖交付，不能用 CLI 本地编排填补服务缺口。
Files 的普通方法鉴权是其发布门槛，但不妨碍先提取、测试已有 NFSP client。

企业本机首次激活另走 Provision 交付线，先复用 active.ts 的单 OOD、did:web、无 SN/BNS 流程；
它不依赖在线 User/System 服务，也不属于通用开发环境生成或 Tool config。

## 2. 如何阅读命令表

- **适配**：已有真实协议或处理路径，可以开发 SDK/CLI 适配；仍须满足该文档的权限与验收条件。
- **补齐**：已有部分实现，表内标出的服务端或 SDK 缺口需先补齐。
- **规划**：尚无可执行服务契约；保留需求，但不注册为可执行命令，不模拟成功。

下列文档的命令和参数是修订后的目标契约，除明确注明的 `system status` 外，不能当作当前 CLI 使用手册。
命令数不再适合作为完成度分母；应分别记录服务、SDK、CLI、集成验收四层状态。

## 3. 共同命令约束

- 遵循[主 PRD](../buckyos%20tool%20PRD.md)：最多一个位置 selector，其余参数具名；全局参数在 module 前。
  `--input` 只读 JSON。传输本地文件使用动作参数 `--path`，原始字节 stdin 须另行定义，不能占用 JSON 输入通道。
- `user_id`、用户 DID、Group DID、ObjId、record_id、task_id 不能混用；本机文件路径指 CLI 所在运行环境，
  不是远程节点或容器 Host 路径。`--identity` 选择身份，不授予代操作权。
- 访问级别描述实际副作用。领域 Owner/Admin 与 Zone Admin、sudo 分开校验；元数据标签和客户端检查不能替代服务端授权。
  当前 Contact/Group handler 的 owner/actor 参数尤其需要与验证后的 principal 绑定。
- 公开 resolver 和邀请查询/接受属于网络命令，但不要求既有 Zone session。显式声明
  `execution: service`、`networkAccess: true`、`requiresSession: false`，禁止触发设备身份回退。
- 只有后端执行幂等去重才宣称支持 `--idempotency-key`；不支持时拒绝该选项。
  超时后可能已提交的写操作返回不确定结果和可查询的资源标识，不自动重放。
- 仅使用服务端实际分页。offset 不是快照 cursor；无分页接口不能全量读取后伪装分页。
  未提供 total、逐项结果或 revision 时不能由客户端猜测填充。
- 原生业务 ID、上传租约、Group expansion `operation_id` 不是 TaskMgr task，也不是可 `apply` 的预演计划。
  普通 RPC 保持 sync；流式传输使用 stream；只有后端持久任务才进入 `task wait`。
- 持久任务默认等待；超时/Ctrl-C 仅结束本地等待，取消必须显式发起。部分成功保留逐项结果并使用主 PRD 的部分成功退出码。
  SSE watch 是有损通知，不能冒充审计日志。

## 4. 共享框架仍需完成的工作

现有[命令元数据](../../cli/core/command.ts)、[执行入口](../../cli/core/app.ts)和
[输出层](../../cli/core/output.ts)提供了基础，但以下能力不可在新模块文档中假设已经完成：

1. 统一执行访问策略、scoped sudo、确认与审计；`ctx.confirmed`/access 标签本身不是授权执行器。
   已有部分模块自行校验，新模块必须有明确的执行检查，不能只填 metadata。
2. 统一全局 `--no-wait` 与任务等待。当前部分模块有动作级 `--no-wait`，不能当作所有命令通用支持。
3. 二进制 stdout 流、背压和中断处理。现有 raw 输出路径为文本；Files/Object 首版以显式输出文件和 JSON 摘要交付，
   完成共享字节流扩展后再开放 `--output raw`。
4. 可信 dry-run/apply 契约：服务端保存带 actor、目标、spec 摘要、风险、revision、过期时间的 operation；
   apply 原子校验并幂等提交。CLI 不能把一次 GET + 本地确认拼成 CAS。
5. 新公开网络命令覆盖 endpoint 解析和无 session 配置路径；不假设现有需要登录的 Service facade 可直接复用。
6. 本机初始化支持独立的 Host 授权、受限 root/备份路径及秘密输入，不要求目标 Zone 已有 session；
   Provision 作为生产初始化例外，不能沿用 dev/test provision 的默认秘密或脚本 `--allow-all`。

## 5. 本轮验收边界

本轮为静态源码与文档 Review，未启动 Zone、未进行服务端安全验收。
后续实现每个命令时，应对真实请求/响应建立 schema、权限失败测试和协议集成测试；
缺少后端能力返回 unsupported，认证失败返回权限错误，二者不能与资源不存在混为一谈。
新增模块请使用[模块模板](module-template.md)，并保持“实际实现”与“目标要求”分栏描述。
