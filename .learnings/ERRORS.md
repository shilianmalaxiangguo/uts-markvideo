# Errors

Command failures and integration errors.

---

## [ERR-20260625-001] hbuilderx_launch_missing_xyc_component

**Logged**: 2026-06-25T00:23:14+08:00
**Priority**: high
**Status**: pending
**Area**: infra

### Summary
HBuilderX Android launch reached UTS compile and phone sync, but cameraX runtime failed before DOM creation because the xyc-markvideo component class was missing.

### Error
```text
error: java.lang.NoClassDefFoundError: Failed resolution of: Luts/sdk/modules/xycMarkvideo/XycMarkvideoComponent;
at pages/cameraX/index.uvue:4:6
<xyc-markvideo
进入页面: pages/cameraX/index 。[{"创建dom元素个数":"0个", ...}]
```

### Context
- Operation: device verification for the CameraX video/photo mode switch thumb width change.
- Command: `/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/chaixixi/od/uts-markvideo --deviceId ce081718f2646039057e --continue-on-error false --pagePath pages/cameraX/index`
- The build reached `项目 uts-markvideo UTS编译完毕` and `同步手机端程序文件成功`, but startup failed before the page rendered, so adb screenshots cannot validate the latest capsule geometry from this run.

### Suggested Fix
Before relying on screenshots after a uvue/component-path change, ensure the xyc-markvideo generated component class is present in the debug base output or force a clean rebuild of the plugin/component cache. Treat screenshots after this failure as stale unless a later launch reaches nonzero DOM creation on `pages/cameraX/index`.

### Metadata
- Reproducible: unknown
- Related Files: pages/cameraX/index.uvue, uni_modules/xyc-markvideo/utssdk/app-android/index.vue

---

## [ERR-20260624-001] hbuilderx_uvue_helper_type_annotations

**Logged**: 2026-06-24T16:30:38+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
HBuilderX uni-app x Android compile rejects JS-style top-level helper parameters in `.uvue` UTS scripts.

### Error
```text
error: An explicit type is required on a value parameter.
error: 返回类型不匹配：预期类型为 'Any'，实际类型为 'Any?'。
```

### Context
- Command: `/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/chaixixi/od/uts-markvideo --compile true --continue-on-error false`
- The compile reached real uni-app x page compilation, then failed in `pages/index/index.uvue` and `pages/cameraX/index.uvue`.
- `function cloneTemplate(template): any` needs an explicit parameter type, and `JSON.parse(...)` must be null-checked before returning as non-null `any`.

### Suggested Fix
For `.uvue` helper functions, annotate parameters explicitly and normalize nullable parse results before returning them. Keep treating HBuilderX compile as the real UTS syntax gate, not Node structure tests.

### Metadata
- Reproducible: yes
- Related Files: pages/index/index.uvue, pages/cameraX/index.uvue, test/structure.test.mjs

---

## [ERR-20260624-002] uvue_structure_tests_stale_untyped_method_regex

**Logged**: 2026-06-24T17:57:16+08:00
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
After adding UTS explicit method parameter types, Node structure tests failed because several regex guards still expected JS-style untyped method signatures.

### Error
```text
not ok 11 - cameraX uvue page owns UI and calls xyc-markvideo native camera methods
The input did not match /setMode\(mode\) \{.../
not ok 22 - applyWatermarkTemplate body should be inspectable
not ok 25 - handleWatermarkMoveChange body should be inspectable
```

### Context
- Command: `npm test > /tmp/uts-markvideo-npm-test.log 2>&1`
- Surface: `test/structure.test.mjs`
- Cause: `.uvue` methods now use signatures like `setMode(mode: string): void`, `applyWatermarkTemplate(template: WatermarkTemplate): void`, and `handleWatermarkMoveChange(event: any | null): void`.

### Suggested Fix
Keep the behavioral structure guards, but make method-signature regexes accept optional UTS parameter and return types whenever HBuilderX requires typed `.uvue` methods.

### Metadata
- Reproducible: yes
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs

---

## [ERR-20260623-008] codegraph_files_cli_panic

**Logged**: 2026-06-23T22:42:40+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
`codegraph files` panicked when used from this workspace, so structural lookup had to fall back to direct file reads and `rg`.

### Error
```text
Mismatch between definition and access of `path`.
Could not downcast to TypeId(...), need to downcast to TypeId(...)
```

### Context
- Command: `codegraph files pages/cameraX`
- Environment: `/Users/chaixixi/od/uts-markvideo`, CodeGraph CLI available at `/Users/chaixixi/.local/bin/codegraph`.
- `codegraph status` succeeded, but the files subcommand panicked before returning indexed paths.

### Suggested Fix
Use `codegraph query` / `codegraph context` or direct `rg` reads until the `files` subcommand is fixed; rerun with `RUST_BACKTRACE=1` if deeper CodeGraph CLI debugging is needed.

### Metadata
- Reproducible: unknown
- Related Files: .codegraph/, skills/codegraph/SKILL.md

---

