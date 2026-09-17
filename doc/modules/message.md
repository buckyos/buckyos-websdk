# Message 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`message`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与资源

通过 msg-center 发送消息和查询用户可见的消息记录、box、会话与回执。
`msg_id` 是不可变消息对象 ID；`record_id` 是用户视图中的记录；`delivery_id` 是投递；
`session_id` 是会话投影，不能互换。MsgCenter 接受、transport 投递、对端接收和已读分别表达。

from 必须是当前 principal 或有效委托身份；to 为明确用户/Group DID 或 external endpoint DID。
canonical contact DID 不能直接推断外部平台目的地。附件使用 [Object](object.md) 的对象引用，
不能把大文件内嵌进消息 JSON。

## 2. 命令、输入与映射

全部走正式 msg-center kRPC。下表均为 sync，send 返回受理结果，不创建 Task。

| 命令 | 关键输入 | 级别 | RPC / 状态 |
| --- | --- | --- | --- |
| `message send` | JSON `msg`、全局幂等键 | write | `msg.post_send`；适配 |
| `message record-get <record-id>` | `--with-object` | read | `msg.get_record`；适配，有记录所有者检查 |
| `message box-list` | `--owner`、`--box`、limit、cursor、state | read | `msg.list_box_by_time`；适配 |
| `message session-list` | `--owner`、limit、cursor | read | `msg.list_sessions`；适配基础查询 |
| `message session-get <session-id>` | `--owner`、limit、cursor、`--with-object` | read | `msg.list_session`；适配，返回时间线页 |
| `message session-status <session-id>` | `--owner` | read | `msg.get_session_state`；补齐 SDK |
| `message session-archive <session-id>` | `--owner` | write | `msg.archive_session`；补齐 SDK |
| `message session-restore <session-id>` | `--owner` | write | `msg.restore_session`；补齐 SDK |
| `message session-delete <session-id>` | `--owner`、确认 | destructive | `msg.delete_session`；补齐 SDK，只删除该 owner 的视图 |
| `message mark-read <record-id>` | 无 | write | `msg.update_record_state`，new_state=READ；适配 |
| `message receipt-set <msg-id>` | `--group`、`--status` | write | `msg.set_read_state`；适配，reader 绑定当前身份 |
| `message receipt-list <msg-id>` | group、limit、offset | read | `msg.list_read_receipts`；补齐可见性校验 |
| `message get <msg-id>` | 无 | read | `msg.get_message`；补齐消息可见性，首批优先 record-get |
| `message delivery-get <delivery-id>` | 无 | read | 规划，缺独立查询接口 |
| `message retry <delivery-id>` | 幂等键、重试条件 | write | 规划，缺用户级重新排队接口 |

`--owner` 是所查询投影的 DID，不是身份切换参数；服务端必须验证调用者可访问它。
receipt-set 使用实际 wire 枚举 `UNREAD/READING/READED/ACCEPTED/REJECTED/QUARANTINED`；
其中 READED 是现有协议拼写，与 record 的 READ 状态不是同一协议。
session-get 保留原命令名，但明确其输出是消息页；会话自身状态通过 session-status 查询。

## 3. 发送与幂等

目标输入为 `{ "msg": <MsgObject> }`；实现时以 Rust MsgObject 定义生成严格 schema，
不能把目前 SDK 的任意 JsonObject 透传当作验收完成。秘密和本地文件路径不得塞进未知字段。
全局 `--idempotency-key` 映射到 post_send 的 idempotency_key，网络重试复用同一个键。

输出保留 `ok/msg_id/deliveries/reason`，每个 delivery 保留 ID、transport、target DID。
`ok=true` 表示服务接受，不是全部送达。不能把 delivery_id 当作 `task_id`，也不承诺 `--wait` 等到对端已读。
当前已按 owner/键记录幂等结果；“同键不同请求必然报冲突”还需服务端内容摘要检查，CLI 不能自行保证。

## 4. 只读查询与状态修改

`msg.get_next`、`msg.get_next_delivery` 是领取接口，会修改队列状态；不得用于 box-list、delivery-get、轮询或健康检查。
`msg.dispatch`、`msg.report_delivery` 属于入站/worker 协议，不能分别包装成用户发送或重试。

box_kind 使用现有 `INBOX/SENT/GROUP_INBOX/REQUEST_BOX`，不要发不存在的 outbox 字符串。
box 分页透传 `(cursor_sort_key, cursor_record_id)`；session-list 使用
`(cursor_updated_at_ms, cursor_session_id)`。CLI 的单个 cursor 可版本化封装完整元组和查询范围，
切换 owner/filter 后拒绝复用；不能把一个时间戳当唯一游标。session-get 同样使用 sort_key/record_id 元组，
但 cursor 必须绑定 session_id，不能与 box-list 混用。

Rust 新增的会话 lifecycle/order_by 与状态字段需同步 SDK 后才开放选项。
会话删除是当前用户投影的删除水位，不销毁 MsgObject、不替其它成员删除历史。
mark-read 只改记录状态；Group 回执通过单独 receipt-set 写入，不能以 msg_id 代替 record_id。

## 5. 权限门槛

post_send 和部分 record/owner 查询已有身份校验，但 legacy 无 token 调用路径以及
get_message/list_read_receipts 的可见性检查不能当作外部用户安全接口。
CLI 始终携带有效 session；外部服务入口也必须拒绝匿名私有查询，并把 from、owner、reader 绑定到 principal/委托。
完成消息成员/记录可见性验证前不开放全局 get 和 receipt-list。消息正文与外部账号标识不得写入通用审计日志。

## 6. 实现依据与验收

- [SDK MsgCenterClient](../../src/msg_center_client.ts)。
- [Rust 协议与分页模型](../../../buckyos/src/kernel/buckyos-api/src/msg_center_client.rs)。
- [服务实现与授权](../../../buckyos/src/frame/msg_center/src/msg_center.rs)。

验收覆盖同一幂等键避免重复发送、from/owner 越权拒绝、查询不领取队列、同时间戳跨页、
部分投递失败、记录已读与 Group receipt 区分、会话删除不删除对象。
未有用户级 delivery-get/retry 时明确 unsupported，不能调用 worker 接口代替。
