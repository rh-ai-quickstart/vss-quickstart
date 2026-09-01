# Customizations vs Upstream

This document tracks the modifications made on top of the [upstream NVIDIA VSS Blueprint](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) **v3.2.1** to support deployment on Red Hat OpenShift AI.

Deployed charts in `deploy/helm/` are at **v3.2.1** image tags.

---

## Source model

This repo draws from two upstreams, on purpose:

- **NVIDIA VSS** — the `upstream/vss/` submodule, pinned to a release tag (currently **v3.2.1**). Source of engine/app code; our source-level changes are kept as patches in [`patches/`](../../patches/) and applied at build time.
- **Red Hat VSS fork** ([`rh-ai-quickstart/nvidia-video-search-and-summarization`](https://github.com/rh-ai-quickstart/nvidia-video-search-and-summarization)) — tracked via the `upstream` git remote, to align with their OpenShift/RHOAI deployment work.

The submodule is shared automatically via `.gitmodules` (`git submodule update --init`). Git remotes are of course not cloned, so you can add the Red Hat remote after cloning to reference the OpenShift compatibility work:

```bash
git remote add upstream https://github.com/rh-ai-quickstart/nvidia-video-search-and-summarization.git
git fetch upstream
```

---

## Customizations

### MLflow Observability

LLM + agent tracing into RHOAI MLflow. The whole pipeline (VLM captioning,
summarization, orchestration) runs inside the **vss-agent** pod as NeMo Agent
Toolkit (`nvidia-nat`) functions — the video-summarization engine is not a
deployed service — so the agent is the single trace source that captures
everything. It emits OTLP spans directly to MLflow's `/v1/traces` endpoint with
the RHOAI auth headers (no OTel collector in the path). See
[`patches/vss-agent/README.md`](../../patches/vss-agent/README.md) and
[observability-guide.md](observability-guide.md).

| Piece | Location | Status |
|-------|----------|--------|
| Header-capable NAT exporter | `patches/vss-agent/observability/*.py` | Done — registers an `otelcollector_redaction` tracing type; nat's built-in `otelcollector` has no `headers` field, so it can't send the `x-mlflow-*` / `Authorization` headers RHOAI MLflow needs. `COPY`'d into the agent image at build. |
| Entry-point patch | `patches/vss-agent/0001-*.patch` | Done — adds one `nat.components` entry point to the agent's `pyproject.toml` (NVIDIA file). |
| MLflow tracer config | `developer-profiles/dev-profile-base/configs/vss-agent/config.yml` | Done — `mlflow` tracer under `general.telemetry.tracing`, gated by `global.openshift.enabled` (config map uses `tpl`). |
| Agent env + token wiring | `developer-profiles/dev-profile-base/values-openshift.yaml`, `templates/mlflow-token-secret.yaml` | Done — `MLFLOW_*` vars via `agent.vss-agent.extraEnv`; long-lived SA token from `vss-mlflow-token` Secret (pasted into `MLFLOW_TOKEN`). |
| MLflow tracking server | `deploy/helm/observability/helm/mlflow/` | Done — RHOAI MLflow operator CR. |

### OpenShift platform support

Deployment patterns aligned with the Red Hat fork:

| Piece | Location |
|-------|----------|
| Path-based Routes | `developer-profiles/dev-profile-base/templates/openshift-routes.yaml` |
| VIOS anyuid SCC | `services/vios/templates/openshift-scc-anyuid.yaml` |
| Trusted-CA / service-CA mounting | `developer-profiles/dev-profile-base/templates/openshift-{trusted-ca,service-ca}.yaml` |
| Pod affinity, security-context nulling, per-profile overlays | `developer-profiles/dev-profile-base/values-openshift.yaml` |
| Gate key | `global.openshift.enabled` |

### KServe model serving (our addition)

On-cluster model serving via KServe instead of the NIM Operator:

| Piece | Location | Status |
|-------|----------|--------|
| KServe `LLMInferenceService` | `developer-profiles/dev-profile-base/templates/openshift-ai.yaml` | Done — data-driven via `openshift.ai.kserveModels`; weights pulled by the storage-initializer from `hf://` (no download Job/PVC). |
| Model config (nemotron + cosmos3) | `developer-profiles/dev-profile-base/values-openshift.yaml` under `openshift.ai` | Done |
| MIG GPU resource requests | `developer-profiles/dev-profile-base/values-openshift.yaml` | **TODO** — MIG profiles for the new models. |

### Red Hat branding

**TODO — not yet ported.** The v3.2.1 frontend is the Next.js app in `services/ui/` (the v2.x Gradio client no longer exists upstream), so branding must be redone against that UI. The Red Hat fork's [`patches/aiq/0002`–`0003`](https://github.com/rh-ai-quickstart) runtime-branding-via-ConfigMap pattern is a good model.

### Documentation

| Doc | Location |
|-----|----------|
| Deployment guide | [`docs/advanced-docs/deployment-guide.md`](deployment-guide.md) |
| Observability stack | [`docs/advanced-docs/observability-guide.md`](observability-guide.md) |
| Agent patches / build | [`patches/vss-agent/README.md`](../../patches/vss-agent/README.md) |
| Fork tracking | this file |

---

## Upstream components (v3.2.1 reference)

The v3.2.1 blueprint is a multi-service monorepo. Components most relevant to this quickstart:

| Component | Chart / path | Notes |
|-----------|--------------|-------|
| Video Summarization (engine) | `services/video-summarization/` | Not deployed here — summarization runs in the agent pod as NAT functions. |
| VSS Agent + MCP | `services/agent/` | `nvidia-nat` toolkit; our MLflow tracing patch targets this. |
| VIOS microservices | `services/vios/` | anyuid SCC applied here. |
| RTVI (CV, VLM, Embed) | `services/rtvi/` | Real-time video intelligence. |
| Analytics / Alert Bridge | `services/analytics/`, `services/alert/` | Behavior analytics, VLM alert verification. |
| Agent UI (Next.js) | `services/ui/` | Branding target (TODO). |
| Infra (Redis, Kafka, Kibana, Logstash, SDRC, Phoenix) | `services/infra/charts/` | Backing services + Arize Phoenix observability. |
| NIM Operator CRDs | (upstream `services/nims/`) | Not used here — on-cluster serving uses KServe. |
