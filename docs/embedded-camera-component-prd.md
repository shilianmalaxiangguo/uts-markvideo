# 页面内嵌水印相机组件 PRD

## 背景

`uts-markvideo` 当前已经验证了原生相机预览、录制、拍照、水印渲染和文件输出等底层能力，但产品形态仍偏向打开独立原生录制页。

最终形态应该是页面内嵌原生相机组件：业务页面拥有自己的顶部信息、模板选择、拍照按钮、录像按钮、闪光灯、焦段切换和业务流程；原生组件只负责相机预览、照片和视频输出、水印预览与烧录、拖动坐标和原生错误回调。

本 PRD 是 Android 和 iOS 的共同实现契约。两端必须遵循同一业务接口、同一字段、同一事件、同一错误码和同一 UI 行为语义。

参考原型：[camera-prototype.html](../camera-prototype.html)

文档关系：本 PRD 是 Android 和 iOS 的唯一主契约。[api.md](api.md) 只说明历史 `recordWatermarkVideo` / `createWatermarkSample` API 与本 PRD 的迁移关系，不作为新组件功能清单。Android/iOS 分支历史文档中与本 PRD 不一致的内容一律不保留。

## 目标

- 支持把原生相机预览嵌入到业务页面的指定区域。
- 支持业务页面通过统一接口控制拍照、录像、闪光灯、焦段和水印模板。
- 支持照片和视频都叠加同一套当前水印模板。
- 支持 Android 和 iOS 按同一 service/facade 契约开发，平台差异只留在各自 adapter 内。
- 支持业务页面携带 3 个默认水印模板进入相机页，覆盖纯主标题、主副标题、PNG 图文三种情况。

## 非目标

- 不做独立原生录制页面作为最终产品形态。
- 不在原生组件内置水印模板库或模板编辑器。
- 不沿用 iOS 分支旧的独立水印设置页、远程 Logo API、Page 层图片资源 API 或上图标下文字旧布局。
- 不沿用 Android 分支旧的 `recordWatermarkVideo` grouped options 作为新组件对外接口。
- 不提供云端上传。
- 不提供录制后视频编辑。
- 不提供直播推流。
- 不做多段录制、暂停录制、继续录制。
- 不在本阶段重写生产级 OpenGL、CameraX、Metal 或 CoreImage 管线，除非真机性能证明现有方案无法满足目标。

## 页面关系

### App.vue 模拟页

`App.vue` 只用于模拟宿主应用准备参数和跳转，不是最终相机业务页。

它负责：

- 维护 3 个默认水印模板。
- 模拟模板编辑。
- 模拟携带模板参数跳转到业务嵌套相机页。

### 业务嵌套相机页

业务嵌套相机页是真实项目里应该存在的页面。

它负责：

- 承接 App.vue 或其他业务入口传入的水印模板列表。
- 维护当前选中的水印模板。
- 显示顶部业务信息卡，例如当前模板和闪光灯状态。
- 显示内嵌原生相机预览。
- 提供拍照、录像、焦段切换、闪光灯、模板选择等外层 UI。
- 调用相机 service/facade 的统一方法。
- 接收相机 service/facade 的统一事件和结果。

### 原生相机组件

原生相机组件只负责相机和媒体能力。

它负责：

- 原生相机实时预览。
- 照片水印烧录。
- 视频水印烧录。
- 水印预览层。
- 长按拖动水印。
- 返回照片和视频结果。
- 返回水印位置变化。
- 返回原生错误和诊断信息。

它不负责：

- 模板列表维护。
- 模板编辑。
- 业务按钮。
- 页面导航。
- 上传。
- 业务表单。

## 跨端架构

业务层不允许直接感知 Android 和 iOS 的实现差异。插件边界必须提供一层统一 service/facade。

推荐分层：

- 业务页面：维护页面状态、模板列表、当前模板和按钮交互。
- `cameraService` / facade：向业务页面暴露统一方法、统一事件、统一参数、统一返回结构和统一错误码。
- Android adapter：按统一契约实现 Android 原生相机能力。
- iOS adapter：按统一契约实现 iOS 原生相机能力。

规则：

