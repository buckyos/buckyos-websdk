# BuckyOS WebSDK: ndm_client 技术需求文档

- 文档状态：Draft for CodeAgent
- 目标读者：CodeAgent / Web SDK 实现者 / NDM Client 维护者
- 本文范围：定义 `pickupAndImport` 及配套 session/upload 查询接口的需求边界、数据模型与状态机

---

## 1. 文档目的

本文基于语音讨论记录，整理出 **BuckyOS WebSDK `ndm_client`** 中一组面向应用开发者的推荐接口，用于统一处理以下问题：

1. 用户在应用中点击“上传/导入”按钮后，如何选择文件或目录。
2. 不同 runtime 对“真实路径”“NDM Cache”“NDM Store”的支持能力不同，应用不应该自己判断和分支。
3. 选择完成后，前端如何立即得到可展示的对象结果，以及可选的缩略图。
4. 在真正开始上传之前，如何以“session”维度查询一次 import 的状态，并显式启动上传。

本文输出的是 **可供 CodeAgent 直接实现的需求文档**，会对录音里的口语化表述做规范化处理，并在必要处补充最小可落地定义。

---

## 2. 背景与问题

### 2.1 runtime 差异

不同 runtime 可能具备完全不同的本地能力：

- **纯 Web / 标准浏览器环境**
  - 通常拿不到文件真实路径。
  - 无法直接访问 NDM Cache。
  - 通常也无法直接写入本机 NDM Store。
  - 快速短路能力主要依赖服务器侧查询，而不是本地文件系统能力。

- **增强型 runtime（桌面壳、原生容器、长期运行环境等）**
  - 可能拿到文件真实路径。
  - 可能能访问 NDM Cache。
  - 甚至可能能直接访问/写入本机 NDM Store。

如果把这些差异全部暴露给应用开发者，让每个应用自己判断：

- 能不能拿到原始路径；
- 能不能使用 NDM Cache；
- 能不能直接走 NDM Store；
- 当前应该走哪个 file opener / importer；

那么应用侧会非常痛苦，接口也会变得不可移植。

### 2.2 设计结论

因此，`ndm_client` 需要提供一个**推荐型统一入口**：

`pickupAndImport`

该接口的职责是：

- 在浏览器/类浏览器应用里，统一替代“点击文件选择按钮后选文件再导入”的基础行为；
- 隐藏 runtime 差异；
- 在返回时即产出“对象化”的结果；
- 用一个 session 来管理这次 import 的后续状态与上传控制。

---

## 3. 术语规范化

由于语音记录中存在口误和 ASR 误识别，本文统一采用以下术语：

| 录音表述 | 规范术语 | 说明 |
|---|---|---|
| longtime | runtime | 指运行时环境 |
| fileopen / fileopenopener | file opener / import provider | 指底层文件选择/导入实现 |
| 梳理图 | 缩略图（thumbnail） | 指本地预览图 |
| allinstall | all_in_store | 语义上表示“全部已进入 Store” |

另外，本文把“对象化”定义为：

> 用户选择完成后，SDK 已经能够为返回的文件/目录生成并返回稳定的 `objectId`，且该过程不依赖实际上传文件字节到服务端完成。

---

## 4. 设计目标

### 4.1 必须达成的目标

1. **统一入口**
   - 应用只调用 `pickupAndImport`，不关心底层 runtime 的差异。

2. **选择完成即对象化**
   - `pickupAndImport` 返回时，结果中的每个对象都必须已经具有 `objectId`。

3. **本地优先**
   - `pickupAndImport` 的主流程是本地流程。
   - 除少量状态查询/去重查询外，不做大量网络上传。
   - 真正的上传由显式 `startUpload(sessionId)` 触发，或由 `autoStartUpload` 自动触发。

4. **支持前端即时展示**
   - 返回结果必须适合前端立刻渲染。
   - 可选支持缩略图生成，避免每个应用各自重复造轮子。

5. **session 级状态管理**
   - 每次 import 都必须生成一个 `sessionId`。
   - 应用可以基于 `sessionId` 查询本次 import 的整体状态和上传进度。

6. **兼容不同能力级别的 runtime**
   - 纯 Web runtime：至少要能选文件并完成对象化。
   - 有 NDM Cache 的 runtime：能表现出 `on_cache` 状态。
   - 有 NDM Store 直写能力的 runtime：能直接进入 `all_in_store`，实现免上传或近似免上传。

