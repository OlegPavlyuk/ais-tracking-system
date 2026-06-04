# HTTPS And Domain Runbook

This runbook operates HTTPS for the single-VM Docker Compose deployment. The
examples use the current project domain:

```text
https://aiswatch.live
https://www.aiswatch.live
```

The architecture stays unchanged: the public Nginx/frontend container
terminates TLS, and API, Postgres, Redis, Prometheus, and Grafana remain
private.

## Chosen Approach

Use Let's Encrypt certificates issued by Certbot with HTTP-01 validation.
Nginx serves the ACME challenge webroot on port 80, redirects normal HTTP
traffic to HTTPS, and proxies frontend, REST API, and WebSocket traffic on port 443.

Tradeoffs considered:

- Certbot + Nginx on the VM is free, simple, and matches the current
  single-VM architecture.
- Google-managed certificates would require introducing an HTTPS load balancer,
  which is useful later but adds cost and operational surface now.
- Cloudflare proxying can be added later for WAF/DDoS features, but direct DNS
  keeps the first HTTPS rollout easier to reason about.

The Nginx image includes a bootstrap fallback: if the Let's Encrypt files are
not present yet, Nginx starts with a temporary self-signed certificate. After
issuance, recreate the Nginx container so it switches to the Let's Encrypt
paths. The bootstrap certificate is only a first-deploy fallback; it is not the
intended steady-state certificate.

Nginx hostnames are intentionally hardcoded in `web/nginx.conf` for the current
production domain: `aiswatch.live` and `www.aiswatch.live`. Changing the domain
later requires updating the Nginx config, DNS, certificate issuance command, and
the `LETSENCRYPT_CERT_NAME` value together.

## DNS

Required DNS shape:

```text
aiswatch.live      A      <reserved-static-ip>
www.aiswatch.live  CNAME  aiswatch.live
```

Verify before issuing certificates:

```bash
dig +short aiswatch.live
dig +short www.aiswatch.live
```

The apex record must resolve to the VM's reserved static IP. The `www` alias
must resolve to the same VM, either through the CNAME above or an equivalent
record. Do not document the concrete production IP here; use the GCP console or
`gcloud compute addresses describe` as the source of truth. New or changed DNS
records may require time to propagate. Verify resolution from more than one
network, or with a public resolver such as `1.1.1.1` or `8.8.8.8`, before
attempting certificate issuance.

## Prerequisites

Before deploying the HTTPS-capable release:

- DNS for `aiswatch.live` and `www.aiswatch.live` must already resolve to the
  VM static IP.
- GCP firewall ingress must allow both `tcp:80` and `tcp:443` to the Nginx
  container host.
- The operator should be ready to issue the Let's Encrypt certificate
  immediately after deployment.

After the HTTPS-capable release is deployed, normal HTTP requests no longer
serve the application directly. They redirect to HTTPS. Until the real
Let's Encrypt certificate is issued and Nginx is recreated or reloaded, HTTPS
uses the temporary bootstrap self-signed certificate and browsers will show a
certificate warning.

## 1. Open GCP Firewall For HTTPS

HTTP on `tcp:80` must stay open for redirects and ACME HTTP-01 validation.
Add `tcp:443` to the same VM network tag used by the public Nginx entrypoint.
Verify the actual tag on the VM before creating the rule:

```bash
PROJECT_ID="<your-project-id>"
ZONE="<vm-zone>"
VM_NAME="<vm-name>"

gcloud compute instances describe "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --format="value(tags.items)"
```

Set `NETWORK_TAG_HTTP` to the tag attached to the VM for public Nginx ingress:

```bash
PROJECT_ID="<your-project-id>"
NETWORK_TAG_HTTP="<public-nginx-network-tag>"

gcloud compute firewall-rules create allow-https-to-nginx \
  --project="$PROJECT_ID" \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags="$NETWORK_TAG_HTTP"
```

Do not add public firewall rules for API `3000`, Postgres `5432`, Redis
`6379`, Prometheus `9090`, or Grafana `3000`/`3001`.

## 2. Deploy The HTTPS-Capable Release

Make sure the VM production env contains:

```text
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
LETSENCRYPT_CERT_NAME=aiswatch.live
```

`LETSENCRYPT_CERT_NAME` is the single primary certificate directory name under
`/etc/letsencrypt/live`, not an Nginx `server_name` list. Keep it as
`aiswatch.live` for this deployment.

Run the normal approved GitHub production deployment. The deployment copies the
updated Compose and Nginx files to `/opt/ais-tracking-system`, pulls the new
frontend image, and starts Nginx with a bootstrap self-signed certificate if the
real Let's Encrypt certificate does not exist yet.

