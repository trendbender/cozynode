# CozyNode Privacy Policy

Last updated: 30 October 2026

CozyNode is a browser extension that routes Chrome traffic through a proxy server **that you own and run yourself**.

## What the extension stores

- The connection link you paste (server address, port, login and password), the on/off state, the mode and your list of selected sites.
- All of it is kept in `chrome.storage.local` on your device only. It is never sent to the developer or to any third party.

## Where your traffic goes

- While the proxy is on, Chrome sends web traffic (all sites, or only the sites you selected) to **your own server**. The developer does not operate these servers and has no access to them or to your traffic.
- The "Check connection" button requests `https://www.cloudflare.com/cdn-cgi/trace` through your server to show the IP address and country that websites see. Cloudflare's own privacy policy applies to that request.

## What the extension does not do

- No analytics, telemetry, advertising, tracking or remote code.
- No accounts, no data collection, no sale or transfer of data.

## Permissions

- `proxy`: set Chrome's proxy to your server.
- `webRequest`, `webRequestAuthProvider`, host access `<all_urls>`: answer your server's login request (HTTP 407) with the credentials you saved; requests are not read or modified otherwise.
- `privacy`: limit WebRTC to the proxy while it is on so your real IP does not leak.
- `storage`: keep your settings on the device.

## Contact

Questions: open an issue at https://github.com/trendbender/cozynode.