- 业务层只能调用统一 service/facade。
- 业务层不写 Android/iOS 分支。
- Android 可以先实现，但不能把 Android 实现细节泄漏为最终接口。
- iOS 后续补齐时只能补 adapter，不应要求业务页面改调用方式。
- 两端字段名、单位、默认值、事件名、错误码和边界行为必须一致。

## 双端功能清单

Android 和 iOS 都必须以本清单作为实现范围。分支旧文档、旧 API 或旧页面里多出来的能力，如果没有列在本清单里，本阶段不实现、不验收、不作为接口约束。

| 模块 | Android | iOS | 统一要求 |
|---|---|---|---|
| 业务嵌套相机页 | 必须支持 | 必须支持 | App.vue 只模拟传参；真实项目页是业务嵌套相机页。 |
| 原生相机预览嵌入 | 必须支持 | 必须支持 | 预览区域由业务页指定，横向满宽，原生只负责相机和媒体能力。 |
| 照片拍摄 | 必须支持 | 必须支持 | 照片必须叠加当前水印模板并返回统一结果结构。 |
| 视频录制 | 必须支持 | 必须支持 | 视频必须叠加录制开始时冻结的水印模板和坐标。 |
| 水印模板列表 | 业务层维护 | 业务层维护 | 原生不维护模板库，不提供模板编辑器。 |
| 三种默认模板 | 必须支持 | 必须支持 | `title_text`、`title_subtitle_text`、`image_title_subtitle`。 |
| 模板选择弹框 | 业务层实现 | 业务层实现 | 相机页内只选择宿主传入模板，不编辑模板。 |
| 水印拖动 | 必须支持 | 必须支持 | 拖动回传比例坐标；录像中禁止拖动。 |
| 闪光灯 | 必须支持 | 必须支持 | 默认关闭，统一 `switchFlash(enabled)` 和错误码。 |
| 焦段切换 | 必须支持 | 必须支持 | 统一 `wide`、`1x`、`2x`，UI 可展示“广角”。 |
| 前后摄像头 | 必须支持 | 必须支持 | 统一 `cameraFacing`，默认 `back`。 |
| 权限时机 | 必须一致 | 必须一致 | 挂载只请求相机；开始录像时请求麦克风。 |
| 结果结构 | 必须一致 | 必须一致 | 成功数据放在 `data`，照片和视频都返回水印快照字段。 |
| 错误码 | 必须一致 | 必须一致 | 使用本 PRD 错误码，不使用分支旧错误码作为新组件错误码。 |

明确不保留的旧分支能力：

- 不保留 iOS 旧 PRD 中的独立水印设置页作为新组件必需页面。
- 不保留 iOS 旧 PRD 中的 `GET /api/watermark/logo-assets` 作为新组件必需接口。
- 不保留 iOS 旧 PRD 中“上图标 / 下文字”的默认混合水印布局。
- 不保留 Android 旧 `camera.enablePhoto` 原生页按钮作为新组件接口。
- 不保留 Android 旧 `recordWatermarkVideo` grouped options 作为业务页直接调用的新接口。
- 不把 Android 旧 CPU 管线优化路线写入本阶段功能验收。

## 统一方法契约

方法命名可以在实现计划阶段再定最终代码名，但两端必须一一对应。业务层看到的入参、返回、事件 payload 和错误码必须一致。

所有方法都必须异步返回统一结构。最终代码可以使用 Promise、callback 或 UTS 约定写法，但 Android 和 iOS 暴露给业务层的形态必须一致。

通用返回：

```json
{
  "success": true,
  "errorCode": "",
  "errorMessage": "",
  "nativeMessage": "",
  "data": {}
}
```

- `success=true` 时，`errorCode`、`errorMessage`、`nativeMessage` 返回空字符串，业务数据必须放在 `data` 内。
- `success=false` 时，`errorCode` 必须使用本 PRD 的统一错误码，`errorMessage` 返回业务可读中文，`nativeMessage` 返回原生诊断信息。
- `success=false` 时，`data` 必须返回空对象。
- 方法表里的“成功返回”均表示 `data` 内的字段，不允许返回裸字段，也不允许把业务字段和 `success/errorCode` 扁平混在一起。

