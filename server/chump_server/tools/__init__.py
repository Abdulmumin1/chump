__all__ = ["build_tools"]


def __getattr__(name: str):
    if name == "build_tools":
        from .builder import build_tools

        return build_tools
    raise AttributeError(name)
