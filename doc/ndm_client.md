# NDM 文件与目录导入

`ndm_client` 是浏览器和 WebSDK 的统一对象导入入口。SDK 负责轻量 QCID 查询、必要的完整哈希、授权内容去重、TUS 传输、FileObject / ChunkList / DirObject 的 canonical 登记和强依赖就绪验证。应用消费就绪 ObjId，业务 retention、消息发送、发布、workspace commit 和目标路径提交由应用负责。

## 已选文件与 picker

```ts
import { ndm } from 'buckyos'

const snapshot = await ndm.importFiles(Array.from(input.files ?? []), {
  mode: 'multi_file', // 一批独立文件；不隐式解释成目录或 ZIP
  endpoint: window.location.origin, // 已 initBuckyOS 时通常可省略
  signal: abortController.signal,
  onProgress: progress => showHashProgress(progress),
})

try {
  const ready = await ndm.ensureUploaded(snapshot.sessionId, {
    signal: abortController.signal,
    onProgress: progress => showUploadProgress(progress),
  })
  // ensureUploaded 只有全部根对象及强依赖 ready 才返回。
  await saveBusinessReference(snapshot.items.map(item => item.objectId))
} finally {
  ndm.releaseImportSession(snapshot.sessionId)
}
```

保留失败重试时不要在 `finally` 中立即释放；持有 session，失败后再次 `ensureUploaded`，完成业务消费或用户放弃后再释放。SDK session 仅保存在当前 JS runtime，刷新后需要重新选择；重新导入会查重，但不声称跨刷新自动恢复。

`pickupAndImport({ mode })` 使用 picker，再进入相同导入路径。可用 `provider` 参数进行单次 picker 注入；已选文件、拖拽、粘贴使用 `importFiles` / `importDirectory`，不修改全局 `setImportProvider`，并行应用不会串文件。`single_file` 必须且仅包含一个文件；`multi_file` 返回独立文件数组。

## 目录与空目录

`importFiles(files, { mode: 'single_dir' })` 要求每个 `File.webkitRelativePath` 包含同一个根目录，并保留根、嵌套目录和相对路径。FileList 无法表示空目录，snapshot 的 `warnings` 明确说明这一限制；空 FileList 产生 `EMPTY_DIRECTORY_UNAVAILABLE`，不能当作成功导入一个空目录。

能够枚举目录节点时，使用树输入保留空目录：

```ts
const snapshot = await ndm.importDirectory({
  kind: 'dir', name: '资料', children: [
    { kind: 'file', file: selectedFile },
    { kind: 'dir', name: '空目录', children: [] },
  ],
}, { signal: abortController.signal })
await ndm.ensureUploaded(snapshot.sessionId)
const dirObjId = snapshot.selection.objectId
```

`ImportDirectoryEntry.children` 接受 `{ kind:'file', file:File }` 或嵌套目录节点。目录根返回 `ImportedDirObject`，`children` 包含文件/目录及各自稳定 ID。相同内容和名称可去重，目录内不同路径仍然保留为两个叶节点；逻辑进度计入每个叶节点。

路径在读取内容或网络请求前验证：拒绝绝对路径、空路径段、`.`、`..`、反斜线、控制字符、盘符、basename 不匹配，以及同目录文件/目录重名。不同目录可以有同名文件。目录不能静默展开成媒体集合或压成 ZIP；这些是显式业务操作。

UI 应用 `ndm.getImportProvider().getCapabilities().canPickDirectory` 判断目录 picker 能力；不支持时保留文件按钮并说明限制。目录拖拽需完整枚举成功后传树，枚举错误必须反馈给用户，不能吞掉后导入部分树。`mixed` 的普通 File[] 是一批文件；实际目录使用显式树输入。

## 状态与生命周期

| 字段 / API | 含义 |
| --- | --- |
| `objectId` | 导入已计算的稳定 ID；不表示服务器可读 |
| `objectStatus` | `pending` → `finalizing` → `ready`；失败为 `failed`，取消为 `cancelled` |
| `materializationStatus` | `ok` 表示已本地计算；`all_in_store` 可表示内容 QCID 命中，不能替代对象 ready |
| `uploadStatus` | `not_started` / `uploading` / `completed` / `not_required` / `failed` / `cancelled`；`completed` 和 `not_required` 都在 finalize 验证后设置 |
| `startUpload(sessionId, options?)` | 后台启动或重试；用查询接口跟踪状态 |
| `ensureUploaded(sessionId, options?)` | 等待同一个后台任务直到所有根对象 ready，失败会抛出原因 |
| `getImportSessionStatus(sessionId)` | 完整状态、summary、error、warnings、逻辑进度 |
| `getUploadProgress(sessionId)` | 逻辑 bytes/objects、`transmittedBytes`（实际发送的内容字节）、状态、错误与警告 |
| `cancelImportSession(sessionId)` | 中止该 session 的请求与 TUS，状态设为 cancelled |
| `releaseImportSession(sessionId)` | 中止未完成任务、移除 registry、释放导入结果上的本地 File 引用 |

