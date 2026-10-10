#!/bin/sh
# Tests scripts/install.sh against a fake release on the local disk (file:// URLs).
# Usage: sh tests/install/run.sh
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
INSTALLER="$ROOT/scripts/install.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

COUNT=0
ok() {
  COUNT=$((COUNT + 1))
  printf 'ok %d - %s\n' "$COUNT" "$*"
}
fail() {
  printf 'not ok - %s\n' "$*" >&2
  if [ -f "$WORK/out.log" ]; then
    sed 's/^/    /' "$WORK/out.log" >&2
  fi
  exit 1
}
# Runs the installer, capturing output in $WORK/out.log; returns its exit status.
run_installer() {
  sh "$INSTALLER" "$@" >"$WORK/out.log" 2>&1
}
expect_log() {
  grep -q -- "$1" "$WORK/out.log" || fail "expected output to contain: $1"
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) fail "unsupported test architecture" ;;
esac
OS=$(uname -s)

# ---- Build a fake release -----------------------------------------------------------------

RELEASE="$WORK/release"
mkdir -p "$RELEASE" "$WORK/build/suara-studio-9.9.9/resources"
cat >"$WORK/build/suara-studio-9.9.9/suara-studio" <<'EOF'
#!/bin/sh
echo "fake suara $*"
EOF
chmod 755 "$WORK/build/suara-studio-9.9.9/suara-studio"
printf 'icon' >"$WORK/build/suara-studio-9.9.9/resources/icon.png"
tar -czf "$RELEASE/suara-studio-9.9.9-linux-$ARCH.tar.gz" -C "$WORK/build" suara-studio-9.9.9
printf 'not really a package' >"$RELEASE/suara-studio_9.9.9_amd64.deb"

if [ "$OS" = Darwin ]; then
  mkdir -p "$WORK/build/mac/Suara Studio.app/Contents/MacOS"
  printf '#!/bin/sh\n' >"$WORK/build/mac/Suara Studio.app/Contents/MacOS/Suara Studio"
  (cd "$WORK/build/mac" && ditto -c -k --keepParent "Suara Studio.app" "$RELEASE/suara-studio-9.9.9-mac-$ARCH.zip")
fi

(cd "$RELEASE" && sha256 -- * >SHA256SUMS.txt)
export SUARA_BASE_URL="file://$RELEASE"

# ---- Option handling ------------------------------------------------------------------------

run_installer --help || fail "--help should succeed"
expect_log "Usage: install.sh"
ok "--help prints usage"

if run_installer --bogus; then fail "unknown options should fail"; fi
expect_log "unknown option: --bogus"
ok "unknown options are rejected"

if run_installer --version; then fail "--version without a value should fail"; fi
expect_log "--version needs a value"
ok "options that need a value say so"

# ---- Linux -------------------------------------------------------------------------------------

if [ "$OS" = Linux ]; then
  PREFIX="$WORK/prefix"

  run_installer --method tarball --prefix "$PREFIX" || fail "tarball install failed"
  expect_log "Checksum verified"
  [ -x "$PREFIX/bin/suara-studio" ] || fail "launcher missing"
  output=$("$PREFIX/bin/suara-studio" --hello)
  case "$output" in
    "fake suara "*"--hello") ;;
    *) fail "launcher ran the wrong program: $output" ;;
  esac
  grep -q "^Exec=\"$PREFIX/bin/suara-studio\" %F$" "$PREFIX/share/applications/suara-studio.desktop" ||
    fail "desktop entry missing or wrong"
  [ -f "$PREFIX/share/icons/hicolor/512x512/apps/suara-studio.png" ] || fail "icon missing"
  ok "tarball install creates the launcher, desktop entry and icon"

  run_installer --method=tarball --prefix="$PREFIX" || fail "reinstall failed"
  [ -x "$PREFIX/share/suara-studio/app/suara-studio" ] || fail "reinstall lost the app"
  ok "reinstalling over an existing install works"

  run_installer --method deb --dry-run || fail "deb dry run failed"
  expect_log "Dry run"
  ok "dry run downloads and verifies without installing"

  if run_installer --method rpm --dry-run; then fail "missing rpm should fail"; fi
  expect_log "no .rpm package"
  ok "a missing package type is reported"

  run_installer --uninstall --prefix "$PREFIX" || fail "uninstall failed"
  [ ! -e "$PREFIX/bin/suara-studio" ] || fail "launcher not removed"
  [ ! -e "$PREFIX/share/suara-studio" ] || fail "app folder not removed"
  [ ! -e "$PREFIX/share/applications/suara-studio.desktop" ] || fail "desktop entry not removed"
  ok "uninstall removes a tarball install"
fi

# ---- macOS -------------------------------------------------------------------------------------

if [ "$OS" = Darwin ]; then
  APPS="$WORK/Applications"
  mkdir -p "$APPS"
  run_installer --app-dir "$APPS" || fail "macOS install failed"
  [ -f "$APPS/Suara Studio.app/Contents/MacOS/Suara Studio" ] || fail "app bundle missing"
  ok "macOS install unpacks the app bundle"

  run_installer --uninstall --app-dir "$APPS" || fail "macOS uninstall failed"
  [ ! -e "$APPS/Suara Studio.app" ] || fail "app bundle not removed"
  ok "macOS uninstall removes the app bundle"
fi

# ---- Integrity -----------------------------------------------------------------------------

for file in "$RELEASE"/*.tar.gz "$RELEASE"/*.zip; do
  [ -f "$file" ] && printf 'tampered' >>"$file"
done
if run_installer --method tarball --prefix "$WORK/other" --app-dir "$WORK"; then
  fail "a tampered download must not install"
fi
expect_log "checksum mismatch"
[ ! -e "$WORK/other/bin/suara-studio" ] || fail "tampered download was installed"
ok "a tampered download is refused"

printf '%d install script tests passed\n' "$COUNT"