### 4.2 非目标（本期不做）

1. **拖拽导入不是本期主目标**
   - `pickupAndImport` 主要面向“点击上传按钮 -> 选择文件/目录”的行为。
   - 拖拽导入后续可设计单独接口，例如 `importByDrop(event, options)`。

2. **不在本期定义完整上传协议**
   - `startUpload` 的服务端协议细节、目标端细节不在本文展开。
   - 但接口必须预留入参扩展位。

3. **不要求 session 跨页面刷新恢复**
   - 本期只要求 session 在当前 JS runtime 生命周期内有效。

---

## 5. 总体设计原则

### 5.1 应用无感知 runtime 差异

应用不应自己判断以下能力：

- 是否能拿到真实路径；
- 是否能访问 NDM Cache；
- 是否能直接访问 NDM Store；
- 当前应选择哪个底层 opener / provider。

这些应由 `ndm_client` 内部处理。

### 5.2 公开 API 面向“导入流程”，底层实现走 provider 机制

对外暴露统一 API；对内允许不同 runtime 注入不同 provider。

### 5.3 session 查询优先于 objectId 查询

系统里原本就存在“基于 objectId 查询 NDM 状态”的标准接口，这些接口继续保留。

但它们**无法很好表达 `on_cache` 这种中间态**，因为从 Store 的视角看，“不在 Store”并不能区分“还没进 Cache”和“已经全部进 Cache”。

因此：

- **导入流程中的状态查询以 `sessionId` 为主**；
- `objectId` 查询接口作为补充，而不是推荐主接口。

---

## 6. 对外 API 需求

### 6.1 `pickupAndImport(options)`

#### 6.1.1 目标

发起一次用户选择 + 本地对象化的 import 流程，并返回：

- `sessionId`
- 对象化后的选择结果
- 该 session 的初始状态快照

#### 6.1.2 推荐 TypeScript 签名

```ts
type ImportMode = 'single_file' | 'multi_file' | 'single_dir' | 'mixed';

type MaterializationStatus = 'ok' | 'on_cache' | 'all_in_store';

type UploadStatus = 'not_started' | 'uploading' | 'completed' | 'failed' | 'not_required';

interface PickupAndImportOptions<TMode extends ImportMode = ImportMode> {
  mode: TMode;

  /**
   * 文件过滤条件，允许 MIME、扩展名或两者混合。
   * 例如：['image/*', '.pdf', '.docx']
   */
  accept?: string[];

  /**
   * 缩略图配置。
   * 不传或 enabled=false 表示不生成。
   */
  thumbnails?: ThumbnailOptions;

  /**
   * 是否在对象化完成后立即自动启动上传。
   * 默认 false。
   */
  autoStartUpload?: boolean;
}

interface ThumbnailOptions {
  enabled?: boolean;

  /**
   * 仅对哪些类型尝试生成缩略图。
   * 例如：['image/*', 'video/*', '.pdf']
   */
  forTypes?: string[];

  /** 默认值由实现决定，建议 256 */
  maxWidth?: number;
  maxHeight?: number;

  /**
   * true: 在 pickupAndImport resolve 前尽量生成完缩略图
   * false: 可以惰性补全，但返回对象中应能追踪其状态
   * 默认 true
   */
  eager?: boolean;
}
```

#### 6.1.3 返回值要求

由于语音讨论中明确要求“返回值受选择模式约束”，建议采用 **wrapper + typed selection** 的形式：

```ts
interface ImportSessionSnapshot<TSelection> {
  sessionId: string;

  /**
   * 按 mode 映射出的主返回值
   */
  selection: TSelection;

  /**
   * 统一归一化后的列表，便于通用 UI 渲染
   */
  items: Array<FileObject | DirObject>;

  materializationStatus: MaterializationStatus;
  uploadStatus: UploadStatus;

  summary: {
    totalObjects: number;
    totalFiles: number;
    totalDirs: number;
    totalBytes: number;
  };
}

type PickupAndImportResult<TMode extends ImportMode> =
  TMode extends 'single_file' ? ImportSessionSnapshot<FileObject> :
  TMode extends 'multi_file' ? ImportSessionSnapshot<FileObject[]> :
  TMode extends 'single_dir' ? ImportSessionSnapshot<DirObject> :
  ImportSessionSnapshot<Array<FileObject | DirObject>>;
```

