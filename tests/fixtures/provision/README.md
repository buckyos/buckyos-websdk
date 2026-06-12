# provision golden fixtures

这些文件是 Rust 版 buckycli（beta2.2）真实输出，作为 websdk `namelib` / `provision`
TS 实现的对照基准（golden fixtures）。测试见 `tests/namelib.test.ts`、
`tests/provision.test.ts`。

## 重新生成步骤

前置：在 buckyos 仓库完成构建（`uv run src/build.py`），得到
`buckyos/src/rootfs/bin/buckycli/buckycli`。

```bash
B=~/project/buckyos/src/rootfs/bin/buckycli/buckycli
FIX=~/project/buckyos-websdk/tests/fixtures/provision
rm -rf $FIX && mkdir -p $FIX/{devtest,alice,charlie,sn,did_docs}
export BUCKYOS_ROOT=$(mktemp -d)

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

## 时间戳说明

- `user_config.json` / `node_device_config.json` 等的 `iat` 取生成时刻，测试从
  fixture 读出 `iat` 后以同一时间重建再比对。
- `*.zone.json` / boot JWT 的 `exp` 固定为 `BASE_TIME(1743478939) + 10y`，确定性。
- JWT 由确定性 Ed25519 签名 + 固定 TestKeys 生成，payload 字段顺序与 Rust serde
  一致时可逐字节比对。

注意：`did_docs/*.doc.json` 内 `create_time`/`last_update_time`/`exp` 取生成时刻，
对照时忽略这三个字段。
