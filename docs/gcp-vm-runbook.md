# GCP VM Runbook

This runbook prepares the first production-like AIS Tracking System deployment
on one Google Cloud Compute Engine VM running Docker Compose.

Use **Compute Engine / VM** for this phase. Do not choose Cloud Run, Cloud SQL,
GKE, or Memorystore for the initial deployment. Those are useful future options,
but the current plan is one cost-conscious VM with self-hosted Postgres/PostGIS,
Redis, Nginx, Prometheus, and private Grafana.

## What This Phase Creates

- one GCP project, or one selected existing project;
- required APIs enabled;
- one Artifact Registry Docker repository;
- one static external IP address;
- one Compute Engine VM;
- one VM service account that can pull images from Artifact Registry;
- firewall rules that expose only HTTP publicly and restrict SSH;
- Docker Engine and the Docker Compose plugin on the VM;
- `/opt/ais-tracking-system` as the stable app directory;
- a real `.env.production` file on the VM, never committed;
- private Grafana access through an SSH tunnel.

This phase does not create the GitHub Actions deploy workflow, backups, HTTPS,
DNS, Cloud SQL, Memorystore, Cloud Run, or public Prometheus/Grafana access.

## Recommended Starting Values

Adjust names if needed, but keep one region/zone for the first deployment.

```bash
PROJECT_ID="your-gcp-project-id"
REGION="europe-central2"
ZONE="europe-central2-a"
AR_REPOSITORY="ais-tracking-system"
VM_NAME="ais-prod-vm"
VM_SERVICE_ACCOUNT="ais-vm-runner"
NETWORK_TAG_HTTP="ais-prod-http"
NETWORK_TAG_SSH="ais-prod-ssh"
STATIC_IP_NAME="ais-prod-ip"
APP_DIR="/opt/ais-tracking-system"
```

Cost-conscious VM recommendation:

- Machine type: `e2-medium` initially.
- Boot disk: 50 GB balanced persistent disk, Debian 12 or Ubuntu 22.04 LTS.
- External IP: reserved static IP.

`e2-small` may work for light demos, but Postgres, Redis, API, ingestion,
worker, Prometheus, Grafana, and Nginx can get cramped on 2 GB RAM.

## If You Are In The GCP Console

If you are on the Google Cloud "Create" page and see options such as **Create
VM**, **Create a database**, **Deploy an application**, **Cloud Run**, **Cloud
SQL**, or **Compute Engine**, choose **Compute Engine** and then **Create VM**.

For this phase:

- Choose **Compute Engine / Create VM**.
- Do not choose **Cloud Run**.
- Do not choose **Cloud SQL**.
- Do not choose **Deploy an application**.
- Do not create a public database.

The database and Redis containers will run privately inside Docker Compose on
the VM.

## 1. Select Or Create A Project

Console path:

1. Open the project picker in the top bar.
2. Select an existing project or click **New Project**.
3. Give it a clear name, for example `ais-tracking-system`.
4. Make sure billing is attached to the project.

`gcloud`:

```bash
gcloud projects create "$PROJECT_ID" --name="AIS Tracking System"
gcloud config set project "$PROJECT_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account="YOUR_BILLING_ACCOUNT_ID"
```

If you already created the project in the Console:

```bash
gcloud config set project "$PROJECT_ID"
gcloud config get-value project
```

## 2. Enable Required APIs

Console path:

1. Go to **APIs & Services**.
2. Click **Enable APIs and Services**.
3. Enable **Compute Engine API**.
4. Enable **Artifact Registry API**.
5. Enable **IAM Service Account Credentials API** if you plan to use service
   account impersonation later.

`gcloud`:

```bash
gcloud services enable \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com
```

## 3. Create Artifact Registry

Console path:

1. Go to **Artifact Registry**.
2. Click **Create Repository**.
3. Name: `ais-tracking-system`.
4. Format: **Docker**.
5. Mode: **Standard**.
6. Location type: **Region**.
7. Region: `europe-central2` or your selected region.

`gcloud`:

```bash
gcloud artifacts repositories create "$AR_REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description="AIS Tracking System Docker images"
```

Check:

```bash
gcloud artifacts repositories list --location="$REGION"
```