统一枚举：

| 枚举 | 取值 | 默认值 | 说明 |
|---|---|---|---|
| `mode` | `photo`、`video` | `photo` | 页面模式。 |
| `zoom` | `wide`、`1x`、`2x` | `1x` | 对外固定枚举；UI 可展示为 `广角`、`1x`、`2x`。 |
| `cameraFacing` | `back`、`front` | `back` | 默认后置摄像头。 |

方法表：

| 能力 | 入参 | 成功返回 | 失败规则 |
|---|---|---|---|
| `mountCamera(options)` | `containerId`、`previewWidth`、`previewHeight`、`cameraFacing`、`zoom`、`flashEnabled` | 空对象，并触发 `onCameraReady` | 相机权限拒绝返回 `1001`；相机不可用返回 `1101`。 |
| `setWatermark(template)` | `WatermarkTemplate` | 通用返回，并立即更新预览 | 模板无效返回 `1201`；图片资源不可读返回 `1202`；录像中调用返回 `1403`。 |
| `clearWatermark()` | 无 | 通用返回，预览和后续输出都无水印 | 录像中调用返回 `1403`。 |
| `getWatermarkPosition()` | 无 | `x`、`y`、`width`、`height` | 相机未就绪返回 `1104`。 |
| `takePhoto()` | 无 | 照片结果结构 | 相机未就绪返回 `1104`；拍照失败返回 `1301`；临时文件成功但保存相册失败返回成功结果，同时 `albumFilePath` 为空字符串并触发 `onError(1501)`。 |
| `startRecord()` | 无 | 空对象，并触发 `onRecordStart` | 未就绪返回 `1104`；麦克风权限拒绝返回 `1002`；重复开始返回 `1403`；启动失败返回 `1401`。 |
| `stopRecord()` | 无 | 录像结果结构，并触发 `onRecordDone` | 未处于录像中返回 `1403`；停止失败返回 `1402`；临时文件成功但保存相册失败返回成功结果，同时 `albumFilePath` 为空字符串并触发 `onError(1501)`。 |
| `switchFlash(enabled)` | `enabled: boolean` | `enabled` | 闪光灯不可用返回 `1102`，并保持原状态。 |
| `setZoom(zoom)` | `wide`、`1x`、`2x` | `zoom` | 焦段不可用返回 `1103`，并保持原焦段。 |
| `switchCamera(cameraFacing)` | `back`、`front` | `cameraFacing` | 设备不可用返回 `1101`；录像中调用返回 `1403`。 |
| `destroyCamera()` | 无 | 空对象 | 必须释放相机、麦克风、录制和水印资源；重复调用也应成功返回。 |

录像状态规则：

- `startRecord()` 的瞬间必须冻结当前水印模板和当前水印坐标，本段视频全程使用这份快照烧录。
- 录像中禁止 `setWatermark()`、`clearWatermark()`、`switchCamera()`，必须返回 `1403`，不得静默改动正在录制的视频水印。
- 录像中禁止拖动水印；原生预览层必须保持录制开始时的水印位置，不触发 `onWatermarkPositionChange`。
- 录像中允许 `setZoom()` 和 `switchFlash()`，但不可用能力仍按 `1103`、`1102` 返回。
- 停止录像后，业务层可以再次切换模板，下一段视频使用新的模板快照。

权限时机：

- `mountCamera()` 只请求相机权限，不应在默认照片模式提前请求麦克风权限。
- `startRecord()` 第一次进入录像能力时请求麦克风权限；被拒绝时返回 `1002`。
- Android 和 iOS 的权限弹窗时机必须按上述规则保持一致。

## 统一事件契约

