# uts-markvideo API

This document defines the public plugin API that the native Android and iOS
recorders should converge on. The current implementation keeps legacy top-level
options working while new work should use the grouped options below.

## Primary API

```ts
recordWatermarkVideo({
  watermark: {
    text: 'Project A',
    imagePath: '/storage/emulated/0/Pictures/logo.png',
    x: 0.5,
    y: 0.78,
    textColor: '#ffffff',
    fontSize: 30,
    textBold: true,
    imageWidth: 72,
    imageHeight: 72,
    imageGap: 18,
    boxWidth: 0.88,
    boxHeight: 0.16,
    backgroundColor: '#00000099',
    borderRadius: 18,
    padding: 28
  },
  video: {
    fps: 30,
    bitrate: 2500000,
    includeAudio: true
  },
  camera: {
    facing: 'back',
    previewFit: 'cover'
  },
  limits: {
    maxDurationMs: 60000,
    minDurationMs: 1000
  },
  diagnostics: {
    perfLogging: false
  },
  success(res) {
    console.log(res.tempFilePath)
  },
  fail(err) {
    console.error(err.errCode, err.errMsg)
  }
})
```

## Compatibility

The existing MVP call shape remains supported:

```ts
recordWatermarkVideo({
  text: 'Project A',
  fps: 30,
  success(res) {}
})
```

When both legacy and grouped options are provided, grouped options win:

- `watermark.text` takes precedence over `text`.
- `video.fps` takes precedence over `fps`.

## Options

### `watermark`

- `text`: Text burned into each output frame. Empty text falls back to the
  native default.
- `imagePath`: Optional local image path or URI for a logo watermark. Android
  camera recording can burn the image alone, or draw it next to `text` when both
  are provided.
- `x` / `y`: Initial watermark center position as ratios from `0` to `1`.
  Android users can still long-press and drag the watermark preview before
  recording; the final chosen position is burned into the MP4.
- `textColor`: CSS-style color string for watermark text. Android accepts
  `#RRGGBB` and `#RRGGBBAA`.
- `fontSize`: Text size in output pixels.
- `textBold`: Whether the text is drawn bold.
- `imageWidth` / `imageHeight`: Logo size in output pixels. If only one side is
  provided, Android preserves the source image aspect ratio.
- `imageGap`: Horizontal gap between logo and text in output pixels.
- `boxWidth` / `boxHeight`: Watermark box size as ratios of output video width
  and height.
- `backgroundColor`: CSS-style background color for the watermark box.
- `borderRadius`: Corner radius in output pixels.
- `padding`: Inner padding in output pixels.

Keep these style options flat inside `watermark`. Some UTS Android runtimes pass
nested objects as `JSONObject` values and cannot construct nested UTS option
types reliably.

Android camera recording implements text, image logo, mixed logo+text, box
styling, text styling, logo sizing, and drag-adjusted position. iOS currently
implements text watermark recording; the shared style fields are accepted by the
API shape so iOS can add matching rendering without changing callers again.

### `video`

- `width`: Compatibility field for generated samples. Camera recording ignores
  this field and uses the native preview display size.
- `height`: Compatibility field for generated samples. Camera recording ignores
  this field and uses the native preview display size.
- `fps`: Preferred frame rate. Android camera recording accepts 8-60 and asks
  the camera for the nearest supported AE FPS range.
- `bitrate`: Preferred video bitrate in bits per second.
- `includeAudio`: Whether microphone audio should be recorded.

For camera recording, `fps`, `bitrate`, and `includeAudio` are wired into the
current native recorders. Width and height are no longer user-tunable for camera
recording: Android derives the MP4 size from the native preview's display aspect
ratio and reports the actual output size in the success result.

### `camera`

- `facing`: Preferred camera, `back` or `front`.
- `previewFit`: Preview display fit, `cover` or `contain`.

`facing` is wired into the current native recorders. The current native previews
use cover-style display.

### `limits`

- `maxDurationMs`: Planned automatic stop limit.
- `minDurationMs`: Planned minimum valid recording duration.

`maxDurationMs` and `minDurationMs` are wired into the current native recorders.
The native stop button remains available for manual stop.

### `diagnostics`

- `perfLogging`: Enables tagged native performance logs for APK smoke tests.
  This should stay off in normal product usage.

## Success Result

```ts
{
  tempFilePath: string,
  savedFilePath?: string,
  durationMs: number,
  width: number,
  height: number,
  watermarkText: string,
  stats?: {
    received: number,
    droppedBusy: number,
    droppedFps: number,
    processed: number,
    encoded: number
  }
}
```

`tempFilePath` points to the recorder's local MP4 file whose video frames should
already contain the watermark. `savedFilePath` points to the system gallery copy
when the platform publishes one. On Android, successful recordings are published
to the system gallery under `Movies/uts-markvideo`, so gallery/video apps can
find them. `durationMs`, `width`, and `height` describe the actual native output,
not merely the requested options.

On Android, `stats` reports frames observed during the recording window:

- `received`: camera frames acquired while recording.
- `droppedBusy`: frames closed because the previous frame was still processing.
- `droppedFps`: frames skipped by the configured FPS throttle.
- `processed`: frames that reached bitmap conversion and watermark drawing.
- `encoded`: frames queued into the video encoder.

## Failure Result

```ts
{
  errCode: number,
  errMsg: string
}
```

Stable recorder error codes:

- `1000`: Native environment is unavailable.
- `1001`: Camera or microphone permission was denied.
- `1002`: Recording was cancelled.
- `1003`: Camera device, session, or camera thread is unavailable.
- `1004`: Recorder start failed.
- `1005`: Recorder stop or MP4 finalization failed.
- `1006`: No video frames were recorded.
- `1007`: Recording is shorter than `limits.minDurationMs`.
- `1008`: Video encoder or supported YUV format is unavailable.

Debug helper error codes:

- `1100`: Android debug sample generation failed.
- `2100`: iOS debug sample generation is unavailable.

## Debug API

`createWatermarkSample` is a development helper. It generates a synthetic MP4 on
Android and is intentionally unavailable on iOS. Product code should call
`recordWatermarkVideo`.
