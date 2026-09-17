# BNS 模块范围说明

> 状态：Scope deferred，经 2026-09-17 实现核对；此前文档为空，主 PRD 尚未定义独立 `bns` 命令模块。

当前 WebSDK 已有 BnsClient 查询接口，Rust 侧有 BNS 权威状态、HTTP resolver 和交易相关基础。
这些能力不等于应当立即增加一套独立命令。首批只读 DID 解析、发布状态与文档验证收敛到
[DID 模块](did-object.md)，不再提供语义重复的 `bns resolve`。

[Content](content.md) 的内容名/sequence 不等于 BNS DID 名称/authority sequence；
Repo.resolve 的本地内容名索引也不等于 BNS 权威发布。

后续若需要独立 BNS 管理 PRD，应先明确名称归属/委托、权威端选择、文档发布/撤销、交易签名与费用、
幂等键/nonce、确认数/重组和失败查询。BnsTxExecutor 的不同传输/签名路径必须逐项核实，
不能把 SN 代理或尚未完整实现的钱包路径笼统称为本地链上签名已完成。
本轮不增加私钥导出、转账或名称购买命令。

依据：[SDK BNS client](../../src/bns_client.ts)、[DID 设计](did-object.md)、[Review 总览](README.md)。
