#!/usr/bin/env bash
# CozyNode server installer: turns any Linux VPS into a private HTTPS proxy
# for the CozyNode browser extension.
#
#   curl -fsSL https://raw.githubusercontent.com/trendbender/cozynode/main/server/install.sh | sudo bash
#
# Commands:
#   install.sh [install] [--port N] [--host IP|DOMAIN] [--acme-http-port N] [--name LABEL]
#              [--self-ports 80,443]   public ports of THIS server reachable via the proxy
#   install.sh link        print the connection link again
#   install.sh add-user    add one more login (for a friend / second device)
#   install.sh ios-profile [N]  sing-box app profile (iPhone/iPad, also macOS/Android) for login N
#   install.sh status      service state and certificate check
#   install.sh uninstall   stop and remove everything
#
# What it does: downloads a pinned sing-box release (sha256 checked), creates an
# HTTPS proxy with a random login, gets a Let's Encrypt certificate for the server
# IP (or domain) automatically, opens the port in ufw and prints a cozy:// link.
set -euo pipefail

SB_VERSION="1.14.3"
declare -A SB_SHA256=(
  [amd64]="e2bdf179c15a3652955dc44867e33ca0965c9c9b91b34267dcc5a5d639a5feee"
  [arm64]="29dae24d76bea3bc62d07dd3e60cfc12003de7debbd6b768df9be9c68360174e"
)

PREFIX=/opt/cozynode
CONF_DIR=/etc/cozynode
DATA_DIR=/var/lib/cozynode
CONFIG="$CONF_DIR/config.json"
META="$CONF_DIR/node.env"
UNIT=/etc/systemd/system/cozynode.service

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

need_root() { [ "$(id -u)" -eq 0 ] || die "run as root: curl ... | sudo bash"; }

port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

sni_arg() { [[ "$HOST" =~ ^[0-9.]+$|: ]] || echo "-servername $HOST"; }

rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

detect_ip() {
  local ip
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -4fsS -m 8 "$u" 2>/dev/null | tr -d '[:space:]') && [ -n "$ip" ] && { echo "$ip"; return; }
  done
  die "cannot detect public IPv4, pass --host"
}

arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) die "unsupported CPU $(uname -m) (amd64/arm64 only)" ;;
  esac
}

download_singbox() {
  local a url tmp
  a=$(arch)
  if [ -x "$PREFIX/sing-box" ] && "$PREFIX/sing-box" version 2>/dev/null | grep -q "version $SB_VERSION"; then
    return
  fi
  url="https://github.com/SagerNet/sing-box/releases/download/v${SB_VERSION}/sing-box-${SB_VERSION}-linux-${a}.tar.gz"
  tmp=$(mktemp -d)
  say "downloading sing-box $SB_VERSION ($a)"
  curl -fsSL -m 120 -o "$tmp/sb.tgz" "$url" || die "download failed: $url"
  echo "${SB_SHA256[$a]}  $tmp/sb.tgz" | sha256sum -c --quiet - || die "checksum mismatch, refusing to install"
  tar -xzf "$tmp/sb.tgz" -C "$tmp"
  install -d -m 755 "$PREFIX"
  install -m 755 "$tmp/sing-box-${SB_VERSION}-linux-${a}/sing-box" "$PREFIX/sing-box"
  rm -rf "$tmp"
}

