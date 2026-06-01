#!/usr/bin/env bash
set -euo pipefail

APP="chump"
REPO="Abdulmumin1/chump"
DEFAULT_INSTALL_DIR="$HOME/.chump/bin"
INSTALL_DIR="${CHUMP_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

is_light_theme() {
    case "${CHUMP_THEME:-}" in
        light) return 0 ;;
        dark) return 1 ;;
    esac

    # Many terminals expose foreground;background ANSI color indexes here.
    # Background indexes 7 and 15 are the common light backgrounds.
    if [[ "${COLORFGBG:-}" =~ \;([0-9]+)$ ]]; then
        case "${BASH_REMATCH[1]}" in
            7|15) return 0 ;;
            *) return 1 ;;
        esac
    fi

    # Last resort on macOS: follows the OS appearance when the terminal does not
    # expose its own theme. `defaults` prints "Dark" only for dark appearance.
    if [[ "$(uname -s)" == "Darwin" ]]; then
        [[ "$(defaults read -g AppleInterfaceStyle 2>/dev/null || true)" != "Dark" ]]
        return $?
    fi

    return 1
}

set_palette() {
    if [[ "${NO_COLOR:-}" == "1" ]]; then
        ACCENT=''
        ACCENT_DIM=''
        MUTED=''
        TEXT=''
        GREEN=''
        YELLOW=''
        RED=''
        BOLD=''
        DIM=''
        NC=''
        return 0
    fi

    BOLD='\033[1m'
    DIM='\033[2m'

    if is_light_theme; then
        # Light terminal palette: same Chump lime family, darker ink for contrast.
        ACCENT='\033[38;2;127;137;50m'
        ACCENT_DIM='\033[38;2;154;163;34m'
        MUTED='\033[38;2;90;82;77m'
        TEXT='\033[38;2;58;53;48m'
        GREEN='\033[38;2;55;128;63m'
        YELLOW='\033[38;2;138;90;68m'
        RED='\033[38;2;185;70;53m'
        DIM=''
        return 0
    fi

    # Dark terminal palette: bright Chump lime, warm neutrals, soft states.
    ACCENT='\033[38;2;228;242;34m'
    ACCENT_DIM='\033[38;2;127;137;50m'
    MUTED='\033[38;2;138;138;150m'
    TEXT='\033[38;2;212;212;212m'
    GREEN='\033[38;2;126;231;135m'
    YELLOW='\033[38;2;206;145;120m'
    RED='\033[38;2;244;135;113m'
}

set_palette

requested_version="${VERSION:-}"
binary_path=""
no_modify_path=false
uninstall=false
dry_run=false

usage() {
    cat <<EOF
chump installer

Usage: install.sh [options]

Options:
  -h, --help                 Show this help
  -v, --version <tag>        Install a specific release tag, e.g. v0.1.0
  -b, --binary <path>        Install from a local binary instead of downloading
      --install-dir <path>   Install somewhere else (default: $DEFAULT_INSTALL_DIR)
      --no-modify-path       Do not edit shell config files
      --uninstall            Remove the chump binary and managed PATH blocks
      --dry-run              Print what would happen without changing files

Examples:
  curl -fsSL https://chump.yaqeen.me/install.sh | bash
  curl -fsSL https://chump.yaqeen.me/install.sh | bash -s -- --version v0.1.0
  ./install.sh --binary ./chump --install-dir /tmp/chump-bin --no-modify-path
  ./install.sh --uninstall
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -z "${2:-}" ]]; then
                echo -e "${RED}error:${NC} --version requires a release tag" >&2
                exit 1
            fi
            requested_version="$2"
            shift 2
            ;;
        -b|--binary)
            if [[ -z "${2:-}" ]]; then
                echo -e "${RED}error:${NC} --binary requires a path" >&2
                exit 1
            fi
            binary_path="$2"
            shift 2
            ;;
        --install-dir)
            if [[ -z "${2:-}" ]]; then
                echo -e "${RED}error:${NC} --install-dir requires a path" >&2
                exit 1
            fi
            INSTALL_DIR="$2"
            shift 2
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        --uninstall)
            uninstall=true
            shift
            ;;
        --dry-run)
            dry_run=true
            shift
            ;;
        *)
            echo -e "${YELLOW}warning:${NC} unknown option '$1'" >&2
            shift
            ;;
    esac
done

say() { echo -e "$*"; }
info() { say "${MUTED}$*${NC}"; }
success() { say "${GREEN}$*${NC}"; }
warn() { say "${YELLOW}$*${NC}"; }
fail() { say "${RED}$*${NC}" >&2; }

run() {
    if [[ "$dry_run" == "true" ]]; then
        info "dry-run: $*"
        return 0
    fi
    "$@"
}