## [ERR-20260623-009] hbuilderx_cli_android_compile_hung_after_uts_audio_patch

**Logged**: 2026-06-23T21:50:00+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
HBuilderX Android compile hung after printing only the version line while rebuilding the UTS Android plugin.

### Error
```text
HBuilderX Version: 5.07
```

### Context
- Command: `/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/chaixixi/od/uts-markvideo --compile true --continue-on-error false`
- Repeated once after stopping stale build processes; the second run also printed only the version line for 60 seconds.
- After interrupting the CLI, a child Kotlin compile Java process remained alive for more than 7 minutes with little CPU activity.
- Stale build child processes were stopped manually.
- Recurrence 2026-06-23T23:09:00+08:00: `/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/chaixixi/od/uts-markvideo --compile true --continue-on-error false --native-log false` again printed only `HBuilderX Version: 5.07` and no compile log for 90 seconds, then was interrupted.
- Recurrence 2026-06-23T23:13:00+08:00: after killing stale `uniapp-cli-vite` / Kotlin compiler child processes, the same CLI command still printed only `HBuilderX Version: 5.07` and no compile log for 90 seconds, then was interrupted.
- Recurrence 2026-06-23T23:50:00+08:00: a macOS-compatible 180s wrapper around the same CLI command again produced only `HBuilderX Version: 5.07`; log path was `/tmp/uts-markvideo-hbuilderx-compile-20260623234705.log`.

### Suggested Fix
If this recurs, clean the HBuilderX compile/plugin cache or restart HBuilderX before re-running the Android compile. Do not treat this command as passed unless it prints `项目 uts-markvideo 编译成功`.

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt

---

## [ERR-20260623-002] python_default_missing_pillow

**Logged**: 2026-06-22T17:53:51Z
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
默认系统 Python 没有 Pillow，导致截图模板匹配脚本第一次失败。

### Error
```text
ModuleNotFoundError: No module named 'PIL'
```

### Context
- Operation: 运行临时截图模板比对脚本，判断水印 logo 是否与 normal/vflip 版本匹配。
- Environment: 默认 `python3`，不是 Codex workspace bundled Python。
- Impact: 额外花了一轮才切到 bundled Python 执行图像分析。

### Suggested Fix
图像分析或脚本验证优先使用 `load_workspace_dependencies` 提供的 bundled Python 路径，或先检查 Pillow 是否可用。

### Metadata
- Reproducible: yes
- Related Files: screenshots/, static/watermark/logo2.png
- See Also: LRN-20260623-C14

---

## [ERR-20260622-C01] macos_timeout_command_missing

**Logged**: 2026-06-22T22:04:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
macOS 默认没有 GNU `timeout`，HBuilderX CLI 验证不能直接用 Linux `timeout 180s ...` 写法。

### Error
```text
zsh:1: command not found: timeout
```

### Context
- Command: `timeout 180s /Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/chaixixi/od/uts-markvideo --compile true --continue-on-error false --native-log false`
- Environment: macOS zsh, HBuilderX 5.07.
- Result: 编译命令没有真正执行，退出码 127。

### Suggested Fix
在本机做 HBuilderX CLI 限时验证时，用 zsh 后台进程配合 `sleep` 和 `kill`，或改用 HBuilderX IDE 右下角“重新运行”。不要把 `timeout` 失败误判成项目编译失败。

### Metadata
- Reproducible: yes
- Related Files: README.md, .learnings/LEARNINGS.md
- See Also: LRN-20260621-002

### Resolution
- **Resolved**: 2026-06-22T22:04:00+08:00
- **Commit/PR**: pending
- **Notes**: Switched to a macOS-compatible shell wrapper for subsequent HBuilderX CLI verification; the wrapped CLI still timed out after 180s with only `HBuilderX Version: 5.07`, so use IDE rerun or device evidence for this workflow.

---

## [ERR-20260622-B01] android_muxer_invalid_state_nonstandard_recording_size

**Logged**: 2026-06-22T20:18:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
N9500 录像停止失败时，先检查 MediaCodec 实际配置的录制尺寸是否来自预览控件尺寸。

### Error
```text
ACodec configure: width = 990, height = 1918, frame-rate = 30
MediaMuxer: stop() is called in invalid state 3
页面显示：录像停止失败 / 相机错误
```

### Context
- Operation: 提升水印录像清晰度后在 N9500 停止录像。
- Root cause: 录像输出尺寸仍从 `previewView.width/height` 反推，生成了 `990x1918` 这种页面布局尺寸。老设备硬编和 MediaMuxer 对这种非标准竖屏尺寸更容易在 stop/finalize 阶段失败。
- Correct route: 输出尺寸应来自 Camera 支持的 `supportedVideoSizes`，竖屏只对选中的相机视频尺寸做 90 度宽高互换，不能从页面预览控件尺寸生成编码尺寸。