#### 6.1.4 `selection` 与 `mode` 的映射

| `mode` | `selection` 类型 |
|---|---|
| `single_file` | `FileObject` |
| `multi_file` | `FileObject[]` |
| `single_dir` | `DirObject` |
| `mixed` | `(FileObject \| DirObject)[]` |

#### 6.1.5 兼容性要求

1. `single_file`、`multi_file` 是**所有 runtime 必须优先支持**的基础能力。
2. `single_dir` 在支持目录选择的 runtime 中必须可用；不支持时应返回明确错误。
3. `mixed` 是**能力依赖型模式**：
   - 某些 runtime 可以支持；
   - 标准浏览器文件选择器通常不原生支持“文件和目录同时选”；
   - 对于不支持的 runtime，应明确返回 `MODE_NOT_SUPPORTED_IN_RUNTIME`，而不是做隐式降级。

#### 6.1.6 行为要求

1. 用户取消选择时，Promise 应 reject，并返回可识别错误码 `USER_CANCELLED`。
2. `pickupAndImport` resolve 时，`selection/items` 中的每个对象都必须已有 `objectId`。
3. `pickupAndImport` 主流程中禁止进行大规模字节上传。
4. 如果 `autoStartUpload=true`：
   - SDK 应在对象化完成后自动调用一次 `startUpload(sessionId)`；
   - 返回时可处于 `uploading` 状态。
5. 缩略图生成失败**默认不应导致整个 import 失败**；应按对象记录缩略图不可用。

---

### 6.2 `getImportSessionStatus(sessionId)`

#### 6.2.1 目标

查询一次 import session 的当前整体状态。该接口是推荐的主查询接口。

#### 6.2.2 推荐签名

```ts
interface ImportSessionStatus {
  sessionId: string;
  materializationStatus: MaterializationStatus;
  uploadStatus: UploadStatus;

  summary: {
    totalObjects: number;
    totalFiles: number;
    totalDirs: number;
    totalBytes: number;
  };

  progress: {
    uploadedBytes: number;
    uploadedObjects: number;
    totalBytes: number;
    totalObjects: number;
  };

  /**
   * 细粒度进度为可选项。
   * 录音中明确指出：大多数场景只需要总体进度，不要求每个对象都展示得非常清楚。
   */
  perObjectProgress?: Record<string, {
    objectId: string;
    uploadedBytes: number;
    totalBytes: number;
    state: 'pending' | 'uploading' | 'completed' | 'failed';
  }>;
}

declare function getImportSessionStatus(sessionId: string): Promise<ImportSessionStatus>;
```

#### 6.2.3 行为要求

1. 所有 `pickupAndImport` 创建的 session 都必须能被该接口查询。
2. `SESSION_NOT_FOUND` 必须作为明确错误码返回。
3. 在 `all_in_store` 场景下，`progress` 应体现为已满足可用态：
   - `uploadStatus = 'not_required'` 或 `completed`；
   - 推荐优先使用 `not_required`，语义更清晰。

---

### 6.3 `startUpload(sessionId, options?)`

#### 6.3.1 目标

显式启动该 session 的实际上传流程。

#### 6.3.2 推荐签名

```ts
interface StartUploadOptions {
  /**
   * 为后续扩展预留。
   * 例如：并发度、优先级、目标 service、重试策略等。
   */
  concurrency?: number;
  priority?: 'foreground' | 'background';
  extra?: Record<string, unknown>;
}

declare function startUpload(
  sessionId: string,
  options?: StartUploadOptions
): Promise<ImportSessionStatus>;
```

#### 6.3.3 行为要求

1. 当 `materializationStatus` 为 `ok` 或 `on_cache` 时，`startUpload` 应启动上传。
2. 当 `materializationStatus` 为 `all_in_store` 时，`startUpload` 应为**幂等 no-op 成功**，而不是报错。
3. 调用成功后，应用可继续通过 `getImportSessionStatus` 或 `getUploadProgress` 查询进度。
4. 重复调用 `startUpload` 必须是幂等的：
   - 已在上传中：返回当前状态；
   - 已完成：返回完成状态；
   - 无需上传：返回 `not_required` 状态。

---