After deployment, on the VM:

```bash
cd /opt/ais-tracking-system
export AIS_DEPLOY_USE_SUDO_DOCKER=true
sudo docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  ps
```

Before the real certificate exists, this check should reach Nginx but will not
yet exercise the HTTPS certificate:

```bash
curl -fsS http://localhost/nginx-health
```

## 3. Issue The Initial Let's Encrypt Certificate

Run this on the VM after the HTTPS-capable Nginx release is running:

The apex domain must be the first `-d` value. Certbot uses the first domain as
the default certificate name, so this creates the expected path:

```text
/etc/letsencrypt/live/aiswatch.live
```

If `www.aiswatch.live` or another name is listed first, Nginx may keep using
the bootstrap self-signed certificate because
`LETSENCRYPT_CERT_NAME=aiswatch.live` will not match the generated directory.

```bash
cd /opt/ais-tracking-system

LETSENCRYPT_EMAIL="you@example.com"

sudo docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  --profile certbot \
  run --rm certbot \
  certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d aiswatch.live \
  -d www.aiswatch.live
```

Then recreate Nginx once so its entrypoint selects the real certificate and
rewrites `/etc/nginx/tls/ssl-certificate.conf` to the Let's Encrypt files:

```bash
sudo docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  up -d --force-recreate nginx
```

## 4. Renewal Dry Run

Run this on the VM:

```bash
cd /opt/ais-tracking-system

sudo docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  --profile certbot \
  run --rm certbot \
  renew \
  --webroot \
  --webroot-path /var/www/certbot \
  --dry-run
```

Expected result: Certbot completes the dry run successfully.

For real renewals, run the same command without `--dry-run`, then reload Nginx:

```bash
cd /opt/ais-tracking-system
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/ops/renew-certificates.sh
```

Schedule that renewal command from cron or a systemd timer after the dry run is
green. Renewal is manual until that scheduler is installed. Twice daily is
conventional; Certbot only renews when the certificate is near expiry. Reloading
Nginx after renewal is required because Nginx keeps using the old certificate
contents until reload or restart.

Example root cron entry:

```cron
17 3,15 * * * cd /opt/ais-tracking-system && AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/ops/renew-certificates.sh
```

If the VM user is already allowed to run Docker directly, omit
`AIS_DEPLOY_USE_SUDO_DOCKER=true`.

## 5. HTTPS And WSS Smoke Checks

Run these from your laptop:

```bash
curl -I http://aiswatch.live/
curl -fsS https://aiswatch.live/healthz
curl -fsS https://aiswatch.live/readyz
curl -fsS "https://aiswatch.live/api/vessels?limit=1"
curl -i https://aiswatch.live/metrics
curl -i https://aiswatch.live/admin
```

Expected:

- `http://aiswatch.live/` returns a redirect to HTTPS.
- `/healthz`, `/readyz`, and `/api/vessels?limit=1` succeed over HTTPS.
- `/metrics` and `/admin` return `404`.

Check WSS with Node 22:

```bash
docker run --rm node:22-alpine node -e '
const ws = new WebSocket("wss://aiswatch.live/ws/positions");
const timer = setTimeout(() => {
  console.error("WSS timeout");
  process.exit(1);
}, 10000);
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "subscribe" }));
  console.log("WSS open");
  clearTimeout(timer);
  ws.close();
});
ws.addEventListener("error", (event) => {
  console.error("WSS error", event.message || event.type);
  process.exit(1);
});
'
```

## Rollback

If HTTPS deployment fails before certificate issuance, roll back containers to
the previous release metadata:

```bash
cd /opt/ais-tracking-system
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/deploy/rollback.sh --app-dir /opt/ais-tracking-system
```

If certificate issuance fails but the HTTPS-capable deployment is healthy, keep
the release running only if a temporary browser certificate warning is
acceptable while you fix DNS/firewall/ACME reachability and rerun the Certbot
command. During that period, `http://aiswatch.live` redirects to
`https://aiswatch.live`, and HTTPS is served with the temporary self-signed
bootstrap certificate.

For a public demo environment, issue the Let's Encrypt certificate immediately
after deploying the HTTPS-capable release. If certificate issuance cannot be
completed promptly, roll back to the previous HTTP-only release rather than
leaving visitors on a self-signed certificate warning.

## Future Improvements

These are intentionally outside the current implementation:

- Enable DNSSEC after DNS is stable.
- Consider Cloudflare proxy/WAF later if the public demo needs extra edge
  protection.
- Replace cron with a managed systemd timer for certificate renewal.
- Consider HSTS after HTTPS has been stable.