| 事件 | 触发时机 | payload |
|---|---|---|
| `onCameraReady` | 相机预览可以显示并接受控制。 | `availableZooms`、`zoom`、`flashAvailable`、`flashEnabled`、`cameraFacing`、`previewWidth`、`previewHeight` |
| `onPhotoDone` | 拍照完成并拿到文件路径。 | 照片结果结构 |
| `onRecordStart` | 录像开始。 | `watermarkTemplateId`、`watermarkPositionX`、`watermarkPositionY`、`zoom`、`cameraFacing` |
| `onRecordDone` | 录像完成并拿到文件路径。 | 录像结果结构 |
| `onWatermarkPositionChange` | 用户拖动水印后位置变化。 | `x`、`y`、`width`、`height`、`watermarkTemplateId` |
| `onZoomChange` | 焦段变化。 | `zoom`、`availableZooms` |
| `onFlashChange` | 闪光灯状态变化。 | `enabled`、`flashAvailable` |
| `onCameraFacingChange` | 前后摄像头变化。 | `cameraFacing` |
| `onError` | 权限、相机、麦克风、录制、拍照、保存、水印参数等错误。 | `errorCode`、`errorMessage`、`nativeMessage` |

错误事件规则：

- 方法直接失败时，必须返回 `success=false`；是否同时触发 `onError` 必须两端一致，本 PRD 约定为同时触发。
- 临时文件已经生成但相册保存失败时，方法返回 `success=true`，结果内 `albumFilePath` 为空字符串，同时触发 `onError(1501)`。
- 原生异步异常无法归属到某个方法返回时，只通过 `onError` 上报。

## 水印模板字段

水印模板必须使用扁平字段。字段缺省时使用统一默认值，不允许 Android 和 iOS 自行定义不同默认值。

### 字段总表

| 字段 | 类型 | 必填 | 默认值 | 取值/范围 | 说明 |
|---|---|---|---|---|---|
| `templateId` | string | 是 | 无 | 非空字符串，建议只用字母、数字、短横线、下划线 | 宿主应用维护的模板唯一标识。 |
| `templateName` | string | 是 | 无 | 非空字符串，建议不超过 20 个中文字符 | 宿主应用展示用名称，不参与水印绘制。 |
| `templateType` | string | 是 | 无 | `title_text`、`title_subtitle_text`、`image_title_subtitle` | 模板类型，决定字段组合和渲染分支。 |
| `mainTitleText` | string | 否 | 空字符串 | 建议不超过 40 个中文字符 | 主标题文字。 |
| `subtitleText` | string | 否 | 空字符串 | 建议不超过 80 个中文字符 | 副标题文字，不需要时传空字符串。 |
| `mainTitleColor` | string | 否 | `#26313B` | `#RRGGBB` 或 `#AARRGGBB` | 主标题颜色。 |
| `subtitleColor` | string | 否 | `#56616D` | `#RRGGBB` 或 `#AARRGGBB` | 副标题颜色。 |
| `mainTitleFontSize` | number | 否 | `16` | `8` 到 `72` | 主标题字号，逻辑像素。 |
| `subtitleFontSize` | number | 否 | `12` | `8` 到 `48` | 副标题字号，逻辑像素。 |
| `mainTitleBold` | boolean | 否 | `true` | `true` 或 `false` | 主标题是否加粗。 |
| `subtitleBold` | boolean | 否 | `false` | `true` 或 `false` | 副标题是否加粗。 |
| `imagePath` | string | 否 | 空字符串 | 本地路径、临时路径或宿主可解析路径 | 图片水印路径，纯文字模板必须传空字符串。 |
| `imageMimeType` | string | 否 | 空字符串 | 当前只要求支持 `image/png` | 图片 MIME 类型。 |
| `imageWidth` | number | 否 | `0` | `0` 到 `512` | 图片显示宽度，逻辑像素；无图片时必须为 `0`。 |
| `imageHeight` | number | 否 | `0` | `0` 到 `512` | 图片显示高度，逻辑像素；无图片时必须为 `0`。 |
| `imageTextGap` | number | 否 | `8` | `0` 到 `64` | 图片和文字之间的间距，逻辑像素。 |
| `boxWidth` | number | 否 | `0.64` | `0.1` 到 `1` | 水印框相对预览区域宽度的比例。 |
| `boxHeight` | number | 否 | `0.16` | `0.05` 到 `1` | 水印框相对预览区域高度的比例。 |
| `boxBackgroundColor` | string | 否 | `rgba(255,255,255,0.78)` | `rgba(...)`、`#RRGGBB` 或 `#AARRGGBB` | 水印框背景色。 |
| `boxRadius` | number | 否 | `8` | `0` 到 `80` | 水印框圆角，逻辑像素。 |
| `boxPadding` | number | 否 | `10` | `0` 到 `80` | 水印框内边距，逻辑像素。 |
| `positionX` | number | 否 | `0.18` | `0` 到 `1` | 水印框左上角横向比例坐标。 |
| `positionY` | number | 否 | `0.25` | `0` 到 `1` | 水印框左上角纵向比例坐标。 |

