from __future__ import annotations

import sys
from pathlib import Path


def extract_section(changelog: Path, version: str) -> str:
    lines = changelog.read_text(encoding="utf-8").splitlines()
    capture = False
    notes: list[str] = []

    for line in lines:
        if line.startswith("## "):
            if capture:
                break
            capture = line[3:].strip() == version
            continue
        if capture:
            notes.append(line)

    content = "\n".join(notes).strip()
    if not content:
        print(f"no changelog entry found for {version}, falling back to default message")
        return f"Release {version}\n"
    return content + "\n"


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: extract_release_notes.py <changelog> <version> <output>"
        )

    changelog = Path(sys.argv[1])
    version = sys.argv[2]
    output = Path(sys.argv[3])
    output.write_text(extract_section(changelog, version), encoding="utf-8")


if __name__ == "__main__":
    main()
