# CozyNode: step-by-step guide

[Русская версия](guide.ru.md)

CozyNode turns a Linux VPS you rent into a private HTTPS proxy. Chrome uses it through the CozyNode extension; a phone (iPhone, iPad, Android) uses the same server through the free sing-box app.

[![CozyNode demo: paste the link, choose sites, add servers, switch](media/demo.gif)](media/demo.mp4)

All addresses and logins on this page are examples.

- [1. What you need](#1-what-you-need)
- [2. Set up the server](#2-set-up-the-server)
- [3. Connect Chrome](#3-connect-chrome)
- [4. All sites or only some](#4-all-sites-or-only-some)
- [5. Several servers](#5-several-servers)
- [6. iPhone and iPad](#6-iphone-and-ipad)
- [7. Android](#7-android)
- [8. A login for every person and device](#8-a-login-for-every-person-and-device)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Update and remove](#10-update-and-remove)

## 1. What you need

- A VPS with Linux on amd64 or arm64. Tested on Ubuntu and Debian; 512 MB of RAM is enough. The server's country is the country websites will see.
- root access over SSH (`ssh root@203.0.113.7`).
- Open ports: TCP 443 (or 8443) for the proxy and TCP 80 for the free certificate. If your provider has a cloud firewall in its panel (Hetzner, AWS, Oracle, Google Cloud and others), allow these ports there too.
- No domain is needed: the certificate is issued for the server's IP address.

## 2. Set up the server

Connect to the server over SSH and run one command:

```bash
curl -fsSL https://raw.githubusercontent.com/trendbender/cozynode/main/server/install.sh | sudo bash
```

![The installer prints the connection link](img/01-server-install.png)

In about a minute the script:

1. downloads a pinned [sing-box](https://github.com/SagerNet/sing-box) release and checks its sha256;
2. creates a random login and password;
3. gets a Let's Encrypt certificate for the server IP and renews it on its own;
4. opens the port in `ufw` and checks that traffic goes through;
5. prints the **connection link** `cozy://login:password@ip:port#name`.

The link is the only secret. Anyone who has it can use your server, so do not post it in chats or tickets.

Commands you will need later (the installer adds the short `cozynode` command):

| Command | What it does |
|---|---|
| `sudo cozynode link` | show the link again |
| `sudo cozynode add-user` | a separate login for another person or device |
| `sudo cozynode ios-profile [N]` | profile for the sing-box app on a phone (login N, default 0) |
| `sudo cozynode status` | service state and certificate |
| `sudo cozynode install` | update sing-box and the config, logins stay |
| `sudo cozynode uninstall` | remove everything |

Install options: `--port N` (default 443, or 8443 if 443 is busy), `--name label` (the name shown in the extension), `--host IP|domain`.

### A server that already runs websites

If nginx already uses ports 80 and 443, put the proxy on 8443 and forward only the certificate check from port 80. Add this file, for example `/etc/nginx/sites-enabled/cozynode-acme`, with your server's IP:

```nginx
server {
    listen 80;
    server_name 203.0.113.7;
    location /.well-known/acme-challenge/ { proxy_pass http://127.0.0.1:18480; }
    location / { return 444; }
}
```

Write `listen 80;` without the IP: `listen 203.0.113.7:80;` would take port 80 of this address away from your other sites. Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsSL https://raw.githubusercontent.com/trendbender/cozynode/main/server/install.sh | sudo bash -s -- --port 8443 --acme-http-port 18480
```

Your websites keep working as before. Through the proxy the server's own sites are reachable on ports 80 and 443 only; databases and admin panels on the server are not reachable at all.

## 3. Connect Chrome

Install CozyNode from the Chrome Web Store. Until the listing is live, install it by hand:

1. Download `cozynode-<version>.zip` from [Releases](https://github.com/trendbender/cozynode/releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), press **Load unpacked** and pick the unzipped folder.

![chrome://extensions with Developer mode and the Load unpacked button](img/02-load-unpacked.png)

3. Pin the extension: the puzzle icon on the toolbar, then the pin next to CozyNode.
4. Click the CozyNode icon, paste the link from the server and press **Connect**.

![Paste the cozy:// link](img/03-paste-link.png)

5. The proxy is on. Under the server you see the IP and country that websites see now. **Check connection** runs this check again.

![Proxy is on, websites see the server IP](img/04-proxy-on.png)

The big button turns the proxy off and on. While it is on:

- DNS is resolved on the server, so your provider does not see which sites you open;
- WebRTC is limited to the proxy, so video calls in the browser do not reveal your real IP;
- local addresses (`localhost`, `192.168.x.x`, `10.x.x.x`) go direct, so your router and local tools keep working.

## 4. All sites or only some

- **All sites**: all Chrome traffic goes through the server.
- **Only selected sites**: only the sites in the list go through the server, everything else goes direct and at full speed. Type a domain and press **+**, or press **Add example.com** to add the site of the current tab. A domain also covers its subdomains: `example.com` includes `www.example.com` and `docs.example.com`.

![Only selected sites](img/05-selected-sites.png)

If a site in the list still does not open, it probably loads its pages from another domain (a CDN or an API). Add that domain too: it is visible in Chrome DevTools, on the Network tab.

## 5. Several servers

You can keep several servers, for example in different countries, and switch between them with one click.

1. Install CozyNode on each server (section 2) and copy each link.
2. In the extension press **+ Add server**, paste the next link and press **Connect**.

![Add one more server](img/06-add-server.png)

3. All servers are in the list. Click a server to switch: the check below shows the new IP and country at once.

![Two servers, the active one is highlighted](img/07-servers.png)

**Remove server** removes only the selected server; the others stay. Pasting the same link again does not create a duplicate, it updates the existing entry.

## 6. iPhone and iPad

Chrome on a phone does not support extensions, so on a phone the whole device goes through the server with the free open-source app **sing-box**. Nothing changes on the server.

What works: all apps and all browsers, DNS through the server. TCP goes through the proxy; other UDP (QUIC) is refused and apps fall back to TCP. Voice and video calls in messengers that need UDP may not connect while the app is on.

**1. Install the app.** [sing-box MT on the App Store](https://apps.apple.com/app/sing-box-mt/id6785326793), the official sing-box client (iOS 15 or later; needs an Apple account from outside mainland China).

**2. Get the profile on your computer.** In the Terminal on your Mac or PC:

```bash
ssh root@203.0.113.7 'cozynode ios-profile' > cozynode.json
```

![The profile is saved to cozynode.json](img/08-phone-profile.png)

For a second server, run the same command with its address and another file name, for example `cozynode-nl.json`. For a separate login on the phone, create one with `sudo cozynode add-user` and pass its number: `cozynode ios-profile 1`.

**3. Move the file to the iPhone.** AirDrop from a Mac is the simplest: the file lands in Files › Downloads. You can also save it to iCloud Drive. The file contains your login, so do not send it through chats or email.

**4. Import it.** Open sing-box, on the **Dashboard** press **+** on the profile card, choose **Import from File** and pick `cozynode.json`. Confirm the import.

**5. Start.** The first time, the app asks to **Install Network Extension**: press it and allow adding the VPN configuration (iOS asks for your passcode). Then press **Start**. The VPN icon appears in the status bar.

**6. Check.** Open https://www.cloudflare.com/cdn-cgi/trace in Safari: the `ip=` and `loc=` lines must show your server.

Several servers: import one profile per server and switch between them with the profile selector on the Dashboard. To turn the proxy off, press **Stop** in the app or turn VPN off in Settings.

## 7. Android

Same as iPhone: the sing-box app sends the whole phone through your server.

**1. Install the app.** [sing-box on Google Play](https://play.google.com/store/apps/details?id=io.nekohasekai.sfa), or the APK from [GitHub Releases](https://github.com/SagerNet/sing-box/releases) or F-Droid. Android 5.0 or later.

**2. Get the profile** on your computer, as in step 2 for iPhone:

```bash
ssh root@203.0.113.7 'cozynode ios-profile' > cozynode.json
```

The profile is the same for iOS, Android and the desktop sing-box app; only the command is called `ios-profile`.

**3. Move the file to the phone** with Quick Share, a USB cable or your own cloud drive. Do not send it through chats: it contains your login.

**4. Import it.** Open sing-box, go to the **Profiles** tab, press **+**, choose **Import from file** and pick `cozynode.json`. Confirm with **Import**.

**5. Start.** On the **Dashboard** press **Start** and allow the VPN connection request.

**6. Check** with https://www.cloudflare.com/cdn-cgi/trace in any browser.

## 8. A login for every person and device

Give everyone their own login instead of sharing yours:

```bash
sudo cozynode add-user      # prints a new link, login number 1, 2, ...
sudo cozynode link 1        # show the link of login 1 again
sudo cozynode ios-profile 1 # phone profile for login 1
```

All logins work at the same time. To take access away from one person, remove their entry from `/etc/cozynode/users.json` and run `sudo cozynode install`.

## 9. Troubleshooting

| What you see | What to do |
|---|---|
| "No connection through the server" in the extension | On the server: `sudo cozynode status`. If the service runs, the port is closed somewhere: check `ufw status` and the cloud firewall in your provider's panel. |
| "The server rejected the login" | The link is outdated (the server was reinstalled or the login removed). Get a fresh one with `sudo cozynode link` and add it again. |
| The installer waits for the certificate and gives up | Port 80 is not reachable from the internet. Open it in the cloud firewall, or use the nginx setup from section 2 if a website already uses port 80. |
| A site opens without the proxy in "Only selected sites" mode | Add the other domains the site loads from (DevTools › Network). |
| Everything is slow | Choose a server closer to you, or use "Only selected sites" so other sites go direct. |
| Phone: the app starts, but nothing opens | Check the server with the trace link from a computer. Re-create the profile after reinstalling the server: the login has changed. |

## 10. Update and remove

- Update the server: `sudo cozynode install` (logins and links stay the same).
- Remove from the server: `sudo cozynode uninstall`.
- Remove from Chrome: right-click the CozyNode icon, then **Remove from Chrome**. Chrome's proxy settings return to normal.
- Phone: delete the profile in the sing-box app, or delete the app.

Privacy: the extension keeps your links only on your device and sends nothing to us. See the [privacy policy](privacy.md).