颜色规则：

- `#RRGGBB` 表示不透明颜色。
- `#AARRGGBB` 表示 ARGB，前两位是 alpha，不允许解释成 RGBA。
- `rgba(r,g,b,a)` 中 `r`、`g`、`b` 必须是 `0` 到 `255` 的整数，`a` 必须是 `0` 到 `1` 的小数或整数。
- 两端必须在解析后得到同一 ARGB 值；解析失败必须返回 `1201`。

### 类型字段组合

`templateType=title_text`：

- 必须使用 `mainTitleText`。
- 必须忽略 `subtitleText`。
- 必须忽略 `imagePath`、`imageMimeType`、`imageWidth`、`imageHeight`、`imageTextGap`。
- `subtitleText`、`imagePath`、`imageMimeType` 应传空字符串。
- `imageWidth`、`imageHeight` 应传 `0`。

`templateType=title_subtitle_text`：

- 必须使用 `mainTitleText`。
- 必须使用 `subtitleText`。
- 必须忽略 `imagePath`、`imageMimeType`、`imageWidth`、`imageHeight`、`imageTextGap`。
- `imagePath`、`imageMimeType` 应传空字符串。
- `imageWidth`、`imageHeight` 应传 `0`。

`templateType=image_title_subtitle`：

- 必须使用 `mainTitleText`。
- 必须使用 `subtitleText`。
- 必须使用 `imagePath`。
- `imageMimeType` 必须是 `image/png`。
- `imageWidth` 和 `imageHeight` 必须大于 `0`。

### 校验规则

- `templateId`、`templateName`、`templateType` 缺失时，必须触发 `1201` 水印模板参数无效。
- `templateType` 不在允许枚举内时，必须触发 `1201`。
- `title_text` 但 `mainTitleText` 为空时，必须触发 `1201`。
- `title_subtitle_text` 但 `mainTitleText` 或 `subtitleText` 为空时，必须触发 `1201`。
- `image_title_subtitle` 但 `imagePath` 为空、`imageMimeType` 不是 `image/png`、`imageWidth <= 0` 或 `imageHeight <= 0` 时，必须触发 `1201`。
- `imagePath` 无法被原生读取或解码时，必须触发 `1202`。
- 颜色字段格式不合法时，必须触发 `1201`。
- 字号、间距、圆角、位置字段超出范围时，必须触发 `1201`。
- `positionX + boxWidth > 1` 或 `positionY + boxHeight > 1` 时，必须按边界 clamp 到可见区域内，并通过 `onWatermarkPositionChange` 回传修正后的坐标；Android 和 iOS 必须使用同一 clamp 规则。
- Android 和 iOS 对同一非法模板必须返回同一错误码和同一错误语义。

### 字段渲染规则

- 字体族统一使用系统 sans-serif；`mainTitleBold=true` 映射为 `600` 或同等系统粗体，`subtitleBold=true` 同理。
- 主标题最多 1 行，副标题最多 2 行。
- 文字先按中文/英文自然断行填充可用宽度；超过最大行数时，最后一行尾部省略。
- 不允许自动缩小字号，不允许扩大 `boxWidth` 或 `boxHeight`。
- `mainTitleText` 和 `subtitleText` 的换行、截断、省略策略必须在预览、照片输出和视频输出中一致。
- `mainTitleColor`、`subtitleColor`、`mainTitleFontSize`、`subtitleFontSize`、`mainTitleBold`、`subtitleBold` 必须同时作用于预览、照片输出和视频输出。
- `imagePath` 指向的 PNG 必须在预览、照片输出和视频输出中使用同一缩放尺寸。
- `imageWidth`、`imageHeight` 表示渲染后的显示尺寸，不表示原始图片像素尺寸。
- `imageTextGap` 表示图片右侧到文字区域左侧的间距；如果未来支持图片在其他方向，需要新增字段，不允许改变该字段含义。
- `imagePath` 只允许传宿主应用已经可访问的本地文件路径、临时文件路径或打包资源解析后的绝对路径；不允许直接传网络 URL。
- `boxBackgroundColor`、`boxRadius`、`boxPadding` 必须同时作用于预览、照片输出和视频输出。
- 预览层和输出层必须使用同一模板对象，不允许预览使用一套字段、输出重新拼接另一套字段。
- 模板切换时，组件必须先清除旧模板，再应用新模板；不能出现两个模板叠加。
- `clearWatermark()` 后拍照和录像都不得再烧录旧水印。

