# CozyNode

Your own VPS as a private proxy for Chrome. One command on the server, one link in the extension, one button.

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

Other commands: `install.sh link` (show the link again), `add-user` (a second login for a friend or device), `ios-profile` (sing-box app profile, see below), `status`, `uninstall`.

Options: `--port N` (default 443, or 8443 if 443 is busy), `--host IP|domain`, `--name label`.

**If nginx already uses ports 80/443** (a server with websites), run on 8443 and forward only the ACME challenge:

```nginx
server {
    listen <PUBLIC_IP>:80;
    server_name <PUBLIC_IP>;
    location /.well-known/acme-challenge/ { proxy_pass http://127.0.0.1:18480; }
    location / { return 444; }
}
```

```bash
sudo bash install.sh --port 8443 --acme-http-port 18480
```

Cloud firewall (Hetzner, AWS, Oracle): allow TCP on the proxy port and on 80.

## 2. Extension

Install CozyNode from the Chrome Web Store (or `chrome://extensions` → Developer mode → Load unpacked → `extension/`), paste the link, press the button.

- **All sites** or **Only selected sites** (the "Add example.com" button takes the current tab).
- WebRTC is limited to the proxy while it is on, so the real IP does not leak.
- DNS is resolved on the server.
- The check button shows the IP and country that sites see (via Cloudflare `cdn-cgi/trace`).

## Security

- The proxy refuses connections to private ranges, CGNAT/Tailscale and the server's own addresses, so a proxy login cannot reach databases or admin panels on the VPS.
- Without a login the proxy answers 407.
- The link is the only secret. Do not post it; use `add-user` for every person.

## iPhone and other apps

The extension covers Chrome only. For the whole device, use the free [sing-box app](https://sing-box.sagernet.org/clients/) (iOS, macOS, Android) with the same server, no server changes:

```bash
curl -fsSL https://raw.githubusercontent.com/trendbender/cozynode/main/server/install.sh | sudo bash -s ios-profile > cozynode.json
# login #0; add " 1" after ios-profile for the second login
```

Send `cozynode.json` to the phone (AirDrop or Files), import it in the sing-box app (Profiles → New → Import) and press Start. Check: https://www.cloudflare.com/cdn-cgi/trace shows the server IP and country. TCP and DNS go through the proxy; other UDP (QUIC) is refused, apps fall back to TCP. The profile contains the login, keep it private.

## Build

```bash
./scripts/build.sh   # -> dist/cozynode-<version>.zip
```
