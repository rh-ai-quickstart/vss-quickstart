# Analyze Manufacturing Video with Red Hat AI and NVIDIA

Turn hours of production-floor video into searchable data - ask questions in natural language, powered by Red Hat AI Factory with NVIDIA.

## Table of Contents

- [Detailed Description](#detailed-description)
  - [Architecture Diagrams](#architecture-diagrams)
- [Requirements](#requirements)
  - [Minimum Hardware Requirements](#minimum-hardware-requirements)
  - [Minimum Software Requirements](#minimum-software-requirements)
  - [Required User Permissions](#required-user-permissions)
- [Deploy](#deploy)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Delete](#delete)
- [Customization](#customization)
- [References](#references)
- [Tags](#tags)

## Detailed Description

Manufacturing operations generate more video than any team can watch. Production lines, work cells, loading docks, and restricted areas stream footage around the clock, and the moments that matter — an unsafe behavior, a missed step, an anomaly on the line — are buried in hours of routine activity. This quickstart lets teams query that footage in natural language and get accurate summaries automatically, turning passive camera feeds into searchable operational insight. The same pipeline applies beyond the factory floor — logistics, facilities, and secure spaces — but this quickstart focuses on manufacturing safety and operations.

Built on the [NVIDIA AI Blueprint for Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization), it deploys a complete AI pipeline on OpenShift: a vision model "watches" the footage and a language model turns what it sees into summaries and answers to your questions. Video ingestion, indexing, and orchestration run as managed services, so you upload a clip — or point at a live stream — and start asking questions, with no manual review required.

This quickstart adapts the upstream blueprint for Red Hat AI environments, showing how enterprise-grade video analytics can run with NVIDIA NIM models on [Red Hat AI Factory with NVIDIA](https://www.redhat.com/en/products/ai/factory-with-nvidia). It adds OpenShift-compatible security contexts, composable Helm overlays, a KServe model serving option for RHOAI integration, and a full observability stack with OpenTelemetry, Grafana, and MLflow.

### Architecture Diagrams

![VSS architecture showing video ingestion, VLM captioning, and LLM summarization](deploy/images/vss_architecture.png)

## Requirements

### Minimum Hardware Requirements

#### GPU Requirements

This deployment uses KServe model serving with vLLM for local inference. You may also choose optionally to point to NGC Cloud endpoints if you do not have local resources. The following requirements apply when models are deployed locally on your GPUs:

**Standard deployment requirements (full GPUs, not using MIG):**
- **2x NVIDIA H100** (80GB) or equivalent [tested on H100s]
  - GPU 0: Cosmos3-Reasoner (VLM) — 1 GPU (~85GB)
  - GPU 1: Nemotron-Nano-9B-v2 (LLM) — 1 GPU (~25GB)

**Optional: Multi-Instance GPU (MIG) optimization**

MIG allows you to partition GPUs into smaller slices, enabling multiple models to share a single GPU efficiently and reduce overall GPU requirements.

NOTE: MIG examples in the deployment manifests are based on H100 MIG profiles

- **With MIG**: 2x H100 GPUs minimum
  - GPU 0: 1x 7g.94gb (Cosmos3 VLM)
  - GPU 1: 1x 3g.47gb (Nemotron LLM) + 1x 2g.24gb (VIOS pipeline)

See the [Deployment Guide](docs/advanced-docs/deployment-guide.md) for detailed MIG setup commands.

#### Storage

- **NIM model weights**: 50-100GB PVC per model (for KServe deployment option)
- **MLflow artifacts**: 10GB PVC
- **Infrastructure services** (Redis, Kafka, Elasticsearch): varies by data volume

### Minimum Software Requirements

- Red Hat OpenShift Container Platform (tested with v4.20)
- Red Hat OpenShift AI (tested with v3.4) with KServe model serving configured
- NVIDIA GPU Operator (optional: with MIG support enabled)
- Helm CLI
- OpenShift Client CLI (oc)

### Required User Permissions

- cluster-admin permissions (chart creates ServiceAccount, SCC RoleBinding, Route)
- Ability to create PersistentVolumeClaims
- Ability to create Secrets
- For KServe deployment: permissions to create LLMInferenceServices

## Deploy

The following instructions will deploy the video search and summarization AI quickstart to your Red Hat AI environment using Helm.

### Prerequisites

- OpenShift cluster with OpenShift AI installed (see version requirements above)
- Helm CLI and OpenShift Client CLI (oc)
- GPU nodes available with NVIDIA GPU Operator installed (required for on-cluster inference with KServe; not required for NGC cloud inference)
- MIG configured on GPU nodes if using MIG scheduling (see [Deployment Guide](docs/advanced-docs/deployment-guide.md#configuring-mig-on-h100-sxm5))

Obtain the following API keys:
- **NGC_API_KEY** (required for all deployment options — used for container image pulls and/or cloud inference)
  - Get your API key at: https://org.ngc.nvidia.com/setup/api-key
  - Sign up for NIM access at: https://build.nvidia.com/

**Choose a model serving option:**

| | Option A: NGC Cloud Inference | Option B: KServe (RHOAI) |
|---|---|---|
| **Models run** | On NVIDIA's hosted API | On your cluster GPUs via KServe |
| **GPU requirement** | VIOS pipeline only (~1 GPU) | 2-3 GPUs (one per model + VIOS pipeline) |
| **Additional prerequisites** | None | RHOAI with KServe configured |
| **Best for** | Quick evaluation, limited GPU capacity | Production on RHOAI |

### Install

1. Clone the repository and initialize the upstream submodule:

```bash
git clone https://github.com/rh-ai-quickstart/vss-quickstart.git
cd vss-quickstart
git submodule update --init --recursive
```

**Note:** The submodule points to the upstream NVIDIA VSS Blueprint. The deployment uses and modifies the v3.2.1 charts in `deploy/helm/`.

2. Ensure you are logged into your OpenShift cluster as cluster-admin:

```bash
oc whoami
```

3. Set environment variables:

```bash
export NGC_API_KEY="<your NGC API key>"
export APPS_DOMAIN=$(oc get ingress.config.openshift.io/cluster \
  -o jsonpath='{.spec.domain}')
```

4. Create namespace:

```bash
oc new-project vss
```

5. This quickstart ships the **`dev-profile-base`** developer profile — the core VSS pipeline (VLM captioning, LLM summary/chat, agent + UI) validated on Red Hat AI Enterprise:

```
dev-profile-base — Core pipeline + NIM models (LLM + VLM)
```

> Additional profiles from the upstream blueprint — `dev-profile-alerts` (alerting), `dev-profile-search` (search/RAG), and `dev-profile-lvs` (long-video summarization) — are retained in the `upstream/vss` submodule.

6. Build chart dependencies (required before first install — the developer-profile charts reference service charts via local `file://` paths that Helm must resolve):

```bash
helm dependency build deploy/helm/developer-profiles/dev-profile-base/
```

7. Install using one of the three model serving options below:

#### Option A: NGC Cloud Inference (no local GPUs for models)

Uses NVIDIA-hosted NIM endpoints for LLM and VLM inference. Models run on NGC cloud; only the VSS pipeline services deploy on your cluster. This is the fastest way to deploy the AI quickstart without provisioning GPU nodes for model serving.

**Cloud model selection.** `values-ngc.yaml` points the agent at specific models on NGC cloud. Depending on model availability and selection with your individual NGC api key, you may swap out the models used. Just be sure to verify model functionality parity before changing them.

```bash
helm upgrade --install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -n vss \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  -f deploy/helm/developer-profiles/dev-profile-base/values-ngc.yaml \
  --set-string ngc.apiKey="$NGC_API_KEY" \
  --set-string agent.vss-agent.extraEnv[0].value="$NGC_API_KEY" \
  --set-string agent.vss-agent.extraEnv[1].value="$NGC_API_KEY" \
  --set global.externalHost=vss.${APPS_DOMAIN}
```

> `ngc.apiKey` backs the image-pull and NIM secrets; the two `extraEnv` overrides populate the agent's `NVIDIA_API_KEY` / `OPENAI_API_KEY` for cloud inference auth (they default to a placeholder in `values-ngc.yaml` so no real key is committed). All three are required for Option A.

#### Option B: Local Model Serving with KServe (models on your GPUs)

Deploys models as KServe LLMInferenceServices managed by Red Hat OpenShift AI. Requires GPU nodes with NVIDIA GPU Operator and RHOAI with KServe model serving configured.

```bash
helm upgrade --install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -n vss \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  --set-string ngc.apiKey="$NGC_API_KEY" \
  --set openshift.ai.useKserve=true \
  --set global.externalHost=vss.${APPS_DOMAIN}
```

See the [Deployment Guide](docs/advanced-docs/deployment-guide.md#kserve-model-serving) for KServe configuration details and MIG GPU scheduling.

#### Verify Installation

Check all deployed pods are running:

```bash
oc get pods -n vss
```

Get the UI URL:

```bash
oc get route vss-vss-ui -n vss -o jsonpath='{.spec.host}'
```

Open `https://<route-host>` in a browser. Upload a video file and open the chat interface to begin.

#### (Optional) Deploy Observability Stack

Deploy the complete observability stack for monitoring, tracing, and metrics visualization:

```bash
cd deploy/helm/observability
chmod +x install-operators.sh deploy.sh

# Step 1: Install operators and wait for CRDs (2-3 minutes)
./install-operators.sh

# Step 2: Deploy observability resources
./deploy.sh
```

This will install:
- **OpenTelemetry Collector** for NIM model metrics collection
- **Grafana** for metrics visualization and dashboards
- **User Workload Monitoring** for Prometheus metrics collection via PodMonitors
- **MLflow** for pipeline experiment tracking and tracing
- **Required operators** (Grafana, OpenTelemetry)

NOTE: For more detailed information on verifying the observability stack deployment and utilizing the resources including configuring tracing in MLflow, review the observability stack guide at [docs/advanced-docs/observability-guide.md](docs/advanced-docs/observability-guide.md)

### Delete

Uninstall the AI quickstart deployment:

```bash
# Delete VSS application
helm uninstall vss -n vss

# Delete all PVCs to remove data
oc delete pvc --all -n vss

# (Optional) Delete the entire namespace
oc delete project vss
```

#### (Optional) Uninstall Observability Stack

If you deployed the observability stack, uninstall it:

```bash
cd deploy/helm/observability
chmod +x uninstall.sh
./uninstall.sh
```

Or manually uninstall in reverse order (resources first, then operators):

```bash
# Uninstall observability resources
helm uninstall mlflow -n redhat-ods-applications
helm uninstall logging-stack -n openshift-logging
helm uninstall grafana -n observability-hub
helm uninstall uwm
helm uninstall otel-collector -n observability-hub

# Clean up orphaned User Workload Monitoring ConfigMap (if it exists)
oc delete configmap user-workload-monitoring-config -n openshift-user-workload-monitoring 2>/dev/null || true

# Uninstall operators (this will also delete their namespaces)
helm uninstall otel-op
helm uninstall grafana-op
helm uninstall cluster-obs
helm uninstall logging-op
```

## Customization

This quickstart extends the upstream [NVIDIA VSS Blueprint v3.2.1](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) in support of the Red Hat AI Factory with NVIDIA joint solution:

- **OpenShift AI deployment** — Per-profile `values-openshift.yaml` overlays with path-based Routes, custom SCCs (NIM SELinux relabel avoidance, VIOS anyuid), pod affinity, security context nulling for restricted-v2, and NGC secret creation. All OpenShift resources are gated by `global.openshift.enabled` and applied at install time.
- **Two model serving options** — NGC cloud inference (`values-ngc.yaml` overlay, no local model GPUs) or KServe LLMInferenceServices via RHOAI (`openshift.ai.useKserve` flag). See [Install](#install) for usage and the [Deployment Guide](docs/advanced-docs/deployment-guide.md#kserve-model-serving) for KServe details.
- **MIG GPU scheduling** — Validated MIG configuration for running GPU workloads on two physical H100 SXM5 96GB GPUs with documented MIG setup commands.
- **Observability stack** — OpenTelemetry Collector, Grafana with Prometheus dashboards, User Workload Monitoring with PodMonitors, and standalone MLflow tracking server. See the [Observability Guide](docs/advanced-docs/observability-guide.md).
- **MLflow tracing** — Per-request pipeline telemetry logged to MLflow without rebuilding the container image (deferred to Phase 2 — see [Fork Customizations](docs/advanced-docs/fork.md)).
- **Red Hat UI branding** — Logo, colors, and fonts replaced in the web UI (deferred to Phase 2 — see [Fork Customizations](docs/advanced-docs/fork.md)).

### Additional Resources

- [Deployment Guide](docs/advanced-docs/deployment-guide.md) — MIG setup, KServe vs NIM details, model size optimization
- [Observability Guide](docs/advanced-docs/observability-guide.md) — Full observability stack documentation
- [Fork Customizations](docs/advanced-docs/fork.md) — Tracks all custom work vs upstream by phase

## References

- [NVIDIA VSS Documentation](https://docs.nvidia.com/vss/latest/index.html)
- [NVIDIA AI Blueprint: Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) - Upstream project repository
- [NVIDIA NIM](https://developer.nvidia.com/nim) - NVIDIA Inference Microservices for optimized model serving
- [Red Hat OpenShift AI Documentation](https://docs.redhat.com/en/openshift-ai)
- [NVIDIA GPU Operator MIG Documentation](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-mig.html)
- [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
- [Red Hat AI Quickstarts](https://www.redhat.com/en/blog/introducing-ai-quickstarts) - Collection of AI blueprints for Red Hat AI

## License

This AI quickstart is based on the [NVIDIA AI Blueprint: Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization), which is licensed under the **Apache License 2.0**. This repository contains Red Hat-specific customizations and deployment configurations for the upstream VSS project.

- **VSS Project License:** See [licenses/LICENSE](licenses/LICENSE) for the Apache License 2.0 text
- **Third-Party Dependencies:** See [licenses/LICENSE-3rd-party.txt](licenses/LICENSE-3rd-party.txt) for all third-party software licenses
- **Data License:** See [licenses/LICENSE.DATA](licenses/LICENSE.DATA) for license around use of NVIDIA dataset for evaluations.
- **AI quickstart Deployment:** See [LICENSE](LICENSE) for license content related to the custom code within this repository.

**Note:** This is not the official NVIDIA VSS Blueprint repository. For the upstream project, see [NVIDIA-AI-Blueprints/video-search-and-summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization).

## Tags

- **Product**: Red Hat AI Enterprise
- **Use case**: Video analytics, observability
- **Industry**: Manufacturing
- **Partner**: NVIDIA