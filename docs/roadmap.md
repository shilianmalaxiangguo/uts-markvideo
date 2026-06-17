# Optimization Roadmap

This document tracks product-quality work discovered while testing packaged APK
builds on Android devices.

## 2026-06-17 Android APK smoke test

Observed behavior:

- Starting the native recorder has a visible loading delay before preview and
  recording feel ready.
- Recording is visibly stuttery on Android.
- The native recorder can show a black camera screen after opening, and remain
  black after tapping start.

Current assessment:

The issue is expected from the current MVP Android pipeline. It was designed to
prove the watermarked MP4 flow, not to be a production recorder. The current
path uses Camera2 `ImageReader` frames and performs CPU-heavy work for every
processed frame:

1. Acquire a `YUV_420_888` camera frame.
2. Convert the YUV planes to an ARGB `IntArray` pixel by pixel.
3. Create a `Bitmap`.
4. Copy the bitmap to a mutable ARGB bitmap.
5. Draw the watermark with `Canvas`.
6. Read all pixels back from the bitmap.
7. Convert ARGB back to YUV420 pixel by pixel.
8. Queue the byte array into `MediaCodec`.

This creates heavy CPU pressure, repeated large allocations, and extra garbage
collection pressure. At 640x480, each full conversion touches hundreds of
thousands of pixels multiple times per frame. At higher requested sizes this
cost grows quickly.

The black-preview symptom came from the MVP preview architecture: preview
depended on the same `ImageReader -> Bitmap -> ImageView` path as watermark
processing. If that path stalls or a device behaves poorly with the CPU frame
conversion path, there is no independent native preview Surface to display.

The visible loading delay is likely a combination of:

- Opening Camera2 and creating the capture session.
- Creating `ImageReader` surfaces.
- Selecting and starting the AVC encoder.
- Starting AAC audio encoding and `AudioRecord`.
- Waiting for `MediaMuxer` to receive track formats before it can write samples.
- First-frame CPU conversion and watermark rendering before encoded frames
  become active.

The recent frame-throttling and bitmap-release changes reduce pressure, but they
do not change the fundamental CPU-bound encoding architecture. The Android
preview path now uses a `TextureView` camera Surface, while `ImageReader` remains
for watermark/encoding frames.

## Next Android work

### 1. Add measurement instrumentation

Add temporary, clearly tagged timing logs around:

- Activity launch to `onCreate`.
- Camera open start to `onOpened`.
- Capture session creation to `onConfigured`.
- Recorder start to first encoded frame.
- Per-frame `image.toBitmap`.
- Per-frame `drawWatermark`.
- Per-frame `argbToYuv420`.
- Encoder input dequeue and output drain.
- Stop request to muxer release.

The goal is to measure the loading delay and frame cost on the test phone before
choosing the final rendering pipeline.

Status: Android has a gated `diagnostics.perfLogging` option. Enable `Perf logs`
in the demo page, then filter Logcat by:

```text
UTSMarkVideoPerf
```

### 2. Improve demo test controls

Expose these controls on the demo page so Android APK tests can compare
settings without rebuilding:

- `fps`
- `width` and `height`
- `bitrate`
- `includeAudio`
- `camera.facing`
- `maxDurationMs`
- `minDurationMs`

Use this to test whether stutter is primarily frame conversion, encoder
configuration, audio muxing, or high requested resolution.

Status: the demo page exposes these controls for APK smoke testing.

### 3. Short-term CPU-path improvements

If we keep the current MVP path briefly, reduce allocation churn:

- Reuse pixel arrays and YUV byte arrays inside `CameraMp4Recorder`.
- Avoid making a second bitmap copy where possible.
- Keep native preview independent from the CPU watermark/encoding path.
- Prefer lower default capture size on weak devices.
- Report dropped/processed frame counts in the result or status text.

These changes can reduce symptoms but should not be treated as the production
architecture.

Status: partially done. The Android path now uses `TextureView` for native
camera preview, reuses the Activity ARGB buffer, reuses recorder pixel/YUV
buffers, draws the watermark in-place on the camera bitmap, throttles processed
frames by target FPS, and returns `stats` with received, dropped-busy,
dropped-FPS, processed, and encoded frame counts. Remaining short-term work is
to test whether lower default sizes improve the packaged APK on target devices.

### 4. Production Android rendering path

Move the Android recorder to a GPU/surface pipeline:

- Camera2 or CameraX produces frames into a Surface/texture.
- Watermark is composited with OpenGL.
- `MediaCodec` uses an input Surface instead of byte-array YUV buffers.
- Preview and encoding share the GPU-rendered frame path.

This avoids the current CPU round trip and is the correct direction for smooth
recording with burned-in watermark.

### 5. Audio/video timing

After the render path is stable, align timestamps:

- Use recording start time as a common clock.
- Timestamp video frames from actual capture/render time instead of only frame
  count.
- Keep audio samples relative to the same base.
- Record dropped-frame counts for debugging.

## Current priority

Recommended next step: run one APK test pass with `diagnostics.perfLogging` and
the returned frame `stats`, then decide whether CPU-path tuning is enough or the
OpenGL/CameraX rewrite should start immediately.
