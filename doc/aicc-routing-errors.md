# AICC 路由错误

`no_candidate_model` 表示逻辑目录没有可达候选，或模型不满足请求能力；检查 Zone 的 Provider 模型清单和能力配置。`resource_not_permitted` 表示有候选但当前调用者没有授权；检查调用身份和模型授权。

kRPC 的结构化 `code` 保留这一区分。xllm 将两者作为 `refused { code }`，保留不同的恢复提示并终止本次执行，等待配置修正后重新发起；不会把它们视为瞬时错误自动重试。

动态登录凭证在 Provider 侧提前失效时，AICC 仅在认证失败且无 usage 的情况下，对同一 Provider、同一模型重新登录并重试一次。API Key 不自动重登。该恢复过程不选择其他模型或 Provider。