### Suggested Fix
`chooseRecordingOutputSize()` 使用 `videoSize` 作为源尺寸，并添加结构测试禁止回到 `previewView.width/height`。真机复测时观察 logcat 中 ACodec configure 的 width/height 应为设备支持视频尺寸互换后的标准值，例如 1080x1920，而不是 990x1918。

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- See Also: LRN-20260622-C04

### Resolution
- **Resolved**: 2026-06-22T20:18:00+08:00
- **Commit/PR**: pending
- **Notes**: `chooseRecordingOutputSize()` now derives from `videoSize` and rotation instead of `previewView.width/height`; Node tests and diff check pass.

---

## [ERR-20260622-A01] n9500_overheat_sleep_black_screenshot

**Logged**: 2026-06-22T15:00:04+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
N9500 真机截图全黑时，先检查电源/温控状态，不要直接判断为页面黑屏。

### Error
```text
dumpsys power: mWakefulness=Asleep, Display Power: state=OFF
系统弹窗：您的手机过热，HBuilder已关闭。请在手机冷却后再尝试用HBuilder。
```

### Context
- Operation: HBuilderX 5.07 重新运行到 samsung SM-N9500 后，用 bundled adb `screencap` 验证水印交互。
- Symptom: `screencap` 输出纯黑图，随后唤醒设备后看到系统提示 HBuilder 因手机过热被关闭。
- Root cause: 设备进入睡眠/温控保护，截图不是页面渲染结果。
- Secondary environment issue: 开启 uni/nvue 调试时，logcat 中可能出现 `未能获取局域网地址，本地调试服务不可用`，定位到 `app-service.js` 的 devtools socket 探测，不是 `pages/cameraX/index.nvue` 业务代码异常。

### Suggested Fix
真机截图为黑屏时先运行：

```bash
/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb shell dumpsys power | rg -i "mWakefulness|Display Power"
/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb shell dumpsys battery | rg -i "temperature|level|status|health"
```

如果设备睡眠，先 `adb shell input keyevent KEYCODE_WAKEUP`；如果出现过热保护，暂停相机验证，等设备冷却后再继续。

### Metadata
- Reproducible: yes
- Related Files: screenshots/
- See Also: LRN-20260621-002, LRN-20260622-001

### Resolution
- **Resolved**: 2026-06-22T15:00:04+08:00
- **Commit/PR**: pending
- **Notes**: This was treated as an environment verification blocker, not a runtime regression in the watermark page.

---

## [ERR-20260622-001] uts_component_sync_emit_thread

**Logged**: 2026-06-22T13:48:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Android UTS component methods must not synchronously `$emit` from ref-invoked native command methods such as `switchMode`, `takePhoto`, `startRecord`, or `stopRecord`.

### Error
```text
WXRuntimeException: fireEvent must be called by main thread
```

### Context
- Operation: HBuilderX 5.07 重新运行到 samsung SM-N9500, then switch to video and record.
- Surface: `uni_modules/xyc-markvideo/utssdk/app-android/index.vue`
- Root cause: `switchMode` and earlier `takePhoto/startRecord/stopRecord` synchronously emitted page events from component methods called through page refs, which triggered Weex thread violations.
- Correct route: return the native command result directly; let native view callbacks emit async lifecycle events such as `recordstart`, `recorddone`, `photodone`, `flashchange`, and `zoomchange`.

### Suggested Fix
Keep ref command methods side-effect-light: call the native view and return its string result. Add tests forbidding `shuttertap` and `modechange` sync emits in the Android UTS component.

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/index.vue, pages/cameraX/index.nvue, test/structure.test.mjs
- See Also: LRN-20260622-001

### Resolution
- **Resolved**: 2026-06-22T13:48:00+08:00
- **Commit/PR**: pending
- **Notes**: Removed `shuttertap` and `modechange` sync emits; N9500 logcat no longer reports `fireEvent must be called by main thread` during photo/video verification.

---

## [ERR-20260621-001] hbuilderx_nvue_css_compile

**Logged**: 2026-06-21T15:40:38Z
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
HBuilderX nvue CSS 编译阶段不支持 `margin-left/right: auto`，会在运行编译时输出 nvue-css error。

### Error
```text
[plugin:vite:nvue-css] ERROR: property value `auto` is not supported for `margin-left`
[plugin:vite:nvue-css] ERROR: property value `auto` is not supported for `margin-right`
```

### Context
- Operation: HBuilderX 5.07 运行 `uts-markvideo`
- Surface: `pages/cameraX/index.nvue`
- Trigger: mode switch 居中布局曾使用 Web 风格 `margin-left: auto; margin-right: auto;`
- Correct route: use nvue-supported flex/absolute wrapper centering instead of auto margins.

### Suggested Fix
Remove `margin-left/right: auto`; center fixed-width controls through a full-width parent using `justify-content: center`. Add static tests that fail on `margin auto` in nvue/component files.

### Metadata
- Reproducible: yes
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- See Also: LRN-20260621-001

### Resolution
- **Resolved**: 2026-06-21T15:40:38Z
- **Commit/PR**: pending
- **Notes**: Current source no longer contains `margin auto`; regression guard added to `test/structure.test.mjs`.

