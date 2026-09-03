# VSS Observability Stack

This guide covers the observability stack for VSS on OpenShift, providing metrics collection, dashboards, and ML experiment tracking.

## Components

| Chart | Type | Purpose |
|-------|------|---------|
| `otel-operator` | OLM Subscription | Installs the OpenTelemetry Operator |
| `grafana-operator` | OLM Subscription | Installs the Grafana Operator |
| `otel-collector` | Resource | OpenTelemetry Collector for OTLP telemetry (traces/metrics pushed to it) |
| `uwm` | Resource | User Workload Monitoring — PodMonitors that scrape model serving metrics |
| `grafana` | Resource | Grafana instance with Prometheus datasource and model metrics dashboards |
| `mlflow` | Resource | MLflow tracking server (RHOAI MLflow operator CR) for pipeline traces |

## Architecture

```
KServe model pods (nemotron, cosmos3)
  └── /metrics endpoint
        └── scraped by → Prometheus (via PodMonitors/UWM)
                           └── queried by → Grafana dashboards

vss-agent pod (NAT: VLM captioning, summarization, orchestration)
  └── OTLP spans
        └── exported directly to → MLflow /v1/traces → MLflow UI
```

- **Metrics path**: model pods expose `/metrics` → PodMonitors tell UWM Prometheus to scrape them → Grafana queries Prometheus via the Thanos Querier
- **Traces path**: the vss-agent emits OTLP spans straight to the MLflow tracking server's `/v1/traces` endpoint (with RHOAI auth headers) → viewable in the MLflow UI. See [Tracing VSS into MLflow](#tracing-vss-into-mlflow).

## Prerequisites

The MLflow chart deploys an `MLflow` CR (`mlflow.opendatahub.io/v1`) that is reconciled by the **OpenShift AI MLflow operator**. That operator ships with Red Hat OpenShift AI — there is no separate subscription in `install-operators.sh`. Before deploying, ensure:

- Red Hat OpenShift AI is installed (tested with v3.3.2+)
- OpenShift AI has a `DataScienceCluster` with the `kserve` and `dashboard` components set to `Managed`

If the `mlflow.opendatahub.io/v1` CRD is not present, install/enable OpenShift AI first. See the [OpenShift AI MLflow documentation](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.4/html/working_with_mlflow/about-mlflow_mlflow).

## Quick Start

### 1. Install operators

```bash
cd deploy/helm/observability
./install-operators.sh
```

