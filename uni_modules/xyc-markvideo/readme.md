# xyc-markvideo

`xyc-markvideo` 是一个 UTS 标准组件模板插件，用于承载多端原生相机 UI。当前版本先实现 Android 原生相机预览、拍照、30fps 录像、闪光灯和单水印烧录；iOS 先保留同名组件骨架，后续按同一表面补齐。

当前初版范围：

- `pages/index/index.uvue`：uni-app x 首页，选择水印模板并跳转到 cameraX。
- `pages/cameraX/index.uvue`：相机 UI 页，挂载 `xyc-markvideo` 组件。
- `utssdk/app-android/index.vue`：Android UTS 组件桥接入口。
- `utssdk/app-android/XycNativeCameraView.kt`：Android 原生相机 View，负责预览、拍照、录像、相册保存和水印烧录。
- `utssdk/app-ios/index.vue`：iOS 同名组件骨架，暂不在包元数据中声明支持。
- Android 权限由项目根 `manifest.json` 统一声明，插件侧不再携带 `utssdk/app-android/AndroidManifest.xml`，避免标准基座把插件识别为依赖额外原生配置。
- 组件名：`xyc-markvideo`。
- 事件：`nativeviewready`、`cameraready`、`nativeerror`、`photodone`、`recordstart`、`recorddone`、`flashchange`、`zoomchange`、`camerachange`。
- 暴露方法：`setStatus(text)`、`switchMode(mode)`、`setFlashMode(mode)`、`setZoomMode(mode)`、`switchCamera()`、`setCameraSoundEnabled(enabled)`、`performHapticFeedback(type)`、`setWatermark(template)`、`clearWatermark()`、`takePhoto()`、`startRecord(options)`、`stopRecord()`、`openSystemAlbum(mediaUri)`、`restartCamera()`、`preparePermissions()`、`prepareRecordPermissions()`、`checkRecordPermissions()`、`destroyCamera()`。

### 开发文档
[UTS 语法](https://uniapp.dcloud.net.cn/tutorial/syntax-uts.html)
[UTS API插件](https://uniapp.dcloud.net.cn/plugin/uts-plugin.html)
[UTS uni-app兼容模式组件](https://uniapp.dcloud.net.cn/plugin/uts-component.html)
[UTS 标准模式组件](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-vue-component.html)
[Hello UTS](https://gitcode.net/dcloud/hello-uts)
