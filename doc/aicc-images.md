# AICC 图片参数

`imagesGenerate` / `helperTextToImage` 接受 `aspect_ratio`、`size`、`quality`、`negative_prompt`、`seed`、`output.media_type`。`imageToImage` 使用相同选项，但尺寸必须在 `output.size`，参考图在 `images`；可另传 `strength`。顶层 `size` 会被拒绝。

```ts
await client.imageToImage({
  exact_model: 'gemini-image@my-provider',
  images: [reference],
  prompt: 'Keep the subject, change the background to a garden',
  aspect_ratio: '16:9',
  seed: 7,
  output: { size: '2K', media_type: 'image/jpeg' },
})
```

比例使用两边为 1–100 的 `W:H`。显式像素尺寸与比例冲突时客户端拒绝发送。1K/2K/4K 是渠道相关档位，不能用于任意模型。

参数不参与模型路由。模型选定后，不支持的字段以结构化 `unsupported_operation` 失败，包含渠道、模型及字段；不会静默删除参数或改换模型。`models.list` 的 `capabilities` 包含 `image.img2img.output.size` 等字段映射声明，具体参数值仍需所选模型支持。

OpenAI/SN 将比例映射为模型支持的像素尺寸；Gemini 将档位和比例写入 `response_format`，不接受专用 `quality` / `negative_prompt`。Qwen 将编辑尺寸转换为 `parameters.size` 的 `W*H` 形式，并映射负面提示词和种子。完整渠道矩阵见 BuckyOS 仓库 `doc/aicc/image_parameters.md`。

SDK `providerErrorFromRpc` 保留 `unsupported_operation` 的 refusal code，AIWorkspace CLI 映射为 `AI_UNSUPPORTED_OPERATION`。请求失败后应修改参数或显式选择适合的模型。
