#!/usr/bin/env bash
set -Eeuo pipefail
# Publish only the workplace QR static site. Authentication uses existing SSH configuration.
# Usage: bash scripts/kiosk_vps_deploy.sh user@host /absolute/path/to/kiosk.tar.gz
host="${1:?SSH host is required}"
archive="${2:?Verified kiosk archive is required}"
[[ "$host" != -* && -s "$archive" ]] || { echo 'Invalid host or missing archive'; exit 2; }
[[ "$(sha256sum "$archive" | cut -d ' ' -f 1)" == '0e36bd0fa9c67061fc7b828787b5a633d361544c1d26fbbf83ef3848703635ab' ]] || {
  echo 'Archive does not match the prepared 2026-10-11 release'; exit 2;
}
release="20261011-eb8fe3a-$(date -u +%H%M%S)"
ssh_args=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)
upload_dir=$(ssh "${ssh_args[@]}" "$host" 'mktemp -d /tmp/smena-kiosk-upload.XXXXXXXX')
[[ "$upload_dir" =~ ^/tmp/smena-kiosk-upload\.[A-Za-z0-9]+$ ]] || { echo 'Unexpected upload directory'; exit 3; }
scp "${ssh_args[@]}" "$archive" "$host:$upload_dir/kiosk.tar.gz"
ssh "${ssh_args[@]}" "$host" bash -s -- "$upload_dir" "$release" <<'REMOTE'
set -Eeuo pipefail
upload_dir=$1
release=$2
root=/var/www/smena-servgo
[[ "$upload_dir" =~ ^/tmp/smena-kiosk-upload\.[A-Za-z0-9]+$ && "$release" =~ ^20261011-eb8fe3a-[0-9]{6}$ ]]
[[ -L "$root/current" ]]
previous=$(readlink -f "$root/current")
[[ "$previous" == "$root/releases/"* && -s "$previous/index.html" ]]
mkdir "$root/releases/$release"
tar -xzf "$upload_dir/kiosk.tar.gz" -C "$root/releases/$release" --no-same-owner
cd "$root/releases/$release"
sha256sum -c SHA256SUMS
[[ -s index.html ]]
nginx -t
# Preserve all old releases. A failed public check switches the link back.
ln -s "$root/releases/$release" "$root/current.$release"
mv -Tf "$root/current.$release" "$root/current"
if ! curl --fail --silent --show-error --max-time 20 https://smena.servgo.ru/ | cmp - index.html; then
  ln -s "$previous" "$root/current.rollback.$release"
  mv -Tf "$root/current.rollback.$release" "$root/current"
  echo 'Public entry check failed; previous release restored' >&2
  exit 4
fi
while read -r digest path; do
  curl --fail --silent --show-error --max-time 20 "https://smena.servgo.ru/$path" | sha256sum | awk -v expected="$digest" '$1 != expected {exit 1}' || {
    ln -s "$previous" "$root/current.rollback.$release"
    mv -Tf "$root/current.rollback.$release" "$root/current"
    echo 'Public asset check failed; previous release restored' >&2
    exit 5
  }
done < SHA256SUMS
printf 'Kiosk deployed: %s\nPrevious release preserved: %s\n' "$release" "$previous"
REMOTE
