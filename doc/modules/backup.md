# Backup 模块需求

> 状态：Planned，经 2026-09-17 实现核对；CLI 未注册，尚无统一 Backup/Restore 服务。对应 module：`backup`。
> 共同约束见 [Review 总览](README.md)。

## 1. 目标与边界

为升级和灾难恢复提供一致性备份、完整性验证、恢复与保留策略。
TaskMgr 与 NamedData 可复用为任务/存储底座，但若干 ObjId 已复制不代表数据库、配置、密钥和 App 数据处于一致恢复点。
服务端拥有备份编排逻辑，CLI 不以 tar/文件遍历模拟系统备份。

## 2. 资源模型

- operation：actor、Zone/node/scope、目标 backup store、规范化 spec、依赖版本、容量、风险、revision、期限。
- backup：backup_id、状态、源系统/组件版本、一致性点、manifest、数据清单/hash、完整性与兼容性报告。
- manifest：包含/排除项、外部依赖、加密算法/KeyRef、所需组件恢复顺序；不含原始密钥、密码、session token。
- restore plan：目标节点/Zone、目标版本、冲突、停机/冻结范围、恢复顺序及失败处理。
- retention policy：保留规则与依赖引用，不能删除仍被升级 gate/增量链/恢复任务依赖的备份。

backup_id、dry-run operation_id、Task ID 分开。备份 status 不能只复制 task.phase。

## 3. 规划命令与输入

这些是待实现的领域契约，不对应现有运行服务。

| 命令 | 关键输入 | 级别 / 模式 |
| --- | --- | --- |
| `backup dry-run` | `--operation create/restore/prune`、JSON spec | privileged / sync |
| `backup apply <operation-id>` | `--expected-revision`、幂等键、确认 | operation-defined / task |
| `backup list` | scope/state/time filter、分页 | read / sync |
| `backup get <backup-id>` | 无 | read / sync |
| `backup verify <backup-id>` | `--level integrity/compatibility` | read / task |

create spec 必须明确 scope、目标存储、加密 KeyRef、包含/排除策略和原因。
restore spec 必须指定 backup_id、恢复目标及冲突/停机策略；prune spec 指明保留规则和候选范围。
不能靠当前目录或 profile 猜测恢复目标。create 风险至少 privileged，restore/prune 为 destructive，
apply 由可信 operation 决定实际等级。verify 只读源备份，允许持久化校验报告和任务状态，不执行恢复或改动业务数据。

## 4. 一致性与任务契约

dry-run 只检查权限、版本、存储容量、KeyRef 可访问性、组件能力和影响范围；不冻结业务、不复制 bytes、不 prune。
输出可审批的规范化 spec、明确不支持/未覆盖项、operation/revision/expiry。
apply 原子检查计划有效性并以幂等键创建持久任务；断线/中断等待不取消远程备份。

create 必须对每个组件执行其一致性协议，例如数据库 checkpoint/snapshot、SQLite WAL 处理、配置与对象清单的一致版本。
冻结、解冻、失败恢复由编排服务处理，不能把读目录成功当作一致性成功。
local-link 数据需 materialize 或明确使该范围备份不完整，并计算目标容量；不能静默跳过。
部分失败保留组件结果和清理状态，backup 不进入 complete；即使任务结束也不能成为可用恢复点。

## 5. 校验、升级 gate 与恢复

integrity 验证 manifest 和所有必要数据/hash/可读性；compatibility 验证组件/版本/目标环境的恢复前置条件。
输出分别标记 checked/passed/failed/unknown，未执行恢复演练时必须保留 `restore_tested=false`。
真正的恢复演练会写隔离环境，应另行设计有副作用的操作，不能藏在 read 级 verify 中。

**升级 gate 是已完成且验证满足策略的备份，不是 dry-run operation。**
System apply 应核对 backup_id、manifest 摘要、一致性范围、校验结果、时间和目标版本/节点覆盖。
只有 pre-upgrade reason 或 Task 成功均不足以通过 gate。

恢复控制面本身时，普通 Zone session/API 可能不可用；需要受控的离线恢复入口、独立可用的身份/KeyRef 和持久恢复日志。
当前没有这条链路，不能宣称灾难恢复已可用，也不能在 API 失败后自动改为本地覆盖系统目录。
解密密钥必须可在目标恢复环境取回；“默认加密”但只有被毁源节点能解密不满足验收。

## 6. 依赖与验收

实现前先确定组件 hook、备份存储协议、KeyRef 生命周期、inventory/manifest schema、
在线/离线 restore orchestrator 及 TaskMgr 的持久恢复边界。

参考 [Object](object.md)、[Storage](storage.md)、[System](system.md) 与 [Task](task.md) 的边界；
截至本次基线，没有可列为已注册服务的统一 backup RPC，不能以文档中的命令名反推服务已存在。

验收覆盖有并发写入的一致性备份、未覆盖组件、local-link materialize、密钥丢失/恢复、
manifest 或数据损坏、不同版本兼容性、prune 依赖保护、服务重启恢复、幂等 apply、控制面不可用的恢复路径。
升级 gate 必须对预演未执行、备份部分成功、校验未完成三种情况全部拒绝。