This creates the `observability-hub` namespace, installs the OTel and Grafana operator subscriptions via OLM, and waits for the `OpenTelemetryCollector` and `Grafana` CRDs to become available. The MLflow operator is provided by OpenShift AI (see [Prerequisites](#prerequisites)).

### 2. Deploy resources

```bash
./deploy.sh
```

Installs in order:
1. **UWM** — ConfigMaps for `cluster-monitoring-config` and `user-workload-monitoring-config` that enable user workload monitoring, plus PodMonitors for each model
2. **OTel Collector** — `OpenTelemetryCollector` CR in `observability-hub` that receives OTLP telemetry
3. **Grafana** — Grafana instance with Prometheus datasource pointing at the Thanos Querier, plus model metrics dashboards
4. **MLflow** — `MLflow` CR reconciled by the OpenShift AI MLflow operator in `redhat-ods-applications`

### 3. Access dashboards

**Grafana:**

```bash
oc get route -n observability-hub -l app.kubernetes.io/name=grafana
```

**MLflow:** the RHOAI MLflow operator does not create a Route; the UI is exposed
via a console link (and reachable in-cluster at the service below). Get the URL:

```bash
oc get consolelink -o custom-columns=TEXT:.spec.text,HREF:.spec.href | grep -i mlflow
```

## Chart Details

### OTel Collector

Deployed as an `OpenTelemetryCollector` CR. The collector configuration is passed as a single YAML block in `values.yaml`:

- **Receivers**: OTLP (gRPC `:4317`, HTTP `:4318`)
- **Exporters**: Debug (configurable)
- **Pipelines**: `metrics` (otlp → debug), `traces` (otlp → debug)

The collector handles OTLP telemetry pushed to it; it does not scrape model
`/metrics`. Model serving metrics are collected by the UWM PodMonitors (see
below), not by this collector.

### User Workload Monitoring (UWM)

Creates two ConfigMaps to enable OpenShift's built-in Prometheus stack for user workloads:

- `cluster-monitoring-config` in `openshift-monitoring` — enables user workload monitoring and configures platform Prometheus retention/storage
- `user-workload-monitoring-config` in `openshift-user-workload-monitoring` — configures user workload Prometheus retention/storage

PodMonitors are created for each model, configured via the `modelMetricsMonitors` map in `values.yaml`. Adding a new model only requires adding an entry to that map.

### Grafana

- **Instance**: Grafana CR with Prometheus datasource pointing at `https://thanos-querier.openshift-monitoring.svc.cluster.local:9091`
- **Authentication**: Uses a `grafana-sa` ServiceAccount with `cluster-monitoring-view` ClusterRoleBinding and a service-account-token Secret created by a post-install Job
- **Route**: TLS edge-terminated OpenShift Route
- **Dashboards**: model metrics (request latency, throughput, token counts)

### MLflow

Deployed as an `MLflow` CR (`mlflow.opendatahub.io/v1`) reconciled by the OpenShift AI MLflow operator in `redhat-ods-applications`. The operator provisions the tracking server, storage, TLS, and Route:

- **Storage**: PVC-backed store for the SQLite backend (`backendStoreUri`) and artifacts (`artifactsDestination`), configured via `mlflow.spec.storage`
- **Artifacts**: served directly by the tracking server (`serveArtifacts: true`)
- **Access**: Route created by the operator; auth via the cluster's OpenShift OAuth

The CR spec is rendered verbatim from `mlflow.spec` in `values.yaml`, so any operator-supported field can be set there.

## Tracing VSS into MLflow

The vss-agent runs the whole summarization pipeline (VLM captioning,
summarization, orchestration) and exports OTLP spans directly to MLflow. Tracing
is enabled automatically when `global.openshift.enabled` is true; you only supply
the target experiment and an auth token. The agent image must include the tracing
plugin — deploy the pre-built image, or build one per
[customization-reference.md](customization-reference.md#building-custom-images).

### Step 1: Extract the ServiceAccount token

The chart creates a long-lived token Secret (`vss-mlflow-token`, bound to the
namespace `default` SA the agent runs as). Extract it:

```bash
oc get secret vss-mlflow-token -n vss -o jsonpath='{.data.token}' | base64 -d
```

Copy this token value.

### Step 2: Create an MLflow experiment

Get the MLflow UI URL (the operator creates no Route — use the console link):

```bash
oc get consolelink -o custom-columns=TEXT:.spec.text,HREF:.spec.href | grep -i mlflow
```

Open it, then:

1. **Select the workspace matching your install namespace** (e.g. `vss`) in the
   workspace selector — RHOAI MLflow scopes experiments by workspace, and the agent's
   SA is only granted access to its own namespace's workspace (see
   `templates/mlflow-rbac.yaml`). Creating the experiment in any other workspace
   gives the agent a `403` on export.
2. Click **"+ Create Experiment"**
3. Enter a **Name** (e.g. `vss-agent-traces`); leave other fields default
4. Click **"Create"**
5. Note the numeric **Experiment ID** from the URL/overview

### Step 3: Update the config

Edit the `mlflow` tracer in
`deploy/helm/developer-profiles/dev-profile-base/configs/vss-agent/config.yml`
(under `general.telemetry.tracing`) with the values from Steps 1–2:

```yaml
      mlflow:
        _type: otelcollector_redaction
        endpoint: https://mlflow.redhat-ods-applications.svc.cluster.local:8443/v1/traces
        project: vss-agent
        headers:
          x-mlflow-experiment-id: "1"                 # from Step 2
          x-mlflow-workspace: "vss"                   # your install namespace
          Authorization: "Bearer eyJhbGciOi..."       # from Step 1
        redaction_enabled: true
```

Confirm the endpoint Service/port for your cluster with
`oc get svc -n redhat-ods-applications | grep mlflow`. The experiment ID must
match the experiment created in Step 2. This block only renders when
`global.openshift.enabled` is true.

### Step 4: Upgrade and restart

Re-run the `helm upgrade --install` from the
[README Install section](../../README.md#install), then restart the agent so it
reloads with the new env:

```bash
oc rollout restart deploy/vss-agent -n vss
oc rollout status  deploy/vss-agent -n vss
```

### Step 5: Test trace collection

Generate activity in the app:

```bash
oc get route vss-vss-ui -n vss -o jsonpath='{.spec.host}'
```

Open the UI, run a video summarization, then in the MLflow UI open your
experiment — spans for the run (VLM captioning, summarization, orchestration)
should appear under the **Traces** tab.

### MLflow Connection Issues

Traces not appearing? Work through:

1. **Experiment ID matches** — `x-mlflow-experiment-id` in `config.yml` equals the ID in the MLflow UI.
2. **Token is valid** — re-extract (Step 1); a placeholder or expired token gives `401`.
3. **`403 PERMISSION_DENIED` on export** — the experiment is in a workspace the agent's SA
   can't reach. Confirm the experiment was created in the workspace matching your install
   namespace (Step 2), and that RBAC applied: `oc get rolebinding vss-mlflow-integration -n vss`.
3. **Check agent logs for OTLP errors:**

   ```bash
   oc logs -n vss deploy/vss-agent | grep -iE "otlp|mlflow|trace|401|403"
   ```

4. **Test connectivity from the vss namespace:**

   ```bash
   oc run -it --rm debug --image=curlimages/curl --restart=Never -n vss -- \
     curl -k https://mlflow.redhat-ods-applications.svc.cluster.local:8443/health
   ```

5. **MLflow TLS trust** — MLflow serves a cert signed by the OpenShift service-CA
   signer. The agent verifies it via `OTEL_EXPORTER_OTLP_CERTIFICATE`, which points
   at the combined trust bundle that includes `vss-service-ca` (the injected signer);
   both are wired on every openshift path. A `CERTIFICATE_VERIFY_FAILED` /
   `self-signed certificate in certificate chain` on `/v1/traces` means the OTLP
   cert env or `vss-service-ca` didn't render — confirm `oc get cm vss-service-ca -n vss`
   exists and that `OTEL_EXPORTER_OTLP_CERTIFICATE` is set in the agent pod.

## Uninstall

```bash
cd deploy/helm/observability
./uninstall.sh
```

Tears down in reverse order: MLflow → Grafana → OTel Collector → UWM → Operators.

After uninstalling, you may need to manually remove the UWM ConfigMap:

```bash
oc delete configmap cluster-monitoring-config -n openshift-monitoring
```

## Customization

### Adding a new model to monitoring

1. Add an entry to `modelMetricsMonitors` in `deploy/helm/observability/helm/uwm/values.yaml`
2. Run `helm upgrade` on the UWM chart

### Changing retention periods

Edit `clusterMonitoringConfig.prometheusK8s.retention` and `userWorkloadMonitoringConfig.prometheus.retention` in the UWM `values.yaml`.

### MLflow storage and spec

The MLflow chart requires the OpenShift AI MLflow operator to be installed. Adjust storage size/class and any other operator-supported settings under `mlflow.spec` in `deploy/helm/observability/helm/mlflow/values.yaml`.