`StartUploadOptions` 支持 `endpoint`、`sessionToken`、`fetcher`、`headers`、`concurrency`（正整数，默认 3）、`signal`、`onProgress`。同 session 并发 `ensureUploaded` 等待同一个任务。失败重试复用已传完的 chunk 和 canonical 清单；登记响应丢失不会导致重复字节上传。QCID 查询故障记入 `warnings` 后执行普通哈希，不吞掉 finalize 错误。

`uploadedBytes` 是包含去重内容的逻辑进度，目录重复叶节点仍能达到 100%；`transmittedBytes` 仅统计实际成功发送的 chunk payload，不把去重内容当网络发送量。它不含 HTTP 头和 TUS 重试的重复包。零字节文件与纯空目录的成功由 `objectStatus` 判断。

取消只终止当前任务的临时 TUS 资源；不删除共享对象和别人的引用。Import 的临时 holding 不能替代业务持久 retention。目标路径改变时只需重做下游物化/提交，不需要再次上传。

## 去重、身份和登记契约

1. ≥12 KiB 的文件先读取头部、居中的中部和尾部各 4096 字节，按 ndn-lib canonical 规则计算 QCID，中部偏移为 `floor((size-4096)/2)`。小文件直接哈希；公开 `calculateQcidFromFile` 对小于 12 KiB 的文件使用全量 SHA-256。
2. SDK 查询 `/ndm/v1/objects/lookup?scope=app&quick_hash=...`。只有 `reusable: true`、可用 chunk 状态与匹配长度才复用；全局存在性或 `reusable:false` 不授予复用权。跨 AppInstance 未有相应读取/holding 授权时需要上传内容证明，不能用 owner/admin token 绕过。
3. 有效 QCID 命中跳过完整读取和哈希。未命中按 32 MiB 分块计算，浏览器支持时放在 Worker 中运行。Worker 失败回退；超时和取消会终止 Worker。零字节文件按空 chunk 计算。
4. 启动上传后，逐 chunk 查授权存在性，只发送缺失内容，同 session 中相同 chunk 只传一次。TUS metadata 不携带固定 `app_id:default` 作为身份；网关以验证后的 session/target 授权。
5. SDK 保存一次计算产生的 canonical 清单，按 ChunkList → FileObject → 子 DirObject → 根 DirObject 的依赖顺序调用：

```text
POST /ndm/v1/import/finalize
Authorization: Bearer <当前用户的应用 session>
{
  "objects": [{ "obj_id": "...", "obj_data": "<canonical JSON>" }],
  "roots": ["..."],
  "qcid_links": [{ "qcid": "...", "content_id": "...", "size": 20000 }]
}

{ "ready": true, "roots": [{ "obj_id": "...", "ready": true }], "warnings": [] }
```

应用不读取 `_file` / `_ndnFileObject` 重算 ChunkList 或拼装登记请求。只要总体 ready 不为 true，或某个根未逐项确认 ready，SDK 就不会报成功。重命名和新目录即使命中已有内容，仍登记缺失元数据并验证依赖。

`sessionToken` 缺省从活动 runtime 获取，TUS 每个 chunk 重新获取；显式 `null` 使用 cookies。`headers` 同时传给元数据请求与 TUS，适用于同源业务代理的额外身份头；SDK session 的 Authorization 优先。Node/Deno 在无 XMLHttpRequest 时使用 fetch HTTP adapter，浏览器保留 TUS 默认 HTTP stack，两者复用相同 TUS 传输引擎。请求不自动切换到 AppService/管理员身份。低层 `ndm` 的 structured `/store/*` API 保留原有 runtime 限制；浏览器统一导入通过受认证的 finalize 入口。

## 两种消费结果

- 内容业务：消费 ready 的 `FileObject` / `DirObject` ID，完成业务授权、引用和 retention；SDK 不替应用发送消息或发布记录。
- 文件系统：把 ready ID 传给目标服务，由 NamedStore 本地提取，再做 ACL、revision/lease、命名冲突和路径提交。NFSP 提供 `NfspClient.commitObject(parent, name, objId, options?)`；浏览器不再次 stream copy。目录冲突和部分落盘恢复遵循目标端契约。

## 验证

`tests/ndm_client.test.ts` 覆盖跨 chunk canonical 清单、QCID 命中无完整读、未授权命中必须上传、重复叶节点进度、空目录、路径冲突、finalize 失败/响应丢失重试、取消与释放。`tests/ndm_client_cases.ts` 同时用于 Node 和浏览器 runner。真实上传用例位于 `tests/browser/real-browser/ndm_client_upload.spec.js`；需已部署支持 finalize 的真实 Zone，不能用 mock 通过代替普通用户上传及回读验收。