### 6.4 `getUploadProgress(sessionId)`

#### 6.4.1 目标

提供一个更聚焦“上传进度”的查询接口，便于 UI 做进度条展示。

#### 6.4.2 推荐签名

```ts
interface UploadProgress {
  sessionId: string;
  uploadStatus: UploadStatus;

  totalBytes: number;
  uploadedBytes: number;
  totalObjects: number;
  uploadedObjects: number;

  /** 可选 */
  speedBps?: number;
  elapsedMs?: number;
  estimatedRemainingMs?: number;

  /** 可选 */
  perObjectProgress?: Record<string, {
    objectId: string;
    uploadedBytes: number;
    totalBytes: number;
    state: 'pending' | 'uploading' | 'completed' | 'failed';
  }>;
}

declare function getUploadProgress(sessionId: string): Promise<UploadProgress>;
```

#### 6.4.3 需求重点

- **聚合进度必须有**：
  - 总字节数
  - 已上传字节数
  - 总对象数
  - 已完成对象数

- **细粒度 per-object 进度可选**：
  - 有更好；
  - 没有也不阻塞本期落地。

---

## 7. 数据模型需求

### 7.1 `FileObject`

```ts
interface BaseImportedObject {
  objectId: string;
  name: string;
  relativePath?: string;

  /**
   * 只有具备真实路径能力的 runtime 才可返回。
   * 纯浏览器环境下通常为 undefined。
   */
  sourcePath?: string;

  /**
   * 供 UI/调试使用，标识该对象当前所在层级。
   */
  locality?: 'local_only' | 'cache' | 'store';
}

interface ThumbnailResult {
  available: boolean;
  url?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  errorCode?: string;
}

interface FileObject extends BaseImportedObject {
  kind: 'file';
  size: number;
  mimeType?: string;
  thumbnail?: ThumbnailResult;
}
```

#### 7.1.1 必须字段

- `objectId`
- `name`
- `kind='file'`
- `size`

#### 7.1.2 可选字段

- `mimeType`
- `relativePath`
- `sourcePath`
- `thumbnail`
- `locality`

---

### 7.2 `DirObject`

```ts
interface DirObject extends BaseImportedObject {
  kind: 'dir';

  /**
   * 目录内容建议支持完整树结构；
   * 若本期实现成本较高，可先支持懒加载，但必须在接口层说明。
   */
  children?: Array<FileObject | DirObject>;
}
```

#### 7.2.1 需求说明

1. 目录对象也必须具有 `objectId`。
2. 目录的层级关系建议保留，以便前端展示目录树。
3. 若底层 runtime 只返回扁平文件列表，也应由 SDK 负责根据 `relativePath` 尽量重建目录结构。

---

## 8. Session 状态模型

### 8.1 物化状态（MaterializationStatus）

录音中明确提出：一次 import 的“导入状态”先只定义三种。

#### 8.1.1 `ok`

语义：

- 本次选择已经完成；
- 对象已经生成，`objectId` 已可用；
- **还没有任何字节进入服务器侧**；
- 也不保证已经进入 NDM Cache / Store。

建议映射到 UI 文案：

- “已选中，待上传”
- “本地就绪”

#### 8.1.2 `on_cache`

语义：

- 本次 import 的所有对象都已经进入 NDM Cache；
- 但尚未全部进入 Store；
- 这种状态多见于具备本地 NDM Cache 的 runtime。

建议映射到 UI 文案：

- “已进入缓存，待正式上传/入库”

#### 8.1.3 `all_in_store`

语义：

- 本次 import 的所有对象都已经进入 NDM Store；
- 对应对象 ID 已可直接被 Store / OOD 侧使用；
- 在具备直写 Store 能力的桌面/原生 runtime 中，可能在选择后直接达到该状态。

建议映射到 UI 文案：

- “已可用，无需上传”
- “已完成导入”

---

### 8.2 上传状态（UploadStatus）

虽然录音里把“导入状态”限定为三种，但为了让实现可用，本期需要一个与之正交的上传状态字段：

| 状态 | 说明 |
|---|---|
| `not_started` | 尚未开始上传 |
| `uploading` | 正在上传 |
| `completed` | 上传流程已结束 |
| `failed` | 上传失败 |
| `not_required` | 当前 session 无需上传（例如已经 `all_in_store`） |

---