banner() {
    if [[ "${NO_COLOR:-}" == "1" ]]; then
        return 0
    fi

    say ""
    say "${ACCENT}        ▗▄▄▖ ▗▖ ▗▖▗▖ ▗▖▗▖  ▗▖▗▄▄▖ ${NC}"
    say "${ACCENT}       ▐▌    ▐▌ ▐▌▐▛▚▞▜▌▐▛▚▖▐▌▐▌ ▐▌${NC}"
    say "${ACCENT_DIM}       ▐▌    ▐▛▀▜▌▐▌  ▐▌▐▌ ▝▜▌▐▛▀▘ ${NC}"
    say "${ACCENT_DIM}       ▝▚▄▄▖▐▌ ▐▌▐▌  ▐▌▐▌  ▐▌▐▌   ${NC}"
    say "${DIM}${TEXT}        tiny agent, sharp teeth, shared context${NC}"
    say ""
}

step() {
    say "${ACCENT}◆${NC} ${TEXT}$*${NC}"
}

detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "darwin" ;;
        Linux*) echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) echo "unsupported" ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) echo "unsupported" ;;
    esac
}

check_rosetta() {
    if [[ "$(detect_os)" == "darwin" && "$(detect_arch)" == "x64" ]]; then
        if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" == "1" ]]; then
            echo "arm64"
            return 0
        fi
    fi
    detect_arch
}

release_tag_from_api() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=30" \
        | sed -n 's/.*"tag_name": *"\(chump-agent@[^"]*\)".*/\1/p' \
        | head -n 1
}

release_tag_from_redirect() {
    local location
    location=$(curl -fsSI "https://github.com/${REPO}/releases/latest" 2>/dev/null \
        | grep -i "^location:" \
        | sed -n 's/.*tag\/\([^[:space:]]*\).*/\1/p' \
        | tr -d '\r' \
        | head -n 1)
    if [[ -n "$location" && "$location" == chump-agent@* ]]; then
        echo "$location"
        return 0
    fi
    return 1
}

latest_release_tag() {
    local tag
    tag=$(release_tag_from_api 2>/dev/null || true)
    if [[ -n "$tag" ]]; then
        echo "$tag"
        return 0
    fi
    release_tag_from_redirect
}

unbuffered_sed() {
    if echo | sed -u -e "" >/dev/null 2>&1; then
        sed -nu "$@"
        return 0
    fi

    if echo | sed -l -e "" >/dev/null 2>&1; then
        sed -nl "$@"
        return 0
    fi

    local pad
    pad="$(printf "\n%512s" "")"
    sed -ne "s/$/\\${pad}/" "$@"
}

print_progress() {
    local bytes="$1"
    local length="$2"
    [[ "$length" -gt 0 ]] || return 0

    local width=42
    local percent=$(( bytes * 100 / length ))
    [[ "$percent" -gt 100 ]] && percent=100

    local on=$(( percent * width / 100 ))
    local off=$(( width - on ))
    local filled empty pointer

    if [[ "$on" -gt 0 ]]; then
        filled=$(printf "%*s" "$((on - 1))" "")
        filled=${filled// /━}
        pointer="◆"
    else
        filled=""
        pointer=""
    fi

    empty=$(printf "%*s" "$off" "")
    empty=${empty// /·}

    printf "\r${ACCENT}%s%s${ACCENT_DIM}%s${NC} ${TEXT}%3d%%${NC}" "$filled" "$pointer" "$empty" "$percent" >&4
}

download_with_progress() {
    local url="$1"
    local output="$2"
    local tracefile

    if [[ ! -t 2 || "${NO_COLOR:-}" == "1" ]]; then
        return 1
    fi

    tracefile="${TMPDIR:-/tmp}/chump-install-trace-$$"
    rm -f "$tracefile"

    if ! mkfifo "$tracefile" 2>/dev/null; then
        return 1
    fi

    exec 4>&2
    printf "\033[?25l" >&4

    trap "trap - RETURN; rm -f '$tracefile'; printf '\033[?25h' >&4; exec 4>&-" RETURN

    curl -f -sSL --trace-ascii "$tracefile" -o "$output" "$url" &
    local curl_pid=$!

    unbuffered_sed \
        -e 'y/ACDEGHLNORTV/acdeghlnortv/' \
        -e '/^0000: content-length:/p' \
        -e '/^<= recv data/p' \
        "$tracefile" | \
    {
        local length=0
        local bytes=0

        while IFS=" " read -r -a line; do
            [[ "${#line[@]}" -lt 2 ]] && continue

            if [[ "${line[0]} ${line[1]}" == "0000: content-length:" ]]; then
                length="${line[2]}"
                length=$(echo "$length" | tr -d '\r')
                bytes=0
                print_progress 0 "$length"
                continue
            fi

            if [[ "${line[0]} ${line[1]}" == "<= recv" ]]; then
                [[ "${#line[@]}" -ge 4 && "${line[3]}" =~ ^[0-9]+$ ]] || continue
                bytes=$(( bytes + line[3] ))
                print_progress "$bytes" "$length"
            fi
        done
    }

    wait "$curl_pid"
    local status=$?

    if [[ $status -eq 0 ]]; then
        print_progress 100 100
        printf "\n" >&4
    else
        printf "\n" >&4
    fi

    return $status
}

shell_name() {
    basename "${SHELL:-sh}"
}

candidate_shell_configs() {
    local xdg_config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
    case "$(shell_name)" in
        fish) echo "$HOME/.config/fish/config.fish" ;;
        zsh) echo "${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $xdg_config_home/zsh/.zshrc $xdg_config_home/zsh/.zshenv" ;;
        bash) echo "$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $xdg_config_home/bash/.bashrc $xdg_config_home/bash/.bash_profile" ;;
        ash|sh) echo "$HOME/.ashrc $HOME/.profile /etc/profile" ;;
        *) echo "$HOME/.bashrc $HOME/.bash_profile $HOME/.profile" ;;
    esac
}

