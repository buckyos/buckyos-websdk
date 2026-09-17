# Object 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 module：`object`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与边界

读取、校验、导入/导出不可变 NamedObject 与内容，并管理 Repo 记录。
可变文件树见 [Files](files.md)，人类可读名字发布见 [Content](content.md)，Host 路径见 [Storage](storage.md)，
一致性备份见 [Backup](backup.md)。对象复制或 Repo pinned 状态不能代替系统备份。

## 2. 分清三个层次

1. **字节与对象存储**：NDM proxy/NamedStore 的读取、上传、对象存在性和 chunk 状态。
2. **Repo 记账**：content_meta、collect、store、pin、proof 等业务记录。
3. **服务可用性**：哪些完整内容可以从哪个可信端点获取；需实际证据，不能从 collected/pinned 推断已复制或公开。

ObjId/ChunkId、Repo content_id 与已解析的元数据必须核对。
引用使用与 NFSP 一致的 object Ref `{type: "object", obj_id, inner_path?}`；live Ref 不表示不可变快照。
Repo pin 与 NDM GC pin 的 owner/scope/ttl 不是同一套状态，首版命令只暴露明确的 Repo 语义。

## 3. 命令与映射

| 命令 | 关键输入 | 级别 / 模式 | 真实映射 / 状态 |
| --- | --- | --- | --- |
| `object ingest <path>` | 首版 store 模式，文件类型/元数据 schema | write / stream | NDM 上传；补齐文件封装与流式适配 |
| `object stat <obj-id>` | 无 | read / sync | NDM queryObjectById/queryChunkState；适配 |
| `object inspect <obj-id>` | 无 | read / sync | NDM getObject + 已知类型解码；适配 |
| `object verify <obj-id>` | 校验范围 | read / stream | NDM 读取 + hash/结构校验；适配 |
| `object read <obj-id>` | `--path <output-file>`、可选 range | read / stream | NDM reader；适配，首版显式落盘 |
| `object export <obj-id>` | `--path <output-file>` | read / stream | 完整读取、校验并原子落盘；补齐传输 facade |
| `object list` | status/origin/content_name/owner_did filter | read / sync | Repo.list；补齐分页与权限后发布 |
| `object collect <obj-id>` | JSON content_meta、可选 referral_proof | write / sync | Repo.collect；适配，核对元数据产生的 ID |
| `object pin <obj-id>` | JSON download_proof | write / sync | Repo.pin；适配，不执行下载 |
| `object unpin <obj-id>` | 可选 `--force`，本地 origin 需确认 | write / sync | Repo.unpin；适配 |
| `object uncollect <obj-id>` | 可选 `--force`、确认 | destructive / sync | Repo.uncollect；适配 |
| `object resolve <name>` | 无 | read / sync | Repo.resolve；适配，返回候选 ObjId 列表 |
| `object announce <obj-id>` | 正式宣告范围/证明待定义 | write / sync | 规划，当前仅写本地队列，BNS 未打通 |

export 的访问级别描述远端只读，仍需显式本地写文件权限。read 可范围读取，export 必须获得并校验完整内容；
首版均仅单个文件，目录树 materialize 另行定义，不能在未知结构下猜测文件路径。
二进制 raw stdout 完成共享输出层扩展后再开放，不把字节转字符串输出。

## 4. 写入与 pin 的实际语义

Repo.store(content_id) 验证内容已经在底层可用，并登记/持有记录；它不接收调用者本地 path，不能代替上传。
ingest 必须先完成 NDM 字节/对象写入并验证 ID，再按明确的登记策略调用 Repo.store。
任一步失败要分别返回 bytes_written、repo_recorded 等真实阶段，不能报告整体成功或盲目从头重试。
进度为本地流式进度；没有后端 Task 的传输不伪造 task_id，也不承诺 CLI 退出后继续上传。

collect 输入是完整 content_meta，而不是仅一个 ObjId；selector 与元数据计算结果不一致时拒绝。
Repo.pin 要求已有记录、内容已可用及 download_proof；当前 pin_record 写的是 Repo 状态，未调用 NDM GC pin。
它不是 fetch，也不承诺复制数量、GC 保留或持久存储 SLA。
如果未来需要“下载并持有”，先定义可恢复的后台传输协议和独立命令，不能悄悄改变 pin 的语义。

unpin 不立即删除 bytes；uncollect 可能同时解除 Repo pin。
现有本地 origin 的保护需 `force=true` 才允许解除，`--force` 是领域保护开关，`--yes` 仅表示确认，二者不能互代。
不得声称 Repo unpin 已同时解除所有 NDM GC pin；报告实际记账与保留状态。

## 5. 查询、权限与可用性

Repo.stat() 不接收 ObjId，返回全库汇总，不能映射 object stat。
Repo.list 当前无 cursor/limit；不能全库扫描查单对象，也不能在 CLI 分页包装。需要列表时先增加真正的服务端分页。
Repo.resolve 是内容名/proof 索引，输出 ObjId 数组，不是 BNS 发布 head 或唯一可信名称归属。

NDM 返回元数据存在、chunk 状态、已存储等证据时分别输出；不能据此猜测 replicated/public。
未知大小、来源或完整性用 unknown 表达。verify 分开 hash、结构和签名结果，缺信任锚时不能报告签名身份可信。

当前 Repo handler 的业务 owner/权限校验仍需与认证 principal 对齐；客户端 owner filter 不是访问控制。
NDM proxy 用于可信 Node/AppClient/Service runtime，CLI 应建立对应认证上下文，不能套用浏览器 BuckyApi 路径。
输出路径属于 CLI 运行环境，默认不覆盖，用临时文件和完整性检查后原子提交。
local-link 涉及远程 Host 路径与可用性，不列入首版 ingest；需受控 Host resource 与 materialize 协议后另行开放。

## 6. 实现依据与验收

- [Repo SDK](../../src/repo_client.ts)、[NDM proxy SDK](../../src/ndm_proxy.ts)。
- [Repo 服务实现](../../../buckyos/src/frame/repo_service/src/service.rs)。

验收必须证明 ingest 实际上传、collect 不承诺存 bytes、pin 不触发下载、stat 不调用全库统计、
未知对象不会被伪造为 JSON、导出 hash 失败不提交最终文件、force 与确认分别生效。
授权、分页、原子导出和后台传输各自验收，不能仅凭已有 SDK 方法把整个模块标为完成。
