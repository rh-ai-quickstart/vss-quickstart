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
| `mlflow` | Resource | Standalone MLflow tracking server for pipeline traces |

## Architecture

```
KServe model pods (nemotron, cosmos3)
  ├── /metrics endpoint
  │     └── scraped by → Prometheus (via PodMonitors/UWM)
  │                         └── queried by → Grafana dashboards
  └── inference calls
        └── traced by → MLflow (experiment tracking)
```

- **Metrics path**: model pods expose `/metrics` → PodMonitors tell UWM Prometheus to scrape them → Grafana queries Prometheus via the Thanos Querier
- **Traces path**: Application code sends traces to MLflow tracking server → viewable in MLflow UI

## Quick Start

### 1. Install operators

```bash
cd deploy/helm/observability
./install-operators.sh
```

This creates the `observability-hub` namespace, installs the OTel and Grafana operator subscriptions via OLM, and waits for the `OpenTelemetryCollector` and `Grafana` CRDs to become available.

### 2. Deploy resources

```bash
./deploy.sh
```

Installs in order:
1. **UWM** — ConfigMaps for `cluster-monitoring-config` and `user-workload-monitoring-config` that enable user workload monitoring, plus PodMonitors for each model
2. **OTel Collector** — `OpenTelemetryCollector` CR in `observability-hub` that receives OTLP telemetry
3. **Grafana** — Grafana instance with Prometheus datasource pointing at the Thanos Querier, plus model metrics dashboards
4. **MLflow** — Standalone MLflow deployment in the `vss` namespace

### 3. Access dashboards

**Grafana:**

```bash
oc get route -n observability-hub -l app.kubernetes.io/name=grafana
```

**MLflow:**

```bash
oc get route mlflow -n vss -o jsonpath='{.spec.host}'
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

Standalone MLflow tracking server deployed as a Deployment + Service + Route:

- **Storage**: PVC-backed artifact store (`/mlflow/artifacts`)
- **Security**: Non-root container with `RuntimeDefault` seccomp profile and dropped capabilities
- **Access**: TLS edge-terminated OpenShift Route

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

### Using RHOAI MLflow instead of standalone

If your cluster has RHOAI with the MLflow operator, you can use a managed MLflow CR instead of the standalone deployment. Apply the CR in `redhat-ods-applications`:

```yaml
apiVersion: chart.openshift.io/v1
kind: MlflowServer
metadata:
  name: mlflow
  namespace: redhat-ods-applications
```

Then skip the MLflow step in `deploy.sh`.