path_command() {
    if [[ "$(shell_name)" == "fish" ]]; then
        echo "fish_add_path $INSTALL_DIR"
        return 0
    fi
    echo "export PATH=\"$INSTALL_DIR:\$PATH\""
}

path_block() {
    cat <<EOF
# chump install
$(path_command)
# /chump install
EOF
}

first_existing_config() {
    local file
    for file in $(candidate_shell_configs); do
        if [[ -f "$file" ]]; then
            echo "$file"
            return 0
        fi
    done
    return 1
}

add_to_path() {
    if [[ "$no_modify_path" == "true" ]]; then
        info "PATH unchanged (--no-modify-path)"
        return 0
    fi

    if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
        info "$INSTALL_DIR is already on PATH"
        return 0
    fi

    local config_file=""
    config_file=$(first_existing_config || true)
    if [[ -z "$config_file" ]]; then
        warn "No shell config found for $(shell_name). Add this manually:"
        say "  $(path_command)"
        return 0
    fi

    if grep -Fq "$INSTALL_DIR" "$config_file" 2>/dev/null; then
        info "PATH entry already exists in $config_file"
        return 0
    fi

    if [[ ! -w "$config_file" ]]; then
        warn "Cannot write $config_file. Add this manually:"
        say "  $(path_command)"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        info "dry-run: append managed PATH block to $config_file"
        return 0
    fi

    {
        echo ""
        path_block
    } >> "$config_file"
    success "Added chump to PATH in $config_file"
}

remove_path_blocks_from_file() {
    local file="$1"
    [[ -f "$file" && -w "$file" ]] || return 0

    if [[ "$dry_run" == "true" ]]; then
        if grep -Fq "chump" "$file" 2>/dev/null; then
            info "dry-run: remove managed chump PATH block from $file"
        fi
        return 0
    fi

    local tmp
    tmp=$(mktemp)
    awk -v install_dir="$INSTALL_DIR" '
        $0 == "# chump install" { managed=1; changed=1; next }
        $0 == "# /chump install" && managed { managed=0; next }
        managed { next }
        $0 == "# chump" { legacy=1; legacy_line=$0; next }
        legacy {
            if (index($0, install_dir) > 0 || index($0, "fish_add_path " install_dir) > 0) {
                changed=1
                legacy=0
                next
            }
            print legacy_line
            legacy=0
        }
        { print }
        END {
            if (legacy) print legacy_line
        }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
}

remove_path_blocks() {
    if [[ "$no_modify_path" == "true" ]]; then
        info "PATH cleanup skipped (--no-modify-path)"
        return 0
    fi

    local file
    for file in $(candidate_shell_configs); do
        remove_path_blocks_from_file "$file"
    done
}

install_from_binary() {
    if [[ ! -f "$binary_path" ]]; then
        fail "Binary not found: $binary_path"
        exit 1
    fi

    step "Installing local binary"
    run mkdir -p "$INSTALL_DIR"
    run rm -f "$INSTALL_DIR"/chump-server-*
    run cp "$binary_path" "$INSTALL_DIR/$APP"
    run chmod 755 "$INSTALL_DIR/$APP"
}

download_binary() {
    local url="$1"
    local output="$2"

    if [[ "$dry_run" == "true" ]]; then
        info "dry-run: curl -fSL --progress-bar -o $output $url"
        return 0
    fi

    if download_with_progress "$url" "$output"; then
        return 0
    fi

    curl -fSL --progress-bar -o "$output" "$url"
}

