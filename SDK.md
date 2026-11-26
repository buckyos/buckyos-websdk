# BuckyOS Web(TypeScript) SDK

## BuckyOS SDK的通用流程
```
Step1. Init
Step2. Login 获得访问服务所需要的身份信息
Step3. GetServiceClient($serviceName) 根本上是根据ServiceName和当前Runtime信息，得到最佳的EndPoint
Step4. client.foo() 大部分情况下，是发起 http post调用
```

- Event支持
runtime的简单事件是回调类型的
sub_event(eventid,callback)

buckyos本身的事件，走的是一致性抽象

eventReader = runtime.create_event_reader(event_id_list)
eventReader.read().await
... call xxxClient.get_data()


## 3种Runtime的主要区别

虽然都是TypeScript,但是我们支持3种Runtime
- node : 用来开发app_service, 能力最全面，对标Rust里的AppService / AppClient. 能力一致，系统给的权限不同
- browser : 用来开发webui client, 能力最弱， Rust里没有
- app_runtime : 用来开发运行在BuckyOS App Web容器里的webui client,能力比browser要强。Rust里没有


**最大的区别在于，运行环境所在的机器上，是否存在cyfs-gatweay.** 只要有cyfs-gateway, 就意味着app能通过下面可信链路访问
```
sdk --local_http--> cyfs-gateway --rtcp-->service
```


## 获得身份的方式不同

- node (AppService/AppClient) ： 通过 启动SessionToken -->verify-hub.login_by_jwt() 获得稳定的双Token,并自己管理刷新
- browser: 通过SSO登录，并获得httpOnly的cookie和account_info+access_token,所有流量都会通过ZoneGateway对RefreshToken的鉴权后到达Verify-hub
    SDK里可以看到account_info + access_token, 可以主动用access-Token向kapi发送请求。 (kapi通常不看refresh-token)
    可以主动调用logout(),来让当前app回到未登录的状态

- app_runtime : 总是能getAccountInfo()成功，并且不会调用login() 
  考虑到开发的便利性，在浏览器里能运行的代码，都能直接在app_runtime里运行。
  主动调用logout()会主动清除当前app的登录状态，但掉login的时候，用的是钱包SSO

> 获得身份还包括获得当前的zoneid,appid等基础runtime信息

### AppService 身份契约

AppService 不从 `AppDoc.name` 或 `app_instance_config` 推导身份。node-daemon/app_loader 必须注入：

- `BUCKYOS_APP_DID`：规范 App DID
- `BUCKYOS_APP_ID`：AppDID 的 raw hostname
- `BUCKYOS_APP_INSTANCE_ID`：`${appId}@${ownerUserId}`
- `BUCKYOS_OWNER_USER_ID`
- `BUCKYOS_DATA_DIR`：绝对路径
- `BUCKYOS_APP_TOKEN`：包含 `app_instance_id` 与 `app_owner_user_id` claim 的 JWT

SDK 初始化时会校验这些字段彼此一致，并通过 `getAppDid()`、`getAppId()`、`getAppInstanceId()`、`getAppDataDir()` 暴露解析结果。

## 建议的 SDK API 命名

为了避免在一个函数内部反复区分 `RuntimeType`，SDK 实现建议按登录链路直接暴露不同名字的入口：

- `loginByRuntimeSession()`
  - `AppClient` / `AppService` 使用
  - 含义是“拿当前 runtime 已具备的身份材料，向 verify-hub 换稳定双 token，并负责续期”
- `loginByBrowserSSO()`
  - `Browser` / `AppRuntime` 使用
  - 含义是“走浏览器交互式 SSO / 钱包 SSO 流程”
  - 行为应该是当前窗口直接跳转到 SSO 页面，而不是弹窗
  - 触发跳转后不需要判断返回值；SSO 成功跳回原页面后，再通过 `getAccountInfo()` 读取当前登录态
- `loginByPassword()`
  - 显式表示“走 verify-hub.login_by_password”
  - 底层请求必须包含结构化 `AuthTarget`；普通 App 使用
    `{ kind: 'app', app_instance_id: '<appId>@<ownerUserId>' }`，系统服务使用
    `{ kind: 'system', service_id: '<serviceId>' }`
  - 高层 SDK 可从初始化配置中的 `appInstanceId` 构造 App target，也允许调用方显式传入 target

