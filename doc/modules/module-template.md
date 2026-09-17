# BuckyOS Tool 模块需求模板

> 状态：Draft / Partially implemented / Available / Planned / Deprecated
> 对应 module：`<module>`；核对日期：YYYY-MM-DD。命令状态定义见 [Review 总览](README.md)。

## 1. 目标与边界

说明用户要完成的操作，链接相关领域；明确 CLI、本机运行环境、远程节点与服务端各自责任。
不要以存在库函数/handler 推导运行服务已注册，也不要以 SDK client 存在推导 CLI 已实现。

## 2. 当前实现与发布前置条件

分别列出服务注册/路由、权限、SDK、CLI、真实集成验收状态，链接具体源码和核对版本。
已有实现的限制与目标设计分开写；方法为占位、缺少鉴权/分页/幂等时明确指出。

## 3. 资源模型

稳定 selector、owner、作用域、desired/observed state、版本/revision、权限和秘密。
明确不同 ID 是否可互换，revision 的比较规则，以及 unknown 与 absent 的区别。

## 4. 命令与映射

| 命令 | 必需输入/选择器 | 级别 / 模式 | 实际 RPC 或 transport | 状态/缺口 |
| --- | --- | --- | --- | --- |
| `<module> list` | scope、真实分页参数 | read / sync | 待填写，不猜测服务名 | 适配 / 补齐 / 规划 |

遵循主 PRD 的标准动词、最多一个位置 selector、全局参数在 module 前。
复杂对象走 JSON --input，字节传输走独立文件/流参数。标明枚举、缺省值、互斥项、字段替换/patch 语义。
实现前固化输入/输出 JSON schema；示例说明是目标契约还是当前可执行命令。
所有选项必须实际生效；服务未支持的 expected-revision、分页或幂等参数不能忽略。

## 5. 权限与风险

区分领域 owner/admin、Zone admin、sudo 与 Host 权限。描述服务端 principal/委托校验，不能依赖 CLI 隐藏参数。
标注只读调用是否可能创建 shadow、领取任务或写快照；风险级别按实际副作用确定。
声明 execution/networkAccess/requiresSession，公开网络命令不能因无 session 被视为离线命令。
动态 action 不适用统一 write 标签；operation-defined 仅用于可信服务生成的预演 operation。

## 6. 输出、分页与秘密

明确结构化输出、分页模型、时间单位、未提供字段和部分成功语义。
没有服务端 cursor/total/逐项结果时不能伪造。秘密从隐藏输入或 secret JSON/文件接收，输出/日志/history 均脱敏。
二进制 stdout 需要共享输出层支持；本地输出文件的覆盖、临时写入、完整性与提交策略必须明确。

## 7. 副作用、幂等与任务

写入顺序、原子性、并发条件、幂等范围/冲突和超时后未知结果处理分别说明。
dry-run 不改变运行状态；apply 由服务端核对 actor、scope、spec 摘要、revision、期限与风险，并幂等提交。
只有后端持久任务才返回 Task ID；普通 RPC、上传租约和领域 operation ID 不伪装为 Task。
长任务默认等待，中断只停止等待，显式 cancel 的部分完成影响必须可查询。

## 8. 实现依据

链接真实服务入口、handler、协议 DTO、SDK client 与 CLI 注册点；旧文档与代码冲突时记录实际行为。
源码链接证明实现存在，不等于已通过生产权限/故障恢复验收。

## 9. 验收

- parser/schema 与真实请求字段一致，权限失败与 unsupported 可区分。
- 用户身份/owner/资源范围不可伪造，公开入口不触发多余登录。
- 只读不产生隐含领域写入，版本冲突和超时结果真实。
- 分页、部分成功、秘密脱敏、流式传输/持久任务按实际能力测试。
- 高风险操作的确认、sudo、幂等与审计实际执行，不能只检查命令 metadata。

## 10. 剩余依赖与交付顺序

列出具体服务/SDK/框架缺口、先后关系及可先交付的范围。
未具备后端协议的命令保持规划，不注册占位成功；不要把尚未解决的关键契约留给 CLI 实现者猜测。
