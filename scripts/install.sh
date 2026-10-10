#!/bin/sh
# Suara Studio installer for macOS and Linux.
#
#   curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh
#
# Pass options through the pipe with `sh -s --`, for example:
#
#   curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh -s -- --version v0.1.0
#
# Run with --help for all options. Every download is checked against the release's
# SHA256SUMS.txt before anything is installed.

set -eu

REPO="tenmaryut/suara-studio"
APP_NAME="Suara Studio"
APP_ID="suara-studio"

VERSION="${SUARA_VERSION:-}"
METHOD="${SUARA_METHOD:-auto}"
PREFIX="${SUARA_PREFIX:-${HOME:-}/.local}"
APP_DIR="${SUARA_APP_DIR:-}"
DRY_RUN="${SUARA_DRY_RUN:-0}"
# Directory or URL that holds the release files; used by tests and mirrors.
BASE_URL="${SUARA_BASE_URL:-}"
UNINSTALL=0
RELEASE_URL=""
TMP_DIR=""
SUMS=""
SUDO=""

usage() {
  cat <<EOF
Install $APP_NAME on macOS or Linux.

Usage: install.sh [options]

Options:
  --version VERSION  Install a specific release, e.g. v0.1.0 (default: latest)
  --method METHOD    Linux only: auto, deb, rpm or tarball (default: auto)
  --prefix DIR       Linux tarball install prefix (default: ~/.local)
  --app-dir DIR      macOS install folder (default: /Applications)
  --dry-run          Download and verify the release, but do not install it
  --uninstall        Remove $APP_NAME
  -h, --help         Show this help

Each option can also be set with an environment variable:
SUARA_VERSION, SUARA_METHOD, SUARA_PREFIX, SUARA_APP_DIR, SUARA_DRY_RUN=1.
EOF
}

if [ -t 1 ]; then
  BOLD=$(printf '\033[1m')
  BLUE=$(printf '\033[1;34m')
  RESET=$(printf '\033[0m')
else
  BOLD=""
  BLUE=""
  RESET=""
fi

info() { printf '%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        [ $# -ge 2 ] || die "--version needs a value"
        VERSION=$2
        shift 2
        ;;
      --version=*)
        VERSION=${1#*=}
        shift
        ;;
      --method)
        [ $# -ge 2 ] || die "--method needs a value"
        METHOD=$2
        shift 2
        ;;
      --method=*)
        METHOD=${1#*=}
        shift
        ;;
      --prefix)
        [ $# -ge 2 ] || die "--prefix needs a value"
        PREFIX=$2
        shift 2
        ;;
      --prefix=*)
        PREFIX=${1#*=}
        shift
        ;;
      --app-dir)
        [ $# -ge 2 ] || die "--app-dir needs a value"
        APP_DIR=$2
        shift 2
        ;;
      --app-dir=*)
        APP_DIR=${1#*=}
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --uninstall)
        UNINSTALL=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1 (see --help)"
        ;;
    esac
  done
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

download() {
  # download URL DESTINATION
  if has curl; then
    case "$1" in
      https://*) curl -fsSL --retry 3 --proto '=https' --tlsv1.2 -o "$2" "$1" ;;
      *) curl -fsSL --retry 3 -o "$2" "$1" ;;
    esac
  elif has wget; then
    wget -q -O "$2" "$1"
  else
    die "curl or wget is required"
  fi
}

latest_tag() {
  if has curl; then
    # GitHub redirects /releases/latest to /releases/tag/<tag>; no API quota needed.
    url=$(curl -fsSLI --retry 3 -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") || return 1
    tag=${url##*/}
  else
    download "https://api.github.com/repos/$REPO/releases/latest" "$TMP_DIR/release.json" || return 1
    tag=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP_DIR/release.json" | head -n 1)
  fi
  case "$tag" in
    v[0-9]*) printf '%s\n' "$tag" ;;
    *) return 1 ;;
  esac
}