`VerifyHubClient` 的 `loginByJwt()`、`loginByPassword()` 和 `sudoByPassword()` 同样要求
`target`，`verifyToken()` 使用可选的 `expected_target`。客户端只序列化协议声明的字段，以匹配
verify-hub 的严格字段解析。

Runtime 优先使用 `appInstanceId`，并可为 `AppClient` / `AppService` 从
`appId + ownerUserId` 构造 App target；需要 System 身份的调用方必须通过
`BuckyOSConfig.authTarget` 明确提供 System target，并确保 `service_id` 与 runtime 的 `appId` 一致。

兼容层可以保留：

- `login()`
  - 作为“按当前 runtime 选择默认登录方式”的别名

## AuthClient 的边界

- `AuthClient` 只应该在浏览器 SSO 环境里创建
- 它只接收 Zone hostname，构造仅带 `redirect_url` 的 SSO 登录 URL，登录目标由 Gateway 路由确定
- 它会触发当前窗口跳转
- 不再担弹窗通信或跨窗口 `postMessage` 回传 token 的逻辑

## 访问系统服务的方法

- node: 通常是直接访问 cyfs-gateway的(127.0.0.1:3180/kapi/$service_name),但也允许直接服务的端口 
- browser: 肯定是 http(s)://$apphsotname/kapi/$service_name， 是唯一一个刚需依赖ZoneGateway和https协议的访问
- app_runtime: 访问的是  http://127.0.0.1:3180/kapi/$service_name 或  http(s)://$apphsotname/kapi/$service_name,取决于这台机器上有没有安装有可信设备身份的cyfs-gateway

### 同时使用多个 Zone

`initBuckyOS` 把一个页面绑定到一个 Zone。要在一个页面里访问多个 Zone 时，按 Zone 建一组客户端，它不读全局运行时：

```ts
import { createZoneClients } from 'buckyos'

const zone = createZoneClients({ zoneHost: 'alice.example', userId: 'alice', fetcher, sessionTokenProvider })
await zone.msgCenter.notifySummary()          // 未处理的通知数和消息未读数
await zone.rpc('control-panel').call('apps.list', {})
```

请求都经传入的 `fetcher` 发到 `https://<zoneHost>/kapi/<service>`。`fetcher` 自己带会话时不用给 `sessionTokenProvider`，token 就不进页面。

## 运行环境与能力清单

```ts
import { getRuntimeEnvironment } from 'buckyos'

const { container, formFactor, capabilities, platform } = getRuntimeEnvironment()
```

- `container`：`browser`（浏览器，包括 Desktop 里的 iframe）、`desktop-app`、`mobile-app`（BuckyOS 客户端的窗口或全屏容器）。
- `formFactor`：`desktop` 或 `mobile`。
- `platform`：只在客户端里有。
- `capabilities`：这里能用的能力。应用按这份清单决定提供什么功能，不要靠平台或 UA 去猜。

| 能力 | 含义 |
| --- | --- |
| `window.native` | 应用在独立的原生窗口里 |
| `notify.system` | 通知会变成操作系统的提醒。应用发通知不变，仍用 `MsgCenterClient.notifySend` |
| `app.open` | 可以打开别的应用 |
| `audio.background` | 客户端能让页面在后台继续播放 |
| `audio.record` | 可以录音（浏览器里用 `MediaRecorder`） |
| `media.session` | 系统的媒体控制可用 |

浏览器里列的只是页面自己能做到的。外面的 Desktop 提供什么，看 App Frame 握手给的 `init.shellCapabilities`。

客户端注入 `window.BuckyApi`（类型 `BuckyApi`、`BuckyApiEnv`，用 `getBuckyApi()` 取）。应用一般不直接用它，SDK 会在下面这些接口里自己选通道。`RuntimeType.AppRuntime` 仍然表示“有 `window.BuckyApi`”。

## 应用页面与宿主（App Frame）

`buckyos/app-frame` 的 `AppFrameClient` 连接应用和它的宿主。Desktop 里宿主是外面的页面，走 iframe 的 postMessage；客户端里应用是顶层文档，走 `BuckyApi`。应用不用区分：

