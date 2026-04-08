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

兼容层可以保留：

- `login()`
  - 作为“按当前 runtime 选择默认登录方式”的别名

## AuthClient 的边界

- `AuthClient` 只应该在浏览器 SSO 环境里创建
- 它的职责是构造 SSO 登录跳转 URL，并触发当前窗口跳转
- 不再担弹窗通信或跨窗口 `postMessage` 回传 token 的逻辑

## 访问系统服务的方法

- node: 通常是直接访问 cyfs-gateway的(127.0.0.1:3180/kapi/$service_name),但也允许直接服务的端口 
- browser: 肯定是 http(s)://$apphsotname/kapi/$service_name， 是唯一一个刚需依赖ZoneGateway和https协议的访问
- app_runtime: 访问的是  http://127.0.0.1:3180/kapi/$service_name 或  http(s)://$apphsotname/kapi/$service_name,取决于这台机器上有没有安装有可信设备身份的cyfs-gateway

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
