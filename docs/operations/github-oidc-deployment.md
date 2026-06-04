# GitHub OIDC Deployment

This document owns GitHub-to-GCP deployment authentication for the production
VM. VM runtime operations live in `docs/operations/gcp-vm-runbook.md`.

The deployment workflow is `.github/workflows/deploy.yml`. It builds and pushes
SHA-tagged images, waits for approval on the GitHub `production` environment,
copies deployment files to the VM, and runs the VM deploy script.

## Workflow Shape

The workflow uses these defaults:

```text
GCP_PROJECT_ID=<your-project-id>
GCP_REGION=<artifact-registry-region>
ARTIFACT_REGISTRY_REPOSITORY=<artifact-registry-repository>
IMAGE_REGISTRY=<region>-docker.pkg.dev/<project-id>/<repository>
GCE_VM_NAME=<vm-name>
GCE_ZONE=<vm-zone>
GCE_APP_DIR=/opt/ais-tracking-system
GCP_USE_IAP=true
```

For the current repository defaults, check `.github/workflows/deploy.yml`.

It pushes four image tags for the deploy SHA:

```text
backend:<git-sha>
migrator:<git-sha>
geo-import:<git-sha>
frontend:<git-sha>
```

Prefer Workload Identity Federation instead of a JSON service account key.

## Service Account

Create the GitHub deploy service account:

```bash
PROJECT_ID="<your-project-id>"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
REGION="europe-central2"
AR_REPOSITORY="ais-tracking-system"
GITHUB_REPOSITORY="OlegPavlyuk/ais-tracking-system"
GITHUB_POOL="github"
GITHUB_PROVIDER="github-actions"
GITHUB_DEPLOY_SERVICE_ACCOUNT="ais-github-deployer"
GITHUB_DEPLOY_SERVICE_ACCOUNT_EMAIL="$GITHUB_DEPLOY_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create "$GITHUB_DEPLOY_SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --display-name="AIS GitHub deployer"
```

Grant deployment permissions:

```bash
gcloud artifacts repositories add-iam-policy-binding "$AR_REPOSITORY" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --member="serviceAccount:$GITHUB_DEPLOY_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$GITHUB_DEPLOY_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/compute.viewer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$GITHUB_DEPLOY_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/compute.osAdminLogin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$GITHUB_DEPLOY_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/iap.tunnelResourceAccessor"
```

`roles/compute.osAdminLogin` lets the workflow prepare
`/opt/ais-tracking-system` and run Docker through `sudo` without pre-adding the
GitHub OS Login user to the VM's `docker` group. IAP access is required while
the workflow default `GCP_USE_IAP=true` is in use.

## Workload Identity Federation

Create the Workload Identity Pool and provider:

```bash
gcloud iam workload-identity-pools create "$GITHUB_POOL" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$GITHUB_PROVIDER" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$GITHUB_POOL" \
  --display-name="GitHub Actions OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$GITHUB_REPOSITORY'"
```

Allow this repository to impersonate the deploy service account:

```bash
gcloud iam service-accounts add-iam-policy-binding "$GITHUB_DEPLOY_SERVICE_ACCOUNT_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$GITHUB_POOL/attribute.repository/$GITHUB_REPOSITORY"
```

## GitHub Configuration

Add these GitHub repository or `production` environment secrets:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER=projects/<project-number>/locations/global/workloadIdentityPools/github/providers/github-actions
GCP_DEPLOY_SERVICE_ACCOUNT=ais-github-deployer@<your-project-id>.iam.gserviceaccount.com
```

Add these GitHub `production` environment variables only if your VM settings
differ from workflow defaults:

```text
GCE_VM_NAME=<vm-name>
GCE_ZONE=<vm-zone>
GCE_APP_DIR=/opt/ais-tracking-system
GCP_USE_IAP=true
```

In GitHub, create an environment named `production` and enable required
reviewers. The deploy job pauses there before touching the VM.

## IAP Requirements

When `GCP_USE_IAP=true`, the VM firewall must allow SSH from Google's IAP TCP
forwarding range:

```bash
gcloud compute firewall-rules describe allow-ais-prod-ssh-iap
```

Expected source range:

```text
35.235.240.0/20
```

OS Login must be enabled for the project or VM:

```bash
gcloud compute project-info describe \
  --format="value(commonInstanceMetadata.items.enable-oslogin)"
```

Test IAP SSH from your machine:

```bash
gcloud compute ssh "$GCE_VM_NAME" \
  --zone="$GCE_ZONE" \
  --tunnel-through-iap
```

## Running A Deployment

Automatic path:

1. Push or merge to `main`.
2. Wait for **CI** to succeed.
3. Open the queued **Deploy** workflow run.
4. Approve the `production` environment deployment.

Manual path:

1. Go to **GitHub** -> **Actions** -> **Deploy**.
2. Click **Run workflow**.
3. Leave `git_sha` empty to deploy the selected branch SHA, or enter an exact
   commit SHA.
4. Wait for image builds and pushes.
5. Approve the `production` environment deployment.

The VM deploy script writes:

```text
/opt/ais-tracking-system/.env.release
/opt/ais-tracking-system/.deploy/releases/current.env
/opt/ais-tracking-system/.deploy/releases/previous.env
```

The deployment fails loudly if image pull, migration, service restart, or smoke
checks fail. If smoke checks fail and a previous release exists, the script
attempts to roll containers back to the previous image metadata.

Related docs:

- [GCP VM runbook](gcp-vm-runbook.md)
- [Deployment overview](deployment.md)
- [Operations runbook](operations-runbook.md)
