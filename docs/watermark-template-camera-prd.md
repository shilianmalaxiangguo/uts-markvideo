# 水印模板相机 PRD

## 背景

当前 `markvideo-mvp` 主线已经切到 `pages/index/index.nvue`、`pages/cameraX/index.nvue` 和 `uni_modules/xyc-markvideo`。本阶段在原生相机跑通的基础上接入水印能力，先做 Android。

老 PRD 中的远程 Logo、独立设置页和旧 `recordWatermarkVideo` API 只作为历史参考，不作为本轮实现入口。

## 目标

- 首页提供水印设置入口，并用全局弹层展示 3 个模板。
- 模板支持纯文字、纯图片、图片加文字。
- 选中的模板传入 `pages/cameraX/index.nvue`。
- 相机页右侧控制按钮改为圆形 `印` 按钮。
- 点击 `印` 可以在相机页内重新选择模板。
- 相机预览上最多显示 1 个可编辑水印，为后续多个水印保留数组结构。
- 水印支持拖拽、缩放、旋转、删除。
- 拍照输出必须把当前水印烧录到照片文件。
- 录像开始时冻结当前水印快照，界面实时显示水印，并把水印烧录到视频文件。

## 非目标

- 本阶段不做水印模板编辑器，只选择预设模板。
- 本阶段不做多个水印同时存在，最多 1 个。
- 本阶段不做远程模板商店、远程 Logo 接口、云上传。
- 本阶段不切到完整 Camera2/CameraX + OpenGL 生产管线，先用 Android O+ 的 `PixelCopy` 帧复制方案完成水印视频文件闭环。

## 关键技术约束

Android 录像不能再使用 `MediaRecorder.VideoSource.CAMERA` 直录作为水印输出路径；这个管线没有逐帧绘制入口，页面 overlay 也不会进入 MP4 文件。

因此本轮 Android 交付改为：

- 页面预览：相机页通过 `cover-view` 实时显示水印，可在录像中看到。
- 照片输出：Android 原生在 JPEG 回调后解码 Bitmap，用 Canvas 绘制水印，再重新编码保存。
- 视频输出：Android 原生通过 `PixelCopy` 从相机预览 Surface 按目标帧率取帧，用 Canvas 绘制冻结水印，再用 `MediaCodec` 编码 H.264；音频使用 `AudioRecord` 编码 AAC，最后通过 `MediaMuxer` 合成 MP4。
- 水印模板存在且帧级编码成功时，视频结果标记 `watermarkVideoBurnIn=true`。
- Android O 以下不支持当前 `PixelCopy` 录像水印管线，应明确返回错误，不退回无水印直录。

## 模板字段

模板对象字段保持扁平，便于 UTS bridge 和 Android/iOS 统一处理。

| 字段 | 类型 | 说明 |
|---|---|---|
| `templateId` | string | 模板 ID。 |
| `templateName` | string | UI 标题。 |
| `templateType` | string | `text`、`image`、`mixed`。 |
| `mainTitleText` | string | 主标题。 |
| `subtitleText` | string | 副标题。 |
| `mainTitleColor` | string | 主标题颜色，支持 `#RRGGBB`、`#AARRGGBB`、`rgba(...)`。 |
| `subtitleColor` | string | 副标题颜色。 |
| `mainTitleFontSize` | number | 主标题字号，逻辑像素。 |
| `subtitleFontSize` | number | 副标题字号，逻辑像素。 |
| `mainTitleBold` | boolean | 主标题是否加粗。 |
| `subtitleBold` | boolean | 副标题是否加粗。 |
| `imagePath` | string | 图片路径，本阶段默认 `/static/watermark/logo2.png`，页面传给原生前尽量解析为可读本地路径。 |
| `imageWidth` | number | 图片显示宽度。 |
| `imageHeight` | number | 图片显示高度。 |
| `imageTextGap` | number | 图片和文字间距。 |
| `boxWidth` | number | 水印框宽度比例。 |
| `boxHeight` | number | 水印框高度比例。 |
| `boxBackgroundColor` | string | 背景色。 |
| `boxRadius` | number | 背景圆角。 |
| `boxPadding` | number | 内边距。 |
| `opacity` | number | 透明度。 |
| `positionX` | number | 左上角横向比例坐标。 |
| `positionY` | number | 左上角纵向比例坐标。 |
| `scale` | number | 缩放，默认 `1`。 |
| `rotation` | number | 旋转角度，单位度。 |

## 默认模板

1. `text-delivery`：纯文字模板，白色半透明背景，主标题加粗。
2. `image-logo`：纯图片模板，使用 `/static/watermark/logo2.png`。
3. `mixed-site`：图片加文字模板，左图右文字。

## 首页行为

- 首页显示 `水印设置` 和 `进入相机`。
- 点击 `水印设置` 打开全局弹层。
- 弹层中每个 item 必须显示缩略图和标题。
- 选择模板后保存到 `xyc-camera-watermark-template`。
- 点击 `进入相机` 时，如果已有选择，把模板写入 storage 后进入 `pages/cameraX/index.nvue`。

## 相机页行为

- 右侧控制按钮显示 `印`，不是重启。
- 点击 `印` 打开模板选择弹层。
- 如果已从首页传入模板，弹层中对应 item 显示选中态。
- 选择模板后立即显示水印 overlay 并同步到原生。
- 删除后清除页面 overlay，并调用 `clearWatermark()`。
- 拖拽、缩放、旋转结束后调用 `setWatermark()` 更新原生快照。
- 录像中冻结水印，禁止删除、切换、拖拽、缩放和旋转。

## 输出结果

照片结果至少包含：

- `tempFilePath`
- `savedToAlbum`
- `albumPath`
- `albumUri`
- `watermarkTemplateId`
- `watermarkPositionX`
- `watermarkPositionY`
- `watermarkBoxWidth`
- `watermarkBoxHeight`
- `watermarkTemplateSnapshot`
- `watermarkPhotoBurnIn`

视频结果至少包含：

- `tempFilePath`
- `savedToAlbum`
- `albumPath`
- `albumUri`
- `durationMs`
- `fps`
- `watermarkTemplateId`
- `watermarkPositionX`
- `watermarkPositionY`
- `watermarkBoxWidth`
- `watermarkBoxHeight`
- `watermarkTemplateSnapshot`
- `watermarkVideoBurnIn`

`watermarkVideoBurnIn=true` 表示本段视频在原生帧级编码路径中写入了当前冻结水印；无水印模板时该字段为 `false`。

## 验收

- 首页可打开水印设置弹层并选择 3 个模板。
- 相机页能显示从首页传入的模板。
- 相机页 `印` 按钮能重新打开模板弹层。
- 预览水印可拖拽、缩放、旋转、删除。
- 录像中水印不可编辑，界面继续显示冻结水印。
- 拍照后相册照片可看到水印。
- 选中水印后录像，视频结果返回水印快照和 `watermarkVideoBurnIn=true`，相册回放可看到水印。
- `npm test` 通过。
- nvue/UTS 页面不使用 `margin auto`。
