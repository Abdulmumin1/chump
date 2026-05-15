import subprocess
from pathlib import Path

def get_git_branch(workspace_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=workspace_root,
            capture_output=True,
            text=True,
            check=True
        )
        branch = result.stdout.strip()
        if branch:
            return branch

        # Fallback for detached head
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=workspace_root,
            capture_output=True,
            text=True,
            check=True
        )
        commit = result.stdout.strip()
        return f"HEAD ({commit})" if commit else None

    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