install_from_release() {
    local os arch package_name latest_tag url tmp_file extract_dir package_dir server_file
    os=$(detect_os)
    arch=$(check_rosetta)

    if [[ "$os" == "unsupported" || "$arch" == "unsupported" ]]; then
        fail "Unsupported platform: $(uname -s) $(uname -m)"
        exit 1
    fi

    package_name="chump-${os}-${arch}.tar.gz"

    step "Detected ${os}-${arch}"

    if [[ -n "$requested_version" ]]; then
        latest_tag="$requested_version"
    elif [[ "$dry_run" == "true" ]]; then
        latest_tag="latest"
    else
        step "Fetching latest release"
        latest_tag=$(latest_release_tag)
    fi

    if [[ -z "$latest_tag" ]]; then
        fail "Failed to fetch latest version"
        exit 1
    fi

    url="https://github.com/${REPO}/releases/download/${latest_tag}/${package_name}"
    tmp_file="${TMPDIR:-/tmp}/chump-install-${$}-${package_name}"
    extract_dir="${TMPDIR:-/tmp}/chump-install-${$}"
    package_dir="$extract_dir/chump-${os}-${arch}"

    step "Installing ${BOLD}${latest_tag}${NC}${TEXT} into ${INSTALL_DIR}"
    run mkdir -p "$INSTALL_DIR"
    run rm -rf "$extract_dir"

    if ! download_binary "$url" "$tmp_file"; then
        fail "Download failed: $url"
        exit 1
    fi

    run mkdir -p "$extract_dir"
    run tar -xzf "$tmp_file" -C "$extract_dir"
    if [[ "$dry_run" == "true" ]]; then
        info "dry-run: validate archive contains chump and chump-server binaries"
        return 0
    fi

    if [[ ! -f "$package_dir/chump" ]]; then
        fail "Release archive is missing chump binary"
        exit 1
    fi
    server_file=$(find "$package_dir" -maxdepth 1 -type f -name 'chump-server-*' | head -n 1)
    if [[ -z "$server_file" ]]; then
        fail "Release archive is missing chump-server binary"
        exit 1
    fi

    local staged_app staged_server installed_server
    staged_app="$INSTALL_DIR/.$APP.install-${$}"
    installed_server="$INSTALL_DIR/$(basename "$server_file")"
    staged_server="$INSTALL_DIR/.$(basename "$server_file").install-${$}"

    run cp "$package_dir/chump" "$staged_app"
    run cp "$server_file" "$staged_server"
    run chmod 755 "$staged_app"
    run chmod 755 "$staged_server"
    run mv -f "$staged_app" "$INSTALL_DIR/$APP"
    run rm -f "$INSTALL_DIR"/chump-server-*
    run mv -f "$staged_server" "$installed_server"
    run rm -rf "$extract_dir" "$tmp_file"
}

uninstall_chump() {
    step "Removing chump from $INSTALL_DIR"
    run rm -f "$INSTALL_DIR/$APP"
    run rm -f "$INSTALL_DIR"/chump-server-*
    if [[ -d "$INSTALL_DIR" ]]; then
        run rmdir "$INSTALL_DIR" 2>/dev/null || true
    fi
    if [[ "$(dirname "$INSTALL_DIR")" == "$HOME/.chump" && -d "$HOME/.chump" ]]; then
        run rmdir "$HOME/.chump" 2>/dev/null || true
    fi
    remove_path_blocks
    success "chump uninstall complete"
}

finish() {
    say ""
    if [[ "$dry_run" == "true" ]]; then
        success "dry run complete"
    else
        success "chump is installed"
    fi
    say ""
    info "next moves:"
    say "  ${ACCENT}cd <project>${NC}     ${MUTED}# open a repo${NC}"
    say "  ${ACCENT}chump${NC}            ${MUTED}# start the interactive agent${NC}"
    say "  ${ACCENT}chump -p \"hi\"${NC}   ${MUTED}# run one prompt${NC}"
    say ""

    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        info "for this terminal, run:"
        say "  ${ACCENT}export PATH=\"$INSTALL_DIR:\$PATH\"${NC}"
        say ""
    fi
}

banner

if [[ "$uninstall" == "true" ]]; then
    uninstall_chump
    exit 0
fi

if [[ -n "$binary_path" ]]; then
    install_from_binary
else
    install_from_release
fi

add_to_path

if [[ "${GITHUB_ACTIONS:-}" == "true" && -n "${GITHUB_PATH:-}" ]]; then
    if [[ "$dry_run" == "true" ]]; then
        info "dry-run: add $INSTALL_DIR to \$GITHUB_PATH"
    else
        echo "$INSTALL_DIR" >> "$GITHUB_PATH"
        info "Added $INSTALL_DIR to \$GITHUB_PATH"
    fi
fi

finish
