# System 模块需求

> 状态：Partially implemented，经 2026-09-17 核对。对应 modules：`system`、`node`、`service`。
> 当前仅 CLI `system status` 已注册，其余为目标设计。共同约束见 [Review 总览](README.md)。

## 1. 目标与当前能力

管理 Zone、节点与系统服务的观测、生命周期、维护、升级/回滚。
node-daemon/controller 的生命周期与 workload 生命周期分开；重启 controller 不等于停止所有 App。
cyfs-gateway 专属管理不在本模块内。

首次激活、建立首个 Zone/Owner/OOD 的能力属于 [Provision](provision.md)。该阶段没有可用 Zone session，
以目标安装根目录为 selector；不能要求先执行在线 `system status` 或 `user create`。
Provision 写好启动材料后，由安装器/受控 node 控制入口接管启动，System 再观测运行状态。

当前 system.status 返回 Control Panel 所在主机的指标推导状态、warnings 和服务列表；
服务项 status 可能为 unknown，不能据此宣称已获得每个服务 readiness 或整个 Zone 的一致健康。
版本信息另有 system.overview/system.buckyos_info.get；指标来自 system.metrics。
system.update.check/apply 虽有路由名，但处理函数仍为 unimplemented。

## 2. 资源与作用域

观测结果必须包含 scope、目标 node/Zone、observed_at、来源及 unknown 字段。
实际无法识别目标节点时明确未确认，不把 CLI 所在容器当作被管理主机。
节点使用 node_id；服务使用 service_id 与实例/node 范围；desired、observed、readiness 分开。
升级 operation 包含目标版本、节点顺序、维护策略、备份证据与 rollback point。

## 3. 命令清单

| 命令 | 关键输入 | 级别 / 模式 | 实现状态与边界 |
| --- | --- | --- | --- |
| `system status` | 当前 profile/Zone | read / sync | 已实现基础 RPC 透传；补齐真实 scope，勿承诺聚合健康 |
| `system metrics` | `--lite` | read / sync | 适配 Control Panel `system.metrics`，当前为服务所在主机指标 |
| `system capabilities` | 当前目标 | read / sync | 补齐权威能力发现，不能只列本地注册的命令 |
| `system dry-run` | `--operation update/rollback`、JSON target/spec | privileged / sync | 规划，持久化不可变预演计划，不执行升级 |
| `system apply <operation-id>` | `--expected-revision`、幂等键、确认 | operation-defined / task | 规划，需系统编排服务 |
| `node list` | 分页/filter | read / sync | 补齐正式节点 inventory/观测协议 |
| `node check <node-id>` | `--mode online/blackbox` | read / sync | 补齐在线 API 或受控 host bridge |
| `node start <node-id>` | 明确模式 | privileged / task/either | 补齐 ensure-running 服务/host bridge |
| `node stop <node-id>` | 明确模式、停止范围、确认 | destructive / task/either | 补齐，不能默认连带杀 workloads |
| `node restart <node-id>` | 明确模式、范围、原因 | privileged / task/either | 补齐，遵循 controller 生命周期协议 |
| `node maintenance-set <node-id>` | `--state cordon/drain/uncordon` | privileged / task | 规划，调度/排空编排 |
| `service list` | node/filter/分页 | read / sync | 补齐正式实例清单协议 |
| `service status <service-id>` | 可选明确 instance/node | read / sync | 补齐 desired/observed/readiness 协议 |
| `service restart <service-id>` | instance/node 范围、原因 | privileged / task | 规划，服务策略控制器执行 |

节点 selector 从可选改为必填，避免 CLI 容器与 Host 混淆。blackbox 必须显式选择，
在线认证/连接失败不能自动提升到 Host 控制。若后续提供本地便捷入口，应先解析并显示确定 node_id。
原生同步 helper 可返回同步结果；只有真实持久后端任务才能返回 Task，不能靠 CLI 自建 task_id。

## 4. 生命周期与 Host 边界

已有 Rust node-control 为本机实现基础，不等于 TS HostControlClient 或可远程调用的服务已经存在。
CLI 的 ToolHost 是运行时文件/进程抽象，也不是具备独立认证的 Host 控制桥。
应通过明确 allowlist、目标节点绑定和身份校验的 native helper/bridge 适配，不能在各命令中重写进程扫描/kill/shell。

在线路径使用正式 system/control-panel/node-daemon 协议；blackbox 在控制面故障时仅提供已授权的有限本机动作。
Linux/macOS/Windows 能力由 helper 返回，未实现的平台直接 unsupported。
不能把 Docker container.action 当作通用 service restart；多节点顺序、健康屏障、drain 必须由系统编排服务承担。

## 5. 升级、回滚与输出

dry-run 检查目标发行物、兼容性、节点能力、工作负载和所需备份，不修改运行状态。
预演记录自身可以持久化，但不启动后台安装、不冻结工作负载。
apply 服务端原子校验 operation 的 actor/目标/revision/spec 摘要/期限，绑定幂等键后创建持久任务；
update/rollback 的实际风险等级取自可信 operation，不能接受 CLI 自报低风险。

升级 gate 必须引用已经完成且校验满足策略的 backup_id、manifest 和 verify report，
参见 [Backup](backup.md)；仅存在 dry-run operation 不满足 gate。
rollback point 不是笼统的旧版本号，还需数据兼容性和恢复计划。任务等待中断不取消远端升级。

status/metrics 明确观测来源和时间；局部 metrics 不能回答全 Zone 容量。
服务 unknown 不能自动归为 healthy，空服务列表也不能证明 Zone 无故障。

## 6. 实现依据与验收

- [当前 CLI](../../cli/modules/system.ts)、[Control Panel 路由](../../../buckyos/src/frame/control_panel/src/main.rs)。
- [状态与指标 handler](../../../buckyos/src/frame/control_panel/src/dashboard.rs)。
- [Rust node-control](../../../buckyos/src/kernel/buckyos-api/src/node_control.rs) 的正式桥接入口待确定；
  不得因本地函数存在而标为远程可用。

优先验收 status/metrics 范围与字段真实性；再覆盖节点身份、认证失败不自动 blackbox、
controller/workload 分离、平台 unsupported、预演失效、备份 gate、任务重启恢复与幂等提交。
系统编排服务和 Host bridge 是升级/生命周期发布前置条件，本轮不将其视为已经实现。