resolve_release() {
  if [ -n "$BASE_URL" ]; then
    RELEASE_URL=${BASE_URL%/}
    return
  fi
  if [ -z "$VERSION" ]; then
    VERSION=$(latest_tag) || die "could not find a published release of $APP_NAME"
  fi
  case "$VERSION" in
    v*) ;;
    *) VERSION="v$VERSION" ;;
  esac
  RELEASE_URL="https://github.com/$REPO/releases/download/$VERSION"
}

pick_asset() {
  # Prints the first file in SHA256SUMS.txt whose name matches the extended regex $1.
  awk '{ name = $2; sub(/^\*/, "", name); print name }' "$SUMS" | grep -E -e "$1" | head -n 1 || true
}

sha256_of() {
  if has sha256sum; then
    sha256sum "$1" | awk '{ print $1 }'
  elif has shasum; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    die "sha256sum or shasum is required to verify the download"
  fi
}

fetch_asset() {
  # Downloads a release file into TMP_DIR and checks it against SHA256SUMS.txt.
  info "Downloading $1"
  download "$RELEASE_URL/$1" "$TMP_DIR/$1" || die "could not download $1"
  expected=$(awk -v name="$1" '{ file = $2; sub(/^\*/, "", file); if (file == name) { print tolower($1); exit } }' "$SUMS")
  [ -n "$expected" ] || die "no checksum listed for $1"
  actual=$(sha256_of "$TMP_DIR/$1")
  [ "$actual" = "$expected" ] || die "checksum mismatch for $1 (expected $expected, got $actual)"
  info "Checksum verified"
}

detect_arch() {
  machine=$(uname -m)
  if [ "$(uname -s)" = Darwin ] && [ "$machine" = x86_64 ] &&
    [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    # An Intel shell running under Rosetta on Apple silicon.
    machine=arm64
  fi
  case "$machine" in
    x86_64 | amd64) echo x64 ;;
    arm64 | aarch64) echo arm64 ;;
    *) die "unsupported processor architecture: $machine" ;;
  esac
}

dry_run_done() {
  info "Dry run: $1 was downloaded and verified, nothing was installed"
}

# ---- macOS ------------------------------------------------------------------------------

install_macos() {
  asset=$(pick_asset "-mac-$1\\.zip\$")
  [ -n "$asset" ] || die "this release has no macOS build for $1"
  fetch_asset "$asset"
  if [ "$DRY_RUN" = 1 ]; then
    dry_run_done "$asset"
    return
  fi

  target=${APP_DIR:-/Applications}
  if [ ! -d "$target" ] || [ ! -w "$target" ]; then
    [ -z "$APP_DIR" ] || die "cannot write to $target"
    target="$HOME/Applications"
    mkdir -p "$target"
  fi
  if pgrep -f "$target/$APP_NAME.app/Contents/MacOS/" >/dev/null 2>&1; then
    die "$APP_NAME is running. Quit it, then run the installer again."
  fi

  mkdir "$TMP_DIR/unpacked"
  if has ditto; then
    ditto -x -k "$TMP_DIR/$asset" "$TMP_DIR/unpacked"
  else
    unzip -q "$TMP_DIR/$asset" -d "$TMP_DIR/unpacked"
  fi
  [ -d "$TMP_DIR/unpacked/$APP_NAME.app" ] || die "the download does not contain $APP_NAME.app"

  rm -rf "${target:?}/$APP_NAME.app"
  mv "$TMP_DIR/unpacked/$APP_NAME.app" "$target/"
  # Files fetched with curl are not quarantined, but clear the flag in case a proxy added it.
  xattr -dr com.apple.quarantine "$target/$APP_NAME.app" 2>/dev/null || true
  info "$APP_NAME is installed in $target"
  printf 'Open it from Launchpad or run: open -a "%s"\n' "$APP_NAME"
}