# users.json holds [{"username":..,"password":..}]; config is regenerated from it
write_config() {
  # shellcheck disable=SC1090
  . "$META"
  local acme_extra="" self_ips self_ports
  # the server's own addresses: only its public web ports are reachable through
  # the proxy (sites hosted here keep working, ufw-closed ports like 6379 do not)
  self_ips=$( { ip -o addr show scope global | awk '{print $4}' | cut -d/ -f1; echo "$HOST"; } \
    | grep -E '^[0-9a-fA-F:.]+$' | sort -u \
    | python3 -c 'import json,sys,ipaddress as i
out=[]
for l in sys.stdin:
    try: out.append(str(i.ip_network(l.strip())))
    except ValueError: pass
print(json.dumps(out))')
  self_ports=$(python3 -c 'import json,sys;print(json.dumps([int(x) for x in sys.argv[1].split(",") if x.strip()]))' "${SELF_PORTS:-80,443}")
  if [ -n "${ACME_HTTP_PORT:-}" ]; then
    acme_extra=", \"disable_tls_alpn_challenge\": true, \"alternative_http_port\": ${ACME_HTTP_PORT}"
  elif [ "$PORT" != "443" ]; then
    acme_extra=", \"disable_tls_alpn_challenge\": true"
  fi
  cat >"$CONFIG.tmp" <<EOF
{
  "log": { "level": "warn", "timestamp": true },
  "inbounds": [
    {
      "type": "http",
      "tag": "cozy-https",
      "listen": "::",
      "listen_port": ${PORT},
      "users": $(cat "$CONF_DIR/users.json"),
      "tls": {
        "enabled": true,
        "alpn": ["http/1.1"],
        "certificate_provider": {
          "type": "acme",
          "domain": ["${HOST}"],
          "default_server_name": "${HOST}",
          "data_directory": "${DATA_DIR}/acme",
          "email": "${ACME_EMAIL:-}"${acme_extra}
        }
      }
    }
  ],
  "outbounds": [ { "type": "direct", "tag": "direct" } ],
  "route": {
    "rules": [
      { "action": "resolve" },
      { "ip_is_private": true, "action": "reject" },
      { "ip_cidr": ["100.64.0.0/10", "169.254.0.0/16", "fe80::/10", "fd7a:115c:a1e0::/48"], "action": "reject" },
      { "ip_cidr": ${self_ips}, "port": ${self_ports}, "action": "route", "outbound": "direct" },
      { "ip_cidr": ${self_ips}, "action": "reject" }
    ],
    "final": "direct"
  }
}
EOF
  "$PREFIX/sing-box" check -c "$CONFIG.tmp" || die "generated config is invalid"
  mv "$CONFIG.tmp" "$CONFIG"
  chmod 600 "$CONFIG" "$CONF_DIR/users.json"
}

write_unit() {
  cat >"$UNIT" <<EOF
[Unit]
Description=CozyNode private HTTPS proxy (sing-box)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${PREFIX}/sing-box run -c ${CONFIG}
Restart=on-failure
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

open_firewall() {
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${PORT}/tcp" comment cozynode >/dev/null
    [ -z "${ACME_HTTP_PORT:-}" ] && ufw allow 80/tcp comment cozynode-acme >/dev/null
    say "ufw: opened ${PORT}/tcp"
  fi
  warn "if your provider has a cloud firewall (Hetzner, AWS, Oracle...), allow TCP ${PORT} and 80 there too"
}

print_link() {
  # shellcheck disable=SC1090
  . "$META"
  local u p
  u=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[int(sys.argv[2])]["username"])' "$CONF_DIR/users.json" "${1:-0}")
  p=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[int(sys.argv[2])]["password"])' "$CONF_DIR/users.json" "${1:-0}")
  local link="cozy://${u}:${p}@${HOST}:${PORT}#${NAME}"
  echo
  echo "  Connection link (paste it into the CozyNode extension):"
  echo
  printf '  \033[1m%s\033[0m\n' "$link"
  echo
  if command -v qrencode >/dev/null; then qrencode -t ANSIUTF8 "$link"; fi
  echo "  Keep it secret: anyone with this link can use your server."
}

# Client profile for the sing-box app (SFI on iOS, SFM, SFA): the whole device goes
# through the same HTTPS proxy. TCP only: DNS goes over DoT through the proxy, other
# UDP (QUIC) is rejected so apps fall back to TCP.
print_ios_profile() {
  # shellcheck disable=SC1090
  . "$META"
  python3 - "$CONF_DIR/users.json" "${1:-0}" "$HOST" "$PORT" <<'PY'
import json, sys
users, n, host, port = sys.argv[1:5]
u = json.load(open(users))[int(n)]
print(json.dumps({
  "log": {"level": "warn"},
  "dns": {
    "servers": [{"type": "tls", "tag": "dot", "server": "1.1.1.1", "detour": "cozy"}],
    "final": "dot",
  },
  "inbounds": [{
    "type": "tun", "tag": "tun",
    "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
    "auto_route": True, "strict_route": True,
  }],
  "outbounds": [
    {"type": "http", "tag": "cozy", "server": host, "server_port": int(port),
     "username": u["username"], "password": u["password"],
     "tls": {"enabled": True, "server_name": host}},
    {"type": "direct", "tag": "direct"},
  ],
  "route": {
    "rules": [
      {"action": "sniff"},
      {"protocol": "dns", "action": "hijack-dns"},
      {"ip_is_private": True, "outbound": "direct"},
      {"network": "udp", "action": "reject"},
    ],
    "final": "cozy",
    "auto_detect_interface": True,
  },
}, indent=2))
PY
  {
    echo "  sing-box profile for '${NAME}' (login #${1:-0}). Save it as a .json file, send it to the"
    echo "  device (AirDrop, Files), import it in the sing-box app (Profiles > New > Import) and press Start."
    echo "  Keep it secret: it contains the login."
  } >&2
}

wait_cert() {
  local i
  say "waiting for the TLS certificate (Let's Encrypt, up to 90 s)"
  for i in $(seq 1 45); do
    if echo | timeout 5 openssl s_client -connect "127.0.0.1:${PORT}" $(sni_arg) 2>/dev/null \
        | openssl x509 -noout -issuer 2>/dev/null | grep -qi "let's encrypt"; then
      say "certificate is ready"; return 0
    fi
    sleep 2
  done
  warn "certificate not issued yet; check: journalctl -u cozynode -n 50"
  return 1
}

