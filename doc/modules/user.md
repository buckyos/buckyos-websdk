# User 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`user`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与边界

管理 Zone 账户、账户类型/状态、私有 Profile、邀请与 Message Tunnel 绑定元数据。
系统角色由 UserType 决定，[App](app.md) 的使用范围、[Content](content.md) 的分享、
[Files](files.md) 的文件权限分别由领域服务管理。Profile 中的 groups 不授予系统权限。

## 2. 资源模型

- 主 selector 是 `user_id`，不能通过拼接用户名推断 DID；DID 以服务返回的账户/文档为准。
- 实际状态包括 Active、Pending、Suspended(reason)、Deleted、Banned(reason)。Pending 由邀请流程管理；
  Deleted 通过软删除进入，不作为任意状态设置的捷径。
- 私有 local Profile、DID Document、密码、角色和 tunnel 元数据是不同资源。
  `profile-set` 不发布公开 DID 文档，软删除不擦除内容、不迁移 App 归属。

## 3. 命令与关键输入

除邀请公开入口外均要求 Zone session；以下 RPC 均属于 Control Panel。

| 命令 | 关键输入 | 级别 / 模式 | RPC / 状态 |
| --- | --- | --- | --- |
| `user list` | `--include-deleted` | read / sync | `user.list`；适配，仅现有完整列表，分页待补齐 |
| `user get <user-id>` | 无 | read / sync | `user.get`；适配 |
| `user create <user-id>` | secret JSON/隐藏输入提供密码；可选显示名 | privileged / sync | `user.create`；适配，仅创建 User |
| `user update <user-id>` | `--show-name` | write / sync | `user.update`；适配，仅账户显示名 |
| `user profile-get <user-id>` | 无 | read / sync | `user.profile.get`；适配 |
| `user profile-set <user-id>` | JSON 白名单字段，固定 local scope | write / sync | `user.profile.set`；适配，按第 4 节限制字段 |
| `user invite-create <user-id>` | `--target-did`、`--type`、`--ttl-secs`、`--invite-file` | privileged / sync | `user.invite.create`；适配 |
| `user invite-get` | secret JSON `invite_id` | read / sync | `user.invite.get`；适配，公开入口 |
| `user invite-accept` | secret JSON `invite_id/owner_config/password` | write / sync | `user.invite.accept`；适配，公开入口 |
| `user change-type <user-id>` | `--type admin/user/limited/guest` | privileged / sync | `user.change_type`；适配 |
| `user change-state <user-id>` | `--state active/suspended/banned`，后两者要求 `--reason` | privileged / sync | `user.change_state`；适配，保留原因 |
| `user delete <user-id>` | 显式确认 | destructive / sync | `user.delete`；适配，软删除 |
| `user change-password` | 隐藏输入或 secret JSON | write / sync | `user.change_password`；补齐重新认证/撤销协议 |
| `user reset-password <user-id>` | secret JSON，scoped sudo | privileged / sync | 补齐独立重置语义；不能直接包装为安全重置 |
| `user revoke-sessions <user-id>` | scope、原因 | privileged / sync | 规划，尚无对应正式接口 |
| `user tunnel-list` | 当前用户 | read / sync | 从 `user.get` 的 contact bindings 提取；适配 |
| `user tunnel-set` | JSON `platform/account_id/display_id/tunnel_instance_id` | write / sync | `user.set_msg_tunnel`；适配，仅元数据 |
| `user tunnel-unbind` | `--platform` | write / sync | `user.remove_msg_tunnel`；适配 |

`/` 分隔的值表示枚举选择，不是一个参数值。示例为目标 CLI 语法：

```bash
buckyos --profile production user get alice
buckyos --profile production --input profile.json user profile-set alice
buckyos --profile production user change-state alice --state suspended --reason maintenance
```

## 4. 字段与流程约束

