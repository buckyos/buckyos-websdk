# Content 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`content`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与资源

Publish 管理 `name -> obj_id`、sequence、历史与上下架；Share 为可变资源授予有限访问权。
Repo 持有/传输属于 [Object](object.md)，可变路径属于 [Files](files.md)。
live path 不是稳定快照，发布需先获得确定的 ObjId；发布名称不自动成为 BNS 名称或 App 安装名。

## 2. 实现现状与服务门槛

ShareContentMgr 文件已有 publish/resolve/history 等 handler，但当前 Control Panel main 未将它挂载为运行服务。
Rust client 的服务名为 `publish-content-mgr`，不能推导出 Control Panel 已接受这些请求。
必须先落实服务注册、路由、存储初始化、鉴权、名字的 owner 命名空间及正式 TS client，再注册发布命令。

NFSP 已有 grant/revoke 和持久化，不再将 Share 全部视为没有协议；但数据面尚未按 cap 校验放行，
也没有完整 share-list/update。不能以“生成了 token”作为分享功能验收通过。
这两条服务依赖分别交付，不能用本地配置文件拼出假发布/分享。

## 3. 命令与协议

下表都是目标命令，publish 侧均受第 2 节运行服务门槛约束；普通调用为 sync，不生成 Task。

| 命令 | 关键输入 | 级别 | 处理逻辑 / 状态 |
| --- | --- | --- | --- |
| `content publish <name>` | `--obj-id`、`--expected-sequence`、JSON policy/config | write | PublishRequest；补齐服务注册/权限 |
| `content resolve <name>` | 可选 `--sequence` | read | resolve / resolve_version；补齐运行入口 |
| `content get <name>` | 无 | read | get_item；补齐运行入口 |
| `content list` | prefix/limit/offset | read | list_items；补齐运行入口 |
| `content history <name>` | limit/offset | read | list_history；补齐运行入口 |
| `content enable <name>` | `--expected-sequence` | write | set_item_enabled；补齐原子 CAS |
| `content disable <name>` | `--expected-sequence`、`--reason` | write | set_item_enabled；补齐原子 CAS |
| `content share-create <resource-url>` | JSON scope/ops/expiry/subject、`--token-file` | write | NFSP grant；补齐数据面授权 |
| `content share-list` | scope/分页 | read | 规划，尚无统一查询接口 |
| `content share-update <share-id>` | JSON policy、expected revision | write | 规划，尚无统一更新接口 |
| `content share-revoke <share-id>` | 明确 resource/Zone、确认 | destructive | NFSP revoke；补齐实际撤销生效链路 |

policy 参数枚举映射已有 `public/token_required/encrypted`；下划线是 wire 值。
这些值描述访问策略，不会自动加密内容。encrypted 发布前必须已经具备密文对象、密钥引用与解密授权方案。
op_device_id 由认证上下文确定，不给普通用户任意覆盖。

## 4. 版本、CAS 与输出

publish 的 expected_sequence 在现有 handler 中可选；目标 CLI 要求明确提供，首次创建使用 0。
现有 enable/disable 会推进 sequence，但没有 expected_sequence 原子检查；必须先扩展服务，
不能先 GET 再 set_item_enabled 冒充 CAS。冲突输出当前 head/sequence，不自动覆盖。

list/history 使用真实 limit/offset，不宣称快照 cursor。现有 resolve/resolve_version 只返回可选 ObjId；
首版 resolve 输出 name、所请求的 sequence（若有）及实际 ObjId，不伪造策略或当前 head 版本。
需要当前 sequence/策略/enabled 时使用 get_item 的同一记录；不能把两次独立 RPC 拼成原子 head 快照。
get 的 availability 只能来自内容查询证据，不能因为名字存在就声称可下载。
Repo announce 当前本地队列也不能作为发布成功的证据。

## 5. Share 权限与生命周期

首版 share-create 只针对 NFSP 可识别的当前 Zone live resource，基于有效 Ref/entry scope，
不接受远端任意 Host path。scope、ops、期限和 subject 以 grant 协议能执行的能力为限；
协议未支持的约束必须拒绝，不静默丢弃。用户通讯录 groups 不是可信授权组。

cap token 是 bearer secret；创建时仅一次写入指定权限受限文件，stdout/日志输出 share-id、期限和摘要。
CLI 不能在分享链接中默认回显完整 token。NFSP 现有 token hash 落库不等于读取请求已验证该 token。
必须验证对象/子树范围、允许操作、过期和撤销后拒绝，才可发布命令。
revoke 只撤销分享，不删除数据；disable 只改变发布项状态，不撤销已被独立复制出去的内容。
share-update 在没有原子协议前不能用 revoke + grant 模拟，因为这会改变凭证且可能部分失败。

## 6. 实现依据与验收

- [发布 handler](../../../buckyos/src/frame/control_panel/src/share_content_mgr.rs)、[Control Panel 注册入口](../../../buckyos/src/frame/control_panel/src/main.rs)。
- [发布协议 client](../../../buckyos/src/kernel/buckyos-api/src/content_mgr_client.rs)。
- [NFSP 分享现状](../../../buckyos/src/frame/nfs_server/README.md)。

先验证运行路由可达和名称 owner 隔离，再验证首次创建/并发更新/上下架 CAS、指定版本查询、
local-only 内容的准确提示、cap 跨范围拒绝/到期/撤销、秘密脱敏。
没有数据面权限测试的 grant、没有实际运行入口的 publish 均不能标 Available。
