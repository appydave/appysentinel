# Tunneling Guide — Exposing a Sentinel over a Public HTTPS URL

This guide covers making a Sentinel's HTTP binding reachable from outside your local network — required for claude.ai CoWork connectors and any external consumer that cannot reach your Tailscale tailnet directly.

Validated by: SS Sentinel pilot (2026-04-29).

---

## When you need this

| Consumer | What it needs | Tunnel required? |
|---|---|---|
| Claude Code (same machine) | stdio MCP or local HTTP | No |
| Claude Code (another machine on tailnet) | HTTP over Tailscale IP | No — tailnet is enough |
| claude.ai CoWork connector | Public HTTPS URL | Yes |
| External webhook or API caller | Public HTTPS URL | Yes |

---

## Tailscale Funnel

Tailscale Funnel exposes a port on your machine to the public internet via a `*.tail<id>.ts.net` subdomain with a valid TLS certificate. No reverse proxy setup required.

### Prerequisites

- Tailscale installed and authenticated on the machine
- The machine must be in your tailnet
- Funnel must be enabled in the Tailscale ACL policy for this machine (node attribute `funnel`)

### Setup steps

**1. Enable Funnel in Tailscale ACL**

In the Tailscale admin console, add the node attribute to the machine's ACL entry:

```json
"nodeAttrs": [
  {
    "target": ["<machine-name>"],
    "attr": ["funnel"]
  }
]
```

**2. Start the funnel**

```bash
tailscale funnel 3000
```

Replace `3000` with the port your Sentinel's HTTP binding listens on. The funnel URL will be printed — it looks like:

```
https://<machine-name>.tail<id>.ts.net
```

**3. Press Enable in the Tailscale UI (critical gotcha)**

The ACL grants permission but does not activate Funnel on the machine. You must also press the **Enable** button in the Tailscale desktop app or system tray on the machine itself. Without this step, the tunnel is configured but not live.

Symptom if you skip this: the public URL returns a connection error even though `tailscale funnel` reports success.

**4. Verify**

```bash
curl https://<machine-name>.tail<id>.ts.net/health
```

Should return a 200 from your Sentinel. If it does, the funnel is live end-to-end.

### Persistence

The funnel survives reboots — it is persisted in Tailscale's state, not a shell session. To stop it:

```bash
tailscale funnel reset
```

---

## Security: what the tunnel gives you and what it doesn't

Tailscale Funnel provides:
- Valid TLS (HTTPS) — traffic is encrypted in transit
- A stable public URL tied to your tailnet machine

Tailscale Funnel does NOT provide:
- Authentication — any caller on the internet can reach the port
- Rate limiting

You must add auth at the application layer. See pattern X5 (bearer token) and X6 (OAuth) in `docs/pattern-catalogue.md`.

---

## Auth layer over the tunnel

### Bearer token (X5) — for Claude Code and programmatic callers

Set `MCP_BEARER_TOKEN` in `.env`. The HTTP binding reads it at startup and rejects any request without a matching `Authorization: Bearer <token>` header.

This is sufficient when all callers are Claude Code instances or scripts you control. It does NOT work for claude.ai CoWork (CoWork only supports OAuth connectors).

### OAuth (X6) — for claude.ai CoWork

claude.ai CoWork requires OAuth Authorization Code flow with PKCE. The Sentinel must embed a minimal OAuth server with three endpoints:

| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-authorization-server` | Discovery — claude.ai calls this first to find the other endpoints |
| `/authorize` | Renders an approval page; on approval, redirects back to claude.ai with an auth code |
| `/token` | Exchanges the auth code for an access token |

The client ID and secret are configured in `.env` and shared with each CoWork user when they add the connector in claude.ai Settings → Integrations.

**Token persistence warning.** The default implementation stores issued tokens in memory. When the Sentinel process restarts (e.g., launchd reloads the service), all tokens are lost and users must re-authorise in CoWork. For long-lived deployments, persist tokens to a file in `state/` or issue long-lived JWTs signed with a key stored in `.env`.

---

## Adding the Sentinel as a CoWork connector

Once the tunnel and OAuth server are live:

1. Go to claude.ai → avatar → Settings → Integrations
2. Click **Add custom connector**
3. Fill in:
   - **Name**: anything descriptive
   - **URL**: your Tailscale Funnel URL (e.g. `https://<machine>.tail<id>.ts.net/mcp`)
   - **OAuth Client ID**: value of `OAUTH_CLIENT_ID` from `.env`
   - **OAuth Client Secret**: value of `OAUTH_CLIENT_SECRET` from `.env`
4. Save — claude.ai will hit `/.well-known/oauth-authorization-server`, then redirect your browser to the `/authorize` approval page
5. Click Approve on the approval page
6. claude.ai completes the OAuth flow and the connector is live

All tools exposed by the MCP binding are now available in CoWork conversations.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Public URL returns connection error | Tailscale Funnel "Enable" not pressed in the desktop app |
| `curl` reaches the server but CoWork can't connect | CoWork requires HTTPS; confirm funnel is using TLS |
| `/.well-known/oauth-authorization-server` returns 404 | OAuth server not started, or HTTP server not listening on the funnel port |
| CoWork shows "OAuth error" after approval | Token exchange failed — check `/token` endpoint logs |
| Tools missing after re-adding connector | Token in memory was lost on restart — re-authorise or add token persistence |