- 直接创建和邀请分开：现有 `user.create` 拒绝非 User 类型；需要其它类型时走服务允许的邀请/类型变更流程。
  服务端生成密钥与 OwnerDocument，CLI 不自行写 `users/<id>/*`。
- `user update` 不提供通用账户补丁：现有 `user.update` 仅处理 `show_name`，它与 Profile display_name 分开。
  现有 profile.set 同时接受整份嵌套 profile 替换和顶层字段修改。首版 CLI 只使用服务端的顶层字段修改路径，
  不发送整份 profile，也不在客户端读取后合并回写。
  schema 限定 display_name/name/avatar/headline/title/bio/location/organization/birthday/bkg_image/website/tags；
  缺省字段不修改，tags 整组替换。DID、内部系统 contact、角色和任意 extra/private_extra 不开放覆盖。
  当前服务内部读改写没有通用 CAS，不能宣称并发更新无丢失；严格条件更新需扩展协议。
- 现有状态 RPC 使用字符串编码原因；CLI 必须保证原因完整往返。旧解析对含 `:` 的原因有截断风险，
  适配期拒绝不能无损编码的原因；目标服务协议改为独立 `state/reason` 字段。
- `tunnel-set` 按 platform 更新绑定描述，不证明调用者拥有外部账号。CLI 不接受用户自报 verified 状态或 tunnel secret。
  原 `tunnel-bind` 的外部账号验证流程保留为后续需求，不以 set 元数据模拟完成。

## 5. 权限与秘密

列表需认证；get/profile 为 self 或有权管理员；创建、类型/状态变更和删除由服务端检查管理员权限。
root 不可被删除/改角色；不得删除当前操作者。跨用户 Profile 代操作应留下审计记录。

密码不能出现在 argv、输出、history 或 verbose。CLI 按现有协议生成 base64 SHA-256 `password_hash`/
`new_password_hash`，hash 同样按 secret 处理。现有 change_password 的 self/admin 检查不等于重新认证，
也未提供默认撤销旧 session 的完整链路；两项能力补齐后再发布密码变更/重置命令。

邀请查询/接受已是服务公开入口，不应要求先正常登录。invite_id 作为邀请凭证按 secret 输入；
创建时只向明确指定的权限受限文件写完整邀请，stdout 返回摘要。接受时校验目标 DID、Zone 绑定及有效期。

## 6. 输出、分页与失败

当前 list 返回 `{total, users}`，没有 cursor/limit/filter；首版明确输出 `pagination_supported=false`，
不接受未实现的分页参数。大规模账户枚举须先扩展服务端分页，不能在 CLI 全量获取后切片。

创建/状态/类型变更可能先写账户再刷新 RBAC；刷新失败不能报告已回滚，也不能盲目重试创建。
返回已提交状态、RBAC 刷新结果和后续查询提示。当前未有通用 CAS/幂等保证，不能宣称重试安全。
所有操作为普通 RPC，不生成虚构 Task；输出去除私钥、密码 hash 和邀请凭证。

## 7. 实现依据

- [Control Panel 路由](../../../buckyos/src/frame/control_panel/src/main.rs)、[UserMgr](../../../buckyos/src/frame/control_panel/src/user_mgr.rs)。
- [公开入口与 principal 校验](../../../buckyos/src/frame/control_panel/src/sys_auth_backend.rs)。
- [账户协议模型](../../../buckyos/src/kernel/buckyos-api/src/control_panel.rs)、[SDK 密码处理](../../src/account.ts)。

## 8. 验收与剩余依赖

覆盖普通用户/管理员/无 session 邀请三条路径；确认非 User 直接创建失败、root/self 删除失败、
软删除保留数据、Profile 更新不覆盖内部字段、任意状态原因不丢失。测试 RBAC 刷新失败后的真实提交结果。
密码重新认证与 revoke、受验证的 tunnel binding、大规模分页是独立服务依赖，不随基础 CLI 自动完成。
