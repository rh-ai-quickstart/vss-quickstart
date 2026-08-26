# Deployment Guide — Advanced Configuration

This guide covers advanced deployment topics not included in the main [README](../../README.md). For standard installation, follow the README's Deploy section.

## Table of Contents

- [Chart Architecture](#chart-architecture)
- [Configuring MIG on H100 SXM5](#configuring-mig-on-h100-sxm5)
- [KServe Model Serving](#kserve-model-serving)
- [Model Size Optimization](#model-size-optimization)
- [GPU Toleration Configuration](#gpu-toleration-configuration)
- [Values Overlay Layering](#values-overlay-layering)
- [Chart Values Reference](#chart-values-reference)

---

## Chart Architecture

VSS v3.2.1 uses a three-tier chart structure inherited from upstream:

```
developer-profiles/              # Install entry points (pick one)
├── dev-profile-base/            # Core pipeline (VLM + LLM)
├── dev-profile-alerts/          # + alert capabilities
├── dev-profile-search/          # + search capabilities
└── dev-profile-lvs/             # + live video streaming

services/                        # Service umbrella charts (dependencies of profiles)
├── agent/                       # Agent + MCP orchestration
├── alert/                       # Alert engine
├── analytics/                   # Analytics service
├── calibration-toolkit/         # Camera calibration
├── infra/                       # Redis, Kafka, Elasticsearch, Phoenix
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

## KServe Model Serving

On-cluster model serving uses KServe, enabled with the `openshift.ai.useKserve=true` feature flag in the profile's `values-openshift.yaml`. For serving without local GPUs, use NGC cloud inference instead (see the [README](../../README.md)).

Uses KServe `LLMInferenceService` resources (`serving.kserve.io/v1alpha1`) managed by Red Hat OpenShift AI. The `openshift-ai.yaml` template renders **one `LLMInferenceService` per enabled model**. Model weights are pulled by KServe's storage-initializer directly from `spec.model.uri` (`hf://<repoId>` by default) into `/mnt/models` — there is no separate download Job or PVC to manage.

Models are configured in the `openshift.ai.kserveModels` map in the profile's `values-openshift.yaml` — one entry per model, each providing `repoId` (or an explicit `modelUri`), a required `runtimeImage`, `vllmArgs`, and `resources`.

The template is data-driven — adding or removing a model only requires editing this map. No template changes needed. The container is named `main` and is started with `--model /mnt/models`, followed by the entries in `vllmArgs`.

**Model source (`hf://`).** `repoId` becomes `spec.model.uri: hf://<repoId>`, so it must be a valid HuggingFace repo. To serve from somewhere else, set `modelUri` explicitly (`pvc://`, `s3://`, `oci://`, …). `spec.model.name` defaults to `repoId` and is the id clients pass on the OpenAI-compatible API; override with `servedName`.

**Default models and runtime images.** The two default entries in `kserveModels` are keyed to match the `vss-agent`'s in-cluster endpoints, so with `global.llmBaseUrl` / `global.vlmBaseUrl` left blank the agent reaches them with no extra wiring:

| Key / service | Model (`repoId`) | Served as | Runtime image |
|---------------|------------------|-----------|---------------|
| `nvidia-nemotron-nano-9b-v2` (LLM) | `nvidia/NVIDIA-Nemotron-Nano-9B-v2` | `nvidia/nvidia-nemotron-nano-9b-v2` | `registry.redhat.io/rhaii/vllm-cuda-rhel9` |
| `nvidia-cosmos3-reasoner` (VLM) | `nvidia/Cosmos3-Nano` | `nvidia/cosmos3-nano-reasoner` | `vllm/vllm-omni:cosmos3` |

Both repos are public/ungated (no HF token required). The vLLM server listens on `:8000` and each `--served-model-name` matches the agent's default `llmName` / `vlmName`. If your KServe build publishes the model `Service` under a different DNS name or port, point `global.llmBaseUrl` / `global.vlmBaseUrl` at the real endpoint.

> **Cosmos3 VLM runtime.** Cosmos3-Nano (16B, omnimodal) does **not** run on the stock Red Hat vLLM image. It requires NVIDIA's cosmos3 vLLM build — the `vllm/vllm-omni:cosmos3` image ships the `vllm-cosmos3` plugin. VSS captions frames over `/v1/chat/completions`, so the model is served on the standard entrypoint (no `--omni`) with an architecture override matching what the image registers — `--hf-overrides '{"architectures":["Cosmos3ForConditionalGeneration"]}'` for the `vllm/vllm-omni:cosmos3` (vLLM 0.25.0) image. **BF16 only** — FP4/FP8/FP16 are not supported. Tested on Hopper/Blackwell-class GPUs (~32GB+ VRAM at BF16).

**Gated models / HuggingFace token.** Gated repos require a token. The chart wires an `HF_TOKEN` env var (from `hfTokenSecret` / `hfTokenKey`, default secret `hf-token-secret` / key `HF_TOKEN`, `optional: true`) into the serving container. Create the secret in the release namespace before install:

```bash
oc create secret generic hf-token-secret \
  --from-literal=HF_TOKEN='<your HF token>' -n vss
```

> **Note:** the weights are fetched by KServe's storage-initializer init container, so for a gated repo confirm the token is also visible to that init container on your cluster (typically via the `ClusterStorageContainer` for the `hf://` prefix, or a namespace secret it references). Because the model is pulled at pod startup rather than cached in a PVC, a pod restart re-downloads the weights; to persist them, publish the model to a PVC and point `modelUri` at `pvc://…`.

**When to use:** Your cluster uses RHOAI for model serving and you want LLMInferenceServices managed alongside other RHOAI workloads.

---

## Model Size Optimization

The default configuration uses Nemotron-Nano-9B-v2 (~25GB VRAM) which fits in a single MIG `3g.47gb` slice. If your GPU environment has more VRAM, you can override to larger models by editing the `openshift.ai.kserveModels` map in `values-openshift.yaml` (model `repoId`, `runtimeImage`, `vllmArgs`, and `resources`).

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

# With on-cluster KServe model serving enabled
helm install vss deploy/helm/developer-profiles/dev-profile-base/ \
  -f deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml \
  --set-string ngc.apiKey="$NGC_CLI_API_KEY" \
  --set global.externalHost=vss.${APPS_DOMAIN} \
  --set openshift.ai.useKserve=true

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

---

## Chart Values Reference

Helm merges your overlay (`values-openshift.yaml`, plus `values-ngc.yaml` for cloud inference, or `values-base.yaml` for a single-file install) on top of the chart's shipped `values.yaml` defaults. You normally do not edit `values.yaml`; add only the keys you need to your overlay. The tables below document the keys you are most likely to set or override.

Model serving itself is configured separately from these keys — NGC cloud via `values-ngc.yaml`, or on-cluster serving via `openshift.ai.kserveModels` (see [KServe Model Serving](#kserve-model-serving)).

### Required values

Set these for a typical external install:

| Key | Description |
|-----|-------------|
| `ngc.apiKey` | Your NGC API key. Used for image pulls and, with NGC cloud inference, model API auth. The chart creates the pull/API secrets from it when `ngc.createSecrets: true` (default). |
| `global.storageClass` | StorageClass name in your cluster (e.g. `oci-bv-high`, `gp3`, `standard`). |
| `global.externalScheme` | `http` or `https` (defaults to `http` in templates if unset). |
| `global.externalHost` | Hostname or IP the browser uses (e.g. `vss.YOUR_IP.nip.io`). Required for a typical external install when subchart URL fields are omitted. |
| `global.externalPort` | Port segment in generated URLs; use `""` so URLs omit `:port` when using default 80/443. Set only for non-default ports (e.g. `8080`). |
| `llmNameSlug` | Slug for the in-cluster LLM service (default `nvidia-nemotron-nano-9b-v2`). Keep `agent.vss-agent.llmName` aligned with the same model id. |
| `vlmNameSlug` | Slug for the in-cluster VLM service (default `nvidia-cosmos3-reasoner`). Keep `agent.vss-agent.vlmName` aligned with the same model id. |
| `global.llmBaseUrl` / `global.vlmBaseUrl` (remote/cloud) | HTTP(S) base URLs for LLM and VLM when models are **not** served on-cluster (NGC cloud or another OpenAI-compatible endpoint reachable from `vss-agent` pods). Leave `""` when serving on-cluster via KServe; `values-ngc.yaml` sets these for you. |
| `global.llmName` / `global.vlmName` (remote/cloud) | Model identifiers (e.g. `nvidia/nvidia-nemotron-nano-9b-v2`, `nvidia/cosmos3-nano-reasoner`) the agent should use; must match what the endpoints expose. |
| `vssIngress` (optional) | Set `vssIngress.enabled: true` to create a Kubernetes `Ingress` for UI, agent, VST, and (when Phoenix is enabled) Phoenix under one hostname. Requires an `IngressClass` that already exists on the cluster. `global.externalHost` must be set unless you set `vssIngress.host`. |

### Optional overrides

Use these when you want to change behavior beyond the required keys. Defaults described here match the chart's `values.yaml`.

| Key / group | Default | Description |
|-------------|---------|-------------|
| `mode` | `""` | `""` for the dev-profile-base chart. |
| `llmNameSlug` | `""` | In-cluster LLM service slug (default `nvidia-nemotron-nano-9b-v2`). Set if you change models. |
| `vlmNameSlug` | `""` | In-cluster VLM service slug (default `nvidia-cosmos3-reasoner`). Set if you change models. |
| `ngc.createSecrets` | `true` | When `true` and `ngc.apiKey` is set, the chart creates two secrets (`templates/ngc-secrets.yaml`): `ngc-api` (Opaque: `NGC_API_KEY` / `NGC_CLI_API_KEY`) for NGC API access, and `ngc-secret` (dockerconfigjson) for pulling images from nvcr.io. Set `false` only if you create both secrets yourself; then set `global.ngcApiSecret` and `global.imagePullSecrets` to match your names. |
| `ngc.apiKey` | `""` | With `ngc.createSecrets: true`, set your NGC API key here; it backs both created secrets. With `createSecrets: false`, install the Opaque + docker secrets out of band and align `global.*` below with those objects. Optional: `ngc.apiKeySecretName` / `ngc.dockerSecretName` rename the generated secrets — update `global.ngcApiSecret.name` and `global.imagePullSecrets` accordingly. |
| `global.imagePullSecrets` | `[{ name: ngc-secret }]` | Pod image-pull credentials for nvcr.io. Must reference the Docker registry secret (default `ngc-secret`). Separate from the NGC API key secret. |
| `global.ngcApiSecret` | `name: ngc-api`, `key: NGC_API_KEY` | Tells model-serving and download workloads which Opaque secret holds the NGC API key: `name` defaults to `ngc-api`, `key` defaults to `NGC_API_KEY`. Change these if you use a different secret name or data key. |
| `global.externalScheme` | `""` in defaults | Set in your overlay (`http` or `https`). With `externalHost` / `externalPort`, builds browser-facing URLs for `vss-agent-ui`, `vss-agent`, and `vss-vios-ingress` when their own URL fields are empty. |
| `global.externalHost` | `""` in defaults | Hostname or IP clients use in the browser (e.g. `vss.YOUR_IP.nip.io`). |
| `global.externalPort` | `""` in defaults | Port segment in generated URLs; use `""` so URLs omit `:port` when using default 80/443. Set only for non-default ports (e.g. `8080`). |
| `global.storageClass` | unset in default `values.yaml` | Set in your overlay; used to create PVCs. |
| `global.llmBaseUrl` | `""` | Remote/cloud LLM API base URL for `vss-agent` when models are not served on-cluster. Must be reachable from pods in the release namespace (cluster DNS, NodePort, LB, or routable IP). |
| `global.vlmBaseUrl` | `""` | Remote/cloud VLM API base URL; same constraints as `global.llmBaseUrl`. |
| `global.llmName` | e.g. `nvidia/nvidia-nemotron-nano-9b-v2` | Catalog-style model id passed to the agent; must match the model served at `global.llmBaseUrl`. |
| `global.vlmName` | e.g. `nvidia/cosmos3-nano-reasoner` | Catalog-style model id passed to the agent; must match the model served at `global.vlmBaseUrl`. |
| `vios.vstStorage.createSharedPvcs` | `true` | `true`: the `vios` umbrella creates PersistentVolumeClaims so sensor and streamprocessing share on-disk folders for VST data and video; data survives pod restarts but a working `StorageClass` is required (`global.storageClass`). `false`: no shared PVCs — pods use emptyDir or per-subchart PVCs; uploaded video and VST cache are lost on reschedule if nothing else persists them. |
| `vios.vstStorage.accessMode` | `ReadWriteOnce` | Access mode for the three shared VST PVCs (`helm/services/vios/templates/vst-storage-pvc.yaml`). |
| `vios.vstStorage.vstData` | `size: 10Gi`, `storageClass: ""` | Claim size for the shared VST data volume. Leave `storageClass` empty to inherit `global.storageClass`; set it only if this volume needs a different class. |
| `vios.vstStorage.vstVideo` | `size: 20Gi`, `storageClass: ""` | Claim size for the shared VST video volume; same `storageClass` rules as `vstData`. |
| `vios.vstStorage.streamerVideos` | `size: 20Gi`, `storageClass: ""` | Claim size for the shared streamer upload video volume; same `storageClass` rules as `vstData`. |
| `infra.enabled` | `true` | Master switch for the `infra` umbrella (Phoenix, Redis, …). |
| `infra.phoenix.enabled` | `true` | Set `false` to disable Phoenix only. |
| `infra.redis.enabled` | `true` | Set `false` to disable Redis only. |
| `vios.enabled` | `true` | Master switch for the `vios` umbrella (all bundled `vss-vios-*` subcharts). Set `false` to omit the entire VST microservice stack. |
| `vios.vss-vios-postgres.enabled` | `true` | Set `false` to disable the centralized DB. Storage sizing/class via the subchart `values.yaml` or overrides under `vios.vss-vios-postgres`. |
| `vios.vss-vios-sensor.streamProcessorEndpoint` | `http://<release>-vss-vios-streamprocessing:30001` | Sensor registers streams against streamprocessing directly (not `:10000`). |
| `vios.vss-vios-sensor.enabled` | `true` | `false` to disable `vss-vios-sensor`. |
| `vios.vss-vios-sensor.persistence` | `vstData` and `vstVideo`: mount on, `create: false`, `existingClaim` empty | Controls whether sensor mounts the two shared folders (data and video). Leave `existingClaim` blank to use the PVCs created when `vios.vstStorage.createSharedPvcs` is `true`; set `existingClaim` for custom PVCs, or set a volume's `enabled: false` to skip that mount. |
| `vios.vss-vios-streamprocessing.enabled` | `true` | `false` to disable `vss-vios-streamprocessing`. |
| `vios.vss-vios-streamprocessing.persistence` | `vstData`, `vstVideo`, `streamerVideos`: same idea as sensor | Streamprocessing mounts up to three shared folders: VST data, VST video, and streamer uploads. Use blank `existingClaim` for the shared PVCs, or set `existingClaim` / `enabled` per volume as for sensor. |
| `vios.vss-vios-ingress.enabled` | `true` | Deploys the in-cluster VST ingress (nginx). |
| `vios.vss-vios-ingress.externallyAccessibleIp` | `""` | Hostname or IP advertised to VST/nginx for external access. If unset, uses `global.externalHost`; if that is unset, defaults to `127.0.0.1`. Override only when the VST ingress must use a host/IP that differs from `global.externalHost`. |
| `vssIngress.enabled` | `false` in chart `values.yaml`; `true` in sample overlays | When `true`, renders `templates/vss-ingress.yaml`: one `Ingress` routing `/` and `/api/chat` to `vss-agent-ui`; `/api`, `/chat`, `/websocket`, `/static` to `vss-agent`; `/vst` to `vss-vios-ingress`; and (if Phoenix is enabled) `phoenix.<host>/` to Phoenix. No effect if both `global.externalHost` and `vssIngress.host` are empty. |
| `vssIngress.ingressClassName` | `haproxy` | `spec.ingressClassName` on the `Ingress`. Must match an `IngressClass` that already exists. Use another name (e.g. `nginx`) if your controller uses a different class. |
| `vssIngress.host` | `""` | Ingress hostname rule. If empty, `global.externalHost` is used. Set only when the Ingress hostname must differ. |
| `vssIngress.vssUiPort` | `3000` | Backend `Service` port for `vss-agent-ui` paths. |
| `vssIngress.vssAgentPort` | `8000` | Backend `Service` port for `vss-agent` paths. |
| `vssIngress.vstIngressPort` | `30888` | Backend `Service` port for `vss-vios-ingress` (`/vst`). |
| `vssIngress.phoenixHost` | `""` | Second-rule host for Phoenix. If empty, defaults to `phoenix.<global.externalHost or vssIngress.host>`. |
| `vssIngress.phoenixPort` | `6006` | Backend `Service` port for Phoenix when the Phoenix subchart is enabled. |
| `agent.enabled` | `true` | Set `false` to skip the `agent` umbrella (`deploy/helm/services/agent`). |
| `agent.vss-agent.enabled` | `true` | Set `false` to disable the `vss-agent` deployment only. |
| `agent.vss-agent.mountConfigEdge` / `mountEvalOutput` | `true` / `true` | Parent ConfigMap includes `config_edge.yml` when present; `/vss-agent/eval-output` emptyDir when `mountEvalOutput` is `true`. Agent YAML lives at `configs/vss-agent/config.yml`. |
| `agent.vss-agent.llmName` | NGC model id (e.g. `nvidia/nvidia-nemotron-nano-9b-v2`) | NGC catalog id for the LLM; must match the served model. |
| `agent.vss-agent.vlmName` | NGC model id (e.g. `nvidia/cosmos3-nano-reasoner`) | NGC catalog id for the VLM; must match the served model. |
| `agent.vss-agent.evalLlmJudgeName` | `""` | Optional eval judge model id. When empty, the subchart defaults to `llmName`. |
| `agent.vss-agent.evalLlmJudgeBaseUrl` | `""` | Optional base URL for the eval judge endpoint. When empty, defaults alongside `llmBaseUrl`. |
| `agent.vss-agent.reportsBaseUrl` | `""` | Base URL for report links. When empty, derived from `global.external*` and in-cluster defaults. |
| `agent.vss-agent.vstExternalUrl` | `""` | External VST URL passed to the agent. When empty, derived from `global.external*` and in-cluster defaults. |
| `agent.vss-agent.externalIp` | `""` | Hostname or IP override for agent-facing external access when `global.external*` is not sufficient. |
| `agent.vss-agent.env` | *(see `values.yaml`)* | Full container env list for `vss-agent`. Each `value` is passed through Helm `tpl`, so URLs can reference `.Values`, `.Release`, and `global` keys. Use `agent.vss-agent.extraEnv` for late overrides (secrets / ad-hoc vars). |
| `agent.vss-agent.extraEnv` | *(omit)* | Optional `{ name, value }` list appended last. |
| `vss-agent-ui.enabled` | `true` | Set `false` to disable the `vss-agent-ui` deployment. |
| `vss-agent-ui.agentApiUrlBase` | `""` | Base URL for the `vss-agent` HTTP API (browser `NEXT_PUBLIC_AGENT_API_URL_BASE`, typically ends with `/api/v1`). If unset, built from `global.external*` as `<global>/api/v1`, else defaults to in-cluster `http://<release>-vss-agent:8000/api/v1`. |
| `vss-agent-ui.vstApiUrl` | `""` | VST HTTP API URL for the browser (`NEXT_PUBLIC_VST_API_URL`). If unset, built as `<global>/vst/api`, else `http://<release>-vss-vios-ingress:30888/vst/api`. |
| `vss-agent-ui.chatCompletionUrl` | `""` | HTTP chat completion URL (`NEXT_PUBLIC_HTTP_CHAT_COMPLETION_URL`). If unset, built as `<global>/chat/stream`, else `http://<release>-vss-agent:8000/chat/stream`. |
| `vss-agent-ui.websocketChatUrl` | `""` | WebSocket chat URL (`NEXT_PUBLIC_WEBSOCKET_CHAT_COMPLETION_URL`). If unset and `global.externalHost` is set, built as `<ws-scheme>://<host>[:port]/websocket` (`ws`/`wss` from `global.externalScheme`). Set explicitly for port-forward or custom routing. |
| `vss-agent-ui.appSubtitle` | `""` | Optional; sets `NEXT_PUBLIC_APP_SUBTITLE` when `envOverrides` does not already define it. |
| `vss-agent-ui.enableDashboardTab` | `""` | Optional; sets `NEXT_PUBLIC_ENABLE_DASHBOARD_TAB` when `envOverrides` does not already define it. |
| `vss-agent-ui.envOverrides` | base defaults in `values.yaml` | List of `{ name, value }` merged into the subchart `env` list by variable name. |
| `vss-agent-ui.extraEnv` | `[]` | List of `{ name, value }` appended last in the container `env` block (override or add any `NEXT_PUBLIC_*` without a ConfigMap). |
| `vss-agent-ui.staticEnvConfigMapName` | `""` | Optional `envFrom` ConfigMap name (you supply the ConfigMap). `extraEnvFrom` is also supported on the subchart. |

### Remote / cloud LLM and VLM

When the LLM and VLM run outside the cluster — NGC cloud endpoints or HTTP endpoints elsewhere on your network — leave on-cluster KServe serving disabled and point the agent at those URLs via `global` keys in your overlay (or `--set`). The `values-ngc.yaml` overlay does this for NGC cloud, and the same keys work for any OpenAI-compatible endpoint:

- `global.llmBaseUrl` / `global.vlmBaseUrl`: base URLs reachable from `vss-agent` pods (cluster DNS, NodePort, LB, or routable IP).
- `global.llmName` / `global.vlmName`: model identifiers (e.g. `nvidia/nvidia-nemotron-nano-9b-v2`, `nvidia/cosmos3-nano-reasoner`), aligned with what the endpoint serves.

Per-agent overrides (`agent.vss-agent.llmBaseUrl`, `agent.vss-agent.vlmBaseUrl`, etc.) exist if the agent must differ from `global.*`.