## 默认模板

业务入口默认传入 3 个模板，不能少于这 3 种覆盖场景。

### 1. 纯主标题文字

```json
{
  "templateId": "title-only",
  "templateName": "纯主标题",
  "templateType": "title_text",
  "mainTitleText": "今日水印相机",
  "subtitleText": "",
  "mainTitleColor": "#26313B",
  "subtitleColor": "#56616D",
  "mainTitleFontSize": 18,
  "subtitleFontSize": 12,
  "mainTitleBold": true,
  "subtitleBold": false,
  "imagePath": "",
  "imageMimeType": "",
  "imageWidth": 0,
  "imageHeight": 0,
  "imageTextGap": 8,
  "boxWidth": 0.64,
  "boxHeight": 0.14,
  "boxBackgroundColor": "rgba(255,255,255,0.78)",
  "boxRadius": 8,
  "boxPadding": 10,
  "positionX": 0.18,
  "positionY": 0.25
}
```

### 2. 主副标题纯文字

```json
{
  "templateId": "title-subtitle",
  "templateName": "主副标题",
  "templateType": "title_subtitle_text",
  "mainTitleText": "门店巡检",
  "subtitleText": "照片和录像共用同一套水印",
  "mainTitleColor": "#26313B",
  "subtitleColor": "#56616D",
  "mainTitleFontSize": 16,
  "subtitleFontSize": 12,
  "mainTitleBold": true,
  "subtitleBold": false,
  "imagePath": "",
  "imageMimeType": "",
  "imageWidth": 0,
  "imageHeight": 0,
  "imageTextGap": 8,
  "boxWidth": 0.64,
  "boxHeight": 0.16,
  "boxBackgroundColor": "rgba(255,255,255,0.78)",
  "boxRadius": 8,
  "boxPadding": 10,
  "positionX": 0.18,
  "positionY": 0.25
}
```

### 3. PNG 图片加主副文字

```json
{
  "templateId": "png-title-subtitle",
  "templateName": "PNG 图文",
  "templateType": "image_title_subtitle",
  "mainTitleText": "交付留档",
  "subtitleText": "PNG 图片 + 主副标题",
  "mainTitleColor": "#26313B",
  "subtitleColor": "#56616D",
  "mainTitleFontSize": 16,
  "subtitleFontSize": 12,
  "mainTitleBold": true,
  "subtitleBold": false,
  "imagePath": "assets/watermark-demo.png",
  "imageMimeType": "image/png",
  "imageWidth": 42,
  "imageHeight": 42,
  "imageTextGap": 8,
  "boxWidth": 0.7,
  "boxHeight": 0.18,
  "boxBackgroundColor": "rgba(255,255,255,0.78)",
  "boxRadius": 8,
  "boxPadding": 10,
  "positionX": 0.15,
  "positionY": 0.25
}
```

## 水印坐标规则