self_test() {
  # shellcheck disable=SC1090
  . "$META"
  local u p code
  u=$(python3 -c 'import json;print(json.load(open("'"$CONF_DIR"'/users.json"))[0]["username"])')
  p=$(python3 -c 'import json;print(json.load(open("'"$CONF_DIR"'/users.json"))[0]["password"])')
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 --proxy "https://${HOST}:${PORT}" \
           --proxy-user "${u}:${p}" https://www.cloudflare.com/cdn-cgi/trace || true)
  if [ "$code" = "200" ]; then say "self-test passed: traffic goes through the proxy"; else warn "self-test got HTTP $code"; fi
}

cmd_install() {
  need_root
  local port="" host="" acme_port="" name="" self_ports=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port="$2"; shift 2 ;;
      --host) host="$2"; shift 2 ;;
      --acme-http-port) acme_port="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --email) ACME_EMAIL="$2"; shift 2 ;;
      --self-ports) self_ports="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  for bin in curl tar sha256sum openssl python3 ss; do command -v "$bin" >/dev/null || die "missing $bin (apt install curl openssl python3 iproute2)"; done

  if [ -f "$META" ]; then
    warn "CozyNode is already installed; keeping logins, updating binary and config"
    # shellcheck disable=SC1090
    . "$META"
    port=${port:-$PORT}; host=${host:-$HOST}; acme_port=${acme_port:-${ACME_HTTP_PORT:-}}; name=${name:-$NAME}
    self_ports=${self_ports:-${SELF_PORTS:-}}
  fi

  if [ -z "$port" ]; then
    if port_busy 443; then port=8443; else port=443; fi
  fi
  if port_busy "$port" && ! systemctl is-active -q cozynode; then die "port $port is busy, pass --port"; fi
  if [ -z "$acme_port" ] && port_busy 80 && [ "$port" != "443" ]; then
    die "port 80 is busy (nginx?). Either free it, or proxy /.well-known/acme-challenge/ to a local port and pass --acme-http-port N (see README)"
  fi
  host=${host:-$(detect_ip)}
  name=${name:-$(hostname -s)}

  download_singbox
  install -d -m 700 "$CONF_DIR" "$DATA_DIR"
  if [ ! -f "$CONF_DIR/users.json" ]; then
    printf '[{"username":"%s","password":"%s"}]\n' "cozy$(rand 6)" "$(rand 24)" >"$CONF_DIR/users.json"
  fi
  cat >"$META" <<EOF
HOST=${host}
PORT=${port}
NAME=${name}
ACME_HTTP_PORT=${acme_port}
ACME_EMAIL=${ACME_EMAIL:-}
SELF_PORTS=${self_ports:-80,443}
EOF
  chmod 600 "$META"
  write_config
  write_unit
  open_firewall
  systemctl enable -q cozynode
  systemctl restart cozynode
  sleep 1
  systemctl is-active -q cozynode || { journalctl -u cozynode -n 30 --no-pager; die "service failed to start"; }
  wait_cert && self_test || true
  print_link 0
}

cmd_add_user() {
  need_root; [ -f "$META" ] || die "not installed"
  python3 - "$CONF_DIR/users.json" "cozy$(rand 6)" "$(rand 24)" <<'PY'
import json, sys
p, u, pw = sys.argv[1:4]
d = json.load(open(p)); d.append({"username": u, "password": pw}); json.dump(d, open(p, "w"))
PY
  write_config
  systemctl restart cozynode
  local n; n=$(python3 -c 'import json;print(len(json.load(open("'"$CONF_DIR"'/users.json")))-1)')
  print_link "$n"
}

cmd_status() {
  [ -f "$META" ] || die "not installed"
  # shellcheck disable=SC1090
  . "$META"
  systemctl --no-pager status cozynode | head -5
  echo | timeout 5 openssl s_client -connect "127.0.0.1:${PORT}" $(sni_arg) 2>/dev/null \
    | openssl x509 -noout -issuer -enddate 2>/dev/null || warn "no certificate yet"
}

cmd_uninstall() {
  need_root
  systemctl disable --now cozynode 2>/dev/null || true
  rm -f "$UNIT"; systemctl daemon-reload
  if [ -f "$META" ] && command -v ufw >/dev/null; then
    # shellcheck disable=SC1090
    . "$META"; ufw delete allow "${PORT}/tcp" >/dev/null 2>&1 || true
  fi
  rm -rf "$PREFIX" "$CONF_DIR" "$DATA_DIR"
  say "CozyNode removed"
}

case "${1:-install}" in
  install) shift || true; cmd_install "$@" ;;
  --*) cmd_install "$@" ;;
  link) need_root; print_link "${2:-0}" ;;
  add-user) cmd_add_user ;;
  ios-profile) need_root; [ -f "$META" ] || die "not installed"; print_ios_profile "${2:-0}" ;;
  status) cmd_status ;;
  uninstall) cmd_uninstall ;;
  *) die "unknown command $1" ;;
esac
