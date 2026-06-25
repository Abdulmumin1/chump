from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from argparse import ArgumentParser
from pathlib import Path


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("onefile", "onedir"),
        default="onefile",
        help="Build a single executable for server-only releases or a directory runtime for bundled client archives.",
    )
    parser.add_argument(
        "--archive",
        action="store_true",
        help="When building in onedir mode, also write a .tar.gz archive suitable for GitHub release assets.",
    )
    args = parser.parse_args()
    if args.archive and args.mode != "onedir":
        raise SystemExit("--archive is only supported with --mode onedir")

    server_dir = Path(__file__).resolve().parents[1]
    dist_dir = server_dir / "dist" / "bin"
    build_dir = server_dir / "build" / "pyinstaller"
    work_dir = server_dir / "build" / "pyinstaller-work"
    spec_dir = server_dir / "build"
    entrypoint = server_dir / "build" / "pyinstaller_entry.py"
    dist_dir.mkdir(parents=True, exist_ok=True)
    build_dir.mkdir(parents=True, exist_ok=True)
    entrypoint.write_text(
        "from chump_server.main import main\n\nif __name__ == '__main__':\n    main()\n",
        encoding="utf-8",
    )

    name = "chump-server"
    command = [
        "uv",
        "run",
        "--with",
        "pyinstaller",
        "pyinstaller",
        "-y",
        "--clean",
        f"--{args.mode}",
        "--copy-metadata",
        "chump-server",
        "--copy-metadata",
        "ai-query",
        "--name",
        name,
        "--distpath",
        str(build_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        str(entrypoint),
    ]
    subprocess.run(command, cwd=server_dir, check=True)

    executable = (
        build_dir / executable_name(name)
        if args.mode == "onefile"
        else build_dir / name / executable_name(name)
    )
    if not executable.exists():
        raise SystemExit(f"missing built executable: {executable}")

    if args.mode == "onefile":
        target = dist_dir / executable_name(f"chump-server-{platform_suffix()}")
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        shutil.copy2(executable, target)
        target.chmod(0o755)
    else:
        target = dist_dir / f"chump-server-{platform_suffix()}"
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        shutil.copytree(build_dir / name, target)
        (target / executable_name(name)).chmod(0o755)
        if args.archive:
            archive_base = dist_dir / target.name
            archive_path = Path(
                shutil.make_archive(
                    str(archive_base),
                    "gztar",
                    root_dir=dist_dir,
                    base_dir=target.name,
                )
            )
            print(archive_path)
    print(target)


def executable_name(name: str) -> str:
    return f"{name}.exe" if sys.platform == "win32" else name


def platform_suffix() -> str:
    system = platform.system().lower()
    if system == "darwin":
        os_name = "darwin"
    elif system == "windows":
        os_name = "windows"
    elif system == "linux":
        os_name = "linux"
    else:
        raise SystemExit(f"unsupported platform: {system}")

    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        arch = "x64"
    elif machine in {"aarch64", "arm64"}:
        arch = "arm64"
    else:
        raise SystemExit(f"unsupported architecture: {machine}")
    return f"{os_name}-{arch}"


if __name__ == "__main__":
    main()