- 坐标基准：原生相机预览组件的实际图像可见区域，不包含业务顶部、底部控制区，也不包含预览区域内部因为比例适配产生的黑边。
- 坐标原点：实际图像可见区域左上角为 `(0, 0)`；如果预览组件内存在黑边，黑边不参与坐标计算。
- 坐标单位：对外使用比例坐标，`x`、`y`、`width`、`height` 取值范围为 `0` 到 `1`。
- 定位语义：`x`、`y` 表示水印框左上角；`width`、`height` 表示水印框相对预览区域的尺寸。
- 默认位置：未传入位置时，默认放在预览区域中上部，并完整落在可见区域内。
- 拖动边界：水印框不得被拖出预览可见区域；到边界时 clamp。
- 位置回传：拖动结束后通过 `onWatermarkPositionChange` 回传比例坐标。
- 输出一致：拍照和录像烧录使用同一份比例坐标，输出位置必须和预览一致。
- 预览和输出比例不一致时，必须先计算预览中真实图像区域，再把比例坐标映射到输出图片或视频的真实画面区域。
- 不允许把水印烧录到预览黑边、裁切区域或业务 UI 区域。
- 前置摄像头如果预览做镜像，输出也必须按最终可见方向保持水印位置一致；不能出现预览在左、输出在右。
- 输出文件如果包含 EXIF 方向或视频旋转元数据，水印必须以最终查看方向为准。
- 竖屏预览、竖屏照片和竖屏录像是本阶段主路径；横屏能力不作为本阶段目标。

坐标字段映射：

- 模板字段使用 `positionX`、`positionY`、`boxWidth`、`boxHeight`。
- 位置事件使用 `x`、`y`、`width`、`height`，含义与模板字段一一对应。
- 输出结果使用 `watermarkPositionX`、`watermarkPositionY`、`watermarkBoxWidth`、`watermarkBoxHeight`，含义与本次输出实际使用的模板字段一一对应。
- 三套命名只是不同返回场景的字段名差异，不允许改变坐标含义。

## 相机页 UI 要求

业务嵌套相机页参考 iPhone 原相机的基本布局，但保留业务水印能力。

默认状态：

- 闪光灯默认关闭。
- 焦段默认 `1x`。
- 模式默认照片。
- 顶部显示当前模板信息和闪光灯开关。
- 取景器占据页面主要空间，横向满宽。
- 右侧显示焦段按钮：`2x`、`1x`、`广角`。
- 底部显示模式切换：`视频`、`照片`。
- 底部主控制为：左侧结果缩略图、中间快门、右侧粗体 `印` 按钮。

快门行为：

- 照片模式：快门为白色圆形按钮，外层有玻璃感边框。
- 视频模式：快门为红色圆形按钮，外层有玻璃感边框。
- 快门内层实心圆必须贴合玻璃边框内侧，不应在按钮和玻璃边框之间留明显透明间隙。
- 录像中：红色圆形变成红色圆角方块，用于停止录像。

水印按钮行为：

- 点击粗体 `印` 按钮打开模板选择弹框。
- 弹框只选择宿主页面传入的模板。
- 弹框不提供模板编辑。
- 选中模板后立即更新预览水印。

## 结果结构

照片完成事件至少返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `tempFilePath` | string | 临时文件路径。 |
| `albumFilePath` | string | 相册路径，无法获取时为空字符串。 |
| `width` | number | 输出图片宽度。 |
| `height` | number | 输出图片高度。 |
| `watermarkTemplateId` | string | 当前水印模板 ID。 |
| `watermarkPositionX` | number | 输出时使用的横向比例坐标。 |
| `watermarkPositionY` | number | 输出时使用的纵向比例坐标。 |
| `watermarkBoxWidth` | number | 输出时使用的水印框宽度比例。 |
| `watermarkBoxHeight` | number | 输出时使用的水印框高度比例。 |
| `watermarkTemplateSnapshot` | object | 输出时冻结的完整水印模板对象；无水印时为空对象。 |

录像完成事件至少返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `tempFilePath` | string | 临时文件路径。 |
| `albumFilePath` | string | 相册路径，无法获取时为空字符串。 |
| `durationMs` | number | 视频时长。 |
| `width` | number | 输出视频宽度。 |
| `height` | number | 输出视频高度。 |
| `watermarkTemplateId` | string | 当前水印模板 ID。 |
| `watermarkPositionX` | number | 输出时使用的横向比例坐标。 |
| `watermarkPositionY` | number | 输出时使用的纵向比例坐标。 |
| `watermarkBoxWidth` | number | 输出时使用的水印框宽度比例。 |
| `watermarkBoxHeight` | number | 输出时使用的水印框高度比例。 |
| `watermarkTemplateSnapshot` | object | `startRecord()` 时冻结的完整水印模板对象；无水印时为空对象。 |

