FROM docker.io/cloudflare/sandbox:0.10.2-python

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/root/.local/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git procps psmisc \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && uv tool install chump-server

WORKDIR /workspace

EXPOSE 3000
EXPOSE 8080