---

## [ERR-20260623-001] watermark_pinch_flicker_regression

**Logged**: 2026-06-23T00:38:22+08:00
**Priority**: critical
**Status**: resolved
**Area**: frontend

### Summary
修水印放大裁剪时，不能让 nvue `movable-view` 移动根在 pinch move 中每帧跟随预览帧，否则会出现严重忽大忽小闪烁。

### Error
```text
捏合放大缩小会抽搐：水印一会儿大、一会儿小，并且闪烁。
```

### Context
- Operation: Android 真机相机页水印双指捏合缩放。
- Surface: `pages/cameraX/index.nvue`
- Trigger: C12 防裁剪方案让 `watermarkMoveX/Y` 和 `watermarkBoxStyle` 每帧读取 `watermarkPinchPreviewFrame()` / `commitFrame`，反向驱动原生 `movable-view` 根的 `x/y/width/height`。
- Root cause: nvue 原生 `movable-view` 本身也在处理手势状态，页面再用预览帧每帧改移动根布局，会和原生手势互相抢状态，导致缩放忽大忽小。
- Correct route: pinch 期间把 `movable-view` 固定成整个水印编辑区域画布，`x/y` 固定为 `0`；只让内部 `watermarkTransformBox` 读取 `watermarkPinchPreviewFrame()` 来定位和变大。

### Suggested Fix
保持三层分工：`movable-area` 是编辑范围；pinch 期间 `movable-view` 是稳定全区域画布；`watermarkTransformBox` 才是读取预览帧并变化的视觉层。禁止恢复 `return this.watermarkMovePositionFromFrame(pinchFrame).x/y` 或在 `updateWatermarkPinch()` 中调用 `updateWatermarkFrame()`、`scheduleWatermarkSync()`、`syncWatermarkToNative()`、`flushWatermarkSync()`。

### Metadata
- Reproducible: yes
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs, .learnings/LEARNINGS.md
- See Also: LRN-20260623-C13, LRN-20260622-C12, LRN-20260622-C10

### Resolution
- **Resolved**: 2026-06-23T00:38:22+08:00
- **Commit/PR**: pending
- **Notes**: Code-level fix added: `watermarkMoveX/Y` return `0` during pinch, root size is the edit area, visual transform box reads the preview frame. `npm test` and `git diff --check` passed; N9500 true-device confirmation is still required.

---

## [ERR-20260623-002] front_camera_preview_upside_down

**Logged**: 2026-06-23T11:01:56+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Android Camera1 前置摄像头预览不能和拍照 JPEG rotation 共用同一个旋转公式，否则切到前摄后人物可能上下颠倒。

### Error
```text
切换的前置摄像头人物是上下颠倒的。
```

### Context
- Operation: Android 真机相机页切换到前置摄像头。
- Surface: `uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt`
- Trigger: `setDisplayOrientation()` 和 `Camera.Parameters.setRotation()` 共用 `resolveCameraRotationDegrees()`。
- Root cause: Camera1 前置预览需要按 `setDisplayOrientation()` 的前摄镜像补偿公式处理；JPEG capture rotation 仍是另一套公式。共用函数把前摄预览角度算反。

### Suggested Fix
保留两个函数：`resolveCameraDisplayOrientationDegrees()` 专门给 `setDisplayOrientation()`，前摄用 `(360 - ((orientation + displayRotation) % 360)) % 360`；`resolveCameraCaptureRotationDegrees()` 专门给 `parameters.setRotation()`，不要再合并。

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- See Also: LRN-20260623-C14

### Resolution
- **Resolved**: 2026-06-23T11:01:56+08:00
- **Commit/PR**: pending
- **Notes**: Split preview display orientation from capture rotation and added structure tests for both formulas. `npm test` and `git diff --check` passed; Android true-device confirmation is still required.

---

## [ERR-20260623-003] hbuilderx_android_compile_no_progress

**Logged**: 2026-06-23T11:14:36+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
HBuilderX Android compile-mode CLI can hang after printing only the version line, so it must not be counted as a successful compile verification.

### Error
```text
11:14:36.891 HBuilderX Version: 5.07
```

### Context
- Command: `/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/chaixixi/od/uts-markvideo --compile true --continue-on-error false --pagePath pages/cameraX/index`
- Result: no compile success/failure output after roughly two minutes; command was interrupted with Ctrl-C.
- Follow-up: `cli lsp lint --file .../XycNativeCameraView.kt --project /Users/chaixixi/od/uts-markvideo --platform app-android` returned `Cannot read properties of null (reading 'start')` instead of native diagnostics.
- Impact: UTS/Kotlin syntax for `XycNativeCameraView.kt` still needs HBuilderX or true-device compile confirmation outside Node structure tests.

### Suggested Fix
Use HBuilderX IDE run-to-Android or a known-good CLI session with device/IDE state ready before treating native plugin compilation as verified. Keep `npm test` and `git diff --check` as narrow static checks only.

### Metadata
- Reproducible: unknown
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, pages/cameraX/index.nvue
- See Also: LRN-20260623-C17