## 错误码

两端必须使用同一错误码。

| 错误码 | 场景 |
|---|---|
| `1001` | 相机权限被拒绝。 |
| `1002` | 麦克风权限被拒绝。 |
| `1101` | 相机设备不可用。 |
| `1102` | 闪光灯不可用。 |
| `1103` | 焦段不可用。 |
| `1104` | 相机未挂载或未就绪。 |
| `1201` | 水印模板参数无效。 |
| `1202` | 水印图片资源不可读或解码失败。 |
| `1301` | 拍照失败。 |
| `1401` | 录像开始失败。 |
| `1402` | 录像停止失败。 |
| `1403` | 当前状态不允许执行该操作，例如重复开始录像、未录像时停止、录像中切换模板或摄像头。 |
| `1501` | 文件保存失败。 |
| `9001` | 未知原生错误。 |

## Android 实现要求

- Android adapter 必须实现统一 facade 的全部方法和事件。
- 预览区域尺寸、焦段、闪光灯、拍照、录像、水印坐标和文件结果必须按本 PRD 的语义返回。
- 不能把 Activity 内按钮作为最终交互形态。
- 当前独立原生录制页面只能作为迁移参考。

## iOS 实现要求

- iOS adapter 必须实现与 Android 完全一致的 facade 契约。
- iOS 后续补齐时不得要求业务页面改字段、改事件或写平台分支。
- iOS 的照片和视频水印输出必须与预览水印一致。
- iOS 的焦段、闪光灯和权限错误必须映射到统一状态和错误码。

## 测试验收

自动化或结构测试至少覆盖：

- 业务页可以嵌入原生相机组件，而不是打开独立原生录制页。
- App.vue 模拟页携带 3 个默认模板进入业务相机页。
- 三种默认模板都能在预览中显示：
  - 纯主标题文字。
  - 主副标题纯文字。
  - PNG 图片加主副文字。
- 当前模板切换后，拍照和录像都使用新模板。
- 录像开始后冻结当前模板和坐标，录像中切换模板、清除水印或切换摄像头必须返回 `1403`。
- 录像中拖动水印不应改变当前预览位置，不应触发位置变化事件。
- 照片结果事件返回可用路径和当前水印模板 ID。
- 视频结果事件返回可用路径、时长和当前水印模板 ID。
- 照片和视频结果返回 `watermarkTemplateSnapshot`、`watermarkBoxWidth`、`watermarkBoxHeight`。
- 所有方法成功返回都必须把业务字段放在 `data` 对象内。
- 闪光灯默认关闭。
- 焦段默认 `1x`。
- `wide`、`1x`、`2x` 三个焦段枚举的成功和不可用返回一致。
- 照片模式快门为白色圆形。
- 视频模式快门为红色圆形。
- 录像中快门为红色圆角方块。
- 水印拖动后回传比例坐标。
- 水印越界时按同一规则 clamp 并回传修正坐标。
- 坐标原点以实际图像可见区域左上角为准，不以包含黑边的组件左上角为准。
- 同一长文本模板在预览、照片和视频中的换行、省略一致。
- PNG 水印路径不可读时返回 `1202`。
- 默认照片模式挂载相机不请求麦克风权限；开始录像时才请求麦克风权限。
- 临时文件成功但保存相册失败时，结果路径仍返回，`albumFilePath` 为空，并触发 `onError(1501)`。
- Android 和 iOS 对同一模板字段、坐标和事件返回保持一致。

真机测试至少覆盖：

- 相机权限。
- 麦克风权限。
- 前置和后置摄像头。
- 闪光灯可用和不可用设备。
- `2x`、`1x`、`广角` 焦段可用和不可用设备。
- 不同 Android 厂商相册可见性。
- iOS 相册保存。
- 竖屏预览区域尺寸。
- 录制流畅度和实际帧率。
- 水印拖动命中区域。
- 照片和视频水印与预览一致。
