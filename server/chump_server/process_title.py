from __future__ import annotations

import platform


def set_process_title(title: str) -> None:
    """Best-effort process labeling for process monitors."""

    try:
        from setproctitle import setproctitle

        setproctitle(title)
    except Exception:
        pass

    try:
        if platform.system() == "Linux":
            _set_linux_comm(title)
            return
        if platform.system() == "Windows":
            _set_windows_console_title(title)
            return
        if platform.system() == "Darwin":
            _set_darwin_process_name(title)
    except Exception:
        return


def _set_linux_comm(title: str) -> None:
    import ctypes

    libc = ctypes.CDLL(None)
    # PR_SET_NAME is limited to 15 bytes plus NUL by Linux.
    encoded = title.encode("utf-8")[:15]
    libc.prctl(15, ctypes.c_char_p(encoded), 0, 0, 0)


def _set_windows_console_title(title: str) -> None:
    import ctypes

    ctypes.windll.kernel32.SetConsoleTitleW(title)


def _set_darwin_process_name(title: str) -> None:
    import ctypes

    libc = ctypes.CDLL(None)
    libc.setprogname.argtypes = [ctypes.c_char_p]
    libc.setprogname(title.encode("utf-8"))