### 8.3 推荐状态迁移

```text
pickupAndImport 完成后：
  ok
  on_cache
  all_in_store

其中可能的迁移关系：
  ok -> on_cache -> all_in_store
  ok -> all_in_store
  on_cache -> all_in_store

上传状态独立演进：
  not_started -> uploading -> completed
  not_started -> uploading -> failed
  all_in_store 对应 not_required
```

#### 8.3.1 关键要求

1. `materializationStatus` 和 `uploadStatus` 必须分开表达。
2. 应用做主流程展示时，应优先使用：
   - `materializationStatus` 表示“对象现在在哪里”；
   - `uploadStatus` 表示“上传流程跑到哪一步了”。

---

## 9. 缩略图（Thumbnail）支持需求

### 9.1 设计动机

导入后，前端往往需要立刻展示所选内容；对大文件、图片、视频、PDF 等类型，缩略图生成是重复性很高且容易分散到各个应用里的工作，因此应在 SDK 层提供统一支持。

### 9.2 需求要求

1. 缩略图能力必须通过 `thumbnails` 参数显式控制。
2. 默认应视为**关闭**，避免不必要的额外成本。
3. 支持按类型过滤是否生成缩略图。
4. 对于纯 Web runtime，应优先使用本地 Blob / File 生成预览，不依赖上传完成。
5. 对于具备本地路径或本地媒体能力的 runtime，可使用更高性能路径。
6. 缩略图失败不影响主流程，只影响对应对象的 `thumbnail.available=false`。

---

## 10. runtime 差异下的预期行为

| 能力/场景 | 纯 Web runtime | 有 NDM Cache 的 runtime | 可直写 NDM Store 的 runtime |
|---|---|---|---|
| 能否拿真实路径 | 通常否 | 可选 | 可选 |
| 能否对象化 | 必须支持 | 必须支持 | 必须支持 |
| 是否可进入 Cache | 通常否 | 是 | 可选 |
| 是否可直接入 Store | 通常否 | 通常否 | 是 |
| 初始 `materializationStatus` | 常见为 `ok` | 常见为 `on_cache` 或 `ok` | 可能直接为 `all_in_store` |
| 是否需要 `startUpload` | 通常需要 | 通常需要 | 可能不需要 |
| `sourcePath` | 通常无 | 可选 | 可选 |

### 10.1 关键结论

**应用层无需关心上述表格。**

这些差异由 `ndm_client` 内部 provider 自动选择并消化，对应用只暴露统一行为。

---

## 11. 内部实现要求（给 CodeAgent）

### 11.1 采用 provider / adapter 机制

`ndm_client` 内部建议引入如下抽象：

```ts
interface RuntimeCapabilities {
  canRevealRealPath: boolean;
  canUseNDMCache: boolean;
  canUseNDMStore: boolean;
  canPickDirectory: boolean;
  canPickMixed: boolean;
}

interface ImportProvider {
  getCapabilities(): RuntimeCapabilities;

  pickupAndImport<TMode extends ImportMode>(
    options: PickupAndImportOptions<TMode>
  ): Promise<PickupAndImportResult<TMode>>;

  getImportSessionStatus(sessionId: string): Promise<ImportSessionStatus>;
  startUpload(sessionId: string, options?: StartUploadOptions): Promise<ImportSessionStatus>;
  getUploadProgress(sessionId: string): Promise<UploadProgress>;
}
```

### 11.2 provider 选择策略

建议按能力优先级选择 provider：

1. **Store-direct provider**：可直写 NDM Store。
2. **Cache-backed provider**：可写入 NDM Cache。
3. **Browser-basic provider**：只能走浏览器文件输入和纯本地对象化。

> 注意：这里的“优先级”是实现层概念，不暴露给应用层。

### 11.3 session 存储要求

本期至少需要一个进程内 / 页面内的 session registry：

- key: `sessionId`
- value: session 快照、对象列表、状态、上传上下文

不要求跨页面恢复。

### 11.4 对象化要求

1. `pickupAndImport` 结束时必须拿到 `objectId`。
2. 对象化过程应尽量本地完成。
3. 若需要向服务器做查询，只能是轻量查询，不得上传完整文件字节。

---

## 12. 错误码需求

建议至少定义以下错误码：

