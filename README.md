# Video Search and Summarization with Red Hat AI and NVIDIA

Deploy NVIDIA's Video Search and Summarization AI blueprint on Red Hat AI Factory with NVIDIA, with NIM model serving, MIG GPU scheduling, and MLflow observability.

> **Project home**
>
> This repository is part of the [Red Hat AI Quickstarts](https://www.redhat.com/en/blog/introducing-ai-quickstarts) initiative. It extends the upstream [NVIDIA AI Blueprint: Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) with OpenShift AI deployment support and MLflow observability. See [Customization](#customization) for details on what this quickstart adds over upstream.

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

The NVIDIA AI Blueprint for Video Search and Summarization addresses the challenge of efficiently analyzing and summarizing large volumes of video data. Operations teams across manufacturing, logistics, and facilities management generate continuous video streams — from warehouse floors and production lines to loading docks and secure spaces — that are too voluminous to review manually. This quickstart enables teams to query that footage in natural language and receive accurate, cited summaries automatically.

The v3.2.1 blueprint deploys a microservices-based AI pipeline: a Vision Language Model (Cosmos3-Reasoner) captions each video frame, an LLM (Nemotron-Nano-9B-v2) generates summaries and handles chat, and infrastructure services (Redis, Kafka, Elasticsearch) support retrieval and event processing. Video I/O Services (VIOS) handle ingestion, decoding, and streaming. An agent layer with Model Context Protocol (MCP) orchestrates the pipeline, and a Real-Time Video Intelligence (RTVI) component enables live stream processing.

Built as a customized version of the NVIDIA VSS Blueprint for Red Hat AI, this quickstart shows how enterprise-grade video analytics can run with NVIDIA NIM models on [Red Hat AI Factory with NVIDIA](https://www.redhat.com/en/products/ai/factory-with-nvidia). The quickstart adapts the upstream blueprint for Red Hat AI environments, adding OpenShift-compatible security contexts, composable Helm overlays, a KServe model serving option for RHOAI integration, and a full observability stack with OpenTelemetry, Grafana, and MLflow.

### Architecture Diagrams

![VSS architecture showing video ingestion, VLM captioning, and LLM summarization](deploy/images/vss_architecture.png)

Video is decoded into chunks by VIOS. Each chunk is captioned by the Cosmos3 VLM and indexed into Elasticsearch. User queries flow through the agent layer to the Nemotron LLM, which returns cited summaries. Alerts fire when captions match user-defined keywords. The RTVI component enables real-time processing of live RTSP streams.

## Requirements

### Minimum Hardware Requirements

#### GPU Requirements

This deployment uses NVIDIA NIM model serving for GPU inference. The following requirements apply when models are deployed locally on your GPUs.

**Models deployed on your cluster:**
- **Nemotron-Nano-9B-v2 (LLM)**: ~25GB VRAM
- **Cosmos3-Reasoner (VLM)**: ~85GB VRAM

**Standard deployment requirements (full GPUs, not using MIG):**
- **2x NVIDIA H100** (80GB) or equivalent
  - GPU 0: Cosmos3-Reasoner (VLM) — 1 GPU (~85GB)
  - GPU 1: Nemotron-Nano-9B-v2 (LLM) — 1 GPU (~25GB)

**Optional: Multi-Instance GPU (MIG) optimization**

MIG allows you to partition GPUs into smaller slices, enabling multiple models to share a single GPU efficiently and reduce overall GPU requirements.

NOTE: MIG examples are based on H100 MIG profiles

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
- Red Hat OpenShift AI v3.4 with KServe model serving configured
- NVIDIA GPU Operator with MIG support enabled
- Helm CLI
- OpenShift Client CLI (oc)

### Required User Permissions

- cluster-admin permissions (chart creates ServiceAccount, SCC RoleBinding, Route)
- Ability to create PersistentVolumeClaims
- Ability to create Secrets
- For KServe deployment: permissions to create InferenceServices

## Deploy

The following instructions will deploy the VSS quickstart to your Red Hat AI environment using Helm developer profiles with a composable OpenShift overlay.

### Prerequisites

Before deployment, ensure you have the following in place:
- OpenShift cluster with OpenShift AI installed (see version requirements above)
- GPU nodes available with NVIDIA GPU Operator installed
- MIG configured on GPU nodes if using MIG scheduling (see [Deployment Guide](docs/advanced-docs/deployment-guide.md#configuring-mig-on-h100-sxm5))

Obtain the following API keys:
- **NGC_API_KEY** (required for NIM model pulls)
  - Get your API key at: https://org.ngc.nvidia.com/setup/api-key
  - Sign up for NIM access at: https://build.nvidia.com/

### Install

1. Clone the repository and initialize the upstream submodule:

```bash
git clone https://github.com/rh-ai-quickstart/vss-quickstart.git
cd vss-quickstart
git submodule update --init --recursive
```

**Note:** The submodule points to the [rh-ai-quickstart fork](https://github.com/rh-ai-quickstart/nvidia-video-search-and-summarization) of the upstream NVIDIA VSS Blueprint, which tracks OpenShift integration work. The deployment uses the unpacked v3.2.1 charts in `deploy/helm/`.

2. Ensure you are logged into your OpenShift cluster as cluster-admin:

```bash
oc whoami
```

3. Set environment variables for API keys:

```bash
export NGC_API_KEY="<your NGC API key>"
```

4. Create namespace:

```bash
oc new-project vss
```

5. Install using Helm:

Pick a developer profile based on the capabilities you need:

```
Which developer profile?
├── dev-profile-base    — Core pipeline + NIM models (recommended starting point)
├── dev-profile-alerts  — + alert capabilities
├── dev-profile-search  — + search capabilities
└── dev-profile-lvs     — + live video streaming
```

```bash
export APPS_DOMAIN=$(oc get ingress.config.openshift.io/cluster \
  -o jsonpath='{.spec.domain}')

helm upgrade --install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -n vss \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  --set-string ngc.apiKey="$NGC_API_KEY" \
  --set global.externalHost=vss.${APPS_DOMAIN}
```

GPU pods may take 20-30 minutes on first deploy while model weights download.

#### Verify Installation

Check all deployed pods are running:

```bash
oc get pods -n vss
```

Get the UI URL:

```bash
oc get route vss-ui -n vss -o jsonpath='{.spec.host}'
```

Open `https://<route-host>` in a browser. Upload a video file or enter an RTSP stream URL to begin.

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

Uninstall the quickstart deployment:

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

**Note:** After uninstalling, you may need to manually remove the User Workload Monitoring ConfigMap:

```bash
oc delete configmap cluster-monitoring-config -n openshift-monitoring
```

## Customization

This quickstart extends the upstream [NVIDIA VSS Blueprint v3.2.1](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) as part of the [Red Hat AI Quickstarts](https://www.redhat.com/en/blog/introducing-ai-quickstarts) initiative, adding:

- **OpenShift AI deployment** — Per-profile `values-openshift.yaml` overlays with path-based Routes, custom SCCs (NIM SELinux relabel avoidance, VIOS anyuid), pod affinity, security context nulling for restricted-v2, and NGC secret creation. All OpenShift resources are gated by `global.openshift.enabled` and applied at install time.
- **KServe model serving option** — Feature flag (`openshift.ai.useKserve`) to deploy NIM models as KServe InferenceServices managed by RHOAI, as an alternative to NVIDIA NIM Operator CRDs. See the [Deployment Guide](docs/advanced-docs/deployment-guide.md#kserve-vs-nim-operator) for details.
- **MIG GPU scheduling** — Validated MIG configuration for running GPU workloads on two physical H100 SXM5 96GB GPUs with documented MIG setup commands.
- **Observability stack** — OpenTelemetry Collector, Grafana with Prometheus dashboards, User Workload Monitoring with PodMonitors, and standalone MLflow tracking server. See the [Observability Guide](docs/advanced-docs/observability-guide.md).
- **MLflow tracing** — Per-request pipeline telemetry logged to MLflow without rebuilding the container image (deferred to Phase 2 — see [Fork Customizations](docs/advanced-docs/fork.md)).
- **Red Hat UI branding** — Logo, colors, and fonts replaced in the web UI (deferred to Phase 2 — see [Fork Customizations](docs/advanced-docs/fork.md)).

### Quick Configuration Changes

- **Model Serving Backend:** Toggle `openshift.ai.useKserve` in the profile's `values-openshift.yaml` to switch between KServe and NIM Operator
- **Developer Profile:** Choose a different profile directory for additional capabilities (alerts, search, live video) — each has its own `values-openshift.yaml` with profile-specific component keys
- **GPU Tolerations:** Edit the `&gpu-tolerations` anchor in the profile's `values-openshift.yaml` to match your node taints — all GPU workloads inherit it
- **Model Selection:** Override NIM model images and resources in the profile's `values-openshift.yaml`

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