Image names will look like this later:

```text
europe-central2-docker.pkg.dev/PROJECT_ID/ais-tracking-system/backend:GIT_SHA
europe-central2-docker.pkg.dev/PROJECT_ID/ais-tracking-system/migrator:GIT_SHA
europe-central2-docker.pkg.dev/PROJECT_ID/ais-tracking-system/frontend:GIT_SHA
```

## 4. Create The VM Service Account

The VM needs permission to pull images, not to push them.

```bash
gcloud iam service-accounts create "$VM_SERVICE_ACCOUNT" \
  --display-name="AIS production VM runner"

VM_SERVICE_ACCOUNT_EMAIL="$VM_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

gcloud artifacts repositories add-iam-policy-binding "$AR_REPOSITORY" \
  --location="$REGION" \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/artifactregistry.reader"
```

Optional but useful for VM logs:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/logging.logWriter"
```

Do not create or commit a JSON service account key for the VM. Attach the
service account to the VM instead.

## 5. Reserve A Static External IP

Console path:

1. Go to **VPC network** -> **IP addresses**.
2. Click **Reserve external static IP address**.
3. Name: `ais-prod-ip`.
4. Network service tier: **Premium**.
5. IP version: **IPv4**.
6. Type: **Regional**.
7. Region: your selected region.

`gcloud`:

```bash
gcloud compute addresses create "$STATIC_IP_NAME" --region="$REGION"
gcloud compute addresses describe "$STATIC_IP_NAME" --region="$REGION" --format="get(address)"
```

Check:

```bash
gcloud compute addresses list
```

## 6. Create Firewall Rules

Only HTTP should be public for the first deployment. SSH should be restricted to
your current public IP address, or to IAP later.

Find your current public IP:

```bash
curl -4 ifconfig.me
```

Set it as a `/32` source range:

```bash
MY_IP_CIDR="YOUR_PUBLIC_IP/32"
```

Create HTTP ingress:

```bash
gcloud compute firewall-rules create allow-ais-prod-http \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:80 \
  --source-ranges=0.0.0.0/0 \
  --target-tags="$NETWORK_TAG_HTTP"
```

Create restricted SSH ingress:

```bash
gcloud compute firewall-rules create allow-ais-prod-ssh \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges="$MY_IP_CIDR" \
  --target-tags="$NETWORK_TAG_SSH"
```

Do not create public firewall rules for these ports:

- Postgres: `5432`
- Redis: `6379`
- Prometheus: `9090`
- Grafana: `3000` or `3001`
- API container port: `3000`

Check:

```bash
gcloud compute firewall-rules list
```

## 7. Create The Compute Engine VM

Console path:

1. Go to **Compute Engine** -> **VM instances**.
2. Click **Create instance**.
3. Name: `ais-prod-vm`.
4. Region: `europe-central2`.
5. Zone: `europe-central2-a`.
6. Machine type: `e2-medium`.
7. Boot disk: Debian 12 or Ubuntu 22.04 LTS, 50 GB balanced persistent disk.
8. Firewall checkboxes: you may leave HTTP/HTTPS unchecked if you created the
   tag-based firewall rule above.
9. Network tags: add `ais-prod-http` and `ais-prod-ssh`.
10. Network interface external IPv4 address: choose the reserved static IP.
11. Service account: choose `ais-vm-runner`.
12. Access scopes: **Allow default access** is enough when IAM is granted on the
   service account.
13. Click **Create**.

`gcloud`:

```bash
STATIC_IP_ADDRESS="$(gcloud compute addresses describe "$STATIC_IP_NAME" \
  --region="$REGION" \
  --format="get(address)")"

gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type=e2-medium \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --address="$STATIC_IP_ADDRESS" \
  --tags="$NETWORK_TAG_HTTP,$NETWORK_TAG_SSH" \
  --service-account="$VM_SERVICE_ACCOUNT_EMAIL" \
  --scopes=https://www.googleapis.com/auth/cloud-platform