---

## [ERR-20260623-004] front_camera_photo_left_right_mirrored

**Logged**: 2026-06-23T11:26:37+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
前置摄像头成片左右颠倒，因为输出保存路径只处理了方向旋转，没有对前摄源图/源帧做水平反镜像。

### Error
```text
前置的摄像头的成片还是左右颠倒的。
```

### Context
- Operation: Android 真机相机页切换前摄后拍摄并查看相册成片。
- Surface: `uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt`
- Root cause: 初次修复只冻结了 `requestedCameraFacing`，真机反馈说明前摄成片仍可能没有进入正确的反镜像分支，或还需要设备侧确认实际帧方向。
- Correct route: freeze the actual active camera facing from `activeCameraId`, apply front-camera horizontal unmirror before drawing watermark and before JPEG/video encoding, then verify on a real Android device.

### Suggested Fix
Keep the front-camera output transform before watermark drawing for both photo and recording frames. Use the active camera id as the source of truth for front/back state; do not solve this by flipping the final full bitmap after watermark burn-in, because that would mirror watermark text too.

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- See Also: LRN-20260623-C18, ERR-20260623-002

### Resolution
- **Resolved**: pending true-device verification
- **Commit/PR**: pending
- **Notes**: Added `applyFrontCameraOutputMirror()` for photos, `applyFrontCameraFrameMirrorIfNeeded()` for recording frames, switched the capture-time facing snapshot to `activeCameraFacing()`, and kept regression guards in `test/structure.test.mjs`. True-device confirmation is still required.

---

## [ERR-20260623-006] android_record_stop_audio_thread_join_race

**Logged**: 2026-06-23T22:17:52+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
启用录像音频后，停止录像可能失败，因为 `finish()` 只等待音频编码线程 1.5 秒，但音频线程自身最多会用 5 秒完成 EOS 和 drain。

### Error
```text
用户反馈：现在录像有bug了，录像停止失败
```

### Context
- Surface: `uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt`
- Root cause: `audioThread?.join(max(1L, min(1500L, deadlineMs - System.currentTimeMillis())))` 可能提前返回，随后 `muxer.stop()` / `muxer.release()` 与音频线程继续写轨形成竞态。
- Fix: wait for the audio thread for the remaining `FINISH_TIMEOUT_MS` window before stopping/releasing the muxer.

### Suggested Fix
Keep audio encoder shutdown and muxer shutdown serialized. Do not reintroduce a shorter audio join cap unless a device log proves the audio thread cannot finish within the recorder deadline.

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs

### Resolution
- **Resolved**: 2026-06-23T22:17:52+08:00
- **Commit/PR**: pending
- **Notes**: Kept video start/stop feedback sounds but moved them outside the microphone capture window, serialized audio thread shutdown before muxer release, and kept regression guards in `test/structure.test.mjs`.

---

## [ERR-20260623-010] adb_path_not_in_shell_path

**Logged**: 2026-06-23T22:17:21+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
`adb` was not available on the shell `PATH`, so device screenshots and device queries needed the explicit Android SDK path.

### Error
```text
zsh:1: command not found: adb
```

### Context
- Operation: ran `adb devices` from the project workspace shell.
- Environment: macOS workspace with Android SDK installed at `$HOME/Library/Android/sdk/platform-tools/adb`.

### Suggested Fix
Use the explicit SDK path for adb in this workspace, or add `platform-tools` to PATH before trying device capture commands.

### Metadata
- Reproducible: yes
- Related Files: N/A

### Resolution
- **Resolved**: 2026-06-23T22:17:21+08:00
- **Notes**: Continued with `/Users/chaixixi/Library/Android/sdk/platform-tools/adb` for all device work.

---

## [ERR-20260623-011] android_record_start_first_packet_stall_low_bitrate

**Logged**: 2026-06-23T23:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Android 真机录像开头第一帧被拉长约 1.4 秒，输出仍落在 `480x640` 和约 `2.7-3.1 Mbps`。

### Error
```text
用户反馈：视频现在的码率有点低，另外还是会卡开头一秒，还会听到录像开始的提示音。
```

### Context
- Surface: `uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt`
- Evidence: 从设备 `/sdcard/Movies/xyc-markvideo/` 拉取最近两个 mp4 后，`ffprobe` 显示视频流为 `480x640`，整体码率约 `2701836` / `3100061` bps；视频 packet 开头为 `0.000000 ... duration=1.449944` 和 `duration=1.401467`。
- Root cause: 输出尺寸仍跟随 Camera1 `supportedVideoSizes`，没有按实际预览框尺寸编码；录像启动窗口内的早期帧和早期麦克风采样也会把不稳定首帧/开始反馈写入成片。

### Suggested Fix
录像输出尺寸应优先取 `previewView.width/height` 再做上限约束；视频 PTS 以第一帧为 0、后续按真实帧间隔递增；启动阶段丢弃短预热窗口内的视频帧和音频采样，避免开始反馈和不稳定首帧进入 muxer。

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- See Also: LRN-20260623-C25, LRN-20260623-C24

