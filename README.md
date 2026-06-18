# uts-markvideo

Native App MVP for testing whether a uni-app UTS plugin can open a camera,
preview a watermark, record, stop, and return an MP4 whose frames already
contain the watermark.

## What this MVP proves

- Android App side configures watermark text and calls a UTS plugin.
- The plugin opens a native Android camera Activity.
- The native Activity previews camera frames with the watermark visible.
- The Activity has start/stop recording buttons.
- Camera frames are drawn with the watermark before being encoded by
  `MediaCodec` + `MediaMuxer`.
- The uni-app page receives the MP4 path and plays it for visual verification.
- No push-stream/RTMP/WebRTC server is involved.

This MVP is deliberately small: Android uses Camera2 `ImageReader` frames plus
`AudioRecord`, and iOS uses AVFoundation video/audio outputs plus
`AVAssetWriter`. Both paths aim to produce a local file with a burned-in
watermark and microphone audio. It is meant to prove the product flow before
replacing the frame path with a production OpenGL/CameraX/Metal pipeline.

## Try it

1. Open this `uts-markvideo` folder in HBuilderX as a uni-app project.
2. Run to Android App.
3. Enter watermark text on the first page.
4. Tap the button to open the native camera recorder.
5. In the native page, tap start, then stop.
6. The app should receive a local MP4 path and display it in the page video
   player. Play the MP4 and check that the watermark is burned into the video.

iOS uses the same `recordWatermarkVideo` API and opens a native AVFoundation
recorder. Enable `camera.enablePhoto` to show the native photo button; iOS saves
watermarked photos to the system photo library and returns their identifiers.

## Important paths

- `pages/index/index.vue` - demo page that configures the watermark and opens
  the recorder.
- `uni_modules/uts-markvideo/utssdk/interface.uts` - public plugin contract.
- `uni_modules/uts-markvideo/utssdk/app-android/index.uts` - UTS Android bridge.
- `uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt` - UTS hybrid
  callback bridge and generated-frame encoder sample.
- `uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt` -
  native Android camera preview, microphone capture, and record/stop MVP.
- `uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift` - native
  iOS AVFoundation camera, audio, watermark, and writer MVP.

## Next step for real camera

For production, replace the CPU bitmap conversion in
`MarkVideoCameraActivity.kt` with an OpenGL or CameraX effect pipeline, replace
the iOS CoreGraphics watermark pass with Metal/CoreImage tuning as needed, and
add deeper device/orientation testing.

## GitHub Actions packaging

`.github/workflows/cloud-package.yml` adds a manual GitHub Actions workflow that
uses the official HBuilderX Linux CLI cloud packaging command:

1. Download HBuilderX Linux CLI.
2. Run `cli open`.
3. Log in with DCloud.
4. Import this project.
5. Generate a temporary `cli pack --config` JSON file.
6. Upload generated APK/AAB/IPA/WGT artifacts from `unpackage/`.

Before running it, configure repository variables:

- `ANDROID_PACKAGE_NAME`, for example `com.example.utsmarkvideo`
- `IOS_BUNDLE_ID`, for example `com.example.utsmarkvideo`
- `ANDROID_CERT_ALIAS`, only when using your own Android keystore
- `IOS_SUPPORTED_DEVICE`, optional, defaults to `iPhone`
- `IOS_CHANNELS`, optional, defaults to `phone`
- `HBUILDERX_URL`, optional, defaults to the current official Linux CLI release

Configure repository secrets:

- `DCLOUD_USERNAME`
- `DCLOUD_PASSWORD`
- `ANDROID_CERT_BASE64`, only when `android_pack_type` is `0`
- `ANDROID_CERT_PASSWORD`, only when `android_pack_type` is `0`
- `ANDROID_STORE_PASSWORD`, only when `android_pack_type` is `0`
- `IOS_PROFILE_BASE64`, only when `ios_prisonbreak` is `false`
- `IOS_CERT_BASE64`, only when `ios_prisonbreak` is `false`
- `IOS_CERT_PASSWORD`, only when `ios_prisonbreak` is `false`

Encode certificate files with `base64 -w 0 <file>` before saving them as
GitHub secrets. The workflow defaults to safe packaging and Android DCloud cloud
certificate mode (`android_pack_type=3`), so you can start with Android once
DCloud cloud certificate configuration exists for this app.

For iOS device smoke testing with AltStore-style self-signing tools, run the
workflow with `platform=ios` and keep `ios_prisonbreak=true`. In that mode the
generated pack config requests a DCloud iOS prisonbreak package and does not
require `IOS_PROFILE_BASE64`, `IOS_CERT_BASE64`, or `IOS_CERT_PASSWORD`. Use the
downloaded IPA as the input to your own signing/install tool. Turn
`ios_prisonbreak` off only when you want DCloud to sign the IPA with Apple
certificate files stored in GitHub Secrets.