| 错误码 | 场景 |
|---|---|
| `USER_CANCELLED` | 用户取消文件选择 |
| `MODE_NOT_SUPPORTED_IN_RUNTIME` | 当前 runtime 不支持所请求的 `mode` |
| `DIRECTORY_NOT_SUPPORTED` | runtime 不支持目录选择 |
| `INVALID_ACCEPT_FILTER` | `accept` 参数非法 |
| `SESSION_NOT_FOUND` | 传入的 `sessionId` 不存在 |
| `UPLOAD_ALREADY_RUNNING` | 可选；若实现选择显式提示 |
| `UPLOAD_FAILED` | 上传失败 |
| `THUMBNAIL_GENERATION_FAILED` | 对象级错误，不应默认导致整体失败 |

> 说明：`UPLOAD_ALREADY_RUNNING` 是否作为独立错误码由实现决定；本期更推荐把 `startUpload` 设计成幂等成功。

---

## 13. 兼容旧有 objectId 查询接口

系统已有的“按 `objectId` 查询 NDM 标准状态”的接口继续保留，适用于：

- 查询对象是否已存在于 Store；
- 查询对象的通用元数据；
- 非 import session 流程下的对象状态检查。

但它不应替代 `sessionId` 查询接口，因为：

1. 它无法自然表达 `on_cache`；
2. 它不适合表达“一次导入任务”的整体状态；
3. 它不适合表达聚合上传进度。

因此，前端导入流程应优先依赖 session API。

---

## 14. MVP 实现范围建议

为了让 CodeAgent 第一轮可落地，建议按以下优先级实现：

### P0

1. `pickupAndImport`（支持 `single_file` / `multi_file`）
2. 返回 `sessionId`
3. 返回对象化的 `FileObject`
4. `getImportSessionStatus`
5. `startUpload`
6. `getUploadProgress`
7. `autoStartUpload`
8. 基础 session registry
9. 聚合上传进度

### P1

1. `single_dir`
2. `DirObject` 树结构重建
3. 缩略图能力
4. `on_cache` 状态支持
5. `not_required` / `all_in_store` 直通能力

### P2

1. `mixed` 模式
2. 更细粒度 `perObjectProgress`
3. 更丰富的 provider 能力探测
4. 后续的拖拽导入接口 `importByDrop`

---

## 15. 验收标准

### 15.1 基础选择与对象化

1. 在纯浏览器环境中调用 `pickupAndImport({ mode: 'single_file' })`：
   - 用户选中文件后返回成功；
   - 返回值带 `sessionId`；
   - `selection.objectId` 存在；
   - `materializationStatus='ok'`；
   - `uploadStatus='not_started'`。

2. 在纯浏览器环境中调用 `pickupAndImport({ mode: 'multi_file' })`：
   - 返回 `FileObject[]`；
   - `items` 与 `selection` 数量一致；
   - 未发生大规模上传。

### 15.2 上传控制

3. 对 `ok` 状态的 session 调用 `startUpload(sessionId)`：
   - 上传开始；
   - `getUploadProgress` 中 `uploadedBytes` 单调增加；
   - 完成后 `uploadStatus='completed'`。

4. 对已 `all_in_store` 的 session 调用 `startUpload(sessionId)`：
   - 不报错；
   - 返回 `uploadStatus='not_required'` 或等价完成态。

### 15.3 缩略图

5. 开启 `thumbnails.enabled=true` 导入图片文件：
   - `thumbnail.available=true`；
   - 前端可直接使用返回的 `url` 预览。

6. 缩略图生成失败：
   - 整个 import 不失败；
   - 仅该对象 `thumbnail.available=false`。

### 15.4 异常场景

7. 用户取消选择：
   - Promise reject；
   - 错误码为 `USER_CANCELLED`。

8. runtime 不支持目录，但调用 `single_dir`：
   - 返回 `DIRECTORY_NOT_SUPPORTED` 或 `MODE_NOT_SUPPORTED_IN_RUNTIME`。

---

## 16. 推荐公开接口清单（最终建议）

```ts
declare function pickupAndImport<TMode extends ImportMode>(
  options: PickupAndImportOptions<TMode>
): Promise<PickupAndImportResult<TMode>>;

declare function getImportSessionStatus(
  sessionId: string
): Promise<ImportSessionStatus>;

declare function startUpload(
  sessionId: string,
  options?: StartUploadOptions
): Promise<ImportSessionStatus>;

declare function getUploadProgress(
  sessionId: string
): Promise<UploadProgress>;
```