```ts
import { AppFrameClient, embedderOrigin, originInZone } from 'buckyos/app-frame'

const zone = buckyos.getZoneHostName()!
const systemOrigin = `${location.protocol}//${zone}`
const frame = new AppFrameClient({
  shellOrigin: embedderOrigin(origin => originInZone(origin, zone)) ?? systemOrigin,
  systemOrigin,
  onInit: init => { /* init.theme、init.locale、init.presentation、init.container … */ },
  onBack: () => goBack(),
  onHeaderEvent: event => { /* 见下 */ },
})
```

- `init.presentation` 为 `tab` 时，应用在宿主的一个标签页里，外层导航由宿主画，应用去掉自己的那一层。
- `init.theme.accent` 是这个 Zone 的主题色，主题变化时 `onTheme` 会再给一次。
- 在 Web Desktop 中打开带 `#fragment` 的页面时，应用可直接读取原始 `location.hash`。当前 `AppFrameClient` 从 iframe 名称读取握手标识。只从 `#bfp` 读取标识的旧 SDK 需要升级才能在这种入口完成握手。
- `selectContent()` 选文件：宿主提供选择器就用宿主的，客户端没有时把 Zone 的 `/embed/sysdlg/select` 嵌在应用页面上，所以要给 `systemOrigin`。

### 经 Desktop 与其他应用交付内容（`transfer.v1`）

不同子域的应用之间，浏览器不保证原生拖放能到达对方。给 `AppFrameClient` 传 `transfer` 处理器就声明了 `transfer.v1`；宿主也列出它时，握手后 SDK 自己建一条 `MessageChannel` 交给宿主，之后的传输消息都走这个端口（客户端里走 `BuckyApi`，本机 `File` 过不去）。

```ts
const frame = new AppFrameClient({ shellOrigin, transfer: {
  onAvailable: () => offerSelection(),
  // 只看种类、格式和操作，不读取、不改动任何东西
  onProbe: probe => ({ targetId: 'cursor', action: '插入到光标处', accept: [{ itemKey: '0', format: 'text/plain', operation: 'copy' }] }),
  onDeliver: async delivery => { /* 落点按 delivery.at 再核对一次后提交 */ return { status: 'done', items: delivery.items.map(i => ({ itemKey: i.itemKey, status: 'done' })) } },
  onRead: read => read.items.map(i => ({ ...i, value: selectedText })),
} })
const reply = await frame.offerTransfer({ purpose: 'drag', items: [{ kind: 'text', formats: ['text/plain'], operations: ['copy'], inline: { 'text/plain': selectedText } }] })
// 选区变了或没了：frame.withdrawTransfer(reply.offerId)
```

- 登记后，用户用 Desktop 在窗口标题栏画的“拖到其他应用”手柄（拖动，或轻触后再轻触目标窗口）或目标窗口菜单里的“粘贴桌面对象…”把它交给另一个应用。应用自己报告的坐标和松手不算数。
- 格式用剪贴板规范 §2.1 登记的名字。值：文本和 JSON 格式是字符串，`application/vnd.buckyos.content-refs+json` 是该项的 `ZoneContent`，`files` 是 `File`。
- 同一个 `operationId` 的投递 SDK 只交给 `onDeliver` 一次，重发和 `transfer.status` 都得到第一次的结果。错误码 `unsupported`、`stale`、`denied`（`TransferError`）。

### 打开应用

```ts
const reply = await frame.openApp({ app: 'messagehub', path: '/?notify=n1' })
if (!reply.ok) { /* reply.code: not_found | denied | unsupported */ }
```

| 字段 | 含义 |
| --- | --- |
| `app` | app_id。系统应用用系统应用清单里的 id，例如 `files`、`messagehub` |
| `path` | 相对于目标应用入口的页面地址，以 `/` 开头，可以带查询参数和片段。例如 Message Hub 的 `/?notify=n1` 对应 Zone 上的 `/messagehub?notify=n1`。 |
| `window` | 窗口路径，由应用自己定义，同一路径指同一个窗口；空串指主窗口 |
| `mode` | `reuse`（缺省）或 `new` |
| `zone` | 目标 Zone 的 DID，不写就是应用自己的 Zone |

`openApp` 不会 reject。宿主没有列出 `app.open` 时返回 `unsupported`；十秒内最多五次，多的返回 `denied`。独立标签页里它在新标签页打开 Zone 根域的 `/?open-app=…`，这时不能指定别的 Zone。