### Resolution
- **Resolved**: 2026-06-23T23:05:00+08:00
- **Commit/PR**: pending
- **Notes**: Recording now uses preview view dimensions with a 960-long-edge/691,200px cap, targets 12-30 Mbps with CBR when supported, skips a 700ms startup warmup window, discards warmup audio reads, and timestamps video from the first encoded frame using real elapsed time.

---

## [ERR-20260624-003] uvue_runtime_class_cast_after_compile

**Logged**: 2026-06-24T19:20:14+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
uni-app x Android compile passed, but phone launch crashed because page code cast storage strings and generated component refs to custom UTS types at runtime.

### Error
```text
java.lang.ClassCastException: java.lang.String cannot be cast to UTSJSONObject
java.lang.ClassCastException: uts.sdk.modules.xycMarkvideo.XycMarkvideoElement cannot be cast to NativeCameraRef
```

### Context
- Operation: launched the app on an Android debug base after `项目 uts-markvideo UTS编译完毕`.
- Surface: `pages/index/index.uvue`, `pages/cameraX/index.uvue`
- Root cause: `uni.getStorageSync()` may return a serialized string, not a `UTSJSONObject`; `$refs['nativeCamera']` returns the generated `XycMarkvideoElement`, and casting it to a page-local structural type triggers JVM `ClassCastException`.

### Suggested Fix
Parse storage through a string/object tolerant helper and construct `WatermarkTemplate` field by field. Do not cast component refs to custom page-local types; import the generated UTS component Element type and cast refs to that real runtime type before calling exposed methods.

### Metadata
- Reproducible: yes
- Related Files: pages/index/index.uvue, pages/cameraX/index.uvue, test/structure.test.mjs

### Resolution
- **Resolved**: 2026-06-24T19:20:14+08:00
- **Commit/PR**: pending
- **Notes**: Added storage parsing helpers, persisted watermark templates as JSON strings, replaced the runtime `NativeCameraRef` cast with the generated `XycMarkvideoElement` ref type, and added structure-test guards against reintroducing the bad casts.

---

## [ERR-20260624-004] uvue_touch_event_and_haptic_compile_gates

**Logged**: 2026-06-24T19:52:23+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
After the `.uvue` migration compiled once, Android runtime/build logs exposed that touch events and page-level haptics cannot be treated like classic nvue/JS objects.

### Error
```text
java.lang.ClassCastException: UniTouchEvent cannot be cast to UTSJSONObject
error: Unresolved reference ... source[names[i]]
error: 请检查 uni.vibrateShort 的拼写是否正确，或确认当前 HBuilderX 版本在当前平台是否支持此 API。
```

### Context
- Surface: `pages/cameraX/index.uvue`, `uni_modules/xyc-markvideo/utssdk/app-android/index.vue`, `uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt`
- Root cause: uni-app x touch callbacks receive `UniTouchEvent` / `UniTouch` classes, so casting the event or touches to `UTSJSONObject` can crash or fail compilation. Native/component event shells have the same risk; do not treat a runtime event class as a JSON object. In HBuilderX 5.07, direct page use of `uni.vibrateShort` was rejected during App Android UTS compile even though docs list the API.
- Fix direction: type touch handlers as `UniTouchEvent`, read `UniTouch.pageX/clientX/screenX/pageY/clientY/screenY` directly, make the `xyc-markvideo` component emit JSON payloads and page handlers receive `UTSJSONObject` payloads, and route page haptic feedback through the generated `xyc-markvideo` native component ref.

### Suggested Fix
Do not parse `UniTouchEvent`, `UniTouch`, or native/component event shells through JSON/dynamic-object helpers. If a component normalizes native callbacks with `$emit`, type the page handler to the emitted payload instead of the original event shell. Keep native-only feedback behind the UTS component surface, e.g. `nativeCamera.performHapticFeedback(type)`, and verify with HBuilderX compile plus `lastBuild` logs.

### Metadata
- Reproducible: yes
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs, uni_modules/xyc-markvideo/utssdk/app-android/index.vue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt

### Resolution
- **Resolved**: 2026-06-24T19:52:23+08:00
- **Commit/PR**: pending
- **Notes**: Added an independent runtime-cast regression subtest, changed touch helpers to `UniTouchEvent`/`UniTouch`, changed native camera event handlers to receive the component-emitted `UTSJSONObject` payload, added Android native `performHapticFeedback`, removed page-level `uni.vibrateShort`, and verified `npm test` 33/33, `git diff --check`, and HBuilderX `项目 uts-markvideo UTS编译完毕`.

---

## [ERR-20260624-005] structure_test_zoom_assertion_drift

**Logged**: 2026-06-24T21:51:01+08:00
**Priority**: high
**Status**: pending
**Area**: tests

### Summary
During the flash pre-commit audit, full `structure.test.mjs` verification failed because a zoom queue assertion no longer matches the current `pages/cameraX/index.uvue` implementation.