---

## 17. 一句话结论

`pickupAndImport` 要解决的核心不是“再包一层文件选择器”，而是：

> **在不同 runtime 能力差异巨大的前提下，为 Web SDK 提供一个统一的、对象化的、可预览的、可 session 化管理的导入入口。**

这也是 `ndm_client` 需要对应用屏蔽的复杂性边界。

## 附录 语音原文
----
我用语音说一下这个Web SDK里的这个pickup and import这个接口的这个设计,我用语音说,然后你这个帮我记录就好。

根据之前的讨论得出了一个结论,就是我们是有机会在不同的longtime里面去使用不同的这个这个这个fileopen这个fileopenopener,也就是说标准的web环境下,因为拿不到这个这个文件的这个真实路径嘛,对吧?所以说我们能用的这个快速的短路接口,这个这只能是靠服务器的查询,然后另一个呢就是说我们在纯web情况下其实我们也是缺乏这个就是说也是没有也是缺乏这个访问这个NDMcache的能力的对吧,那如果说我们我们去把这个区分不同的longtime,对吧,怎么去判断呃人能能够拿到文件的原始原始路径,包括能不能使用这个NDMcache,甚至说能不能用到本机的这个NDMstore这种接口全部都让每个应用自己去做的话,它就会变得非常的痛苦,对吧,所以说我们在这里呃,我们根据我们的这个实际情况啊,我们就抽象出一个我们的推荐给SDK用户的一个接口,就叫做pickupandimportimport,就是它讲的就是在浏览器里面就解决了解决了一个最基本的一个问题,就是在呃传统的这个这个weblike的这个runtime里面呃怎么样去呃就是说当用户有有这个把文件上传到它的这个APPservice的时候,我们提供的是一组什么样的一个基础设施。

这个接口接口的这个参数很纯粹啊,它其实是一个它的参考它的参数主要是过滤器,对吧,就是换句话讲,它就是说因为毕竟毕竟这个不同的应用能够能够处理的文件类型是不一样的嘛,所以第一个就是首先当然说这个过滤器的首先第一个是它是支持单文件还是多文件,是不是支持目录,对吧,是不是说我可以我能处理目录,这个这个我要我就换句话讲,它决定了这个返回值是什么,就说如果说返回值呃我们我们有有几种返回值哈,就是说第一种返回值是单个的fileobject,然后第二个就是一个fileobject的list,然后第三个就是一个dirobject了,第四个是一个一个dirobject和一组就说是一个dirobject的和这个fileobject的一个混合列表哈。对,所以说这个这是我们就是说说应用得根据自己它能支持什么样的这个东西,对吧?东东西去去决定呃自己调这个接口,对。当然说呃目前来看的话,这个接口其实对于这个拖拽是不好支持的。对,毕竟呃我们我们其实要的是用户在点击上传的时候不调不调原来那个牛就不调这个嘛,拖拽拖拽的话好像不是那么好触发,对吧,但我们也可以说说是说通过这个这个就算我拖拽的时候,我把那个拖拽的那个event也也扔到这个这个这个接口里面去,就但是另一个接口啊,这可能就是呃不是pickup的input的了,是这个是这个这个import的bybyby吧,对吧,可能是这样的一个接口哈对吧,所以说这个这个我们先专注于去替代这个按一个文件打开按钮去选文件这样的一个行为吧,就拖拽我们配在这个结果实际好的基础状态去做,对吧,然后呢,这是它的这个接口定义哈,就是说其实我们定义接口的时候,也把返回值给基本定下来了。然后第二个什么呢?第二个就是呃它的参数它的第二个这个输入参数的话是呃对于梳理图的支持,就是说换句话讲呃因为因为它有本地显示的一个需要嘛,就相当于说呃用户调了这个接口之后,它这个异步接口嘛,那异步接口来讲的话,它这个拿到了一个当他拿到了一个这个呃用户选了一组文件之后,可能我这个前端立刻就要显示,然后那我这个前端显示的其实过去有很多很精细的事情,对吧,就是说我如果说是一个特别大的文件的话,我还得我要去做梳理图,对吧,那那这个梳理图每个每个应用自己搞一遍也挺麻烦的,对吧,所以这里就可以判断说呃就是说我要给一个给一个这个哪些类型的文件需要生成梳理图,然后梳理图我们呃默认就梳理图也有也有也有参数控制啊对吧,所以说呃会有这个呃这个梳理图相关的这个是不是enable梳理图的一组接口进来

