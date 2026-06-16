# uts-markvideo

Native App MVP for testing whether a uni-app UTS plugin can create a video file
whose frames already contain a watermark.

## What this MVP proves

- Android App side calls a UTS plugin.
- The plugin calls native Kotlin through UTS hybrid code.
- Kotlin generates a short MP4 with `MediaCodec` + `MediaMuxer`.
- The watermark is drawn into every video frame before encoding.
- No push-stream/RTMP/WebRTC server is involved.

This MVP intentionally does not open the camera yet. It uses generated frames so
the smallest native encoding path can be checked first. The real recording
version keeps the same output shape, then replaces generated frames with
CameraX/Camera2 frames.

## Try it

1. Open this `uts-markvideo` folder in HBuilderX as a uni-app project.
2. Run to Android App.
3. Tap the button on the first page.
4. The app should receive a local MP4 path and display it in the page video
   player.

iOS currently returns an unsupported error. That file exists only to keep the
UTS API shape stable for the next implementation pass.

## Important paths

- `pages/index/index.vue` - demo page that calls the plugin.
- `uni_modules/uts-markvideo/utssdk/interface.uts` - public plugin contract.
- `uni_modules/uts-markvideo/utssdk/app-android/index.uts` - UTS Android bridge.
- `uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt` - native MP4
  watermark encoder MVP.

## Next step for real camera

Replace `renderFrame(...)` in `MarkVideoNative.kt` with camera frames from
CameraX or Camera2, then keep the same watermark draw and encoder/muxer output
path. For audio, add an AAC encoder track and mux it with the video track.
