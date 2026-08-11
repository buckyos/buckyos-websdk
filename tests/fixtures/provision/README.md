# provision golden fixtures

这些文件是 Rust 版 buckycli（beta2.2）真实输出，作为 websdk `namelib` / `provision`
TS 实现的对照基准（golden fixtures）。测试见 `tests/namelib.test.ts`、
`tests/provision.test.ts`。

当前基准对应 name-lib 的 `xxxDocument` 命名 + node_identity schema v2：

- `user_config.json`：OwnerDocument（`display_name`，无 `full_name`/`default_zone_did`）
- `{node}/node_identity.json`：`buckyos.node_identity.v2`（只含元数据，含 `device_did`）
- `{node}/node_gateway_params.json`：`{"params":{"device_did":...}}`
- `{node}/local/identity/{device raw host}/`：`did.json` + `device_doc.jwt` +
  `device_mini_doc.jwt`（identity-roots public 布局）
- `{node}/security/{device raw host}/authentication.private.pem`：设备私钥
- 设备 DID 为名字型（`did:bns:ood1.alice` / `did:web:ood1.test.buckyos.io`），
  由 `build_device_did` 生成；不再有 `node_device_config.json` / `node_private_key.pem`
- `sn_device_config.json`：字段 `device_mini_document_jwt`（原 `device_mini_config_jwt`）

## 重新生成步骤

前置：构建 buckycli（完整构建 `uv run src/build.py`，或
`cd buckyos/src && cargo build -p buckycli --release`，产物位置以
`src/.cargo/config.toml` 的 target-dir 为准，当前为 `/tmp/rust_build/release/buckycli`）。

注意：buckycli 启动时会读取 `~/.buckycli` 的开发者配置；若其中是旧格式
user_config 会导致 runtime 初始化失败，用临时 HOME 兜底。

```bash
B=/tmp/rust_build/release/buckycli   # 或 rootfs/bin/buckycli/buckycli
FIX=~/project/buckyos-websdk/tests/fixtures/provision
rm -rf $FIX/{devtest,alice,charlie,sn,did_docs} && mkdir -p $FIX/{devtest,alice,charlie,sn,did_docs}
export HOME=$(mktemp -d)
export BUCKYOS_ROOT=$(mktemp -d) && mkdir -p $BUCKYOS_ROOT/etc

# dev group（did:web zone，wan OOD，无 SN）
$B create_user_env --username devtest --hostname test.buckyos.io \
  --ood_name "ood1@wan" --sn_base_host "" --rtcp_port 2980 --output_dir $FIX/devtest
$B create_node_configs --device_name ood1 --net_id wan --env_dir $FIX/devtest

# alice group（did:bns zone，lan OOD + SN）
$B create_user_env --username alice --hostname alice.bns.did \
  --ood_name "ood1" --sn_base_host "devtests.org" --rtcp_port 2980 --output_dir $FIX/alice
$B create_node_configs --device_name ood1 --net_id lan --env_dir $FIX/alice

# charlie group（域名 zone，portmap + 自定义 rtcp 端口）
$B create_user_env --username charlie --hostname charlie.me \
  --ood_name "ood1@portmap" --sn_base_host "devtests.org" --rtcp_port 2981 --output_dir $FIX/charlie
$B create_node_configs --device_name ood1 --net_id portmap --env_dir $FIX/charlie

# SN 配置（含 sn_db.sqlite3 schema 基准）
$B create_sn_configs --sn_ip 192.168.64.84 --sn_base_host devtests.org --output_dir $FIX/sn

# 内核服务 did docs
$B build_did_docs --output_dir $FIX/did_docs
```

`pkg_meta/` 与 did-document 变更无关，不需要随上述命令重生成。

## 时间戳说明

- `user_config.json` 的 `iat` 取生成时刻，测试从 fixture 读出 `iat` 后以同一
  时间重建再比对。
- 设备文档（`did.json` / `device_doc.jwt` / `device_mini_config.jwt` /
  `start_config.json` 里的 `ood_jwt`）的 `iat` 也取生成时刻；
  `createNodeConfigs` 提供 `now` 参数，测试传入 fixture `did.json` 的 `iat`
  即可逐字节对拍（Ed25519 签名确定性）。
- `*.zone.json` / boot JWT 的 `exp` 固定为 `BASE_TIME(1743478939) + 10y`，
  `node_identity.json` 的 `zone_iat` 固定为 `BASE_TIME`，均确定性。

注意：`did_docs/*.doc.json` 内 `create_time`/`last_update_time`/`exp` 取生成时刻，
对照时忽略这三个字段。
