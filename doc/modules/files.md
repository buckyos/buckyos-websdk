# Files 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`files`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与当前基础

提供用户可见文件树、View、Collection 的读取、修改和服务端复制。当前已有真实 nfs-server、
NFSP HTTP 接口及 Desktop 的 TS client，不再以“等待真实 DFS backend”为前置条件。
当前服务以原生文件树和 filedb 为真相源，尚未接入 fs_meta；不能宣称已具备完整分布式文件系统能力。

NFSP 入口为 `/nfs/v1`，控制请求 `POST /nfs/v1/{method}`，数据读取和上传有独立 HTTP 路径；
不是 kRPC，也不是 `/kapi/nfs-server`。SDK 应提取 Desktop 的协议 client，避免引用 React、UI cache 或 mock。
[Object](object.md) 管不可变对象，[Storage](storage.md) 管 Host 挂载，[Content](content.md) 管分享。

## 2. 资源、路径与能力

- 首版路径为所选 Zone 的 `cyfs:///...`；带 authority 的跨 Zone URL 和 `device://` 尚无完整路由/授权，明确 unsupported。
- 协议 Ref 复用 NFSP：live 为 `{type, node_id, gen}`，object 为 `{type, obj_id, inner_path?}`。
  服务目前不支持的 object ref 操作按能力拒绝，不因为存在类型定义就宣称支持。
- Node 与 Entry 分开；entry_ref 指容器中的绑定，target ref 指内容。Node 可为 dir/file/symlink/view/collection/group。
  capabilities 中的 list/read/accepts_content/references/remove_semantics/ordered 决定可用动作。
- revision 是 opaque 相等性令牌，目录 revision 在服务重启后变化；不能按数值排序或与 ObjId 当作同一种版本。
  list 的 canonical_path 仅为路径显示，不能代替 Ref 的身份/代际校验。
- View 只读，Collection 保存引用；用户可编辑 metadata 不等于 ACL。

## 3. 命令与输入

全局 JSON `--input` 不承担字节输入。下列路径参数指 CLI 本地文件；不会让远程服务读取调用者路径。

| 命令 | 关键输入 | 级别 / 模式 | NFSP 映射 / 状态 |
| --- | --- | --- | --- |
| `files list <url>` | limit/cursor/order、kind/name_glob filter | read / sync | resolve + list；适配 |
| `files stat <url>` | 无 | read / sync | resolve + stat；适配 |
| `files read <url>` | `--path <output-file>`、可选 range | read / stream | stat + read URL；适配，首版显式落盘 |
| `files write <url>` | `--path <input-file>`、`--expected-revision`、可选 `--overwrite` | destructive / stream | open_write + tus + commit_file；适配 |
| `files mkdir <url>` | `--expected-revision`，作用于 parent | write / sync | mkdir；适配，仅创建一级 |
| `files move <url>` | `--to <url>`、from/to parent revisions | write / sync | move；适配，不支持跨设备时原样报错 |
| `files delete <url>` | `--expected-revision`、可选 `--recursive`、确认 | destructive / sync | delete；适配，仅 native 实体 |
| `files unlink <url>` | `--entry-ref`、parent expected revision | write / sync | unlink / collection_patch.remove_entry；适配，仅移除绑定 |
| `files search <url>` | `--query`、limit/cursor | read / sync | search，name 模式；适配 |
| `files watch <url>` | jsonl 输出 | read / stream | watch SSE；适配，有损通知 |
| `files copy <url>` | `--to <dir-url>`、`--conflict`、幂等键 | write / task | copy_submit；适配，服务端持久任务 |
| `files copy-status <task-id>` | `--after/--limit` | read / sync | copy_get；适配，任务及逐项日志 |
| `files copy-decide <task-id>` | `--item-id`、`--choice`、可选 `--apply-to-same-kind` | write / sync | copy_decide；适配，解决同名冲突 |
| `files copy-retry <task-id>` | 新幂等键 | write / task | copy_submit + retry_of；适配，遵循失败项重试规则 |
| `files copy-cancel <task-id>` | 明确取消请求 | write / sync | copy_cancel；适配，返回已请求而非已回滚 |
| `files acl-get/acl-set <url>` | 待正式 ACL schema | read / write，sync | 规划，两个独立命令，当前无 ACL API |

write 暂固定 destructive，因为允许覆盖；缺省 `overwrite=false`。覆盖必须显式选项、确认和 parent revision，
不能只依赖本地路径是否存在。未来拆分创建/覆盖命令时可分别调整级别，不能由未审查 JSON 隐式提升操作风险。
read 对远端是 read，但会写显式本地输出文件；默认禁止覆盖，使用临时文件和成功后的原子提交。

```bash
buckyos --profile production files list cyfs:///home/alice/ --limit 50
buckyos --profile production files read cyfs:///home/alice/report.pdf --path ./report.pdf
buckyos --profile production --idempotency-key copy-001 files copy cyfs:///home/alice/report.pdf --to cyfs:///home/alice/archive/ --conflict keep-both
```

