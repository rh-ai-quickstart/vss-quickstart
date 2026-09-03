# Using the App: Upload a Video and Ask Questions

This guide walks through the core workflow — upload a video, then ask questions
about it in natural language. Use it to explore what the app can do and to run
a basic demo.

The sample clips under
[`assets/videos/manufacturing/safety/`](../../assets/videos/manufacturing/safety/)
are short manufacturing-floor safety scenes (walkway violations, forklift
overload, open/closed panel covers, equipment intervention) — a good starting
set for a workplace-safety walkthrough.

## 1. Open the app

Get the UI URL and open it in a browser:

```bash
oc get route vss-vss-ui -n vss -o jsonpath='{.spec.host}'
```

## 2. Upload a video

1. Click the **Upload Video** button and choose a file — e.g.
   `safe-walkway-violation-01.mp4` from the sample set.
2. Wait for processing to finish before querying — a short clip takes a moment,
   longer footage takes longer.

The video's **name is its identifier** (its `sensor_id`), so descriptive
filenames like `forklift-overload` make it easy to refer to a specific video in
a question.

## 3. Ask questions

On the video's tile, click **+ Chat** to add it to the chat, then ask about it
in natural language. Two modes:

**Summarize** — one description of the whole clip:

- "Summarize what happens in this video."
- "Describe any safety issues you observe."
- "What is the worker doing, step by step?"

**Search / Q&A** — targeted questions the sample footage can answer:

- "Is the worker staying within the designated walkway?"
- "Is anyone in a restricted or unsafe area?"
- "Is the electrical panel cover open or closed?"
- "How many blocks is the forklift carrying — is it overloaded?"
- "Is the worker wearing proper equipment for this intervention?"

## Tips

- **Start with one short clip.** Confirm the end-to-end flow before uploading
  more or a longer video.
- **Name videos clearly.** The filename is the `sensor_id` — reference it by name
  when a question should target a specific video.
- **Be specific.** "Is the panel cover open?" gets a sharper answer than "anything
  wrong here?"