打开到哪个窗口由应用的窗口声明决定（AppDoc 的 `window`，写法见 [PIKG 模块](doc/modules/pikg.md)）：

| 声明 | 请求 | 结果 |
| --- | --- | --- |
| `single`（缺省） | 任意 | 已有窗口就置前，带 `path` 且和当前页面不同就在其中进入该页面；没有就新建 |
| `multi` | 不带 `window` | 最近用过的窗口置前，带 `path` 时同上；没有就新建 |
| `multi` | 带 `window` | 这个路径的窗口已存在就置前，否则新建 |
| `multi` | `mode: 'new'` | 新建。路径被占用时加 `~2`、`~3`… |

规则只有一份，在 `buckyos/open-app` 的 `resolveOpenApp`，宿主（Desktop 和客户端）都调它；`tests/open_app_vectors.json` 是它的用例。同一模块还有窗口 ID（`appWindowId`）、声明的宽容解析（`readAppWindowDeclaration`）和 `buckyos://app.open?v=1&zone=…&app=…` 的读写（`formatAppOpenUrl`、`parseAppOpenUrl`）。

### 移动端的 Header

移动容器的 Header 由宿主画，应用声明里面放什么。桌面上宿主忽略它。

```ts
frame.setHeader({
  title: 'Notes',
  second_row: [{ id: 'all', label: 'All', active: true }, { id: 'mine', label: 'Mine' }],
  search: { placeholder: 'Search' },
  menu: [{ id: 'export', label: 'Export' }, { id: 'delete', label: 'Delete', danger: true }],
  back: true,
})
// 之后只给变化的字段；空数组、search: null 表示去掉
frame.setHeader({ search: null })
```

用户的操作从 `onHeaderEvent` 回来：`{ kind: 'search', value }`、`{ kind: 'item', id }`（第二行）、`{ kind: 'menu', id }`。返回键走 `onBack`。第二行只在窗口声明的 `mobile_header` 为 `standard` 时显示。

## 音频

```ts
import { acquireBackgroundAudio, audioCapabilities, startRecording, stopRecording, getRecording } from 'buckyos'

audioCapabilities() // { background: 'native' | 'media-session' | 'none', record: 'native' | 'browser' | 'none' }
```

后台播放：声音仍由页面里的 `<audio>` 发出，申请只是让客户端不要停掉它。浏览器里退回 Media Session，什么都没有时是空操作。

```ts
const handle = await acquireBackgroundAudio({ title: 'Song', artist: 'Band', artwork: '/cover.png' })
handle.onCommand(command => { /* play | pause | stop | next | previous */ })
audio.onpause = () => handle.update({ playing: false })
audio.onplay = () => handle.update({ playing: true })
await handle.release() // 播放结束后必须释放
```

一个页面只有一个申请，再次申请会替换前一个。

录音：一次录一个。客户端里录成本地文件；浏览器里用 `MediaRecorder`，结果只在页面的内存里，页面关掉就没有了。

```ts
await startRecording({ title: 'Memo' })       // pauseRecording() / resumeRecording() / getRecordingStatus()
const { id } = await stopRecording()
const { blob } = await getRecording(id)        // listRecordings() / deleteRecording(id)
onRecordingState(status => { /* idle | recording | paused | interrupted */ })
```

失败时抛 `AudioError`，`code` 为 `unsupported`、`denied`、`busy`、`not_found`、`invalid_state` 或 `failed`。

## 管理状态数据
- node : 
    - app_service:以服务器的角度，考虑使用/config/或cyfs:// 来保存数据。
    - app_client:通常没有长期状态需要使用,直接用client的文件系统就好(node生态自带)
- browser: 基本只能用IndexDb和LocalStorage，这是Cache
- app_runtime: 除了使用IndexDb和LocalStorage的空间更大外，还可以使用本地的ndn_store/ndn_cache, 来改进NamedData的传输效率

> 这里的状态数据特指“由内核提供，不依赖特定服务“的状态存储

## 使用Named Data Netowrk

这是一个目前只有rust才可以使用的能力，type-script完全确实。
- NamedDataNetwork(CYFS)是一个协议，虽然复杂，但是绝对应该支持多种语言实现
- 本地的高效IO的核心是：无Daemon进程的直接读写
    - Named Cache永远有需求
    - Named Store 一旦分布式化，就肯定会daemon service

## 使用kevent/kmsgqueue