## 4. 上传、删除、分页和通知

上传链路保留 open_write 返回的 upload_url、fb_handle、lease_id/seq；tus HEAD/PATCH 续传后由
commit_file 原子提交到 parent/name。租约和上传句柄不是 Task。probe 只是优化；NEED_PULL 时退回真实上传，
不能以 hash 命中猜测数据已提交。中断/租约失效需重新查询或重新开始，不能自动覆盖冲突文件。

delete 明确销毁 native 实体；默认不递归。若选择的是 reference/member，提示使用 unlink，禁止按位置静默更换语义。
unlink 必须携带容器内 entry_ref，Collection 使用 remove_entry；不能把 target ObjId 当作待删除 entry。
move/delete/mkdir/commit 均提交正确 parent 的 revision，冲突返回最新状态供调用者重新决策，不自动读取新版后强写。

list 透传 next_cursor、truncated、revision_changed、watch_token。revision_changed 时保留已返回页并报告遍历已过期，
要求重新开始；不得把跨 revision 的页合并为一致快照。按 hello limits 限制请求，不拉全量后排序。
search 仅支持 name，不宣称语义搜索。read 支持 Range/弱 ETag，不标为 immutable；二进制 raw stdout 需先完成共享输出层扩展。

watch 首事件和断线重连可能为 resync；收到后重新 list 建立基线，不承诺补发历史。
事件走 JSONL、进度走 stderr；错误/结束遵循统一流式输出契约，不能混入表格或普通日志。

## 5. 复制任务的真实边界

提交前调用 copy_capabilities，确认平台、TaskMgr 的 `nfs.copy/v1` schema 和认证能力。
首版为同一服务导出范围内的复制，不宣称跨 Zone/跨设备复制；现有平台支持以服务返回为准。
CLI 通过 stat 返回的 copy_ref 构造 sources，source_path 仅展示；批量 JSON 输入遵循现有 1–256 个 sources 限制。

conflict 使用现有 `ask/keep-both/skip/cancel`，没有 overwrite 选项。
非交互缺省 cancel；ask 必须显式选择，并允许后续 copy-decide 解决等待中的任务。
copy-decide 的 choice 限定 `keep-both/skip/cancel`；不允许用 ask 将等待中的冲突再次变成未决。
`--apply-to-same-kind` 对应 apply，仅影响同类冲突，不能表述为覆盖全部文件。

幂等键映射到 copy_submit；相同键不同输入返回冲突。copy-retry 使用 retry_of，保留原任务不变，
目标/源和可重试状态由服务校验，不用通用 `task retry` 冒充已有 domain handler。
默认通过 TaskMgr 等待，copy_get 补充 after/limit 的逐项日志；支持统一等待层后再开放全局 `--no-wait`。
Ctrl-C/超时只停止本地等待，不照搬 Desktop 中 abort 自动 cancel 的 UI 行为。
copy-cancel 可能保留已完成项，返回真实任务/逐项状态，不能宣称事务回滚。

## 6. 身份与发布门槛

目前 copy_* 已验证实际用户 Bearer token；其余 NFSP 方法尚未完整接入 SSO/cap。
hello 返回的随机 session 是协议会话，不是 Verify Hub principal。SDK 始终发送目标 Zone 的正确凭证，
服务端完成逐请求身份、导出范围和文件/容器权限检查后，才能发布面向多用户的普通文件 CLI。
CLI 的路径校验和 capability 检查不能代替这一服务端修复。

上传/下载 URL 必须限制到可信服务源，跨源跳转不得转发 Zone token。
symlink、导出边界及 reference 解析均由服务安全校验；容器内 CLI 无权自动浏览/挂载 Host 文件系统。
ACL 不得用 get_meta/set_meta 模拟；grant/revoke 已落库但尚无数据面 cap 放行，分享门槛见 [Content](content.md)。

## 7. 实现依据与验收

- [nfs-server README 与覆盖表](../../../buckyos/src/frame/nfs_server/README.md)、[复制产品协议](../../../buckyos/product/bucky_file/nfs_server.md)。
- [Desktop NFSP client](../../../buckyos/src/frame/desktop/src/api/nfsp_client.ts)、[真实适配器安装入口](../../../buckyos/src/frame/desktop/src/app/filebrowser/data/install.ts)。
- [复制服务](../../../buckyos/src/frame/nfs_server/src/copy.rs)、[NFSP 协议](../../../cyfs-ndn/doc/NamedFileSystem_Protocol_v0.md)。

验收覆盖跨用户拒绝、导出边界、native/reference 同名冲突、unlink 不删数据、旧 revision 失败、
大目录分页、watch resync、tus 中断/租约过期、旁路修改冲突、复制部分成功/重启恢复/取消/幂等重试。
本轮依据代码确认协议存在，不代表以上生产集成验收已经通过。
