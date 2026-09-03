# Sample footage — manufacturing workplace safety

The clips in this directory are drawn from the **Safe and Unsafe Behaviours**
dataset: fixed security-camera footage of safe/unsafe worker behaviours at a
metal/plastic production facility, used here as sample input for the VSS
quickstart's manufacturing-safety use case.

## Attribution (required — CC BY 4.0)

> Önal, O., & Dandıl, E. (2024). Video dataset for the detection of safe and
> unsafe behaviours in workplaces. *Data in Brief*, 56, 110756.

- License: **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/) —
  redistribution and modification permitted with attribution.
- Original data: https://data.mendeley.com/datasets/xjmtb22pff/1
- Paper: https://www.sciencedirect.com/science/article/pii/S235234092400756X
- FiftyOne / Hugging Face mirror: `Voxel51/Safe_and_Unsafe_Behaviours`
  (https://huggingface.co/datasets/Voxel51/Safe_and_Unsafe_Behaviours)

Footage was captured at the Kafaoğlu Metal Plastik facility (Eskişehir, Turkey);
identifiable workers appear with permissions obtained by the original authors.

## Behaviour classes

| Unsafe | Safe (counterpart) |
|--------|--------------------|
| Safe walkway violation | Safe walkway |
| Unauthorized intervention | Authorized intervention |
| Opened panel cover | Closed panel cover |
| Forklift overload (3+ blocks) | Safe carrying (≤2 blocks) |

## Picking clips (no need to watch anything)

Source files are named `data/<digit>_<split><n>.mp4` (`tr`=train, `te`=test),
and the **leading digit is the behaviour class** (verified against all 691
samples in `samples.json`):

| Digit | Behaviour | Type |
|-------|-----------|------|
| 0 | Safe Walkway Violation | unsafe |
| 1 | Unauthorized Intervention | unsafe |
| 2 | Opened Panel Cover | unsafe |
| 3 | Carrying Overload with Forklift | unsafe |
| 4 | Safe Walkway | safe |
| 5 | Authorized Intervention | safe |
| 6 | Closed Panel Cover | safe |
| 7 | Safe Carrying | safe |

Download any file with the digit you want from the HF `data/` folder
(https://huggingface.co/datasets/Voxel51/Safe_and_Unsafe_Behaviours/tree/main/data),
then **rename** it after its behaviour — the agent treats a video's filename as
its `sensor_id`, so descriptive names read better than `0_tr1.mp4`. Clips are
MP4, 1920×1080, 24 fps, 1–20 s. Only a small subset is vendored here, not all 691.

## Provenance (fill in as you add clips)

| Vendored file | Source file | Behaviour |
|---------------|-------------|-----------|
| `safe-walkway-violation-01.mp4` | `data/0_tr1.mp4` | Safe Walkway Violation |