uninstall_macos() {
  removed=0
  for dir in ${APP_DIR:+"$APP_DIR"} /Applications "$HOME/Applications"; do
    if [ -d "$dir/$APP_NAME.app" ]; then
      rm -rf "${dir:?}/$APP_NAME.app"
      info "Removed $dir/$APP_NAME.app"
      removed=1
    fi
  done
  [ "$removed" = 1 ] || warn "$APP_NAME is not installed"
}

# ---- Linux ------------------------------------------------------------------------------

linux_paths() {
  SHARE_DIR="$PREFIX/share/$APP_ID"
  BIN_DIR="$PREFIX/bin"
  DESKTOP_FILE="$PREFIX/share/applications/$APP_ID.desktop"
  ICON_FILE="$PREFIX/share/icons/hicolor/512x512/apps/$APP_ID.png"
}

setup_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
  elif has sudo; then
    SUDO="sudo"
  else
    return 1
  fi
}

install_linux() {
  arch=$1
  method=$METHOD
  if [ "$method" = auto ]; then
    if has dpkg && has apt-get; then
      method=deb
    elif has rpm && { has dnf || has yum || has zypper; }; then
      method=rpm
    else
      method=tarball
    fi
    if [ "$method" != tarball ] && ! setup_sudo; then
      warn "sudo is not available, so $APP_NAME will be installed for the current user only"
      method=tarball
    fi
  fi
  case "$method" in
    deb) install_deb "$arch" ;;
    rpm) install_rpm "$arch" ;;
    tarball) install_tarball "$arch" ;;
    *) die "unknown install method: $method (use auto, deb, rpm or tarball)" ;;
  esac
}

install_deb() {
  case "$1" in
    x64) deb_arch=amd64 ;;
    *) deb_arch=$1 ;;
  esac
  asset=$(pick_asset "_${deb_arch}\\.deb\$")
  [ -n "$asset" ] || die "this release has no .deb package for $deb_arch; try --method tarball"
  fetch_asset "$asset"
  if [ "$DRY_RUN" = 1 ]; then
    dry_run_done "$asset"
    return
  fi
  setup_sudo || die "installing a .deb package needs root or sudo; try --method tarball"
  # apt drops privileges to read local packages, so the file must be world-readable.
  chmod 755 "$TMP_DIR"
  chmod 644 "$TMP_DIR/$asset"
  info "Installing $asset with apt (you may be asked for your password)"
  $SUDO apt-get install -y "$TMP_DIR/$asset"
  info "$APP_NAME is installed. Start it from your applications menu or run: $APP_ID"
}

install_rpm() {
  case "$1" in
    x64) rpm_arch=x86_64 ;;
    arm64) rpm_arch=aarch64 ;;
    *) rpm_arch=$1 ;;
  esac
  asset=$(pick_asset "\\.${rpm_arch}\\.rpm\$")
  [ -n "$asset" ] || die "this release has no .rpm package for $rpm_arch; try --method tarball"
  fetch_asset "$asset"
  if [ "$DRY_RUN" = 1 ]; then
    dry_run_done "$asset"
    return
  fi
  setup_sudo || die "installing an .rpm package needs root or sudo; try --method tarball"
  info "Installing $asset (you may be asked for your password)"
  if has dnf; then
    $SUDO dnf install -y "$TMP_DIR/$asset"
  elif has yum; then
    $SUDO yum install -y "$TMP_DIR/$asset"
  elif has zypper; then
    $SUDO zypper --non-interactive install --allow-unsigned-rpm "$TMP_DIR/$asset"
  else
    die "no supported package manager found (dnf, yum or zypper); try --method tarball"
  fi
  info "$APP_NAME is installed. Start it from your applications menu or run: $APP_ID"
}

