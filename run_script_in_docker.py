#!/usr/bin/env python3
"""在 Docker 中运行某个 appid 对应的本地脚本目录。

设计目标：
1. Python 侧只使用标准库。
2. 容器内同时提供 Node LTS、Python 3 和 uv。
3. 每个 appid 使用独立的依赖卷，避免不同 app 之间互相污染。
4. 既支持自动探测常见入口，也支持 `--` 后显式传入命令。

示例：
  python run_script_in_docker.py demo ./examples/service
  python run_script_in_docker.py demo ./examples/service -- python -m http.server 8080
  python run_script_in_docker.py demo ./examples/service -p 8080:8080 -- npx -y tsx service.ts
"""

from __future__ import annotations

import argparse
import json
import platform
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

DEFAULT_IMAGE = "buckyos-script-runner:node-lts-python3"
DEFAULT_CONTAINER_PREFIX = "buckyos-script"
DEFAULT_SOURCE_MOUNT = "/src"
DEFAULT_APP_DATA_ROOT = "/app_data"
DOCKERFILE_TEMPLATE = """\
FROM node:lts-bookworm-slim

RUN apt-get update \\
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
       ca-certificates \\
       curl \\
       git \\
       python3 \\
       python3-pip \\
       python3-venv \\
    && rm -rf /var/lib/apt/lists/*

ENV UV_INSTALL_DIR=/usr/local/bin
ENV UV_NO_MODIFY_PATH=1
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

RUN corepack enable

WORKDIR /workspace
CMD ["/bin/bash"]
"""


class ScriptError(RuntimeError):
    """用户输入或运行环境错误。"""


def eprint(*parts: object) -> None:
    print(*parts, file=sys.stderr)


def run(
    cmd: list[str],
    *,
    check: bool = True,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=check,
        text=True,
        capture_output=capture_output,
    )