如果再往下一个比较重要的就是对于这个一次import的这个状态管理啊,就我们刚刚说了,这个他这个每一次import的回来之后,它都会得到一组,就其实已经对象化了,就其实已经就百分之百是已经对象化了这个接口里面,只是说对于纯浏览器接口来讲的话,可能呃就是说它的这个这个这个就就说这个对象对象ID是肯定会会拿到,对,但是呢, 并不代表说这个对象,就是它其实某种意义上来讲,这是一个这是一个本地接口啊,这是一个本地接口,就是说呃这个这个在这个接口接口的这个处理过程中,其实是没有做什么这个呃服务器相关的一个一个一个操作的,它是没有这个服务器相关的一些操作,就是说可能有一些这个状态查询,那非常量非常少,反正没有大量的大量的这个upload的工作在做那这个时候来讲的话,就说呃就相当于说说拿到,当然说这它有可能自动开始哈,对,所以说在这个过程中来讲的话,呃它会有有两个力度的查询,可能第一个是我们这个东西它一定会返回一个sessionID给你就一定会有个sessionID给你,就说每次这个import都会给你一个这个这个sessionID,然后呢你就可以基于这个sessionID去比较简单的去了解这一次import的import的状态就我们这个import的状态,我们现在就这么三种,第一种就是就是OK,这个状态就是就是这个这个就是属于还是属于这个呃临时的状态,就是说呃input的过来的东西没有任何一个字节,就没有东西在服务器上,然后第二状态就是cache,就是oncache,就是说所有东西我都进cache了,那这种状态就比较适合说我在本地有ndm的情况,对吧,那我有ndmcache的情况下,我就全部东西进cache了,然后第三个就比较爽了,这个叫做叫做allinstall,对吧,就所有东西都已经在这个在这个store里面了,对吧,那在这个store里面的话就意味着呃这些对象ID其实已经存到了OOD里面,对吧,这种特别对于桌面版软件来讲是就是说比如我在电脑上,我即使就我本身也就是说对象迟都就在我这个电脑上,对吧,那我本地压根不用跑这个ndmcache,我就是ndm的store,那可能这个文件直接通过我们的一些这个技术测试就直接就塞到这个store里去了,那你就就就免上传了嘛,就相当于说就完全免上传了。 那这个时候来讲的话,就是这个呃这个session这个力度的控制啊,就是说你查状态,然后查完状态回来之后,呃你可以去对这个整个session的力度去做做做做做这个传输管理,就比如说呃比如说说做不管是这个incache还是这个这个这个non的这种状态 你都要叫upload的接口,叫start-upload,就start-upload,就说你调用这个start-upload之后呢,它才会开始呃去把这个里面的这个这个所选的东西开始往这个服务项去传,往我们自己的中中列去传,然后这个呃这个upload的这个这个这个在这个过程中,这个session就说你可能在呃开始upload的时候,你还可以传一些这个upload相关的控制参数进去吧,对啊,反正这里会有一个显示的start-upload,然后你可以也可以通过这个sessionID去去查询一些这个呃这个上传的一些这个进度进度信息吧。进度信息,然后这里面进度信息它是因为已经有对象ID了嘛,所以它是perID的一个呃一个一个大概的一个状态啊,但但这个其实很多时候并不太重要,对啊,其实我们很多时候查回来这个状态其实也不要那么清晰,我们只要知道总共有多少数据要上传,对吧,已经有上传完了多少,对吧,然后看时间就是像类似这样的东西就差不多了,对吧,所以这是一个接口,这个session的接口,然后还有一组接口是就跟这个是正交的,就我们系统里当然有一套基于对象ID去查的一个接口,对吧,但它就拿不到那种cache的,因为对在对对那个NDM的状态查询来看,你进不进cache对于这个呃storeservice来讲,对那个那个store来讲,它都都都一样嘛,都是不在store里面嘛,所以说呃也可以说基于对象ID去这个NDM里面去用NDM的标准接口去这个去查,但但肯定没有这个session相对来说这么好用
---

