# PIKG 命令与开发态元数据

> 当前权威：`pikg` CLI、`dapp_meta` 和受管理的 `dapp_dist`。本文描述现有实现；未来设计和旧验收清单不作为使用步骤。

PIKG 二进制容器、对象图与信任边界只在 [PIKG 格式规范](https://github.com/buckyos/buckyos/blob/main/doc/pikg/format.md) 维护；普通 App 安装与升级只在 [App 模块](app.md) 维护；SDK/Tool 分发见 [distribution](../distribution.md)。其他资料与历史归档见 [PIKG 文档总览](https://github.com/buckyos/buckyos/blob/main/doc/pikg/README.md)。

## 1. 本地打包流程

在已有 App 工程中构建代码、准备目录或本地 Docker image，然后执行：

```bash
npx buckyos --non-interactive pikg init . --name demo --owner did:bns:alice --kind static-web --source ./web/dist
npx buckyos pikg doctor ./dapp_meta
npx buckyos pikg build ./dapp_meta
npx buckyos pikg pack ./dapp_dist
npx buckyos pikg info ./dapp_dist/demo-0.1.0.pikg
```

需先在 App 工程安装 npm `buckyos`。`pikg` 不执行 npm/cargo/make、Docker build 或任意工程脚本，不拉取、登录或推送镜像，不安装 App，不签名或发布。path 型打包不要求运行中的 BuckyOS、Zone、session 或网络；首次执行 npx 时的 npm 下载不属于离线打包操作。

提交 `dapp_meta/`；`dapp_dist/` 是可重新生成的快照，不是第二种安装输入。重新 build 会替换本工程的旧快照和其中旧 PIKG，交付与回滚包应另外保存。

## 2. 命令表

| 命令 | 默认输入 | 访问级别 | 当前行为 |
| --- | --- | --- | --- |
| `pikg doctor [meta_dir]` | `./dapp_meta` | read | 诊断本机 Tool/SDK、策略、元数据、path source 与目标配置 |
| `pikg init [project_dir]` | `.` | write | 只创建 `dapp_meta/app.json` 和 `pikg.json` |
| `pikg build [meta_dir]` | `./dapp_meta` | write | 读取已构建的 source，生成完整受管理快照 |
| `pikg pack [dist_dir]` | `./dapp_dist` | write | 只消费快照，封装 PIKG 并回读验证 |
| `pikg info <pikg_path>` | 必填 | read | 离线验证容器、AppDoc 和内容图，输出摘要 |
| `pikg clean [meta_dir]` | `./dapp_meta` | destructive | 核对所有权后删除整个输出目录，包括已封装 PIKG |

六个命令均为 local/sync，不要求 session、不申请网络。`doctor` 会读取本机 profile/identity candidate 摘要，其余命令不依赖线上身份。实际参数与 JSON schema 可用 `buckyos command describe pikg <verb>` 查询。

### `doctor`

报告 `healthy` 与逐项 `checks`、Tool/SDK/协议版本、权限策略、分发清单、目标 profile 和 identity candidate 顺序。它不登录、不连接 Zone、不执行 Docker inspect；目标兼容性为 `not-checked`。诊断成功不等于构建、签名或安装成功。

### `init`

选项为 `--name`、`--owner`、`--kind`、`--source`、`--version` 和 `--app-did`，也接受全局 `--input` JSON；同一字段不能同时由 option 和 input 提供。工程目录必须已存在。`dapp_meta` 非空时拒绝覆盖，不提供 force/merge。

| kind | 生成的类别 | 初始子包 | source |
| --- | --- | --- | --- |
| `static-web` | `web` | `web` | 已构建目录或 `.tar.gz` |
| `script` | `dapp` | `script` | 已构建目录或 `.tar.gz` |
| `docker` | `dapp` | `amd64_docker_image` / `aarch64_docker_image` | 本地 Docker image name/tag/ID |
| `agent-skills` | `agent_skills` | `agent_skills` | skill 内容目录或 `.tar.gz` |
| `aiws-controls` | `aiws` | `aiws` | AIWS bundle 目录（`aiws-manifest.json` + `controls/<dir>/`）；不存在时写一个 declarative 控件骨架 |

Agent 模板没有独立 init kind，参考 [Jarvis 元数据](https://github.com/buckyos/buckyos/tree/main/src/apps/jarvis_agent/dapp_meta) 或 [Agent fixture](https://github.com/buckyos/buckyos/tree/main/test/app_installer_test/pikg_samples/agent)。

`name` 缺省从工程目录名规范化，version 缺省 `0.1.0`。Owner 必须能按当前实现推导 BNS App DID：`did:bns:<owner>` → `did:bns:<name>.<owner>`；`--app-did` 可覆盖生成 DID，但不绕过 Owner 的推导校验。包 namespace 使用 DID 派生的 AppId，不使用展示名。

只有可交互 TTY 才询问缺失字段；`--non-interactive` 下缺少必填值立即失败。path source 的相对路径以工程目录为基准，写入 manifest 时转换为相对 `dapp_meta`；尚未生成时只警告，build 时必须存在。Docker source 在 init 时必须已存在且可 inspect。

## 3. `dapp_meta/app.json`

这是开发态 schema，不是 AppDoc，不能用生成的 `APPDOC.json` 替代。完整最小示例：

```json
{
  "schema_version": 1,
  "did": "did:bns:demo.alice",
  "name": "demo",
  "version": "0.1.0",
  "owner": "did:bns:alice",
  "author": "did:bns:alice",
  "show_name": "Demo",
  "categories": ["web"],
  "permissions": [],
  "selector_type": "static",
  "service_config_tips": {}
}
```

| 字段 | 当前规则 |
| --- | --- |
| `schema_version` | 必填，固定 `1` |
| `did/name/version/owner/author/show_name/selector_type` | 必填非空字符串，身份/name/version 继续经过专用校验 |
| `categories` | 必填非空字符串数组；首项生成 AppDoc `app_type` |
| `permissions` | 缺省 `[]`；条目和授权语义见 [App 包配置](https://github.com/buckyos/buckyos/blob/main/doc/sdk/app-package-config.md) |
| `content_handlers` | 可选；打包时校验，与 App permissions 一起处理 |
| `presentation` | 可选，原样进入 AppDoc；完整字段和图标示例见下文。 |
| `service_config_tips` | 缺省 `{}`；端点、挂载、数据库等字段见 [App 包配置](https://github.com/buckyos/buckyos/blob/main/doc/sdk/app-package-config.md) |

根对象严格拒绝未知字段。不得手工加入 `pkg_list/pkg_id/pkg_objid`、PackageMeta、payload size/digest、Object ID、签名、`deps` 或 `source_url`。这些派生内容由 build 构造。build 不改写两个开发输入文件。

`presentation` 遵循现有 [AppPresentation](https://github.com/buckyos/buckyos/blob/main/src/kernel/buckyos-api/src/app_doc.rs)：提供时六个字段均必填，映射可以为空。`title/summary/description/links` 的值为字符串，`icons` 的值为序列化 ObjectId，`license` 为字符串；未知字段和非法值会在 build 时拒绝。

例如，在上面的 `app.json` 中增加：

```json
"presentation": {
  "title": {"en": "Demo", "zh-CN": "示例"},
  "summary": {},
  "description": {},
  "icons": {},
  "links": {"app_icon_url": "./icon.svg"},
  "license": "MIT"
}
```

Desktop 使用 `links.app_icon_url`，支持 HTTPS 地址、小图片 data URL，或在应用有 Web 地址时使用相对路径。`./icon.svg` 相对于应用的 Web 地址，文件需要随应用提供；`/icon.svg` 则相对于 Desktop 所在站点。网页 favicon 不会自动成为应用图标。此元数据控制应用的展示图标，不会自动在 Desktop 创建快捷方式。

## 4. `dapp_meta/pikg.json`

```json
{
  "schema_version": 1,
  "output_dir": "../dapp_dist",
  "pikg_file": "demo-0.1.0.pikg",
  "sub_pkgs": {
    "web": {
      "required": true,
      "source": {"type": "path", "path": "../web/dist"}
    }
  }
}
```

| 字段 | 当前规则 |
| --- | --- |
| `schema_version` | 固定 `1`，未知版本拒绝 |
| `output_dir` | 缺省 `../dapp_dist`；相对路径以 `dapp_meta` 为基准，可显式绝对路径 |
| `pikg_file` | 缺省 `<name>-<version>.pikg`；必须为安全的 `.pikg` 单段文件名；init 会显式写入 |
| `sub_pkgs` | 非空对象；key 使用 `[A-Za-z0-9._-]+`，不能是 `.` 或 `..` |
| `sub_pkgs.*.selector` | 可选；与已知 key 的默认 OS/arch 冲突时拒绝 |
| `sub_pkgs.*.required` | 缺省 `true` |
| `source.type=path` | `path` 为目录或已完成 `.tar.gz`；相对路径以 `dapp_meta` 为基准 |
| `source.type=docker-image` | `image` 为本地 Docker image name/tag/ID |

多子包、组合包或多架构包直接编辑 `sub_pkgs`；init 只生成一个主子包。当前不提供部分 PIKG、独立子包发布或第三方 package 下载工作流。

目录 source 按稳定顺序归档，规范化 uid/gid/mtime 和 mode；已完成 `.tar.gz` 原样复制，不二次打包。输入不存在、不支持的文件类型或逃出声明输入根的链接会失败。

Docker build 先 inspect 固定不可变 image ID，再仅按该 ID 执行 image save；runtime image digest 与导出 `.tar.gz` 的 digest 分别记录，不混用，也不因本地镜像缺失而 pull。

## 5. 快照、可复现构建与清理

build 在临时目录完成写入和对象图验证，成功后替换输出目录；失败不留下可被 pack 接受的半成品。快照包括：

- `.buckyos-pikg-dist.json`：`schema_version/tool_version/meta_root_id/source_fingerprint/app_doc_object_id/pikg_file/generated_files/subpackages`，记录工具所有权和生成文件摘要。
- `APPDOC.json`、`PACKAGE_META.json` 和所有 `<key>.tar.gz`。
- pack 成功后才出现的最终 `.pikg`。

build/clean 必须确认目录归本 `dapp_meta` 所有。无 manifest、所有权不符、目录含非生成文件或目标与源输入/受保护目录冲突时拒绝替换或删除；不会替用户搬走额外文件。clean 删除不存在的目录按幂等成功处理；非交互 clean 需要全局 `--yes`。

pack 不重新读取 `dapp_meta`、源目录或 Docker tag。它核对快照所有权、allowlist、摘要及对象引用，写临时包，再用 CLI 同一严格 reader 回读，通过后原子替换最终 PIKG；失败保留上一成功包。

默认 AppDoc 时间取当前 Unix 秒。需要可复现构建时设置非负整数秒 `SOURCE_DATE_EPOCH`，同时固定 source、工具和运行环境；无该变量时不能因相同源码就假定 Object ID 和整包 digest 相同。升级需递增 `app.json.version`，并同步已显式写入的 `pikg_file` 与 Docker source。

## 6. `info` 与信任结果

`info` 先完成严格验证才输出成功 envelope，包含 `protocol/pikg_path/size/pikg_digest/valid`、`app` 身份与 Object ID、各 `subpackages` 的 selector/required/package identity/payload 摘要，以及：

| 输出 | 当前含义 |
| --- | --- |
| `app_doc_form=unsigned/signed/both` | 只标识 JSON/JWT entry 形式；`signed` 不是验签成功 |
| `canonical_match` | 同时有 JSON/JWT 时 body 的 canonical identity 一致 |
| `offline_content_validation=passed` | 容器、对象图与 payload 内容通过 |
| `signature_validation=not-present` | 没有 JWT |
| `signature_validation=not-resolvable-offline` | 有 JWT；当前只解码并验证 body，不执行密码学验签 |
| `publication_validation=not-checked` | 未核对 BNS 当前发布状态 |

不返回“存在 JWT 就签名有效”的结果。校验阶段和信任层次详见 [格式规范](https://github.com/buckyos/buckyos/blob/main/doc/pikg/format.md)。

## 7. AI Workspace 控件包（`aiws`）

`categories:["aiws"]`，`pkg_list` 只能含 `aiws`，payload 是 AIWS bundle：`aiws-manifest.json`（`manifest_version`、`purpose: "aiws"`、`controls[]`、`workspace_templates: []`）加每个控件的平铺目录 `controls/<dir>/`（`component.json` 与其文件）。`build` / `pack` / `info` 都按清单重算每个控件的内容摘要（`[[文件名, sha256], …]` 排序后的规范 JSON 的 sha256）并预检 `component.json`，与 AI Workspace 服务安装时的校验一致；`info` 在结果里多出 `aiws`。安装：`buckyos app install <x.pikg>`（control-panel 转交 aiworkspace `ext.install`，不建 AppSpec、不起服务）或开发态 `buckyos aiws library install <x.pikg>`。从工作区导出见 `buckyos aiws ext-export --pikg`；协议见 buckyos `src/frame/aiworkspace/README.md` “Extension controls”。

## 8. Agent skill 包

独立 skill 包使用 `categories:["agent_skills"]`，必须有 App name，且 `pkg_list` 只能含 `agent_skills`。source 按 `cmd_skills/<name>.md`、`goal_skills/<name>.md`、`tools/<cmd_skill>/...` 组织。手册 front matter 为 `name/description/requires`。

```bash
npx buckyos skill install ./dapp_dist/hello-skills-0.1.0.pikg --agent <agent_id>
```

skill CLI 用 TypeScript reader 严格验证，再将认可的普通文件/目录及可执行位交给 Agent `skills.install`；拒绝逃逸路径和链接，其他目录文件在 `ignored_files` 中列出。`skill list/remove` 调用同一 Agent 接口；remove 非交互需要 `--yes`。普通 Rust App Installer 不安装此类型。

包样例与 Session 冻结语义见 [skill 样例](https://github.com/buckyos/buckyos/blob/main/test/skills_pikg_sample/README.md) 和 [OpenDAN 开发指南](https://github.com/buckyos/buckyos/blob/main/doc/sdk/OpenDAN_Agent_Dev_Guide.md)。

## 9. 实现、失败与验证

实现入口为 [pikg.ts](../../cli/modules/pikg.ts)、[pikg_protocol.ts](../../cli/modules/pikg_protocol.ts)、[pikg_archive.ts](../../cli/modules/pikg_archive.ts)，离线回归在 [pikg_test.ts](../../cli/tests/pikg_test.ts)。Rust reader 是另一份实现，普通 App 的交集通过协议和 golden fixtures 对齐。

所有命令使用统一 JSON envelope；参数/schema 错误为 usage error，容器/对象图错误为 `INVALID_PACKAGE`，不安全清理为 `UNSAFE_CLEAN_TARGET`，失败不会生成伪 Task ID。诊断写 stderr，错误码和退出码以 [errors.ts](../../cli/core/errors.ts) 为准。

本页不重复 App 安装命令。普通 App 首装、本地新包升级、Catalog 升级及 `app publish` 的 Repo candidate 边界见 [App 模块](app.md)；完整应用教程见 [快速入门](https://github.com/buckyos/buckyos/blob/main/doc/sdk/app-dev-quickstart.md)。
