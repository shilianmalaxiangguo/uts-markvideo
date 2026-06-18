# uts-markvideo 历史 API 与新 PRD 迁移说明

本文档只用于说明历史 `recordWatermarkVideo` / `createWatermarkSample` API 与新内嵌相机 PRD 的迁移关系。新需求、新开发、新验收一律以 `docs/embedded-camera-component-prd.md` 为准。

## 文档优先级

从本阶段开始，仓库文档优先级如下：

| 优先级 | 文档 | 定位 |
|---|---|---|
| 1 | `docs/embedded-camera-component-prd.md` | Android 和 iOS 共同遵循的唯一主契约。 |
| 2 | `camera-prototype.html` | 对 PRD 的可视化原型说明。 |
| 3 | `docs/api.md` | 历史 API 归档和迁移说明，不作为新组件功能清单。 |

结论：

- 新内嵌水印相机组件只能以 `docs/embedded-camera-component-prd.md` 为准。
- Android 分支和 iOS 分支历史上的 `docs/api.md`、旧 PRD、旧页面交互都不能覆盖新 PRD。
- iOS 分支中不属于新 PRD 的旧设置页、旧远程图片 API、旧上图标下文字布局、旧独立原生录制页交互，不进入新组件功能清单。
- Android 分支中不属于新 PRD 的旧 `enablePhoto` 原生页按钮、旧录制页 grouped options、旧 CPU 管线优化项，也不进入新组件功能清单。
- 旧 `recordWatermarkVideo` API 只作为迁移参考；后续可以兼容保留，但不得作为业务页面调用新组件的方式。

## 历史已导出的插件 API

当前代码里仍可能存在 MVP 独立原生录制页 API：

```ts
recordWatermarkVideo({
  text: 'Project A',
  fps: 30,
  success(res) {
    console.log(res.tempFilePath)
  },
  fail(err) {
    console.error(err.errCode, err.errMsg)
  },
  complete(res) {}
})
```

### `recordWatermarkVideo(options)`

历史导出类型：

```ts
type RecordWatermarkVideoOptions = {
  text?: string
  fps?: number
  success?: (res: RecordWatermarkVideoSuccess) => void
  fail?: (err: MarkVideoFail) => void
  complete?: (res: any) => void
}
```

成功结果：

```ts
type RecordWatermarkVideoSuccess = {
  tempFilePath: string
  durationMs: number
  width: number
  height: number
  watermarkText: string
}
```

失败结果：

```ts
type MarkVideoFail = {
  errCode: number
  errMsg: string
}
```

### `createWatermarkSample(options)`

`createWatermarkSample` 是开发调试辅助能力，不属于新 PRD 的目标功能。

```ts
type CreateWatermarkSampleOptions = {
  text?: string
  durationMs?: number
  width?: number
  height?: number
  fps?: number
  success?: (res: CreateWatermarkSampleSuccess) => void
  fail?: (err: MarkVideoFail) => void
  complete?: (res: any) => void
}
```

## 分支历史文档处理结论

远端 `android` 和 `ios` 分支曾经出现过 `docs/api.md`，但它们不是本阶段双端功能清单来源：

| 来源 | 主要内容 | 处理方式 |
|---|---|---|
| `origin/android:docs/api.md` | 扩展了 `recordWatermarkVideo` 的 grouped options，例如 `watermark`、`video`、`camera`、`limits`、`diagnostics` | 归档为旧独立录制页 API 背景，不进入新组件契约。 |
| `origin/ios:docs/api.md` | 补充 Page 层准备图片资源、远程 Logo API、iOS 当前实现对齐说明 | 归档为旧 iOS 分支背景，其中不符合新 PRD 的内容不保留。 |
| `origin/ios:docs/prd-watermark-camera-cross-platform.md` | 旧水印相机 PRD，包含独立设置页、远程图片 API、Page 设置页等旧方向 | 废弃为历史文档，不作为本阶段双端功能清单。 |
| `docs/embedded-camera-component-prd.md` | 定义业务嵌套相机页、原生内嵌组件、统一 service/facade、水印模板字段、事件和错误码 | 新需求的主契约。 |

因此最优解不是把 Android 分支 `api.md` 原样复制到 `main`，也不是让 iOS 分支旧 PRD 覆盖当前 PRD，而是在 `main` 明确：

- Android 和 iOS 都以新 PRD 统筹。
- 双端功能清单只来自新 PRD。
- 分支历史文档只作为理解旧实现的材料，不作为验收依据。

## 旧 API 到新组件的迁移边界

旧 API 和新 PRD 的字段不是一一同名：

| 旧 `recordWatermarkVideo` 层 | 新内嵌组件 PRD 层 |
|---|---|
| `text` / `watermark.text` | `mainTitleText`，必要时由业务层映射 |
| `watermark.imagePath` | `imagePath`，但新 PRD 还要求 `imageMimeType`、`imageWidth`、`imageHeight` |
| `watermark.x` / `watermark.y` | `positionX` / `positionY`，且新 PRD 使用水印框左上角比例坐标 |
| `watermark.boxWidth` / `watermark.boxHeight` | `boxWidth` / `boxHeight`，但新 PRD 以预览真实图像区域为坐标基准 |
| `success(res)` / `fail(err)` | service/facade 统一返回 `{ success, errorCode, errorMessage, nativeMessage, data }` |

迁移规则：

- 不要把新 PRD 的 `WatermarkTemplate` 直接塞进旧 `recordWatermarkVideo`。
- 不要把旧 API 的 `watermark.x/y` 当成新 PRD 的 `positionX/positionY` 直接复用，二者坐标语义不同。
- 如果要复用旧录制能力支撑新组件，必须在 facade adapter 内显式转换字段，并写测试覆盖转换规则。
- 对外业务页面只能依赖 PRD 的 service/facade，不应直接调用 Android 或 iOS 分支旧 API。
- Android/iOS 实现过程中发现旧 API 与新 PRD 冲突时，优先修改 adapter 或新增 facade，不反向修改 PRD 去迁就旧 API。