def require_command(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise ScriptError(f"未找到命令 `{name}`，请先安装。")
    return path


def sanitize_name(value: str) -> str:
    sanitized = []
    for ch in value.lower():
        if ch.isalnum():
            sanitized.append(ch)
        else:
            sanitized.append("-")
    result = "".join(sanitized).strip("-")
    while "--" in result:
        result = result.replace("--", "-")
    return result or "app"


def parse_key_value(items: Iterable[str], flag_name: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for item in items:
        if "=" not in item:
            raise ScriptError(f"`{flag_name}` 参数必须使用 KEY=VALUE 格式，收到: {item}")
        key, value = item.split("=", 1)
        key = key.strip()
        if not key:
            raise ScriptError(f"`{flag_name}` 的 KEY 不能为空，收到: {item}")
        pairs.append((key, value))
    return pairs


def parse_package_scripts(package_json: Path) -> dict[str, str]:
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ScriptError(f"无法解析 {package_json}: {exc}") from exc

    scripts = data.get("scripts")
    if not isinstance(scripts, dict):
        return {}
    return {str(key): str(value) for key, value in scripts.items()}


def detect_default_command(script_dir: Path) -> list[str]:
    package_json = script_dir / "package.json"
    if package_json.exists():
        scripts = parse_package_scripts(package_json)
        for script_name in ("start", "dev", "serve"):
            if script_name in scripts:
                return ["npm", "run", script_name]

    python_candidates = [
        "service.py",
        "server.py",
        "app.py",
        "main.py",
        "start.py",
        "index.py",
    ]
    for name in python_candidates:
        if (script_dir / name).is_file():
            return ["uv", "run", "python", name]

    ts_candidates = [
        "service.ts",
        "server.ts",
        "app.ts",
        "main.ts",
        "start.ts",
        "index.ts",
        "service.mts",
        "server.mts",
        "main.mts",
        "index.mts",
    ]
    for name in ts_candidates:
        if (script_dir / name).is_file():
            return ["npx", "-y", "tsx", name]

    js_candidates = [
        "service.js",
        "server.js",
        "app.js",
        "main.js",
        "start.js",
        "index.js",
        "service.mjs",
        "server.mjs",
        "main.mjs",
        "index.mjs",
    ]
    for name in js_candidates:
        if (script_dir / name).is_file():
            return ["node", name]

    top_level_py = sorted(path.name for path in script_dir.glob("*.py") if path.is_file())
    if len(top_level_py) == 1:
        return ["uv", "run", "python", top_level_py[0]]

    top_level_ts = sorted(
        path.name
        for pattern in ("*.ts", "*.mts")
        for path in script_dir.glob(pattern)
        if path.is_file()
    )
    if len(top_level_ts) == 1:
        return ["npx", "-y", "tsx", top_level_ts[0]]

    top_level_js = sorted(
        path.name
        for pattern in ("*.js", "*.mjs")
        for path in script_dir.glob(pattern)
        if path.is_file()
    )
    if len(top_level_js) == 1:
        return ["node", top_level_js[0]]

    raise ScriptError(
        "无法自动判断启动命令。请显式在命令尾部加上 `-- <your command>`，例如：\n"
        "  python run_script_in_docker.py demo ./service -- uv run python main.py"
    )


def docker_image_exists(image: str) -> bool:
    result = run(["docker", "image", "inspect", image], check=False, capture_output=True)
    return result.returncode == 0


def ensure_image(image: str, rebuild: bool) -> None:
    if not rebuild and docker_image_exists(image):
        return

    eprint(f"准备 Docker image: {image}")
    with tempfile.TemporaryDirectory(prefix="buckyos-docker-image-") as temp_dir:
        dockerfile_path = Path(temp_dir) / "Dockerfile"
        dockerfile_path.write_text(DOCKERFILE_TEMPLATE, encoding="utf-8")
        run(["docker", "build", "-t", image, temp_dir])


def container_exists(name: str) -> bool:
    result = run(["docker", "container", "inspect", name], check=False, capture_output=True)
    return result.returncode == 0


def remove_container(name: str) -> None:
    if container_exists(name):
        eprint(f"移除已有容器: {name}")
        run(["docker", "rm", "-f", name], check=False)


def build_shell_command(parts: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in parts)


def build_runtime_bootstrap_script(
    *,
    source_mount: str,
    runtime_workdir: str,
    app_data_root: str,
    run_command_parts: list[str],
) -> str:
    lines = [
        "set -e",
        f"mkdir -p {shlex.quote(runtime_workdir)}",
        f"mkdir -p {shlex.quote(app_data_root)}/node_modules",
        f"mkdir -p {shlex.quote(app_data_root)}/.venv",
        f"mkdir -p {shlex.quote(app_data_root)}/uv-cache",
        f"mkdir -p {shlex.quote(app_data_root)}/npm-cache",
        f"mkdir -p {shlex.quote(app_data_root)}/pnpm-store",
        f"mkdir -p {shlex.quote(app_data_root)}/pnpm-home",
        f"mkdir -p {shlex.quote(app_data_root)}/pip-cache",
        (
            f"for entry in {shlex.quote(source_mount)}/* {shlex.quote(source_mount)}/.[!.]* "
            f"{shlex.quote(source_mount)}/..?*; do "
            "[ -e \"$entry\" ] || [ -L \"$entry\" ] || continue; "
            "base=$(basename \"$entry\"); "
            "case \"$base\" in .|..|node_modules|.venv) continue ;; esac; "
            f"ln -s \"$entry\" {shlex.quote(runtime_workdir)}/$base; "
            "done"
        ),
        f"ln -s {shlex.quote(app_data_root)}/node_modules {shlex.quote(runtime_workdir)}/node_modules",
        f"ln -s {shlex.quote(app_data_root)}/.venv {shlex.quote(runtime_workdir)}/.venv",
        f"export UV_PROJECT_ENVIRONMENT={shlex.quote(app_data_root)}/.venv",
        f"export UV_CACHE_DIR={shlex.quote(app_data_root)}/uv-cache",
        f"export npm_config_cache={shlex.quote(app_data_root)}/npm-cache",
        f"export npm_config_store_dir={shlex.quote(app_data_root)}/pnpm-store",
        f"export PNPM_HOME={shlex.quote(app_data_root)}/pnpm-home",
        f"export PIP_CACHE_DIR={shlex.quote(app_data_root)}/pip-cache",
        f"export PATH={shlex.quote(app_data_root)}/pnpm-home:{shlex.quote(app_data_root)}/node_modules/.bin:$PATH",
        f"cd {shlex.quote(runtime_workdir)}",
        f"exec {build_shell_command(run_command_parts)}",
    ]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="给定 appid 和脚本目录，在 Docker 中运行该目录，并为该 appid 绑定独立依赖卷。",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=(
            "容器内命令请放在 `--` 之后，例如：\n"
            "  python run_script_in_docker.py demo ./service -- uv run python main.py"
        ),
    )
    parser.add_argument("appid", help="逻辑 appid，用于容器名和独立卷命名。")
    parser.add_argument("script_dir", help="本地脚本目录。")
    parser.add_argument(
        "-p",
        "--port",
        action="append",
        default=[],
        metavar="HOST:CONTAINER",
        help="端口映射，可重复传入。",
    )
    parser.add_argument(
        "-e",
        "--env",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="传给容器的额外环境变量，可重复传入。",
    )
    parser.add_argument(
        "-v",
        "--volume",
        action="append",
        default=[],
        metavar="SRC:DST[:MODE]",
        help="额外挂载卷，可重复传入。",
    )
    parser.add_argument(
        "--image",
        default=DEFAULT_IMAGE,
        help=f"Docker image 名称，默认: {DEFAULT_IMAGE}",
    )
    parser.add_argument(
        "--container-name",
        default=None,
        help="指定容器名；默认根据 appid 自动生成。",
    )
    parser.add_argument(
        "--workdir",
        default="/workspace",
        help="容器内工作目录，默认: /workspace",
    )
    parser.add_argument(
        "--detach",
        action="store_true",
        help="后台运行容器。",
    )
    parser.add_argument(
        "--no-replace",
        action="store_true",
        help="如果同名容器已存在，则报错而不是自动删除重建。",
    )
    parser.add_argument(
        "--rebuild-image",
        action="store_true",
        help="强制重建运行所需的 Docker image。",
    )
    parser.add_argument(
        "--shell",
        action="store_true",
        help="忽略自动探测，直接进入容器 shell。",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="只打印最终的 docker run 命令，不实际执行。",
    )
    return parser


def normalize_command(command: list[str]) -> list[str]:
    if command and command[0] == "--":
        return command[1:]
    return command


def split_cli_and_container_command(argv: list[str]) -> tuple[list[str], list[str]]:
    if "--" not in argv:
        return argv, []
    separator_index = argv.index("--")
    return argv[:separator_index], argv[separator_index + 1:]


def build_docker_run_cmd(
    *,
    args: argparse.Namespace,
    appid: str,
    script_dir: Path,
    container_name: str,
    run_command_parts: list[str],
) -> list[str]:
    safe_appid = sanitize_name(appid)
    app_data_volume = f"{safe_appid}-data"

    volume_specs = [
        f"{script_dir}:{DEFAULT_SOURCE_MOUNT}",
        f"{app_data_volume}:{DEFAULT_APP_DATA_ROOT}",
    ]
    volume_specs.extend(args.volume)

    env_pairs = parse_key_value(args.env, "--env")
    env_pairs.extend(
        [
            ("BUCKYOS_APPID", appid),
            ("BUCKYOS_HOST_GATEWAY", "host.docker.internal"),
        ]
    )

    startup_script = build_runtime_bootstrap_script(
        source_mount=DEFAULT_SOURCE_MOUNT,
        runtime_workdir=args.workdir,
        app_data_root=DEFAULT_APP_DATA_ROOT,
        run_command_parts=run_command_parts,
    )

    cmd = [
        "docker",
        "run",
        "--name",
        container_name,
        "--init",
        "--rm",
        "-w",
        args.workdir,
    ]

    if args.detach:
        cmd.append("-d")
    else:
        cmd.append("-i")
        if sys.stdin.isatty() and sys.stdout.isatty():
            cmd.append("-t")

    if platform.system() == "Linux":
        cmd.extend(["--add-host", "host.docker.internal:host-gateway"])

    for port in args.port:
        cmd.extend(["-p", port])

    for key, value in env_pairs:
        cmd.extend(["-e", f"{key}={value}"])

    for volume in volume_specs:
        cmd.extend(["-v", volume])

    cmd.append(args.image)
    cmd.extend(["/bin/bash", "-lc", startup_script])
    return cmd


def main() -> int:
    parser = build_parser()
    cli_argv, raw_command = split_cli_and_container_command(sys.argv[1:])
    args = parser.parse_args(cli_argv)

    require_command("docker")

    script_dir = Path(args.script_dir).expanduser().resolve()
    if not script_dir.exists():
        raise ScriptError(f"脚本目录不存在: {script_dir}")
    if not script_dir.is_dir():
        raise ScriptError(f"脚本目录不是目录: {script_dir}")

    appid = args.appid.strip()
    if not appid:
        raise ScriptError("appid 不能为空")

    container_name = args.container_name or f"{DEFAULT_CONTAINER_PREFIX}-{sanitize_name(appid)}"

    command = normalize_command(raw_command)
    if args.shell:
        run_command_parts = ["exec", "/bin/bash"]
    elif command:
        run_command_parts = command
    else:
        run_command_parts = detect_default_command(script_dir)

    if not args.print_only:
        ensure_image(args.image, rebuild=args.rebuild_image)

    docker_run_cmd = build_docker_run_cmd(
        args=args,
        appid=appid,
        script_dir=script_dir,
        container_name=container_name,
        run_command_parts=run_command_parts,
    )

    eprint("脚本目录:", script_dir)
    eprint("容器名:", container_name)
    eprint("镜像:", args.image)
    eprint("启动命令:", " ".join(shlex.quote(part) for part in run_command_parts))

    if args.print_only:
        print(" ".join(shlex.quote(part) for part in docker_run_cmd))
        return 0

    if container_exists(container_name):
        if args.no_replace:
            raise ScriptError(f"容器已存在: {container_name}；如需覆盖，请去掉 --no-replace。")
        remove_container(container_name)

    result = run(docker_run_cmd, check=False)
    return result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ScriptError as exc:
        eprint(f"错误: {exc}")
        raise SystemExit(2) from exc
    except KeyboardInterrupt:
        eprint("已中断。")
        raise SystemExit(130)