install_tarball() {
  asset=$(pick_asset "-linux-$1\\.tar\\.gz\$")
  [ -n "$asset" ] || die "this release has no Linux archive for $1"
  fetch_asset "$asset"
  if [ "$DRY_RUN" = 1 ]; then
    dry_run_done "$asset"
    return
  fi

  linux_paths
  mkdir "$TMP_DIR/unpacked"
  tar -xzf "$TMP_DIR/$asset" -C "$TMP_DIR/unpacked"
  executable=$(find "$TMP_DIR/unpacked" -maxdepth 2 -type f -name "$APP_ID" | head -n 1)
  [ -n "$executable" ] || die "the archive does not contain the $APP_ID program"

  mkdir -p "$SHARE_DIR" "$BIN_DIR" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"
  rm -rf "${SHARE_DIR:?}/app"
  mv "$(dirname "$executable")" "$SHARE_DIR/app"

  # The launcher turns off Chromium's sandbox only where the kernel forbids the
  # unprivileged user namespaces it needs (Ubuntu 24.04+ AppArmor default).
  cat >"$BIN_DIR/$APP_ID" <<EOF
#!/bin/sh
# Created by the $APP_NAME installer.
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ]; then
  set -- --no-sandbox "\$@"
fi
exec "$SHARE_DIR/app/$APP_ID" "\$@"
EOF
  chmod 755 "$BIN_DIR/$APP_ID"

  if [ -f "$SHARE_DIR/app/resources/icon.png" ]; then
    cp "$SHARE_DIR/app/resources/icon.png" "$ICON_FILE"
  fi
  cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=Record and edit audio
Exec="$BIN_DIR/$APP_ID" %F
Icon=$APP_ID
Terminal=false
Categories=AudioVideo;Audio;Recorder;
StartupWMClass=$APP_ID
EOF
  if has update-desktop-database; then
    update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
  fi

  info "$APP_NAME is installed in $SHARE_DIR"
  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) printf 'Start it from your applications menu or run: %s\n' "$APP_ID" ;;
    *) printf 'Start it from your applications menu or run: %s\n' "$BIN_DIR/$APP_ID" ;;
  esac
}

uninstall_linux() {
  removed=0
  if has dpkg-query && [ "$(dpkg-query -W -f='${Status}' "$APP_ID" 2>/dev/null)" = "install ok installed" ]; then
    setup_sudo || die "removing the .deb package needs root or sudo"
    $SUDO apt-get remove -y "$APP_ID"
    removed=1
  elif has rpm && rpm -q "$APP_ID" >/dev/null 2>&1; then
    setup_sudo || die "removing the .rpm package needs root or sudo"
    if has dnf; then
      $SUDO dnf remove -y "$APP_ID"
    elif has yum; then
      $SUDO yum remove -y "$APP_ID"
    else
      $SUDO zypper --non-interactive remove "$APP_ID"
    fi
    removed=1
  fi
  linux_paths
  if [ -d "$SHARE_DIR" ] || [ -f "$BIN_DIR/$APP_ID" ]; then
    rm -rf "${SHARE_DIR:?}"
    rm -f "$BIN_DIR/$APP_ID" "$DESKTOP_FILE" "$ICON_FILE"
    removed=1
  fi
  if [ "$removed" = 1 ]; then
    info "$APP_NAME was removed. Your recordings were not touched."
  else
    warn "$APP_NAME is not installed"
  fi
}

# ---- Main -----------------------------------------------------------------------------

main() {
  parse_args "$@"
  os=$(uname -s)
  case "$os" in
    Darwin | Linux) ;;
    *) die "unsupported system: $os. On Windows, run in PowerShell: irm https://github.com/$REPO/releases/latest/download/install.ps1 | iex" ;;
  esac

  if [ "$UNINSTALL" = 1 ]; then
    if [ "$os" = Darwin ]; then uninstall_macos; else uninstall_linux; fi
    return
  fi

  arch=$(detect_arch)
  TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t suara-studio)
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  SUMS="$TMP_DIR/SHA256SUMS.txt"

  resolve_release
  info "Installing $APP_NAME ${VERSION:-from $RELEASE_URL}"
  download "$RELEASE_URL/SHA256SUMS.txt" "$SUMS" || die "could not download the release checksums from $RELEASE_URL"

  if [ "$os" = Darwin ]; then
    install_macos "$arch"
  else
    install_linux "$arch"
  fi
}

main "$@"
