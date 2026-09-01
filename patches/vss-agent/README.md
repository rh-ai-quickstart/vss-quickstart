# VSS Agent Customizations

Adds MLflow tracing support to the VSS agent (`services/agent/`), applied before
building a custom agent image. Most users deploy the pre-built image and never
need this.

The NeMo Agent Toolkit's built-in `otelcollector` tracing type has no `headers`
field, so it can't authenticate to RHOAI MLflow. We add an `otelcollector_redaction`
type that does. Enable it in the agent NAT config
(`deploy/helm/developer-profiles/dev-profile-base/configs/vss-agent/config.yml`).

| File | What it is |
|------|------------|
| `0001-*.patch` | Adds one `nat.components` entry point to `pyproject.toml` (NVIDIA file). |
| `observability/*.py` | Our NAT plugin: registers the `otelcollector_redaction` tracing type. |
| `build.sh` | Applies the patch, drops in the plugin, builds, restores the submodule. |

## Build

```bash
./build.sh                       # -> vss-agent:latest
IMAGE=my/vss-agent:dev ./build.sh
```

The submodule is restored to its pinned commit afterward, even on failure.

## Update the patch after changing NVIDIA files

```bash
cd upstream/vss
# commit your change, then:
git format-patch -1 HEAD -o ../../patches/vss-agent/
git reset --hard HEAD~1 && git clean -fd
```

Commit the `.patch` (not the submodule commit).
