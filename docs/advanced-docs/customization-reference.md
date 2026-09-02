# Customizing VSS for Red Hat OpenShift AI

This quickstart deploys NVIDIA VSS on Red Hat OpenShift AI using pre-built
container images. Most changes are Helm-values edits and need no rebuild;
building a custom image is only required for source-level changes to the agent
(for example, the MLflow tracing plugin).

## Table of Contents

- [Building Custom Images](#building-custom-images)
- [Additional Resources](#additional-resources)

---

## Building Custom Images

The only image this quickstart rebuilds is the **VSS agent**, to add the MLflow
tracing plugin. Pre-built images already include it — build your own only when
changing agent source.

### Container Images & Versioning

Based on **NVIDIA VSS v3.2.1** with Red Hat changes:

- **Agent:** v3.2.1 + patch 0001 (registers the `otelcollector_redaction`
  tracing exporter) + our `observability/` plugin.

Upstream source is the `upstream/vss` submodule, pinned to v3.2.1. See
[patches/vss-agent/README.md](../../patches/vss-agent/README.md) for patch
details.

### Build Process

**1. Build.** `build.sh` applies the patch, copies in the plugin, builds with
podman, then restores the submodule to its pinned commit (even on failure):

```bash
cd patches/vss-agent
IMAGE=quay.io/<you>/vss-agent:mlflow ./build.sh   # default: vss-agent:latest
```

**2. Push** to a registry the cluster can pull from:

```bash
podman login quay.io
podman push quay.io/<you>/vss-agent:mlflow
```

Make the repo public, or add a pull secret to the install namespace and list it
under `global.imagePullSecrets` (next to `ngc-secret`).

**3. Point the deployment at your image** in
`deploy/helm/developer-profiles/dev-profile-base/values-openshift.yaml` under
`agent.vss-agent`:

```yaml
agent:
  vss-agent:
    image:
      repository: quay.io/<you>/vss-agent
      tag: mlflow
      pullPolicy: Always
```

**4. Deploy** with the `helm upgrade --install` command from the
[README Install section](../../README.md#install), then roll the agent:

```bash
oc rollout restart deploy/vss-agent -n vss
```

To enable and verify MLflow tracing after deploying, see
[observability-guide.md](observability-guide.md#tracing-vss-into-mlflow).

### Version Alignment

Always build from the version that the git submodule is pinned to from the upstream NVIDIA repository; this is the version that the AI quickstart code maps to and using a
different version may cause incompatibilities.

---

## Additional Resources

- **Agent patches:** [patches/vss-agent/README.md](../../patches/vss-agent/README.md)
- **Observability & tracing:** [observability-guide.md](observability-guide.md)
- **Fork tracking:** [fork.md](fork.md)
- **Upstream NVIDIA VSS:** https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization
- **NeMo Agent Toolkit:** https://docs.nvidia.com/nemo/agent-toolkit/latest/
