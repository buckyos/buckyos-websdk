# Group 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`group`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与资源

管理 GroupDoc、成员角色、邀请/加入证明、策略及 subgroup。
Group 是领域资源，不是进程；不提供 start/stop。GroupMgr 服务生命周期由 [System](system.md) 管理。

主 selector 是 Group DID；角色采用 owner/admin/member/guest。
独立 Group 作为 nested member 仍有自己的 DID；subgroup 属于 parent，使用 parent DID + subgroup_id，不能互换。
GroupDoc 的 doc_version/profile_version 是业务版本，现有写请求没有通用 expected-revision CAS。

## 2. 命令与映射

使用 msg-center 的 `group.*`，全部为 sync。以下“适配”均以第 3 节身份与证明边界为发布门槛。

| 命令 | 关键输入 | 级别 | RPC / 状态 |
| --- | --- | --- | --- |
| `group create` | JSON profile/settings；owner 从认证身份取得 | write | `group.create`；适配 |
| `group get <group-did>` | 无 | read | `group.get_doc`；适配 |
| `group list` | `--member <did>` | read | `group.list_by_member`；补齐分页 |
| `group update <group-did>` | JSON profile patch | write | `group.update_profile`；适配，不混入策略 |
| `group invite <group-did>` | `--member`、`--role`、member_kind | write | `group.invite_member`；适配 |
| `group proof-submit <group-did>` | JSON proof | write | `group.submit_member_proof`；补齐可信 proof 校验 |
| `group join-request <group-did>` | JSON proof；member 为当前身份 | write | `group.request_join`；补齐可信 proof 校验 |
| `group approve <group-did>` | `--member` | write | `group.approve_member`；适配，保留实际成员状态 |
| `group reject <group-did>` | `--member`、`--reason` | write | `group.reject_member`；适配 |
| `group member-list <group-did>` | limit/offset、state/role filter | read | `group.list_members`；适配 |
| `group member-remove <group-did>` | `--member`、`--reason` | write | `group.remove_member`；适配 |
| `group member-role-set <group-did>` | `--member`、`--role`、显式确认 | write | `group.update_member_role`；适配，Group 角色校验 |
| `group subgroup-create <group-did>` | JSON name/description/member_dids | write | `group.create_subgroup`；适配 |
| `group subgroup-update <group-did>` | `--subgroup-id`、JSON patch | write | `group.update_subgroup`；适配 |
| `group subgroup-list <group-did>` | 无 | read | `group.list_subgroups`；补齐分页 |
| `group collection-policy-set <group-did>` | JSON policy、确认 | write | `group.update_collection_policy`；适配 |
| `group attribution-policy-set <group-did>` | JSON policy，可显式 null | write | `group.update_attribution_policy`；适配 |
| `group expand <group-did>` | `--purpose`、`--max-depth` | write | `group.expand_members`；适配，会持久化快照 |
| `group parent-list <group-did>` | 无 | read | `group.list_parents`；补齐分页 |
| `group access-check <group-did>` | `--subject <did>`、`--action` | read | `group.check_access`；适配，解释权限 |
| `group freeze/unfreeze <group-did>` | 原因 | privileged | 规划，尚无冻结协议，两个独立命令 |
| `group close <group-did>` | 原因、确认 | destructive | 规划，尚无关闭协议 |

`--subject` 仅为权限检查的被查询对象；修改请求不开放任意 actor_did。
带 JSON 的命令使用全局 `--input`；一个命令最多一个位置参数。

## 3. 身份、角色与证明

当前 handler 多处忽略 ctx，把请求中的 actor_did/host_owner 直接交给 GroupMgr；
GroupMgr 的领域角色判断不能弥补调用身份可伪造的问题。先由服务端绑定验证后的 actor 与 host_owner，
校验明确委托，禁止无 owner 请求落入系统空间。CLI 同样不能接受这些内部字段覆盖身份。

Group Admin 不等于 Zone Admin；成员与策略操作按 Group 权限执行，不要求普通群管理者取得 Zone sudo。
角色提升/策略变化仍需显式确认、服务审计及 owner 不变量约束。

当前 proof 校验包含 group 匹配、非空证明、有效期及 scope 等检查，但不足以证明签名链可信；
host-issued 字符串也不是可验证的跨 Zone 签名。输出区分成员状态与 proof 验证状态，不能因为字段齐全显示 verified。
跨 Zone 成员证明需补齐签名者身份、签名、撤销及重放检查后发布；本地受限适配不能绕过这一边界。
invite/approve 可能仍处于等待成员签名状态，不能一律报告 active。

## 4. 展开、分页与版本

expand 有界遍历并保存 GroupExpansionSnapshot，应标为 write；`max_depth` 按服务范围校验，
返回 expanded/opaque members、visited、truncated、cycle 信息及 policy/proof digest。
该结果中的 `operation_id` 是展开快照 ID，不可交给 `group apply` 或 `task wait`。
快照用于解释某时刻的计算结果，不能成为永久授权证明。

member-list 使用 offset/limit（服务默认 200、上限 2000）。list_by_member/subgroups/parents 当前为完整数组，
没有原生分页；目标生产 CLI 需先补齐服务端分页，不支持 CLI 拉全量后伪造 cursor。
现有写接口没有条件版本更新，不能接受无效 CAS 参数；对策略并发编辑的严格冲突保护属于后续服务扩展。

## 5. 实现依据与验收

- [Rust 请求/响应和领域模型](../../../buckyos/src/kernel/buckyos-api/src/group_mgr.rs)。
- [GroupMgr 实现](../../../buckyos/src/frame/msg_center/src/group_mgr.rs)、[handler](../../../buckyos/src/frame/msg_center/src/msg_center.rs)。
- [SDK](../../src/msg_center_client.ts) 已有方法，但不少 Group DTO 仍为宽泛 JSON，CLI 接入前需具体 schema。

覆盖伪造 actor/host_owner 拒绝、Group Admin 与 Zone Admin 区分、待签名状态、伪造/过期 proof、
循环嵌套和深度截断、subgroup selector、角色变化审计。freeze/close 的消息与成员写入语义需服务端确定，不能本地加标记模拟。
