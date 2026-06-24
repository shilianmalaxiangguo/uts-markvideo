# uts-markvideo

这是一个用于验证 uni-app / UTS 相机能力的 Native App MVP：打开相机、预览水印、录制、停止，并返回已经烧录水印的本地媒体文件。

## 当前工作流

- 只在 `/Users/chaixixi/od/uts-markvideo` 这个目录继续开发。
- 当前开发分支是 `markvideo-mvp-uvue`。
- 目前常用短分支是 `dev`、`markvideo-mvp`、`markvideo-mvp-uvue`、`markvideo-plugin`；这些分支都从 iOS 分支基线创建。
- 不再继续在 `/Users/chaixixi/od/uts-markvideo-android` 做功能开发；旧目录已移到 `/Users/chaixixi/od/uts-markvideo-android.backup`，只用于恢复旧 stash 或历史参考。
- MVP 阶段的活跃实现已经切到 `uni_modules/xyc-markvideo`。
- 旧 `uni_modules/uts-markvideo`、`pages/index/index.vue`、`pages/camera/camera.vue` 路线已经废弃，不要恢复。
- `/Users/chaixixi/od/UniAppX-iOS@5.07/` 是本机 iOS offline SDK/demo 包，不是主源码项目。
- 生成的 `unpackage/`、`www/` 和 offline SDK demo output 都不是源码；项目内 `uni_modules/` 在包含活跃插件实现时就是源码，应该纳入提交。

## MVP 验证目标

- App 侧配置水印模板并进入相机业务页。
- 相机业务页通过 `xyc-markvideo` UTS 标准组件接入平台原生相机能力。
- 原生相机预览中可以看到水印。
- 页面负责拍照、录像和保存等业务控制。
- Android 侧当前实现包含 Camera legacy preview、`PixelCopy`、`AudioRecord`、`MediaCodec`、`MediaMuxer`。
- iOS 侧当前只保留同名组件骨架，后续再补齐原生实现。
- 不涉及 push-stream、RTMP、WebRTC 服务端。

这个 MVP 的目标是先证明产品闭环：水印模板、拍照、录像、保存、Android 真机体验。等流程稳定后，再考虑把 Android 帧处理替换为 OpenGL 或 CameraX effect pipeline，把 iOS 水印处理补齐并继续优化为 Metal/CoreImage 等生产方案。

## 运行方式

1. 用 HBuilderX 打开 `/Users/chaixixi/od/uts-markvideo`。
2. 确认当前分支是 `markvideo-mvp-uvue`。
3. 运行到 Android App。
4. 在首页打开水印设置，选择纯文字、纯图片或图文模板。
5. 进入 `cameraX` 相机业务页。
6. 验证预览水印可拖拽、缩放、旋转、删除。
7. 验证拍照、录像、保存后的本地媒体是否带有水印。

## 重要路径

- `pages.json` - 页面入口配置。
- `App.uvue` / `main.uts` - uni-app x 应用入口。
- `pages/index/index.uvue` - 首页，负责选择水印模板并进入相机流程。
- `pages/cameraX/index.uvue` - 当前相机业务页，负责 UI、权限触发、闪光灯、拍照/录像按钮和水印交互。
- `camera-prototype.html` - 原型参考，不是运行时代码。
- `docs/watermark-template-camera-prd.md` - 当前 Android 水印模板相机阶段 PRD。
- `docs/embedded-camera-component-prd.md` - 嵌入式水印相机组件的跨端长期合同。
- `docs/api.md` - 历史 API 迁移说明，不是当前 MVP 的功能清单。
- `uni_modules/xyc-markvideo/package.json` - UTS 标准组件插件元数据。
- `uni_modules/xyc-markvideo/utssdk/app-android/index.vue` - Android UTS 组件桥接入口。
- `uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt` - Android 原生相机 View，负责预览、拍照、录像、相册保存和水印烧录。
- `uni_modules/xyc-markvideo/utssdk/app-ios/index.vue` - iOS 同名组件骨架，当前包元数据暂不声明 iOS 支持。

## 分支约定

- `dev`：阶段性集成分支。
- `markvideo-mvp`：当前 MVP 基线分支。
- `markvideo-mvp-uvue`：从 `markvideo-mvp` 拆出的 uni-app x / `.uvue` 迁移分支，先保持 Android 闭环，iOS 后续补齐。
- `markvideo-plugin`：MVP 稳定后再抽取 `uni_modules/xyc-markvideo` 的插件化分支。
- 旧 `ios`、`android`、`android-sn9500` 分支只作为历史参考，不再作为当前主开发入口。

## GitHub Actions 打包

`.github/workflows/cloud-package.yml` 提供手动触发的 GitHub Actions 云打包流程，使用官方 HBuilderX Linux CLI：

1. 下载 HBuilderX Linux CLI。
2. 执行 `cli open`。
3. 登录 DCloud。
4. 导入当前项目。
5. 生成临时 `cli pack --config` JSON 文件。
6. 从 `unpackage/` 上传生成的 APK、AAB、IPA、WGT 等产物。

仓库变量：

- `ANDROID_PACKAGE_NAME`，例如 `com.example.utsmarkvideo`
- `IOS_BUNDLE_ID`，例如 `com.example.utsmarkvideo`
- `ANDROID_CERT_ALIAS`，仅在使用自有 Android keystore 时需要
- `IOS_SUPPORTED_DEVICE`，可选，默认 `iPhone`
- `IOS_CHANNELS`，可选，默认 `phone`
- `HBUILDERX_URL`，可选，默认使用当前官方 Linux CLI release

仓库 secrets：

- `DCLOUD_USERNAME`
- `DCLOUD_PASSWORD`
- `ANDROID_CERT_BASE64`，仅当 `android_pack_type` 为 `0` 时需要
- `ANDROID_CERT_PASSWORD`，仅当 `android_pack_type` 为 `0` 时需要
- `ANDROID_STORE_PASSWORD`，仅当 `android_pack_type` 为 `0` 时需要
- `IOS_PROFILE_BASE64`，仅当 `ios_prisonbreak` 为 `false` 时需要
- `IOS_CERT_BASE64`，仅当 `ios_prisonbreak` 为 `false` 时需要
- `IOS_CERT_PASSWORD`，仅当 `ios_prisonbreak` 为 `false` 时需要

证书文件写入 GitHub secrets 前需要先做 base64 编码。该 workflow 默认使用安全的打包配置和 Android DCloud 云证书模式，也就是 `android_pack_type=3`。

iOS 真机烟测如果使用 AltStore 一类自签安装工具，可以运行 `platform=ios` 并保持 `ios_prisonbreak=true`。这种模式会请求 DCloud iOS prisonbreak 包，不需要 `IOS_PROFILE_BASE64`、`IOS_CERT_BASE64`、`IOS_CERT_PASSWORD`。只有需要 DCloud 使用 Apple 证书签 IPA 时，才把 `ios_prisonbreak` 关掉。