```

## 8. Install Docker And Compose On The VM

SSH to the VM:

```bash
gcloud compute ssh "$VM_NAME" --zone="$ZONE"
```

On the VM:

```bash
REGION="europe-central2"
PROJECT_ID="your-gcp-project-id"
AR_REPOSITORY="ais-tracking-system"

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version
```

If you choose an Ubuntu image, use Docker's Ubuntu repository URL instead of the
Debian URL above.

Check whether the Google Cloud CLI is already installed on the VM:

```bash
gcloud --version
```

If `gcloud` is missing, install it:

```bash
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
  | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list > /dev/null
sudo apt-get update
sudo apt-get install -y google-cloud-cli
gcloud --version
```

## 9. Authenticate Docker To Artifact Registry

On the VM:

```bash
gcloud auth configure-docker "$REGION-docker.pkg.dev"
```

Then test a pull after at least one image has been pushed to Artifact Registry:

```bash
docker pull "$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPOSITORY/frontend:GIT_SHA"
```

If no AIS images have been pushed yet, this check is expected to wait until the
image publishing phase.

## 10. Prepare The App Directory

On the VM:

```bash
sudo mkdir -p /opt/ais-tracking-system
sudo chown "$USER:$USER" /opt/ais-tracking-system
cd /opt/ais-tracking-system
```

For the first manual bootstrap, copy or clone the repository contents needed to
run Compose:

```bash
git clone https://github.com/OlegPavlyuk/ais-tracking-system.git .
```

Later, the CD workflow will update this directory automatically. Do not build
that deploy workflow in this phase.

## 11. Create The Production Env File Securely

On the VM:

```bash
cd /opt/ais-tracking-system
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit the file on the VM:

```bash
nano .env.production
```

Replace every `change-me` value with a strong unique secret. Do not use the
example values on the VM.

Generate secrets on the VM:

```bash
openssl rand -base64 32
```

Set image names to Artifact Registry image tags once images exist:

```text
AIS_BACKEND_IMAGE=europe-central2-docker.pkg.dev/PROJECT_ID/ais-tracking-system/backend:GIT_SHA
AIS_MIGRATOR_IMAGE=europe-central2-docker.pkg.dev/PROJECT_ID/ais-tracking-system/migrator:GIT_SHA
AIS_FRONTEND_IMAGE=europe-central2-docker.pkg.dev/PROJECT_ID/ais-tracking-system/frontend:GIT_SHA
```

Never commit `.env.production`. It is ignored by Git and should exist only on
the VM or in a secure secret manager later.

## 12. Private Grafana Access

Grafana must not be public. Use the local-only Compose override in this repo:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  up -d
```

The override binds Grafana to `127.0.0.1:3001` on the VM only. It is not
reachable from the public internet.

From your laptop, create an SSH tunnel:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  -- -L 3001:127.0.0.1:3001
```

Then open:

```text
http://127.0.0.1:3001
```

Use `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` from the VM's
`.env.production`.

## 13. Bootstrap Checks

Run locally:

```bash
gcloud compute addresses list
gcloud compute firewall-rules list
gcloud artifacts repositories list --location="$REGION"
```

Run on the VM:

```bash
docker compose version
gcloud auth configure-docker "$REGION-docker.pkg.dev"
```

When images exist in Artifact Registry, verify the VM can pull them:

```bash
docker pull "$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPOSITORY/frontend:GIT_SHA"
```

After the stack is started, public checks should be limited to:

```bash
curl -i "http://STATIC_IP/"
curl -i "http://STATIC_IP/api/vessels?limit=1"
curl -i "http://STATIC_IP/healthz"
curl -i "http://STATIC_IP/readyz"
```

These should not be publicly reachable:

```bash
curl -i "http://STATIC_IP/metrics"
curl -i "http://STATIC_IP/admin"
```

Do not test or expose Postgres, Redis, Prometheus, or Grafana through public
firewall rules.

## 14. IAP Hardening Later

Restricting SSH to your own public IP is acceptable for the first deployment.
Google Cloud IAP for TCP forwarding is the preferred hardening path when
practical. It can replace direct SSH ingress later by allowing source range
`35.235.240.0/20` and using:

```bash
gcloud compute ssh "$VM_NAME" --zone="$ZONE" --tunnel-through-iap
```

Do not let IAP setup block this first VM bootstrap unless it is straightforward
in your project.
