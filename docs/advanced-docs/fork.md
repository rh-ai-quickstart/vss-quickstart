# Customizations vs Upstream

This document tracks all modifications made on top of the [upstream NVIDIA VSS Blueprint](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) to support deployment on Red Hat OpenShift AI.

Deployed charts in `deploy/helm/` are at **v3.2.1** image tags.

---

## Source model

This repo draws from two upstreams, on purpose:

- **NVIDIA VSS** — the `upstream/vss/` submodule, pinned to a release tag (currently **v3.2.1**). Source of engine/app code; our source-level changes are kept as patches in [`patches/vss-engine/`](../../patches/vss-engine/) and applied at build time.
- **Red Hat VSS fork** ([`rh-ai-quickstart/nvidia-video-search-and-summarization`](https://github.com/rh-ai-quickstart/nvidia-video-search-and-summarization)) — tracked via the `upstream` git remote, to align with their OpenShift/RHOAI deployment work.

The submodule is shared automatically via `.gitmodules` (`git submodule update --init`). Git remotes are of course not cloned, so you can add the Red Hat remote after cloning to reference the OpenShift compatibility work:

```bash
git remote add upstream https://github.com/rh-ai-quickstart/nvidia-video-search-and-summarization.git
git fetch upstream
```

---

## Custom Work by Area

All customizations were built on top of the upstream v2.4.1 chart across two phases: an initial OpenShift integration (PR #1–#6 in the `RHEcosystemAppEng` fork), then an extended integration adding MLflow, MIG model serving, and branding (PRs #1–#2 in `rh-ai-quickstart`).

### Phase 1 — Initial OpenShift Integration

Built the foundation for OpenShift deployment on top of the upstream v2.4.1 chart:

| File | Description |
|------|-------------|
| `deploy/helm/values-openshift.yaml` | Initial OpenShift values overlay (162 lines) — NGC secrets via `nvcf` mechanism, `openshift.enabled` flag, SA/SCC/Route config, GPU tolerations |
| `deploy/helm/openshift-deployment.md` | Initial deployment runbook (572 lines) — prerequisites, deployment steps, OpenShift-specific challenges |
| Chart `.tgz` modifications | Added `templates/openshift.yaml` (SA, SCC RoleBinding, Route, service secrets) and `templates/openshift-ai.yaml` (KServe model serving) inside the packaged chart |
| Docker Compose configs | Added `otel-collector-config.yaml` and `prometheus.yml` to all 4 compose variants |

### Phase 2 — MLflow, KServe/MIG, Branding, Documentation

Extended the OpenShift integration with observability, production-grade model serving, and Red Hat branding:

#### MLflow Observability Layer
| File | Description |
|------|-------------|
| `src/vss-engine/src/mlflow_helper.py` | 356 lines — MLflow integration library. Provides `init_mlflow()`, `start_request_run()`, `end_request_run()`. Patches MLflow HTTP client to inject `X-MLFLOW-WORKSPACE` header for RHOAI. Uses SA token for auth. Links autolog traces to runs via REST API |
| `deploy/helm/scripts/apply_mlflow_patches.py` | 140 lines — Idempotent startup patcher. Applies 4 patches to `via_stream_handler.py` at pod start: import, init call, start-run before summarization, end-run after success |
| `deploy/helm/mlflow.yaml` | RHOAI MLflow CR (`mlflow.opendatahub.io/v1`) in `redhat-ods-applications` namespace — operator-managed deployment |
| `deploy/helm/mlflow-standalone.yaml` | 136 lines — Standalone MLflow (Deployment + Service + Route) in `vss` namespace. PVC-backed SQLite + artifact store. No auth overhead |

#### KServe Model Serving with MIG GPU Scheduling
| File | Description |
|------|-------------|
| `deploy/helm/is-sr.yaml` | 378 lines — Legacy KServe InferenceService + ServingRuntime definitions for 4 models (llama-rerank, embedqa, cosmos, llama3-8b) with MIG-specific GPU resources. Superseded by LLMInferenceService in v3.2.1 templates |
| `deploy/helm/job-pvc.yaml` | 242 lines — Model download Jobs (HuggingFace `snapshot_download` and modelcar copy) + PVCs for each model |
| `generate_template.sh` | Concatenates `is-sr.yaml` + `job-pvc.yaml` into a Helm template wrapped in `{{- if .Values.openshift.ai.enabled }}` |
| `deploy/helm/values-openshift.yaml` | Expanded from 162→216 lines: added MIG resource requests, KServe predictor endpoints, CA-RAG config pointing to KServe services, init containers for dependency checks, MLflow env vars, volume mounts for patches and branding |
| Chart `.tgz` modifications | Updated `templates/openshift-ai.yaml` with the full KServe + model-download content |

#### Red Hat UI Branding
| File | Description |
|------|-------------|
| `src/vss-engine/src/client/assets/kaizen-theme.css` | 43 lines — CSS overrides (primary color #EE0000, Red Hat brand colors) |
| `src/vss-engine/src/client/assets/kaizen-theme.json` | Expanded Gradio theme tokens for Red Hat look and feel |
| `src/vss-engine/src/client/assets/app_bar.html` | Redesigned header bar with Red Hat branding |
| `src/vss-engine/src/client/assets/rh-logo.png` | Red Hat logo |
| `src/vss-engine/src/client/assets/rh-hat.png` | Red Hat hat icon |
| `src/vss-engine/src/client/assets/rh-logo-avatar.svg` | Red Hat logo avatar (SVG) |
| `src/vss-engine/src/client/summarization.py` | Minor edits for branding integration |
| `src/vss-engine/src/via_demo_client.py` | Points Gradio UI to Red Hat theme assets |

#### Documentation
| File | Description |
|------|-------------|
| `README.md` | Substantially rewritten (348-line diff) — quickstart for OpenShift, MLflow setup, CVE notes |
| `deploy/helm/openshift-deployment.md` | Expanded by 211 lines — MIG setup commands, MLflow architecture and server-side bug workarounds, 10 documented OpenShift-specific challenges and solutions |
| `combined.yaml` | 614 lines — `kubectl apply` alternative with all KServe + Job + PVC manifests (older naming, non-MIG) |
| Architecture diagram | Updated `deploy/images/` |

---

## Mapping: v2.4.1 Custom Work → v3.2.1 Structure

The upstream chart was completely restructured between v2.4.1 and v3.2.1. This table tracks where each piece of custom work lives (or needs to be ported) in the new structure.

### OpenShift Platform Support
| Custom Work | Source | v3.2.1 Location | Status |
|-------------|--------|-----------------|--------|
| Path-based Routes (7 core + profile-specific) | rh-ai-quickstart fork | `developer-profiles/*/templates/openshift-routes.yaml` | Adopted from fork |
| NIM custom SCC (SELinux relabel avoidance) | rh-ai-quickstart fork | (removed with NIM Operator path) | Removed from quickstart |
| VIOS anyuid SCC (3 ServiceAccounts) | rh-ai-quickstart fork | `services/vios/templates/openshift-scc-anyuid.yaml` | Adopted from fork |
| Pod affinity (sensor↔streamprocessing) | rh-ai-quickstart fork | Per-profile `values-openshift.yaml` | Adopted from fork |
| Security context nulling (restricted-v2) | rh-ai-quickstart fork | Per-profile `values-openshift.yaml` | Adopted from fork |
| Per-profile values overlays | rh-ai-quickstart fork + ours | `developer-profiles/*/values-openshift.yaml` | Fork base + KServe/NGC additions |
| Gate key: `global.openshift.enabled` | rh-ai-quickstart fork | All OpenShift templates | Aligned with fork |

### KServe Model Serving (our addition, not in fork)
| Custom Work | v3.2.1 Location | Status |
|-------------|-----------------|--------|
| KServe LLMInferenceService (serving.kserve.io/v1alpha1) | `developer-profiles/*/templates/openshift-ai.yaml` | Data-driven via `openshift.ai.kserveModels`; weights pulled by storage-initializer from `hf://` (no download Job/PVC) |
| KServe model config | Per-profile `values-openshift.yaml` under `openshift.ai` | Complete — nemotron + cosmos3 |
| MIG GPU resource requests | Per-profile `values-openshift.yaml` | TODO — needs MIG profiles for new models |

### MLflow Observability
| Custom Work | v2.4.1 Location | v3.2.1 Location | Status |
|-------------|-----------------|-----------------|--------|
| MLflow helper library | `src/vss-engine/src/mlflow_helper.py` | `src/vss-engine/src/mlflow_helper.py` (kept as-is) | Deferred — will move to patches/ later |
| MLflow startup patcher | `deploy/helm/scripts/apply_mlflow_patches.py` | `deploy/helm/scripts/apply_mlflow_patches.py` (kept) | Deferred — needs update for v3.2.1 agent |
| RHOAI MLflow CR | `deploy/helm/mlflow.yaml` | Noted in docs as alternative | Superseded by observability chart |
| Standalone MLflow | `deploy/helm/mlflow-standalone.yaml` | `deploy/helm/observability/helm/mlflow/` | TODO — convert to Helm chart |

### Red Hat Branding
| Custom Work | v2.4.1 Location | v3.2.1 Location | Status |
|-------------|-----------------|-----------------|--------|
| Theme CSS/JSON, logos, app bar | `src/vss-engine/src/client/assets/` | `src/vss-engine/src/client/assets/` (kept as-is) | Deferred — will move to patches/ later |
| Branding ConfigMap mount | `values-openshift.yaml` `vss.applicationSpecs` | TODO | Needs new injection mechanism for v3.2.1 agent |

### Documentation
| Custom Work | v2.4.1 Location | v3.2.1 Location | Status |
|-------------|-----------------|-----------------|--------|
| Deployment runbook | `deploy/helm/openshift-deployment.md` | `docs/advanced-docs/deployment-guide.md` | TODO — move and update |
| Fork tracking | Not present | `docs/advanced-docs/fork.md` | This file |

---

## Upstream Components Removed in v3.2.1

These v2.4.1 sub-charts no longer exist upstream and their custom integrations are obsolete:

| Removed Sub-Chart | Custom Work That Referenced It |
|-------------------|-------------------------------|
| `arango-db` | SA assignment, credential secret |
| `neo4j` | SA assignment, credential secret, init container health check |
| `milvus` / `milvus-minio` | emptyDir volume workaround, init container health check |
| `minio` | Credential secret |
| `nemo-embedding` / `nemo-rerank` | KServe InferenceService, CA-RAG config endpoints |
| `riva` | Not customized |
| `etcd` | Not customized |

## New Upstream Components in v3.2.1

These are new and have no custom work yet:

| New Component | Chart Location | Notes |
|---------------|---------------|-------|
| Redis | `services/infra/charts/redis` | Replaces part of Milvus pipeline |
| Kafka (KRaft) | `services/infra/charts/kafka` | New message broker |
| Kibana | `services/infra/charts/kibana` | Dashboard |
| Logstash | `services/infra/charts/logstash` | Log pipeline |
| SDRC + Envoy | `services/infra/charts/sdrc` | Stream router |
| Phoenix | `services/infra/charts/phoenix` | Arize Phoenix observability |
| VIOS microservices | `services/vios/` | Replaces monolithic VSS pod |
| RTVI (CV, VLM, Embed) | `services/rtvi/` | Real-time video intelligence |
| VSS Agent + MCP | `services/agent/` | Replaces old VSS agent |
| Analytics | `services/analytics/` | Behavior analytics + API |
| Alert Bridge | `services/alert/` | VLM-based alert verification |
| Video Summarization | `services/video-summarization/` | Long video summarization |
| NIM Operator CRDs | (upstream `services/nims/`) | Removed from this AI quickstart repository; on-cluster serving uses KServe |
| Agent UI (Next.js) | `services/ui/` | Replaces Gradio frontend |