### Error
```text
node --test test/structure.test.mjs
not ok - cameraX uvue page owns UI and calls xyc-markvideo native camera methods
The input did not match the regular expression /const targetMode = normalizeUiZoomMode\(mode\)...this.nativeStatus = targetMode === this.zoomMode ? this.zoomModeLabel(targetMode) : '焦段切换中'.../
```

### Context
- Operation: flash fix pre-commit audit and verification.
- Surface: `test/structure.test.mjs`, `pages/cameraX/index.uvue`
- The flash-specific Android native view subtest passes, but the full structure suite fails before commit readiness because the test still expects an older zoom pending/status flow.
- `npm test -- test/structure.test.mjs` is not a narrow structure-only command in this repo; it expands through the script to `node --test test/*.test.mjs test/structure.test.mjs`.

### Suggested Fix
Align the zoom queue assertions with the current `setZoomMode()` behavior, or intentionally restore the expected status behavior in `pages/cameraX/index.uvue` if the test describes the desired product contract. Keep flash-only staging patch-level until this unrelated test drift is resolved.

### Metadata
- Reproducible: yes
- Related Files: test/structure.test.mjs, pages/cameraX/index.uvue

### Follow-up
- **Seen Again**: 2026-06-24T21:54:54+08:00
- **Context**: Video/photo mode switch slider pre-commit audit again produced `npm test` 32/33 with the same failing zoom queue assertion at `test/structure.test.mjs:703`; mode-switch-specific checks passed.

---

## [ERR-20260624-006] hbuilderx_run_state_and_incomplete_app_android_cache

**Logged**: 2026-06-24T22:23:44+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
HBuilderX App Android verification became blocked by stale run services and then an incomplete `.app-android` generated cache.

### Error
```text
运行状态错误，请重试
error: Source file or directory not found: /Users/chaixixi/od/uts-markvideo/unpackage/cache/.app-android/src/index.kt
error: Source file or directory not found: /Users/chaixixi/od/uts-markvideo/unpackage/cache/.app-android/src/pages/cameraX/index.kt
error: Source file or directory not found: /Users/chaixixi/od/uts-markvideo/unpackage/cache/.app-android/src/pages/index/index.kt
```

### Context
- Operation: commit-prep verification after cameraX zoom/layout fixes.
- First, `cli launch app-android --compile true` returned `运行状态错误，请重试` while old `uniapp-cli-vite -p app`, Java UTS compiler, and many launcher `httpServer.js` processes were still alive.
- After terminating stale HBuilderX run child processes but leaving the HBuilderX main process alive, compile entered normal work but failed because `unpackage/cache/.app-android/src` generated Kotlin files were missing.
- A separate HBuilderX run process later appeared for `--pagePath pages/cameraX/index`, so IDE-side run state may still be rebuilding asynchronously.

### Suggested Fix
Before final device verification, let any active HBuilderX run process finish or restart HBuilderX cleanly, then rebuild the uni-app x Android cache from a clean run. Do not claim final device verification from screenshots taken before the latest code has been rebuilt and installed.

### Metadata
- Reproducible: unknown
- Related Files: pages/cameraX/index.uvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs

### Resolution
- **Resolved**: 2026-06-24T23:00:09+08:00
- **Commit/PR**: pending
- **Notes**: Let the active HBuilderX build finish, then reran `cli launch app-android --project /Users/chaixixi/od/uts-markvideo --deviceId ce081718f2646039057e --continue-on-error false --pagePath pages/cameraX/index`. The build reached `项目 uts-markvideo UTS编译完毕`, synced files, and launched `pages/cameraX/index`.

---

## [ERR-20260624-007] structure_test_camera_mainline_drift

**Logged**: 2026-06-24T15:31:38Z
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
Full `npm test` failed during focal-length linkage verification because `test/structure.test.mjs` still had stale assertions for older cameraX watermark and Android preview implementations.

### Error
```text
npm test
not ok - cameraX uvue page owns UI and calls xyc-markvideo native camera methods
Expected old watermark/movable-area and SurfaceView/PixelCopy patterns that no longer match current .uvue and TextureView code.
```

### Context
- Operation: commit-prep verification after fixing zoom selected-state fallback.
- Current source uses a normal `view.watermarkLayer` with page touch math, and Android preview uses `TextureView.SurfaceTextureListener` plus `previewView.getBitmap`.
- The failing assertions were unrelated to the focal-length item linkage, but blocked the full repository test suite.

### Suggested Fix
Keep structure tests aligned with the current active mainline when `.uvue`/native camera implementation changes, and prefer narrow behavior assertions around the regression being fixed.

### Metadata
- Reproducible: yes
- Related Files: test/structure.test.mjs, pages/cameraX/index.uvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt

### Resolution
- **Resolved**: 2026-06-24T15:42:00Z
- **Commit/PR**: pending
- **Notes**: Updated `test/structure.test.mjs` to track the current `.uvue` camera mainline and TextureView preview implementation. Full `npm test` now passes 35/35 after the focal-length selected-state regression fix.

