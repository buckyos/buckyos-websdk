# Storage 模块需求

> 状态：Planned，经 2026-09-17 实现核对；CLI 未注册，领域服务尚未完成。对应 module：`storage`。
> 共同约束见 [Review 总览](README.md)。

## 1. 目标与实际边界

管理节点的语义路径、存储根、容量以及受控 Host 目录 mount。
文件 CRUD 属于 [Files](files.md)，NamedData 持有属于 [Object](object.md)。
当前 NFS 导出路径、buckyos-kit 本地路径函数和 Control Panel 磁盘指标都可参考，
但它们不是远程节点的存储 inventory 或 mount 管理服务。Control Panel 的 storage_mgr 仍为占位。

## 2. 资源模型

- semantic path：system/user/app/data/cache/log，结果包含目标 node、owner/app instance、逻辑路径及权限允许显示的 resolved path。
- root：稳定 root_id、所属 node、容量/可用空间、观测时间、健康和未知项；不能从路径字符串推断物理设备。
- host_resource：由 Host helper 登记和授权的资源 ID；用户选择的本机目录先转换成有范围与期限的引用。
- mount spec：node_id、host_resource_id、逻辑 target、read_only、owner、persistence、revision。
- observed mount 与 desired spec 分开，列出依赖的 App/Service 与收敛状态。

CLI 路径、容器路径、Host 路径不能混用；远程命令不得将调用者 `./data` 解释为目标 Host 上同名目录。

## 3. 规划命令

以下命令均需正式服务契约后注册；参数是目标设计，不对应当前已存在 RPC。

| 命令 | 关键输入 | 级别 / 模式 |
| --- | --- | --- |
| `storage path-list` | 必填 `--node`，可选 owner/app-instance | read / sync |
| `storage root-list` | 必填 `--node`、分页 | read / sync |
| `storage status` | 必填 `--node`，可选 root-id | read / sync |
| `storage mount-list` | 必填 `--node`、分页/filter | read / sync |
| `storage dry-run` | `--operation mount/unmount`、`--node`、JSON spec | privileged / sync |
| `storage apply <operation-id>` | `--expected-revision`、幂等键、确认 | operation-defined / task |

mount spec 的 read_only 默认 true，read-write 必须显式声明。
unmount 输入稳定 mount_id 和预期配置版本，不通过字符串路径猜测要卸载的挂载点。
不同 operation 的风险来自服务：mount 至少 privileged；可能中断业务的 unmount 为 destructive。

## 4. dry-run/apply 契约

dry-run 只检查资源授权、目标节点、路径规范化/符号链接、平台支持、目标冲突、占用者、持久化策略和受影响服务。
它可以保存计划记录，但不 mount、不修改运行配置、不 drain。
输出 operation_id/revision、规范化 spec、target node、风险、影响清单、expires_at 与所需确认。

apply 由服务端重新校验资源引用、权限、operation/revision 和环境前提，绑定幂等键并提交持久任务。
operation 过期或目标状态变化时冲突退出，不能重新读取配置后默默执行新的计划。
需要排空时由 scheduler/node 控制面负责，CLI 不循环停止各个容器。
失败分别记录 desired 更新、Host 实际动作和回滚结果，不能只用 shell exit code 表示整体完成。

## 5. 服务与平台前置条件

确定 mount spec 的唯一配置所有者、scheduler/node-daemon 收敛协议、Host bridge API 和任务执行者。
既有 ToolHost 不能代替此桥；Jarvis/paios 容器不能直接执行 Host mount。
Host helper 对资源 allowlist、symlink 解析、目标根限制和调用者授权作最终检查；CLI 只做输入校验。

Linux/macOS/Windows 可共享 spec，但必须返回真实平台能力；未实现时明确 unsupported，不能降级为任意 shell。
容量状态可复用受认证指标采集，但需标明 node 和观测时间，不能把 Control Panel 当前主机磁盘当作所有节点存储。

## 6. 实现依据与验收

- [StorageMgr 占位](../../../buckyos/src/frame/control_panel/src/storage_mgr.rs)。
- [NFS 实际导出边界](../../../buckyos/src/frame/nfs_server/README.md)。
- [System 的 Host 控制依赖](system.md)。

验收覆盖显式 node、CLI/Host 路径区分、默认只读、资源越权/过期、symlink 越界、mount 冲突、
使用中的 unmount、dry-run 无运行副作用、apply 幂等与失败恢复、跨平台 capability。
没有真实 Host helper 与收敛服务时，不开放“可执行”的 mount 命令。
