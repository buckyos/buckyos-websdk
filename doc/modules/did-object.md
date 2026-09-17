# DID / DID Object 模块需求

> 状态：Draft，经 2026-09-17 实现核对；CLI 未注册。对应 modules：`did`、`did-object`。
> 命令状态与共同约束见 [Review 总览](README.md)。

## 1. 目标与已有基础

查询 DID 发布状态与文档，验证候选文档，并读取/调用 DID Object Protocol 声明的能力。
密钥生成、私钥导出、钱包交易与签名托管不属于普通查询命令；不可变对象内容见 [Object](object.md)。

Rust name-client 已有可信解析/验证体系和 DIDObjectClient；cyfs-gateway 的 BNS 服务已有
`GET /1.0/identifiers/{did}` HTTP resolver，不能根据旧文档将它视为尚未实现。
WebSDK 的 sdk_core.resolve_did 依赖浏览器 BuckyApi，不能直接用于 Node/Deno CLI；
namelib 中 JWT decode/单次 EdDSA 验签也不等于完整 DID 发布状态验证。

## 2. 状态模型

必须分开输出以下维度，不能把它们混成单个 status：

- document_status：Active/Missing/Revoked/Expired/Migrated/Tombstoned 等权威发布状态。
- evidence：Anchored/NeedProof/UnproofInfo，表示取回信道和文档类型对应的证据要求。
- verification_status：Passed/Failed/Unavailable/NotAttempted，是现有缓存 lazy verify 的结果；
  新鲜解析路径可能没有该字段，不能把 null 当作验证失败或自行补成 Passed。
- did/doc_type、owner、authority、source、cache/freshness、文档 hash、document_version、authority_seq。
- DID Object 的 Card/Profile、property/action schema、可信端点绑定及 invocation 结果。

Active 不等于完整信任链验证通过；NeedProof 不是“已经验签”，也不是发布状态。
网络失败不等于 Missing；Revoked/Tombstoned 不能被缓存中的旧文档覆盖。
当前 name-client document_version 使用文档 iat 语义，authority_seq 是另一个序列；
不能把 BNS 底层记录版本、文档时间和 Content sequence 混为一个 revision。

## 3. 命令与参数

| 命令 | 关键输入 | 级别 / 模式 | 实现状态 |
| --- | --- | --- | --- |
| `did resolve <did>` | `--doc-type`、可选明确 `--resolver <url>` | read / sync | 补齐 TS 可信解析适配；返回摘要与状态 |
| `did get <did>` | 与 resolve 相同 | read / sync | 同一解析链，增加完整文档，不另走无验证捷径 |
| `did verify <did>` | JSON candidate、doc_type、可选 `--offline` | read / sync | 补齐候选文档验证与输出模型 |
| `did-object describe <object-url>` | 无 | read / sync | 补齐 DIDObjectClient TS facade 与身份/端点验证 |
| `did-object read <object-url>` | `--property <name>` | read / sync | 校验 Profile 后按 property form 读取 |
| `did-object action <object-url>` | `--action <name>`、JSON params | 待可信动作策略决定 / sync 或领域异步 | 保留设计，策略执行器完成前不注册通用 action |

公开 DID resolver 是网络访问，不要求先登录 Zone；显式声明 networkAccess=true、requiresSession=false。
resolver 参数仅控制 DID 解析服务，不重新解释全局 kRPC endpoint，也不向公共 resolver 发送 Zone token。
首次支持范围应明确为已实现的 DID method/doc_type，未知方法返回 unsupported，不能任意 HTTP fallback。

## 4. 解析与验证契约

HTTP resolver 可作为已实现的传输入口，但 HTTP 200/远端自报 verified 不足以替代本地信任策略。
适配器需校验响应 DID/doc_type、authority/owner 与来源绑定，复用或桥接 Rust 验证规则，
保留 document_status、验证失败、网络未知和证据不足各自原因。缓存带来源/有效期和撤销语义。

verify 的 candidate 身份必须与位置参数 DID 一致。在线模式还检查发布状态、版本/hash 与授权链；
offline 模式只在已提供可信 key/证据范围内验签和检查结构/有效期，输出 signature_verified、
authority_checked、freshness_checked 等独立结果，不能声称已经证明“当前未撤销且为最新发布”。
候选文档里自带一个能验签的 key 不自动成为可信 owner。

默认输出稳定摘要；get 可返回文档原文，但不返回签名私钥或认证 token。
需要证明的候选必须实际通过验证；过期、撤销或无法查询权威源不能因 --yes 或非交互模式被忽略。

## 5. DID Object 动作边界

Rust DIDObjectClient 已覆盖 Card/Profile 读取、结构校验、property 和 action invocation，
比仅引用 Agent dev tool 更适合作为协议依据。但结构 validate 不等于对象身份、发布归属或端点信任已得到证明。
读取和调用前需完成这些验证，再根据 Profile form、输入 schema、响应 schema 构造请求。

原方案把全部 action 固定为 write 不合理：动作可能只读、删除资源、提升权限或产生费用。
当前 CLI AccessPolicy 只支持固定级别和预演 operation，不能直接承载任意远端 action 的风险策略。
首批可针对可信 action 注册固定 schema/级别的命令；通用 action 需先增加可信策略解析与执行检查，
风险未知或无法验证时拒绝调用。不能仅相信远端 Profile 自报低风险，也不能用 --yes 绕过领域授权/支付同意。

凭证必须绑定目标 audience/origin，任意 object-url 或 HTTP 跳转不能获得 Zone session token。
禁止下载远端脚本执行，禁止把 dev route 的 file/http fallback 引入生产默认路径。
返回领域 invocation ID/status 时原样说明；只有显式桥接到 TaskMgr 才返回 task_id，不能承诺所有异步动作都可 task wait/cancel。

## 6. 实现依据与验收

- [SDK 浏览器解析入口](../../src/sdk_core.ts)、[JWT 基础函数](../../src/namelib.ts)。
- [Rust 发布/验证模型](../../../buckyos-base/src/name-client/src/provider.rs)、[DIDObjectClient](../../../buckyos-base/src/name-client/src/did_obj_client.rs)。
- [Card/Profile 定义](../../../buckyos-base/src/name-lib/src/did_object_card.rs)。
- [HTTP resolver 运行实现](../../../cyfs-gateway/src/components/bns-server/src/lib.rs)。

覆盖 Node/Deno 无浏览器环境、公开查询无 session、未签名或错误 owner 文档、撤销状态覆盖旧缓存、
网络失败与 Missing 区分、offline 验签局限、版本轴不混用、恶意跳转不泄露凭证、未知 action 风险拒绝。
TS 可信解析/动作策略与异步任务桥接是剩余依赖，不能因为 Rust 有方法就将 CLI 标为可用。