---

## [ERR-20260624-008] zsh_status_variable_and_exa_key_missing

**Logged**: 2026-06-24T15:34:20Z
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
Two verification helper commands failed for tooling reasons unrelated to the mode switch code.

### Error
```text
zsh:1: read-only variable: status
web_search_exa error (401): API key must be provided as an argument or as an environment variable (EXA_API_KEY)
```

### Context
- Operation: video/photo segmented-control visual fix verification.
- The first failure came from using `status` as a shell variable name in zsh while combining `git diff --check` commands.
- The second failure came from trying to use Exa web search for Apple segmented-control references without an Exa API key configured.
- The whitespace checks were rerun with non-conflicting variable names and passed.

### Suggested Fix
Use variable names like `rc1`/`rc2` in zsh helper commands. Treat Exa as optional unless `EXA_API_KEY` is configured; use official docs or Context7 where available.

### Metadata
- Reproducible: yes
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs

---

## [ERR-20260624-009] structure_test_layout_contract_stale

**Logged**: 2026-06-24T23:56:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
After tightening the cameraX top and bottom layout constants, the first `npm test` rerun failed because structure tests still asserted the previous layout contract.

### Error
```text
npm test
not ok - cameraX uvue page owns UI and calls xyc-markvideo native camera methods
Expected /const CAMERA_TOP_BAR_HEIGHT = 64/ after source had moved to 60.
not ok - camera viewport keeps a full-width 3:4 area below the top controls
Expected old bottom panel heights after top bar height changed.
```

### Context
- Operation: cameraX layout tightening before device verification.
- Source changed intentionally: top bar height moved from 64 to 60, bottom main controls use a min/max top clamp.
- The test failure was useful: it prevented claiming the new layout until the structural contract was updated.

### Suggested Fix
When layout constants are part of the behavior contract, update tests to assert the new constants and the formula that prevents high-screen bottom whitespace from expanding unchecked.

### Metadata
- Reproducible: yes
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs

### Resolution
- **Resolved**: 2026-06-24T23:58:00+08:00
- **Commit/PR**: pending
- **Notes**: Updated `test/structure.test.mjs` to assert top bar 60, top control offsets 16, bottom control min/max clamp, and new remaining-panel heights. `npm test` now passes 35/35.

---

## [ERR-20260625-002] android_muxer_stop_audio_pts_regression

**Logged**: 2026-06-25T00:42:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
N9500 录像停止失败的直接原因是音频 track 写入 MediaMuxer 的时间戳回退，触发 `MediaMuxer.stop()` invalid state。

### Error
```text
MPEG4Writer: do not support out of order frames (timestamp: 5989216 < last: 5995357 for Audio track
MediaMuxer: stop() is called in invalid state 3
XycMarkVideo: record stop failed during finish: stage=muxer_stop; frames=80; videoSamples=80; audioSamples=260
```

### Context
- Operation: 用户反馈“现在录像停止失败”后拉取 SM-N9500 / Android 9 logcat。
- The stop path did write media samples: video had 80 encoded samples and audio had 260 samples, so this was not a zero-frame or missing-permission failure.
- Root cause candidate: audio sample PTS currently comes from wall-clock `audioPresentationTimeUs()` and is written without a per-track monotonic clamp, unlike video PTS which is guarded by `lastVideoPresentationTimeUs`.

### Suggested Fix
Track the last written audio presentation timestamp and clamp audio muxer writes to a strictly increasing value before `writeSampleData`. Keep the muxer stop diagnostics because it exposed the real failing track.

### Metadata
- Reproducible: yes
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt
- See Also: ERR-20260623-007

---

## [ERR-20260625-003] bottom_panel_style_regex_overmatch

**Logged**: 2026-06-25T01:07:46+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The first regression guard for the cameraX bottom panel color failed because a broad regex crossed into later style blocks containing unrelated `rgba(...)` values.

### Error
```text
npm test
not ok - cameraX uvue page owns UI and calls xyc-markvideo native camera methods
Expected source not to match /\.bottomPanel \{[\s\S]*background-color: rgba/
```

### Context
- Operation: adding a guard that `.bottomPanel` stays opaque while fixing Android bottom system navigation color mismatch.
- The source was already `background-color: #e2e6e4;` inside `.bottomPanel`, but the greedy pattern continued past `.modeSwitchWrap` into later controls that legitimately use semi-transparent white backgrounds.

### Suggested Fix
For style-block assertions, extract the selector block with `findStyleBlock(page, '.selector')` before checking presence or absence of declarations. Do not run negative `[\s\S]*` regexes across an entire `.uvue` source when later selectors may contain valid matches.

### Metadata
- Reproducible: yes
- Related Files: test/structure.test.mjs, pages/cameraX/index.uvue

### Resolution
- **Resolved**: 2026-06-25T01:07:46+08:00
- **Commit/PR**: pending
- **Notes**: Scoped the assertions to `findStyleBlock(page, '.bottomPanel')` and reran the test suite.

---
