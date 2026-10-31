# CozyNode

Your own VPS as a private proxy for Chrome. One command on the server, one link in the extension, one button.

[![CozyNode demo](docs/media/demo.gif)](docs/media/demo.mp4)

**Step-by-step guide with screenshots, iPhone and Android:** [English](docs/guide.md) · [Русский](docs/guide.ru.md)

```
VPS (any Linux, amd64/arm64)                Chrome
┌──────────────────────────────┐            ┌────────────────────────┐
│ sing-box HTTPS proxy :443    │◀── TLS ────│ CozyNode extension      │
│ login + password             │            │ paste cozy:// link      │
│ Let's Encrypt cert on the IP │            │ all sites / chosen ones │
└──────────────────────────────┘            └────────────────────────┘
```

## 1. Server (2 minutes)

On a fresh Ubuntu/Debian VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/trendbender/cozynode/main/server/install.sh | sudo bash
```

The script downloads a pinned [sing-box](https://github.com/SagerNet/sing-box) release (sha256 checked), creates a random login, gets a Let's Encrypt certificate for the server IP (no domain needed), opens the port in `ufw` and prints:

```
cozy://cozyXXXXXX:************************@203.0.113.7:443#my-vps
```

The installer keeps a copy of itself, so later commands are short: `sudo cozynode link` (show the link again), `add-user` (a second login for a friend or device), `ios-profile` (sing-box app profile, see below), `status`, `install` (update sing-box and config, logins stay), `uninstall`.

Options: `--port N` (default 443, or 8443 if 443 is busy), `--host IP|domain`, `--name label`.

**If nginx already uses ports 80/443** (a server with websites), run on 8443 and forward only the ACME challenge:

```nginx
server {
    listen 80;
    server_name <PUBLIC_IP>;
    location /.well-known/acme-challenge/ { proxy_pass http://127.0.0.1:18480; }
    location / { return 444; }
}
```

Keep `listen 80;` without the IP: an `IP:80` listen would take port 80 of that address away from your other sites.

```bash
curl -fsSL https://raw.githubusercontent.com/trendbender/cozynode/main/server/install.sh | sudo bash -s -- --port 8443 --acme-http-port 18480
```

Cloud firewall (Hetzner, AWS, Oracle): allow TCP on the proxy port and on 80.

## 2. Extension

Install CozyNode from the Chrome Web Store (or `chrome://extensions` → Developer mode → Load unpacked → `extension/`), paste the link, press the button.

- **All sites** or **Only selected sites** (the "Add example.com" button takes the current tab).
- **Several servers**: "+ Add server" pastes one more link, a click on a server switches to it.
- WebRTC is limited to the proxy while it is on, so the real IP does not leak.
- DNS is resolved on the server.
- The check button shows the IP and country that sites see (via Cloudflare `cdn-cgi/trace`).

## Security

- The proxy refuses connections to private ranges, CGNAT/Tailscale and the server's own addresses, so a proxy login cannot reach databases or admin panels on the VPS.
- Without a login the proxy answers 407.
- The link is the only secret. Do not post it; use `add-user` for every person.

## iPhone, Android and other apps

The extension covers Chrome only. For the whole device, use the free [sing-box app](https://sing-box.sagernet.org/clients/) ([sing-box MT](https://apps.apple.com/app/sing-box-mt/id6785326793) on iOS, [sing-box](https://play.google.com/store/apps/details?id=io.nekohasekai.sfa) on Android, also macOS) with the same server, no server changes:

```bash
sudo cozynode ios-profile > cozynode.json
# login #0; `sudo cozynode ios-profile 1` for the second login
```

Send `cozynode.json` to the phone (AirDrop, Quick Share, a cable), import it in the sing-box app (iOS: Dashboard → + → Import from File; Android: Profiles → + → Import from file) and press Start. Details: [guide, sections 6–7](docs/guide.md#6-iphone-and-ipad). Check: https://www.cloudflare.com/cdn-cgi/trace shows the server IP and country. TCP and DNS go through the proxy; other UDP (QUIC) is refused, apps fall back to TCP. The profile contains the login, keep it private.

## Build

```bash
./scripts/build.sh   # -> dist/cozynode-<version>.zip
```
