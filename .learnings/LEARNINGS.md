# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260622-001] best_practice

**Logged**: 2026-06-22T02:20:00Z
**Priority**: high
**Status**: resolved
**Area**: android-permissions

### Summary
Android 9 及以下保存照片/视频到相册时，宿主 `manifest.json` 和插件 `AndroidManifest.xml` 都要声明 `WRITE_EXTERNAL_STORAGE`。

### Details
在 `uts-markvideo` 的 `xyc-markvideo` 路线里，`saveMediaToLegacyAlbum()` 会在 API 28 及以下走旧式公共目录写入；如果只在原生插件里请求权限而宿主应用没声明 `WRITE_EXTERNAL_STORAGE`，真机上会出现“拍照/录像已生成但相册保存失败”的假成功。宿主层和插件层都要把这条权限写实，且限制到 `maxSdkVersion=28`。

### Suggested Action
后续只要看到 Android 9 及以下的相册保存异常，先检查 `manifest.json`、插件 `AndroidManifest.xml`、以及 `recordMissingPermissions()` 是否三处一致。

### Metadata
- Source: user_feedback
- Related Files: manifest.json, uni_modules/xyc-markvideo/utssdk/app-android/AndroidManifest.xml, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt
- Tags: android-permissions, legacy-album, write-external-storage
- Pattern-Key: uts_markvideo.android_legacy_album_permission
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T02:20:00Z
- **Commit/PR**: pending
- **Notes**: This is a host-manifest plus plugin-manifest contract, not just a runtime requestPermissions issue.

---

## [LRN-20260621-002] best_practice

**Logged**: 2026-06-21T15:51:28Z
**Priority**: high
**Status**: resolved
**Area**: tests

### Summary
验证 N9500 真机 UI 时，优先用 HBuilderX 自带 adb 直接截设备屏幕。

### Details
在 `uts-markvideo` 的 Android 真机调试中，HBuilderX 里看到的是 IDE 窗口和调试控制台，不适合作为页面 UI 验收证据。更稳定的做法是使用已连接的 samsung SM-N9500，通过 HBuilderX bundled adb 直接获取设备 framebuffer：

```bash
/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb exec-out screencap -p > screenshots/<name>.png
```

需要进入页面或点按钮时，配合同一路径下的 adb：

```bash
/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb shell input tap <x> <y>
```

### Suggested Action
后续本项目做相机 UI、授权状态、拍照/录像状态验收时，默认用 N9500 + HBuilderX bundled adb 的截图方式取证，并把截图保存在 `screenshots/` 下。HBuilderX 控制台只用于确认编译、同步、调试服务状态。

### Metadata
- Source: user_feedback
- Related Files: screenshots/
- Tags: hbuilderx, adb, n9500, android-ui, screenshot-verification
- Pattern-Key: uts_markvideo.n9500_adb_screenshot
- Recurrence-Count: 1
- First-Seen: 2026-06-21
- Last-Seen: 2026-06-21

### Resolution
- **Resolved**: 2026-06-21T15:51:28Z
- **Commit/PR**: pending
- **Notes**: The user confirmed this linked-device screenshot route is more stable and should be used going forward.

---

## [LRN-20260621-001] best_practice

**Logged**: 2026-06-21T15:40:38Z
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
uni-app x nvue 样式里不要用 `margin-left: auto`、`margin-right: auto` 或 `margin: auto` 做居中。

### Details
HBuilderX 5.07 的 nvue CSS 编译器会报错：`property value auto is not supported for margin-left/margin-right`。在 `pages/cameraX/index.nvue` 这类 App Android nvue 页面中，居中布局应改为外层容器控制，例如 `position: absolute; left: 0; right: 0; flex-direction: row; justify-content: center;`，或用固定宽度容器配合 flex 对齐，不能套用 Web CSS 的 `margin: auto` 居中习惯。

### Suggested Action
修改 nvue UI 前先检查是否引入 `margin auto`。结构测试已增加扫描 `pages` 和 `uni_modules/xyc-markvideo` 下 `.nvue/.vue` 文件的守卫，防止再次提交不兼容写法。

### Metadata
- Source: error
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: uni-app-x, nvue-css, hbuilderx-5.07, android-ui
- Pattern-Key: uniappx.nvue.margin_auto_unsupported
- Recurrence-Count: 1
- First-Seen: 2026-06-21
- Last-Seen: 2026-06-21

### Resolution
- **Resolved**: 2026-06-21T15:40:38Z
- **Commit/PR**: pending
- **Notes**: Current `cameraX` UI uses a full-width wrapper plus flex centering for the mode switch, and tests now forbid `margin auto` in active nvue/component surfaces.

---
