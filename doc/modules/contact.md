# Contact 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`contact`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与资源

管理用户通讯录、endpoint binding、alias、联系人关系与消息入站准入。
canonical contact DID 与 external endpoint DID 分开；groups/tags 只是通讯录组织信息，不能授予系统角色。
出站目的 endpoint 由 [Message](message.md) 显式选择，preferred binding 不是自动路由承诺。

关系采用现有 `block/stranger/temporary/friend`；临时准入由 context、授予时间、到期时间组成。
forget、archive 与 block 含义不同：不再显示联系人不代表阻止其来信，也不保证其 shadow 不再创建。

## 2. 命令与真实映射

服务为 msg-center，复用 MsgCenterClient 的 `contact.*` 方法。全部为 sync；先满足第 3 节身份隔离门槛。

| 命令 | 关键输入 | 级别 | RPC / 状态 |
| --- | --- | --- | --- |
| `contact list` | `--limit/--offset/--keyword/--source/--access-level` | read | `contact.list_contacts`；适配 |
| `contact get <did>` | 无 | read | `contact.get_contact`；适配，null 表示未找到 |
| `contact import` | JSON `contacts`、显式 `upgrade_to_friend` | write | `contact.import_contacts`；补齐逐项结果后发布批量接口 |
| `contact update <did>` | JSON name/avatar/note/groups/tags | write | `contact.update_contact`；适配，仅白名单字段 |
| `contact merge <target-did>` | `--source <did>`、显式确认 | destructive | `contact.merge_contacts`；补齐安全重试/并发契约 |
| `contact block <did>` | 无 | write | `contact.block_contact`；适配 |
| `contact unblock <did>` | `--level stranger/friend` | write | `contact.update_contact` 的 access_level；适配 |
| `contact grant-temporary <did>` | `--context-id`、`--duration-secs` | write | `contact.grant_temporary_access`；适配 |
| `contact endpoint-list <did>` | 无 | read | `contact.get_contact` 的 bindings；适配 |
| `contact access-check <did>` | 可选 context | read | `contact.check_access_permission`；适配 |
| `contact forget <did>` | 删除范围、确认 | destructive | 规划，当前无独立删除协议 |
| `contact archive <did>` | 无 | write | 规划，当前无归档字段/接口 |

原 `contact create` 不作为首批命令：当前 import 可能创建、合并或升级 shadow，不能包装成“保证新建”。
如需要单个导入也使用 import 的同一语义。原通用 update 中的关系修改收敛到专用命令；
另行设计 friend 降级/提升时必须明确授权影响，不能顺带修改 source/is_verified。

## 3. 发布前置条件：服务端身份隔离

当前 handler 接收 `contact_mgr_owner`，部分方法不使用请求 ctx；缺省 owner 落到系统命名空间，
并不表示当前用户。适配器必须从已验证 session 明确带入 owner；服务端同时校验其等于 principal 或有效委托范围。
CLI 不开放任意 `--owner` 改写这个字段，客户端填字段不能替代服务端权限修复。

`source/is_verified` 不能由普通更新参数冒充来源证明；导入时也不能用用户输入构造可信标记。
Profile/contact 中的 groups 不能用于 BuckyOS RBAC。所有写入限制在当前用户通讯录。

## 4. 读取、分页与修改语义

- list 使用真实 offset/limit，默认 100、上限 1000；输出 items、offset、limit，不捏造 total 或稳定快照 cursor。
  满页只能表示可能还有下一页，不能保证并发修改下不重不漏。
- endpoint-list 只读取已有 bindings。`resolve_endpoint_did`/部分 resolve 流程可能创建 shadow，
  不能用来实现只读 get/list，也不能静默“修复”缺失联系人。
- update 中 groups/tags 为整组替换；未知字段报参数错误。服务未提供 CAS，CLI 不接受假 expected-revision。
- unblock 明确恢复为 stranger 或 friend，清除/失效临时准入须遵循服务实际更新结果；不隐式恢复旧关系。
  对并发状态变更需要严格条件更新的场景，先扩展服务协议，不能以先 get 再 update 保证原子性。
- grant 返回每个 DID 的 granted、到期时间与拒绝原因。现有逻辑可能创建缺失联系人；必须明确告知这一副作用，
  不能声称“只修改已有联系人”。被 block 的联系人不能借临时 grant 绕过封禁；失败不自动延长授权重试。
- merge 会改变 canonical 归属并保留 alias，具有破坏性；目标/源不得相同。先补齐服务端幂等与并发冲突契约，
  输出 canonical DID、被合入的源与保留 alias，不能仅返回 `true`。

## 5. 批量导入与错误

当前 ImportReport 仅有 imported、upgraded_shadow、merged、created、skipped、failed、errors、affected_dids。
它不包含输入行与结果的可靠一一映射。目标 import 协议需为每项增加 client_ref、结果 DID、动作与错误，
同时限制单批数量；不能把 affected_dids 按序拼接成逐项结果，也不能在 CLI 循环单条请求伪造原子批量导入。

目标 CLI 默认显式发送 `upgrade_to_friend=false`；当前服务省略该字段时默认 true，不能依赖服务缺省值。
导入通讯录不自动开放陌生人入站权限。
部分成功输出逐项结果与汇总，使用部分成功退出码；保留已提交项，不能在失败后整批重放。
未完成逐项协议之前，SDK 原有汇总接口可保留，但不宣称满足目标 CLI 批量验收。

## 6. 实现依据与验收

- [SDK 类型与方法](../../src/msg_center_client.ts)。
- [Rust 联系人协议](../../../buckyos/src/kernel/buckyos-api/src/msg_center_client.rs)。
- [服务路由](../../../buckyos/src/frame/msg_center/src/msg_center.rs)、[ContactMgr](../../../buckyos/src/frame/msg_center/src/contact_mgr.rs)。

测试必须覆盖跨 owner 拒绝、缺省 owner 不进入系统空间、只读查询不创建 shadow、关系字段白名单、
封禁优先于 temporary grant、合并后 alias 可追溯，以及导入失败项可定位。forget/archive 不得用 block 或本地过滤冒充实现。
