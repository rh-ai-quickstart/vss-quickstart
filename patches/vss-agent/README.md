# VSS Agent Patches

Patch files for source-level changes to the NVIDIA VSS agent (`services/agent/`)
that must be applied before building a custom agent image — features we intend to
contribute upstream, or minor changes needed for Red Hat OpenShift AI.

Alongside the patches, this directory ships our own (non-NVIDIA) NAT plugin under
`observability/`, which `build.sh` copies into the agent source tree at build
time. For the full build/push/deploy flow see
[Building Custom Images](../../docs/advanced-docs/customization-reference.md#building-custom-images).

## Patch Creation Workflow

1. **Develop and commit** in the `upstream/vss/` submodule
2. **Generate patch**: e.g. `cd upstream/vss && git format-patch -1 HEAD -o ../../patches/vss-agent/`
3. **Reset submodule**: `git reset --hard HEAD~1 && git clean -fd`
4. **Track patch**: `git add patches/vss-agent/*.patch && git commit`
5. **Submit upstream** via PR to NVIDIA VSS for changes we want to contribute
6. **Remove patch** once merged and the submodule is updated

## Applying Patches

`build.sh` applies these automatically. To apply them by hand to a fresh
checkout:

```bash
cd upstream/vss
git am ../../patches/vss-agent/*.patch
```

This applies all patches in order:
1. `0001-Register-VSS-observability-telemetry-exporter-otelco.patch`

If patch application fails:

```bash
git am --abort
```

## Patch Descriptions

- **0001** — Registers our observability plugin as a `nat.components` entry point
  in `services/agent/pyproject.toml`, so the NeMo Agent Toolkit loads the
  `otelcollector_redaction` tracing exporter (Red Hat quickstart customization).

## Plugin Source (not a patch)

`observability/*.py` is our own code, not an NVIDIA modification, so it is kept
as plain source and copied into `services/agent/src/vss_agents/observability/`
by `build.sh` rather than carried as a patch:

- `otel_header_redaction_exporter.py` — registers the `otelcollector_redaction`
  tracing type, adding the `headers` field the built-in `otelcollector` lacks so
  the agent can send RHOAI MLflow auth headers.
- `register.py` — entry-point module that imports the exporter.
- `__init__.py`

## Notes

- Patches are numbered to ensure correct application order.
- Use `git format-patch` + `git am` to preserve commit metadata.
- Use patches for source-level changes to NVIDIA files; keep our own new files as
  plain source (copied in by `build.sh`).
- Do not commit local `upstream/vss` submodule commits to this repository.
- After running `git am`, the submodule will have new local commits and the
  parent repo will show `upstream/vss` as modified — expected during
  build/testing. `build.sh` restores the submodule to its pinned commit
  afterward, even on failure.
