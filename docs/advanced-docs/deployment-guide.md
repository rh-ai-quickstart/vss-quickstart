# Deployment Guide — Advanced Configuration

This guide covers advanced deployment topics not included in the main [README](../../README.md). For standard installation, follow the README's Deploy section.

## Table of Contents

- [Chart Architecture](#chart-architecture)
- [Configuring MIG on H100 SXM5](#configuring-mig-on-h100-sxm5)
- [KServe vs NIM Operator](#kserve-vs-nim-operator)
- [Model Size Optimization](#model-size-optimization)
- [GPU Toleration Configuration](#gpu-toleration-configuration)
- [Values Overlay Layering](#values-overlay-layering)

---

## Chart Architecture

VSS v3.2.1 uses a three-tier chart structure inherited from upstream:

```
developer-profiles/              # Install entry points (pick one)
├── dev-profile-base/            # Core pipeline + NIM models
├── dev-profile-alerts/          # + alert capabilities
├── dev-profile-search/          # + search capabilities
└── dev-profile-lvs/             # + live video streaming

services/                        # Service umbrella charts (dependencies of profiles)
├── agent/                       # Agent + MCP orchestration
├── alert/                       # Alert engine
├── analytics/                   # Analytics service
├── calibration-toolkit/         # Camera calibration
├── infra/                       # Redis, Kafka, Elasticsearch, Phoenix
├── nims/                        # NIM model serving (nemotron, cosmos, cosmos3)
├── rtvi/                        # Real-time video intelligence
├── ui/                          # Web interface
├── video-summarization/         # Video summarization pipeline
└── vios/                        # Video I/O services
```

Each developer profile is an independent Helm chart that declares dependencies on the service charts via `Chart.yaml`. Dependencies use `file://../../services/<name>` paths, which resolve at install time.

Each profile has its own `values-openshift.yaml` because profiles have different component keys (e.g. alerts has `vss-rtvi-cv`, LVS has `vss-summarization`). The overlay is applied with `-f <profile-dir>/values-openshift.yaml`.

---

## Configuring MIG on H100 SXM5

MIG must be enabled before deploying VSS. On the GPU node:

```bash
# Enable MIG mode on both GPUs (requires root; node reboot may be needed)
nvidia-smi -i 0 --mig-mode=Enabled
nvidia-smi -i 1 --mig-mode=Enabled

# GPU 0: one full 7g.94gb instance for Cosmos3 VLM
nvidia-smi mig -i 0 -cgi 0 -C   # creates 1x 7g.94gb + 1x compute instance

# GPU 1: 3g.47gb (Nemotron LLM) + 2g.24gb (VIOS pipeline) + 1g.12gb (spare)
nvidia-smi mig -i 1 -cgi 9,15,19 -C
# Profile IDs: 9=3g.47gb, 15=2g.24gb, 19=1g.12gb (verify with: nvidia-smi mig -lgip)
```

After MIG is configured, verify slices are visible:

```bash
nvidia-smi mig -lgi
```

The NVIDIA GPU Operator will advertise the MIG slices as extended resources (e.g. `nvidia.com/mig-3g.47gb`). Your `values-openshift.yaml` GPU tolerations and resource requests must match these advertised resources.

> **Note:** The `mig-7g.94gb` slice occupies all 7 compute instances of one GPU — no other workload can share it. Plan your MIG layout to fully utilize each GPU.

---

## KServe vs NIM Operator

The chart supports two model serving backends via the `openshift.ai.useKserve` feature flag in each profile's `values-openshift.yaml`.

### NIM Operator (default: `useKserve: false`)

Uses NVIDIA NIM Operator CRDs (`NIMCache`, `NIMService`). The NIM Operator manages model lifecycle, caching, and health checks automatically. This is the default because it requires less OpenShift AI configuration.

**When to use:** Your cluster has the NIM Operator installed and you want NVIDIA-managed model lifecycle.

### KServe (RHOAI: `useKserve: true`)

Uses KServe `LLMInferenceService` resources (`serving.kserve.io/v1alpha2`) managed by Red Hat OpenShift AI. The `openshift-ai.yaml` template creates three resources per enabled model:

1. **PVC** — persistent storage for model weights
2. **Job** — downloads model weights from HuggingFace/NGC into the PVC
3. **LLMInferenceService** — defines the container spec and model serving endpoint in a single resource

Models are configured in the `openshift.ai.kserveModels` map:

```yaml
openshift:
  ai:
    useKserve: true
    kserveModels:
      nemotron:
        enabled: true
        repoId: nvidia/Nemotron-Nano-9B-v2
        storage: 50Gi
        runtimeImage: "registry.redhat.io/rhoai/vllm-cuda-rhel9:latest"
        vllmArgs:
          - "--gpu-memory-utilization"
          - "0.90"
          - "--max-model-len"
          - "16384"
          - "--trust-remote-code"
        resources:
          limits:
            cpu: "12"
            memory: 48Gi
            nvidia.com/gpu: "1"
          requests:
            cpu: "4"
            memory: 24Gi
            nvidia.com/gpu: "1"
```

The template is data-driven — adding or removing a model only requires editing this map. No template changes needed.

**When to use:** Your cluster uses RHOAI for model serving and you want LLMInferenceServices managed alongside other RHOAI workloads.

---

## Model Size Optimization

The default configuration uses Nemotron-Nano-9B-v2 (~25GB VRAM) which fits in a single MIG `3g.47gb` slice. If your GPU environment has more VRAM, you can override to larger models by modifying the NIM model references in `values-openshift.yaml` under the `nims` section.

For GPU-constrained environments, consider:
- Using MIG to partition GPUs efficiently (see [MIG configuration](#configuring-mig-on-h100-sxm5))
- Deploying only the base profile without optional capabilities (alerts, search, LVS)

---

## GPU Toleration Configuration

If your GPU nodes use custom taints, update the toleration in `values-openshift.yaml`:

```yaml
openshift:
  gpuTolerations: &gpu-tolerations
    - key: "nvidia.com/gpu"
      operator: "Exists"
      effect: "NoSchedule"
```

The YAML anchor `&gpu-tolerations` is referenced throughout the values file wherever GPU pods need scheduling. Change it once and all GPU workloads pick it up.

To verify your node taints match:

```bash
oc get nodes -l nvidia.com/gpu.present=true -o name | \
  xargs -I{} oc describe {} | grep -A1 Taints
```

---

## Values Overlay Layering

Each profile has its own `values-openshift.yaml` with profile-specific component keys (RTVI variants, summarization, alerts). The OpenShift deployment uses Helm's `-f` flag layering to compose values:

```bash
# Base deployment
helm install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  --set-string ngc.apiKey="$NGC_CLI_API_KEY" \
  --set global.externalHost=vss.${APPS_DOMAIN}

# With KServe enabled (disable NIM Operator, enable KServe)
helm install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  --set-string ngc.apiKey="$NGC_CLI_API_KEY" \
  --set global.externalHost=vss.${APPS_DOMAIN} \
  --set openshift.ai.useKserve=true --set nims.enabled=false

# Alerts profile
helm install vss-alerts deploy/helm/developer-profiles/dev-profile-alerts/ \
  -f deploy/helm/developer-profiles/dev-profile-alerts/values-openshift.yaml \
  --set-string ngc.apiKey="$NGC_CLI_API_KEY" \
  --set global.externalHost=vss-alerts.${APPS_DOMAIN}

# With custom overrides
helm install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  -f my-custom-overrides.yaml
```

Later `-f` files override earlier ones. `--set` flags override everything. This composability means you can maintain environment-specific overlays (dev, staging, prod) without forking the base values.
