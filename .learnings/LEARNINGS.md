# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260625-C03] correction

**Logged**: 2026-06-25T00:23:47+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
CameraX 焦段切换是用户可感知的相机控制，点击时也要触发轻震。

### Details
用户反馈“现在焦距切换没震动”。复查 `pages/cameraX/index.uvue` 发现 `cycleFlashMode()`、`switchCameraFacing()`、拍照和录像入口都有 `triggerHaptic()`，但 `setZoomMode()` 缺少这一步。焦段 rail 会立即更新 selected 状态并向 native 发起切焦段请求，属于同一类相机控制反馈；pending 期间被接受并排队的 zoom tap 也应该给轻震，让用户知道点击已被接收。

### Suggested Action
后续新增或调整 CameraX 控制入口时，把触觉反馈纳入交互合同：只要点击被页面接受并会改变/排队改变相机控制状态，就在业务阻断条件之后调用 `triggerHaptic('light')`；保存中、录制禁止等被拒绝的点击不震动。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, zoom, haptic, uvue, interaction-feedback
- See Also: LRN-20260625-C02
- Pattern-Key: uts_markvideo.camera_controls_haptic_feedback
- Recurrence-Count: 1
- First-Seen: 2026-06-25
- Last-Seen: 2026-06-25

### Resolution
- **Resolved**: 2026-06-25T00:23:47+08:00
- **Commit/PR**: pending
- **Notes**: Added `triggerHaptic('light')` to `setZoomMode()` after the stop-pending guard and before pending/dispatch handling, added a structure-test assertion, and verified `npm test`, `git diff --check`, and HBuilderX Android UTS compile.

---

## [LRN-20260625-C02] correction

**Logged**: 2026-06-25T00:07:29+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 焦段 selected 状态不能只防 stale payload，zoom 枚举字符串也不能在 `.uvue` 关键路径里用 `===`/`!==`。

### Details
用户复测继续反馈：点击 `2x` 后相机实际已经到 2x，但底部焦距 item 又自动选回 `1x`。上一条 `zoomLatestRequestMode` guard 假设只解释了晚到 payload，但漏了 `.uvue`/UTS 运行时字符串比较语义：native 回包里的 `requestedZoomMode` / `zoomMode` 是动态字符串，`normalizeUiZoomMode()`、zoom 按钮 class、`handleZoomChange()`、`syncZoomMode()` 等关键路径如果用 `===`/`!==`，生成端可能把值比较误判为默认分支，导致 `2x` 被归一化成 `1x`。这和此前 flash 的 `on/auto/off` 问题是同类。

### Suggested Action
后续维护来自 native payload 的 `.uvue` 小枚举字符串时，状态机、UI selected class、label 和数组去重都用已验证的值比较写法；结构测试要像 flash 一样用 `doesNotMatch` 防止 zoom 关键路径重新引入 `===`/`!==`。

### Metadata
- Source: user_feedback, systematic_debugging
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, zoom, uvue, uts, string-comparison, native-event
- See Also: LRN-20260624-C11, LRN-20260624-C07
- Pattern-Key: uts_markvideo.zoom_string_value_comparison
- Recurrence-Count: 1
- First-Seen: 2026-06-25
- Last-Seen: 2026-06-25

### Resolution
- **Resolved**: 2026-06-25T00:07:29+08:00
- **Commit/PR**: pending
- **Notes**: Replaced zoom-critical strict string comparisons with value comparisons, added zoom comparison regression assertions, and verified `npm test`, `git diff --check`, and HBuilderX Android UTS compile.

---

## [LRN-20260625-C01] correction

**Logged**: 2026-06-25T00:01:10+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 视频/照片 switch 的胶囊间距问题要先看橙色 thumb 与外层白色边框的几何内距，不要误判成文字上下对齐。

### Details
用户明确纠正：问题不是“视频/照片”文字的 padding 或 baseline，而是橙色选中背景和外层白色边框之间的内距。第一处是下边距几乎没有；第二处是选中“照片”时橙色 thumb 右侧紧贴外层白边；第三处是右侧 3px 仍偏少，需要再给右侧多一点呼吸。带 border 的 uni-app x 原生 view 里，`modeSwitch` 轨道高度 36px、thumb `top: 2px; height: 32px` 会在实际内框中把底部空间吃得太满；`left: 2px; width: 84px; translateX(88px)` 会让照片态右侧只剩很窄的视觉缝。用文字 `translateY()` 只能掩盖问题，不能修复外框与 thumb 的真实几何关系。

### Suggested Action
后续调这个 segmented switch 时，优先改 `.modeThumb` 的 top/height/radius/left/width 等几何参数，并用结构测试锁定；不要加空 spacer view，也不要把主修复放到 `.modeText` 的 transform 或 line-height 上。真机截图判断时聚焦橙色 thumb 到白色外边框的上下和左右内距。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, mode-switch, uvue, segmented-control, geometry
- Pattern-Key: uts_markvideo.mode_switch_thumb_border_gap
- Recurrence-Count: 1
- First-Seen: 2026-06-25
- Last-Seen: 2026-06-25

### Resolution
- **Resolved**: 2026-06-25T00:01:10+08:00
- **Commit/PR**: pending
- **Notes**: Reduced the selected thumb height to create bottom inset, narrowed the thumb to 78px with `left: 3px` so the right edge has more breathing room in photo mode, removed text translateY, and added regression assertions.

---

## [LRN-20260624-C11] correction

**Logged**: 2026-06-24T23:54:25+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 焦段 UI selected 状态不能只防 `syncZoomMode`，还要防晚到的 `cameraready`/native state payload 把 latest request 覆盖回 `1x`。

### Details
用户复测反馈：点击 `2x` 后相机实际已经切到 2x，但底部焦距 item 又自动选回 `1x`。前一轮只处理了 pending/queued 请求和 camera ready 后续 silent sync，但 `handleCameraReady()` 开头仍会调用 `applyNativeCameraState(detail)`；如果这个 ready payload 携带旧的 `zoomMode: 1x` 且没有 `requestedZoomMode`，就会在用户 latest request 为 `2x` 时把 `zoomSelectedMode` 和 `zoomLatestRequestMode` 回写成 `1x`。另外，成功的 `zoomchange` 也不能优先相信 payload 的 `zoomMode`，应该优先采用与本次命令匹配的 `requestedZoomMode`。

### Suggested Action
后续维护焦段状态时，把 `zoomLatestRequestMode` 当作 UI intent guard：`applyNativeCameraState()` 只有在 payload 的 `zoomMode` 或 `requestedZoomMode` 与 latest request 匹配，或正在执行 camera switch 这种明确重置路径时，才更新 `zoomSelectedMode`/`zoomLatestRequestMode`。成功的 `handleZoomChange()` 和 `syncZoomMode()` response 合并应优先使用 `requestedZoomMode`，避免旧 `zoomMode` payload 把已应用的 2x/广角 item 拉回 1x。

### Metadata
- Source: user_feedback, systematic_debugging
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, zoom, uvue, native-event, stale-payload
- See Also: LRN-20260624-C10
- Pattern-Key: uts_markvideo.zoom_selected_latest_request_guard
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T23:54:25+08:00
- **Commit/PR**: pending
- **Notes**: Guarded `applyNativeCameraState()` against stale zoom payloads, changed successful zoom event/response merging to prefer `requestedZoomMode`, added regression assertions, and verified `npm test` plus `git diff --check`.

---

## [LRN-20260624-C06] correction

**Logged**: 2026-06-24T20:45:43+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 焦段 UI 不应依赖 native `availableZoomModes` 隐藏或拦截 2x。

### Details
用户指出实际设备有 2x，但页面没有返回/展示 2x。原因是迁移到 uni-app x 后把 native 上报的 `availableZoomModes` 当作 UI 展示和点击拦截的唯一依据；Camera1 的倍率能力上报可能低于严格 200，比如最接近 200 的倍率在 190-199 时仍能作为 2x 体验使用。正确策略是焦段 UI 固定展示“广角 / 1x / 2x”，点击后交给 native 应用结果决定是否成功；失败时回退到 1x 并提示“当前设备未暴露广角镜头”或“当前设备不支持 2x 焦段”。

### Suggested Action
后续处理相机能力时，区分“业务 UI 提供的入口”和“native 能力探测结果”。能力列表可以用于诊断或状态回显，但不要直接隐藏用户预期的核心入口；native 应用失败后再给明确提示并保持实际选中状态。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.uvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, zoom, availableZoomModes, Camera1, uni-app-x
- See Also: LRN-20260624-C04
- Pattern-Key: uts_markvideo.camera_zoom_ui_not_bound_to_available_modes
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T20:45:43+08:00
- **Commit/PR**: pending
- **Notes**: Zoom controls now always render wide/1x/2x, page sends selected modes to native instead of pre-blocking via `availableZoomModes`, and Android 2x availability now uses the same closest-to-200 selection plus 190 threshold as actual zoom application.

---

## [LRN-20260624-C07] correction

**Logged**: 2026-06-24T21:26:39+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 连续切焦段时要防止旧 native 事件覆盖最新选中态和提示。

### Details
用户复现：先点广角，再点 2x，再点回 1x，UI item 已选中 1x，但提示仍显示 2x/旧失败提示，并且提示一直挂着。原因是焦段页面状态只用 `zoomEventHandled` / `zoomRequestSilent` 处理单次请求，没有记录最后一次用户选择；旧的 `zoomchange` 事件晚到时仍能覆盖 `nativeStatus`。另外点击当前已选中的 1x 时直接 return，不能清掉上一条 unsupported 或 2x 提示。

### Suggested Action
后续处理相机按钮这类 native 异步回包时，记录“最后一次用户意图”，并用 native 事件里的 requested mode/type 做 stale-event guard。pending 期间的最新点击要排队，在当前 native 回包结束后补发；点击当前已选状态也应刷新可见状态文案，不能静默返回后留下旧错误提示。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, zoom, stale-event, nativeStatus, uni-app-x
- See Also: LRN-20260624-C06
- Pattern-Key: uts_markvideo.camera_zoom_stale_event_status_guard
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T21:26:39+08:00
- **Commit/PR**: pending
- **Notes**: Added `zoomLatestRequestMode` and `zoomQueuedMode`, ignored stale zoom events whose requested mode no longer matches the latest user intent, replayed the last pending zoom tap after the active native request finishes, and refreshed `nativeStatus` when tapping the already selected zoom mode.

---

## [LRN-20260624-C08] correction

**Logged**: 2026-06-24T22:36:17+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 水印长按拖拽不能只补 `longpress`，一指拖动要回到 `movable-view` 并解析 `event.detail.x/y`。

### Details
用户反馈“现在缩放可以了，但是长按拖拽还是不行”。第一次只加 `@longpress` 和单指 `touchmove` 兜底后，真机仍不能长按拖动，说明问题不在 longpress 入口本身。`.uvue` 普通 `view` 手算移动不如原来 `movable-view` 稳定；更关键的是 `movable-view @change` 的坐标在 `event.detail.x/y`，如果只从事件对象本体取 `x/y`，页面会丢掉移动坐标，松手后无法提交水印位置，表现为拖不动或回弹。

### Suggested Action
后续改水印手势时，一指拖动优先让 `movable-area/movable-view` 承担，页面通过 `@change` 同步 `watermarkMoveDraft` 和 `watermarkMovePosition`；双指缩放继续用 sibling overlay 避免 pinch 闪烁。处理 movable change 时必须先读 `event['detail']`，再兼容测试里直接传 `{ detail: { x, y } }` 的手写对象。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, watermark, longpress, drag, movable-view, uni-app-x
- See Also: LRN-20260624-C02
- Pattern-Key: uts_markvideo.watermark_drag_movable_change_detail
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T22:36:17+08:00
- **Commit/PR**: pending
- **Notes**: Restored `movable-area/movable-view` as the one-finger drag root, kept pinch visual rendering in the sibling overlay, and added `watermarkMoveEventDetail()` so `@change` reads `event.detail.x/y` before committing the move.

---

## [LRN-20260623-C14] correction

**Logged**: 2026-06-22T17:53:51Z
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
水印内容里的 logo 图片上下颠倒时，不要误判成右下角缩放手柄图标问题。

### Details
用户纠正“不是手柄图标，而是水印当中的图片上下颠倒”。截图裁剪对比显示，页面预览和照片烧录里的小圆 logo 更接近 `logo2.png` 的上下翻转版本。`logo2.png` 带 `eXIf` chunk，但解析后只包含尺寸信息，没有 Orientation 标签；修复点应放在水印图片本体的渲染/绘制层，而不是改素材、手柄图标或整个水印容器。

### Suggested Action
后续处理水印图片方向问题时，先裁剪截图里的 logo 与当前源图 normal/vflip 做对比；只有确认当前素材在页面预览和 Android 输出都相对源图倒置时，才允许在图片本体渲染层做局部翻转。换素材后必须重新验证方向，不能沿用旧素材的补偿翻转。不要把翻转加到整个水印内容层，否则文字也会倒。参见 LRN-20260623-C23。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs, static/watermark/logo2.png
- Tags: watermark, image-orientation, android, nvue, canvas
- Pattern-Key: uts_markvideo.watermark_logo_vertical_flip
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-22T17:53:51Z
- **Commit/PR**: pending
- **Notes**: Added local image flip in the nvue preview image style and Android canvas watermark image draw path. `npm test` passed.

---

## [LRN-20260623-C16] correction

**Logged**: 2026-06-23T01:18:58+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
nvue 真机上，`<text>` 图标能稳定显示，但 `<image>` 加 SVG 不能想当然地认为一定可见。

### Details
用户指出红色关闭按钮能显示，而缩放图标只剩橙色底球、内部没有描边。根因不是颜色本身，而是当前 nvue 真机对 `<image src="...svg">` 的渲染路径没有稳定画出 SVG path。`<text>` 之所以可见，是因为它走的是原生文本渲染通道。要做稳定悬浮图标，优先用原生 `view`/`text` 组合，而不是依赖 SVG image 解码。

### Suggested Action
后续在 `cameraX` 页做悬浮按钮、角标、控件图标时，先区分是文本、纯 `view` 还是 `image/SVG` 通道；对真机 nvue 来说，能稳定显示的优先级应是 `text` > 原生 `view` 线段 > SVG image。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: nvue, image-rendering, svg, text-rendering, icon
- See Also: LRN-20260623-C15, LRN-20260623-C14
- Pattern-Key: uts_markvideo.nvue_text_vs_svg_rendering
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T01:18:58+08:00
- **Commit/PR**: pending
- **Notes**: Resize handle now uses native `view` line segments instead of SVG `<image>`; tests passed after the switch.

---

## [LRN-20260623-C15] correction

**Logged**: 2026-06-23T00:45:30+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印缩放 SVG 图标不仅要换成真实资产，还要保证真机相机预览上的颜色对比度。

### Details
用户反馈缩放 icon 仍没有正确显示，并指出可能没有考虑颜色。原实现把 SVG 描边设为 `#111917`，缩放手柄背景是半透明白色；在真机相机预览和 nvue 渲染混合下，半透明底色可能让深色细线显得不清楚。正确做法是让缩放手柄使用稳定的高对比实底色，并让 SVG 使用反色描边。

### Suggested Action
后续调整相机页悬浮控件图标时，图标资产和承载按钮背景要成组设计：避免只替换 SVG 路径而不校验前景/背景对比度。水印缩放手柄当前使用橙色实底 `#ff8a00` 和白色 SVG 描边 `#ffffff`。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, static/watermark/resize-diagonal.svg, test/structure.test.mjs
- Tags: watermark, resize-icon, svg, contrast, nvue
- See Also: LRN-20260622-C09, LRN-20260623-C14
- Pattern-Key: uts_markvideo.watermark_resize_icon_contrast
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T00:45:30+08:00
- **Commit/PR**: pending
- **Notes**: Resize handle now uses `#ff8a00`; SVG paths use `#ffffff` and `stroke-width=\"2.6\"`. Regression tests assert the high-contrast icon colors.

---

## [LRN-20260623-C14] correction

**Logged**: 2026-06-23T00:39:22+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
当前相机主线入口是 `pages/cameraX/index.nvue`，不要回到废弃的 `pages/camera/camera.vue`。

### Details
用户纠正：本轮相机缩放图标、pinch 缩放和 HBuilderX nvue-css 编译问题都发生在 `cameraX` 主线。README 和 `pages.json` 也确认当前业务页是 `pages/cameraX/index.nvue`，旧 `pages/camera/camera.vue` 已废弃。本轮 HBuilderX 报错中的 `overflow: visible` 也是 `pages/cameraX/index.nvue` 的 nvue 样式问题。

### Suggested Action
后续处理 `uts-markvideo` 相机 UI、缩放图标、水印交互或 HBuilderX 运行日志时，先用 README 和 `pages.json` 确认当前入口；除非用户明确要求历史路线，否则不要检查或恢复 `pages/camera/camera.vue`。

### Metadata
- Source: user_feedback
- Related Files: README.md, pages.json, pages/cameraX/index.nvue, pages/camera/camera.vue
- Tags: cameraX, nvue, route-truth, deprecated-route
- See Also: LRN-20260623-C13
- Pattern-Key: uts_markvideo.cameraX_is_current_entry
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T00:39:22+08:00
- **Commit/PR**: pending
- **Notes**: Current review and verification were anchored on `pages/cameraX/index.nvue`; old `pages/camera/camera.vue` was not used as the mainline.

---

## [LRN-20260622-C11] correction

**Logged**: 2026-06-22T23:55:16+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
当前相机主线入口是 `pages/cameraX/index.nvue`，不要再从旧记忆推断为 `pages/camera/camera.vue`。

### Details
用户纠正：`pages/camera/camera.vue` 是历史路线，当前已经改到 `cameraX`。本仓库当前真相面以 `README.md`、`pages.json` 和实际文件为准：旧 `pages/camera/camera.vue` 路线已废弃，当前相机业务页是 `pages/cameraX/index.nvue`。历史 memory 只能作为背景线索，不能优先于当前 repo 文件。

### Suggested Action
后续处理 `uts-markvideo` 相机页、缩放、水印、拍照/录像 UI 时，先读 `README.md` 和 `pages.json` 确认入口，再进入 `pages/cameraX/index.nvue`；只有涉及旧迁移背景时才提 `pages/camera/camera.vue`。

### Metadata
- Source: user_feedback
- Related Files: README.md, pages.json, pages/cameraX/index.nvue
- Tags: cameraX, stale-memory, repo-truth, camera-ui
- See Also: LRN-20260622-C09, LRN-20260622-C10
- Pattern-Key: uts_markvideo.current_camera_entry_cameraX
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T23:55:16+08:00
- **Commit/PR**: pending
- **Notes**: Future audits should treat `README.md` and `pages.json` as the first truth surface and route current camera UI work to `pages/cameraX/index.nvue`.

---

## [LRN-20260622-C09] correction

**Logged**: 2026-06-22T22:45:16+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印右下角缩放 icon 要用真实 SVG 对角双向箭头，不能用文字符号代替。

### Details
用户先指出缩放 icon 不能是单向箭头，后续进一步指出 `⤡` 这类文字符号也不对，应该是实际 SVG/icon。`pages/cameraX/index.nvue` 的右下角缩放手柄应显示同一对角线上的双向箭头，但渲染方式必须是本地资产图标，例如 `/static/watermark/resize-diagonal.svg` 通过 `<image>` 引用。这个 icon 只是视觉提示，不应重新绑定右下角单指缩放逻辑。

### Suggested Action
后续调整水印编辑 UI 时，保留真实 SVG/icon 资产路径，不要退回 `watermarkResizeText`、`⤡` 或 `↘`。同时缩放上限只约束旋转后的可见水印内容不能超出编辑区域，删除、旋转、缩放手柄的外部占位不应参与水印内容最大缩放计算。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, static/watermark/resize-diagonal.svg, test/structure.test.mjs
- Tags: watermark, nvue, camera-ui, resize-icon, svg-icon, scale-clamp
- See Also: LRN-20260622-C07, LRN-20260622-C10
- Pattern-Key: uts_markvideo.watermark_resize_svg_content_clamp
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T23:27:38+08:00
- **Commit/PR**: pending
- **Notes**: The resize handle now renders `/static/watermark/resize-diagonal.svg` with `<image>`, and structure tests forbid text-arrow fallbacks. Scale clamping now uses visible content bounds instead of edit handle padding.

---

## [LRN-20260622-C10] best_practice

**Logged**: 2026-06-22T23:15:45+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
nvue 水印捏合缩放时不要重建 `movable-view`，也不要把预览态写回正式水印帧或原生层。

### Details
用户反馈水印缩放“又卡又抽搐”。commit 前审计确认两个高风险点：几何量驱动的 `:key` 会在 scale 变化时重建原生 `movable-view`；`updateWatermarkPinch()` 每帧调用 `updateWatermarkFrame()` 会同步改外层 `x/y/width/height`，和原生拖拽组件争同一个手势状态。`watermarkMoveDisabled` 如果跟随 `watermarkPinchGesture` 切换，也可能让原生组件取消当前手势。

### Suggested Action
后续修改水印贴纸交互时，保持正式状态稳定：不要用 scale/rotation 生成动态 key；不要在 pinch move 中调用 `updateWatermarkFrame()`、`scheduleWatermarkSync()` 或 `setWatermark()`；缩放中的预览布局可读取 `commitFrame` 让外层盒子变大，`touchend` 后再一次性提交 frame 并同步原生。删除、旋转、缩放按钮继续作为同一移动根里的 sibling，坐标锚定未旋转编辑框角点。

### Metadata
- Source: user_feedback_and_subagent_audit
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: nvue, movable-view, watermark, pinch, performance
- See Also: LRN-20260622-C01, LRN-20260622-C02, LRN-20260622-C07
- Pattern-Key: uts_markvideo.watermark_pinch_stable_outer_movable
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T23:15:45+08:00
- **Commit/PR**: pending
- **Notes**: `pages/cameraX/index.nvue` keeps official watermark state and native sync stable during pinch, removes dynamic geometry keys, and commits/syncs only after pinch end. A later clipping fix allows the preview layout box itself to grow from `commitFrame` while keeping state writes deferred.

---

## [LRN-20260622-C08] correction

**Logged**: 2026-06-22T22:29:31+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
相机 UI 横屏不旋转不能只靠 `manifest.json` / `pages.json` 配置，要用真机验证 Activity 是否真的锁住竖屏。

### Details
用户在手机开启自动旋转后横向握持，发现 `pages/cameraX/index.nvue` 相机 UI 仍跟着横屏旋转。此前只加 `app-plus.screenOrientation`、`globalStyle.pageOrientation` 和页面宽高归一化，测试能过，但真机运行时宿主 Activity 仍响应系统旋转。当前 Android 主路径需要在 `XycNativeCameraView` 挂载和重新获得焦点时调用宿主 Activity 的 `requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT`，把相机业务页固定成竖屏比例。

### Suggested Action
后续处理相机方向问题时，先区分“页面配置声明”和“运行时 Activity 是否实际锁定”。结构测试要保护 `lockHostActivityToPortrait()`，但最终验收仍要用 N9500 开启自动旋转后横握手机，确认相机 UI 不旋转、水印坐标和拍照/录像烧录仍一致。

### Metadata
- Source: user_feedback
- Related Files: manifest.json, pages.json, pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: android, nvue, camera-ui, orientation, portrait-lock
- Pattern-Key: uts_markvideo.android_camera_runtime_portrait_lock
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T22:29:31+08:00
- **Commit/PR**: pending
- **Notes**: Android native camera view now requests portrait orientation from the host Activity at init and window-focus time, with structure-test coverage.

---

## [LRN-20260622-C06] best_practice

**Logged**: 2026-06-22T21:42:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
拍照水印清晰度要从高分辨率 picture size 和预览到照片画布的坐标映射一起保证。

### Details
用户指出拍照水印分辨率也不高。录像为了 30fps 稳定可以控制在 1080p 级输出，但拍照不应沿用录像的低分辨率思路，也不能只提高 JPEG quality。Android Camera1 应显式选择 `supportedPictureSizes` 中较高的照片尺寸，并在照片烧录时按相机页面的全屏 center-crop 预览模型，将页面预览坐标反推到照片画布，再用 Canvas 以照片分辨率重绘文字、背景和图片。不能用 aspect-fit 的 `min(output/preview)` 留白映射，否则预览和相册照片的水印位置/大小会漂移。纯图片水印仍受源素材分辨率限制；`static/watermark/logo2.png` 曾经只有 `128x128`，放大超过源图尺寸后无法凭代码生成真实细节。

### Suggested Action
后续优化拍照质量时，先检查 `setPictureSize()`、`PHOTO_JPEG_QUALITY`、`watermarkOutputTransform()` 和 `drawWatermarkOnPhoto()` 的 center-crop 坐标映射，而不是只改压缩质量或录像尺寸。若纯图片模板仍模糊，替换高分辨率 logo 素材。

### Metadata
- Source: user_feedback
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, static/watermark/logo2.png, test/structure.test.mjs
- Tags: android, camera, photo-quality, watermark, canvas
- See Also: LRN-20260622-C04
- Pattern-Key: uts_markvideo.android.photo_watermark_quality_mapping
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T21:58:00+08:00
- **Commit/PR**: pending
- **Notes**: Android now sets a high-resolution picture size, raises JPEG quality to 96, maps preview coordinates into the photo canvas with `watermarkOutputTransform()`, avoids an extra full-size bitmap copy when possible, and `static/watermark/logo2.png` has been replaced with a 1024x1024 source asset protected by tests.

---

## [LRN-20260622-C07] correction

**Logged**: 2026-06-22T21:58:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印缩放不要再绑定右下角单指手柄，nvue 主路径改为主体双指捏合。

### Details
用户反复指出缩放 icon 和缩放功能异常。根因之一是缩放使用 `distanceBetween(point, anchor)`：手指朝左上拖会变小，但一旦越过左上锚点，距离又开始变大，水印就会反向重新放大或跳动。真机复测还暴露了第二层问题：nvue 右下手柄的 touch 坐标不一定是页面绝对坐标，可能是局部坐标；直接把 `touchPoint(event)` 当页面坐标会导致左上拖反而放大、右下拖反而缩小。进一步修正后确认，手柄不能脱离 `movable-view` 移动根，否则内容走了手柄还在原地。用户补充 DCloud `movable-view` 官方文档后确认：普通 uni-app 组件支持 `scale`，但 `movable-area` 文档同时标注 app-nvue 平台暂不支持手势缩放。当前 `pages/cameraX/index.nvue` 是 nvue 页面，因此更稳的主路径不是右下角单指手柄，也不是完全依赖原生 `scale-value`，而是保留 `movable-view` 同根拖拽，同时在水印主体上用双指 touch 距离计算缩放；右下角 icon 只作贴纸缩放提示，不绑定 `touchmove`。

### Suggested Action
后续改水印缩放时保持三条约束：`movable-view` 只负责单指拖拽；主体双指捏合才更新 `watermarkFrame.scale`；右下角 resize icon 不再绑定 `@touchmove.stop="moveWatermark"` 或任何单指缩放算法。不要恢复 `resolveResizePointMode()`、`resizeGesturePoint()`、`watermarkResizeVector()`、`resizeProjectionRatio()` 这套右下角手写缩放链路。结构测试应保护 `startWatermarkPinch()` / `updateWatermarkPinch()` 和旧 resize 入口不存在，并用 N9500 双指捏合复测。

### Metadata
- Source: user_feedback_and_subagent_audit
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: nvue, watermark, sticker-ui, resize, gesture
- See Also: LRN-20260622-A01, LRN-20260622-C05
- Pattern-Key: uts_markvideo.watermark_resize_signed_projection
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T22:20:00+08:00
- **Commit/PR**: pending
- **Notes**: The unstable right-bottom single-finger resize path was removed. Sticker controls remain in the same `movable-view` movement root, while scaling is handled by two-finger pinch on the watermark body and guarded by structure tests.

---

## [LRN-20260622-C05] correction

**Logged**: 2026-06-22T21:35:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
nvue 水印内容用 `movable-view` 拖动时，外部删除/旋转/缩放控件必须跟随同一个可见 frame。

### Details
用户指出“拖拽的时候水印走了，icon 还在原地”。前一版只让外部控件读取 `watermarkVisibleFrame()` 仍然不够，因为水印内容由 `movable-view` 原生位移展示，独立放在 `movable-view` 外的普通 `view` 控件只能靠 JS 样式刷新追赶，真机上会脱节。正确模型是控件和内容同属一个 `movable-view` 移动根，只有 `watermarkTransformBox` 旋转，delete/rotate/resize 是不旋转的 sibling；拖动结束后再把 draft commit 回 `watermarkFrame`，原生 `setWatermark()` payload 读取同一个可见 frame。

### Suggested Action
后续修改水印贴纸交互时，不要让内容、控件、原生 payload 分别读取不同坐标源，也不要把编辑控件挪出 `movable-view` 移动根。只要使用 `movable-view` 的非受控拖拽，就要保留 `watermarkVisibleFrame()` / `watermarkFrameFromMovePosition()` 这层转换，并用测试保护控件在同一移动根内、旋转层外。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: nvue, movable-view, watermark, sticker-ui, drag
- See Also: LRN-20260622-C01, LRN-20260622-C03
- Pattern-Key: uts_markvideo.watermark_visible_frame_single_source
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T21:35:00+08:00
- **Commit/PR**: pending
- **Notes**: The edit handles now live inside the same `movable-view` as the watermark content, but outside the rotated content layer; this keeps icons moving with the sticker while remaining visually upright.

---

## [LRN-20260622-C04] best_practice

**Logged**: 2026-06-22T20:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
水印录像的输出尺寸和码率不能从预览控件尺寸或 720p 临时上限反推。

### Details
`XycNativeCameraView.kt` 的录像链路会用 `PixelCopy` 把预览帧复制到编码 bitmap，再把水印画到同一帧里。如果输出尺寸来自 `previewView.width/height` 或被 `1280x720` / `921_600` 像素上限压低，视频和水印会一起变糊；即使水印文字是原生 Canvas 重绘，也会被低分辨率帧限制。

### Suggested Action
录像质量策略应优先使用相机支持的 1080p 级视频尺寸，并按输出像素和 30fps 设置足够码率。结构测试要保护 1920x1080 上限和高码率区间，避免以后为了性能或临时调试回退到 720p。

### Metadata
- Source: user_feedback
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: android, camera, video-quality, watermark, media-codec
- Pattern-Key: uts_markvideo.android.watermark_video_quality
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T20:15:00+08:00
- **Commit/PR**: pending
- **Notes**: Android recording now chooses 1080p-capped camera/video size and uses a higher bitrate guard.

---

## [LRN-20260622-C03] correction

**Logged**: 2026-06-22T19:45:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
相机水印应按贴纸交互拆分手势：内容拖拽，右下角锚点只缩放。（已被 C07 的 nvue 双指捏合方案覆盖）

### Details
水印编辑如果把缩放锚点放进旋转内容层，右下角长按缩放会和内容拖拽、内容旋转抢手势。早期判断认为右下角锚点可以用 `.stop` 只处理缩放，不触发 movable 拖拽；后续真机和官方文档复核后，这个缩放部分已被 C07 覆盖：nvue 主路径改为水印主体双指捏合，右下角图标只作视觉提示，不再承载单指缩放。仍然保留的正确结论是：`movable-view` 作为贴纸统一移动根，内容层负责视觉旋转，删除、旋转、缩放控件作为不旋转 sibling 锚定水印未旋转编辑框角点。此前把控件挪到 `movable-view` 外部虽然避免了手势抢占，但真机会出现内容移动、icon 留在原地的脱节。

### Suggested Action
后续改水印贴纸交互时，保持 delete/rotate/resize 控件在同一个 `movable-view` 移动根内、旋转内容层外。不要按本条早期说法恢复右下角单指缩放；缩放以 C07 为准，使用主体双指捏合。结构测试应保护“控件在 movable-area 内、transformBox 后面”的约束。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: watermark, sticker-ui, nvue, gestures, movable-view
- Pattern-Key: uts_markvideo.watermark_sticker_gesture_split
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T19:45:00+08:00
- **Commit/PR**: pending
- **Notes**: Earlier independent-overlay guidance was corrected after true-device evidence showed icon/content separation. The right-bottom single-finger scaling part is superseded by C07; current tests protect same-root sticker controls, two-finger pinch scaling, and no legacy resize handler.

---

## [LRN-20260622-C02] correction

**Logged**: 2026-06-22T19:38:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印旋转只能作用在内容层，删除、旋转、缩放编辑控件必须锚定未旋转编辑框角点。

### Details
在 `pages/cameraX/index.nvue` 的水印编辑 UI 中，即使控件不是 transform 子节点，如果外层 `movable-view` 尺寸和子控件定位都按旋转外接框粗暴取整，按钮仍会看起来跟着旋转漂移或出现 1px 级偏移。正确模型是：旋转内容层独立居中旋转；外层容器取未旋转编辑框和旋转内容外接范围的最大尺寸防裁剪；编辑控件坐标用未旋转编辑框角点计算，并避免父层和子层双重整数舍入。

### Suggested Action
后续修改水印旋转、拖拽、缩放时，保持 `watermarkTransformStyle` 只包内容，`watermarkRotateStyle` / `watermarkDeleteStyle` / `watermarkResizeStyle` 只锚定未旋转编辑框。保留 `watermark edit handles stay anchored while content rotates` 几何测试，不要放宽成肉眼允许漂移。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs, docs/watermark-template-camera-prd.md
- Tags: watermark, nvue, rotation, movable-view, geometry
- Pattern-Key: uts_markvideo.watermark_controls_unrotated_anchor
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T19:38:00+08:00
- **Commit/PR**: pending
- **Notes**: Verified with `npm test`, HBuilderX Android compile, and N9500 screenshot `screenshots/watermark-rotation-after-tap.png`.

---

## [LRN-20260622-C01] best_practice

**Logged**: 2026-06-22T19:17:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
nvue 相机预览上的水印拖拽优先用 `movable-area` + `movable-view`，拖动中不要反向重算 `x/y` 或同步原生。

### Details
参考 `TC-movable-area-view_1.0.4_example.zip` 后确认，稳定拖拽路径是让 `movable-view` 作为 `movable-area` 的直接子节点，由原生组件接管位移。页面只记录 `change.detail.x/y`，并在松手时转换成水印 frame。旧路径在拖动中用 computed `watermarkFrame -> x/y` 反向绑定，同时每 160ms 调用 `setWatermark()`，容易造成抖动、回弹或卡顿。后续真机反馈进一步确认：编辑控件也必须放在同一个 `movable-view` 移动根里，否则内容原生移动时外部 icon 会停在旧位置。

### Suggested Action
后续改水印拖拽时保持四条约束：`movable-view` 直接挂在 `movable-area` 下；水印内容和 delete/rotate/resize 控件共用这个移动根；`@change` 只更新草稿坐标，不调用 `updateWatermarkFrame()`、`scheduleWatermarkSync()` 或 `setWatermark()`；松手、拍照前和录像前再 flush 最新水印到原生。

### Metadata
- Source: external_example_and_device_verification
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs, docs/watermark-template-camera-prd.md
- Tags: uni-app-x, nvue, movable-view, watermark, android-ui, n9500
- Pattern-Key: uts_markvideo.watermark_movable_view_uncontrolled_drag
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T19:17:00+08:00
- **Commit/PR**: pending
- **Notes**: HBuilderX 5.07 compile passed, Node structure tests passed, and N9500 screenshots confirmed content-area dragging plus fixed control handles.

---

## [LRN-20260622-B01] best_practice

**Logged**: 2026-06-22T15:48:27+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
录像停止后的 UI 不能用固定 `setTimeout` 把“视频保存中”伪装成“视频已保存到相册”。

### Details
用户指出 4 秒左右的停止录像兜底是假完成。正确路径是：`stopRecord()` 可以立即返回“视频保存中”，但页面必须等待原生 `recorddone` 或 `nativeerror` 决定最终状态；原生侧要在 `recorddone` payload 暴露 `recordFinishMs`、`recordAlbumSaveMs`、`recordTotalSaveMs`、帧数和文件大小，先定位慢在编码收尾还是相册写入。Android 10+ 录像应直接创建 MediaStore pending item，并用 `MediaMuxer(FileDescriptor, ...)` 写入，完成后只 publish `IS_PENDING=0`；Android 9 及以下已有相册写权限时，优先直接录到 `Movies/xyc-markvideo`，停止后只扫描，避免 cache 到相册的二次复制。

### Suggested Action
以后优化保存速度时先看 `XycMarkVideo` logcat 的 `record stop timing`，不要新增“保存中 N 秒后显示成功”的页面兜底。若需要超时，只能显示真实超时/失败状态，不能显示保存成功。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: video-recording, watermark, android, performance, truth-first-ui
- Pattern-Key: uts_markvideo.record_save_no_fake_success_timeout
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T15:48:27+08:00
- **Commit/PR**: pending
- **Notes**: Removed the stop-record pending timer, added native timing payload/logging, made Android 10+ video write directly to MediaStore, and made legacy Android recording write directly to the album directory.

---

## [LRN-20260622-A01] best_practice

**Logged**: 2026-06-22T15:00:04+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印右下角缩放/旋转手柄要让手指方向和水印视觉方向一致，不能用中心点重算 left/top。（右下角缩放已被 C07 的 nvue 双指捏合方案覆盖）

### Details
用户指出“按住右下放大缩小图标往上移动，水印会往相反方向走/向下倾斜”。根因是旧实现把缩放和连续旋转绑在同一个右下手柄上，手指方向和视觉方向很容易冲突。这里关于“右下手柄只缩放”的中间结论已被后续 C07 覆盖：nvue 主路径不再使用右下角单指缩放，改为主体双指捏合；仍然保留的正确结论是旋转独立出来，左上角按钮每次顺时针旋转 90 度。

### Suggested Action
后续修改水印手势时，不要恢复右下缩放分支，也不要重新加入 `nextAngle`、`watermarkGesture.angle` 或 `watermarkGesture.rotation`。缩放统一走 C07 的主体双指捏合；旋转统一走左上角 `rotateWatermarkQuarterTurn()` 的 90 度步进按钮。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: watermark, nvue, gesture, transform-origin, android-ui
- Pattern-Key: uts_markvideo.watermark_resize_anchor
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T15:00:04+08:00
- **Commit/PR**: pending
- **Notes**: This entry is partially superseded by C07. `pages/cameraX/index.nvue` now separates scaling and rotation: scaling is two-finger pinch on the watermark body, the right-bottom handle is visual only, and the left-top button rotates 90 degrees.

---

## [LRN-20260622-001] best_practice

**Logged**: 2026-06-22T13:49:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
N9500 adb `input tap` must use physical device coordinates from `adb shell wm size`, not the scaled screenshot display size shown in Codex.

### Details
The SM-N9500 screenshot may render in Codex at a scaled width, while `adb shell input tap` expects physical coordinates. In this session the displayed screenshot looked about 1080px wide, but `adb shell wm size` reported `1440x2960`; tapping with displayed coordinates missed the `进入相机` and `水印设置` buttons. Converting to physical coordinates fixed navigation and allowed reliable camera verification.

### Suggested Action
Before adb-driven UI testing, run:

```bash
/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb shell wm size
```

Then calculate tap coordinates against that physical size, or use conservative button centers from the physical coordinate system.

### Metadata
- Source: error
- Related Files: screenshots/
- Tags: adb, n9500, screenshot-verification, coordinate-scaling
- See Also: LRN-20260621-002
- Pattern-Key: uts_markvideo.n9500_adb_physical_coordinates
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T13:49:00+08:00
- **Commit/PR**: pending
- **Notes**: Used physical taps such as `720 1695` to enter camera and `720 2550` to operate the shutter on SM-N9500.

---

## [LRN-20260622-LEGACY01] best_practice

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

## [LRN-20260622-001] correction

**Logged**: 2026-06-22T15:39:40Z
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
水印旋转后 icon 错位不是单纯坐标公式问题，而是内容和编辑控件不在同一个旋转层。

### Details
用户真机截图显示水印内容旋转后，delete/rotate/resize 控件仍停在旋转前的横向位置。先前只调整外层坐标或 key 的做法不能解决，因为 `watermarkContent` 在 `watermarkTransformBox` 内旋转，而控制按钮作为兄弟节点仍按未旋转坐标定位。正确结构是让内容、边框和控制按钮共享同一个旋转容器；如果按钮图形要保持正向，再对按钮内部文本或图片做反向旋转。

### Suggested Action
以后修这类 nvue 视觉变换问题时，先检查 DOM 层级和 transform 坐标系，再写回归测试防止“内容变了、控件留在旧位置”的结构复发。真机验证必须以相机页旋转后的截图为准；HBuilderX CLI 卡住或只生成 dev 产物不能当作真机通过。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs, screenshots/
- Tags: watermark, rotation, nvue, transform-layer, android-ui
- Pattern-Key: uts_markvideo.watermark_controls_share_transform_layer
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

---

## [LRN-20260622-C12] correction

**Logged**: 2026-06-22T23:55:19+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
nvue 水印从小倍率再放大时，预览外层盒子必须跟着 pinch 的提交预览帧变大。

### Details
用户反馈水印从 1x 缩到 0.5x 后，再放大到 2x 时，外层会像 `overflow: hidden` 一样卡在旧的 1x/小倍率边界。根因是 `watermarkLayoutFrame()` 在 pinch 期间仍返回 `startFrame`，只靠内层 `scale()` 放大；`movable-view` 的 width/height 仍是旧尺寸，真机上会裁掉外扩部分。单独加 `overflow: visible` 不够可靠，因为 native 组件本身仍可能按旧布局盒裁剪。

### Suggested Action
后续修改 pinch 缩放时，用 `watermarkPinchPreviewFrame()` 合并 `startFrame` 和 `commitFrame` 给视觉层读取，但不要让 `watermarkMoveX/Y` 每帧读取预览帧反向驱动 `movable-view`。缩放期间移动根应保持稳定，视觉水印层在稳定根里定位和变大；仍然禁止在 pinch move 中调用 `updateWatermarkFrame()`、`scheduleWatermarkSync()`、`syncWatermarkToNative()` 或 `flushWatermarkSync()`。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: watermark, nvue, pinch, movable-view, clipping
- See Also: LRN-20260622-C10
- Pattern-Key: uts_markvideo.watermark_pinch_preview_frame
- Recurrence-Count: 1
- First-Seen: 2026-06-22
- Last-Seen: 2026-06-22

### Resolution
- **Resolved**: 2026-06-22T23:55:19+08:00
- **Commit/PR**: pending
- **Notes**: Added `watermarkPinchPreviewFrame()` and a regression test that fails when preview scale only transforms inside the old small layout box. This entry was later refined by LRN-20260623-C13 because driving `movable-view` x/y from the preview frame caused pinch flicker.

---

## [LRN-20260623-C13] correction

**Logged**: 2026-06-23T00:36:52+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
nvue 水印 pinch 缩放不能每帧改 `movable-view` 的 `x/y/width/height`，否则会忽大忽小闪烁。

### Details
用户反馈捏合放大缩小时“一会儿大一会儿小、闪烁”。这是 C12 防裁剪方案的副作用：让 `watermarkMoveX/Y` 和外层盒子尺寸每帧读取 `commitFrame`，等于在双指手势中反向驱动 nvue 原生 `movable-view` 移动根，和组件自己的手势状态互相打架。正确折中是 pinch 期间把 `movable-view` 固定成整个水印编辑区域画布，`x/y` 固定为 `0`，只让内部 `watermarkTransformBox` 按预览帧定位和变大。

### Suggested Action
后续处理水印缩放时，保持三层分工：`movable-area` 是编辑范围；pinch 期间 `movable-view` 是稳定全区域画布；`watermarkTransformBox` 才读取 `watermarkPinchPreviewFrame()` 更新视觉位置、尺寸和旋转。不要恢复 `return this.watermarkMovePositionFromFrame(pinchFrame).x/y` 这类每帧驱动移动根的写法。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: watermark, nvue, pinch, movable-view, flicker
- See Also: LRN-20260622-C10, LRN-20260622-C12
- Pattern-Key: uts_markvideo.watermark_pinch_stable_canvas_root
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T00:36:52+08:00
- **Commit/PR**: pending
- **Notes**: `pages/cameraX/index.nvue` now fixes `watermarkMoveX/Y` to `0` during pinch, sizes the root to the edit area, and positions the visual transform box from the preview frame. Structure tests passed.

---

## [LRN-20260623-C14] correction

**Logged**: 2026-06-23T10:53:47+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
相机页小型工具按钮应优先用常见简洁图标和外层热区触发，不要用复杂多线段图标并给子节点重复绑事件。

### Details
用户反馈闪光灯旁的切换摄像头 icon 太复杂，并且按钮未生效。更稳的做法是参考主流相机 UI 的切换符号，把事件只绑在外层 `cover-view` 热区，内部只显示一个简单 glyph，避免子节点事件、`click`/`touchend` 双触发和节流互相影响。

### Suggested Action
后续修改 `pages/cameraX/index.nvue` 的 native preview 覆盖控件时，操作按钮保持外层 tap area + 内部单一图标。若用户反馈点击不生效，先检查事件是否只绑定在外层热区；只有真机确认 `click` 不可靠时，再单独评估 `touchend` 兜底，避免默认双绑定。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, cover-view, icon, tap-area, nvue
- Pattern-Key: uts_markvideo.camera_overlay_controls_outer_tap_area
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T10:53:47+08:00
- **Commit/PR**: pending
- **Notes**: Replaced the multi-line switch-camera glyph with a single switch icon and kept one click handler on the outer tap area. Node tests passed.

---

## [LRN-20260623-C17] correction

**Logged**: 2026-06-23T11:12:13+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
锁竖屏相机页不能用 `defaultDisplay.rotation` 或页面宽高判断拍照输出方向。

### Details
用户纠正：横着拍时，相册里应该仍然是横向图像；竖着拍时，相册里才应该是竖向图像。当前 `cameraX` 页面把宿主 Activity 锁成 portrait，所以 `windowManager.defaultDisplay.rotation` 不再等于用户物理拿手机的方向。预览显示方向仍可用 Camera1 的 `setDisplayOrientation()` 公式，但 JPEG `parameters.setRotation()` 和录像输出尺寸必须使用 `OrientationEventListener` 捕获的物理设备方向。

### Suggested Action
后续处理 Android Camera1 输出方向时，区分 preview display orientation 和 capture output rotation：预览用 display rotation；拍照/录像输出用 device orientation listener。不要在页面层用窗口宽高、portrait layout 或相册结果再做二次旋转。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, android, camera1, orientation, photo-output, recording-output
- See Also: LRN-20260623-C14
- Pattern-Key: uts_markvideo.camera_output_uses_device_orientation
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T11:12:13+08:00
- **Commit/PR**: pending
- **Notes**: Added `OrientationEventListener` for capture rotation while keeping preview display orientation separate. Structure tests guard against using display rotation for capture output.

---

## [LRN-20260623-C19] correction

**Logged**: 2026-06-23T11:45:28+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印旋转后拖拽范围变窄时，`movable-view` 移动根和 clamp 必须使用同一套旋转外接框。

### Details
用户截图显示旋转后的水印横向拖拽只剩中间窄条。根因是 90 度宽水印旋转后，移动根仍按未旋转宽度参与计算，会把原生 `movable-view` 可移动范围压缩；进一步 commit 前审计发现，如果移动根改成旋转外接框，但 `clampWatermarkFrame()` 仍按不含手柄的内容外接框夹边，边缘会输出负 `x` 或超过原生最大 `x`，导致原生二次夹边和边缘跳动。

### Suggested Action
后续修改 `pages/cameraX/index.nvue` 的水印旋转/拖拽几何时，`watermarkBoxMetrics()`、`watermarkMovePositionFromFrame()`、`watermarkFrameFromMovePosition()` 和 `clampWatermarkFrame()` 必须共享 handle-inclusive rotated container bounds。测试要覆盖 90 度宽水印的可移动宽度，以及贴近四个边缘时输出给 `movable-view` 的 `x/y` 不越界。

### Metadata
- Source: user_feedback_and_subagent_audit
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, nvue, watermark, rotation, movable-view, drag
- See Also: LRN-20260623-C13, LRN-20260622-C10
- Pattern-Key: uts_markvideo.rotated_watermark_drag_root_bounds
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T11:45:28+08:00
- **Commit/PR**: pending
- **Notes**: `watermarkBoxMetrics()` now uses rotated external bounds for the root, and `clampWatermarkFrame()` clamps with the same `containerWidth/containerHeight`. Structure tests cover both movement range and native-bound edge output.

---

## [LRN-20260623-C20] best_practice

**Logged**: 2026-06-23T13:34:28+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
纯图片水印模板的默认框必须由图片尺寸、模板 padding 和图文 gap 反推，不能只按 viewport 比例给框。

### Details
Android 真机截图显示纯图片水印 logo 顶部被浅灰背景框裁掉。根因是 `image-logo` 模板的图片为 `72x72`、`boxPadding=12`，但旧默认高度在紧凑相机视口下会落到 `64px`，小于 `72 + 12 * 2 = 96`；同时 nvue 预览曾经用静态 CSS `padding: 10px` 和 `.watermarkImage { margin-right: 8px }`，与 native payload 的 `boxPadding` / `imageTextGap` 不一致。修复时应让模板 frame 最小尺寸覆盖 `imageWidth + imageTextGap + textWidth + padding * 2`、`imageHeight + padding * 2`，纯图片无文字时 gap 必须为 0。

### Suggested Action
后续新增或调整水印模板时，先用模板内容尺寸计算预览 frame 和 native payload；不要只调 `boxWidth/boxHeight` 比例，也不要在 CSS 里保留与模板字段重复的静态 padding/margin。回归测试应覆盖紧凑视口下纯图片模板不会小于图片加 padding 的最小框。

### Metadata
- Source: user_feedback_and_subagent_audit
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, nvue, watermark, image-template, clipping
- See Also: LRN-20260623-C19, LRN-20260622-C12
- Pattern-Key: uts_markvideo.image_watermark_frame_min_content_size
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T13:34:28+08:00
- **Commit/PR**: pending
- **Notes**: Added template minimum frame sizing and dynamic nvue image padding/gap. `npm test` and `git diff --check` passed. Later true-device rerun confirmed the third-template to second-template path with `screenshots/adb-switchfix-third-to-second-final-20260623-1404.png`.

---

## [LRN-20260623-C21] best_practice

**Logged**: 2026-06-23T14:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
水印模板切换必须先清掉旧 move/pinch/sync 状态并重建 nvue 移动根，再渲染新模板。

### Details
用户反馈从第三个图文模板切到第二个纯图片模板后，纯图片水印又出现残缺。根因不是纯图片模板本身的最小尺寸，而是切换路径可能让新 `activeWatermark` 先进入渲染，同时旧 `watermarkMoveDraft`、`watermarkPinchGesture` 或 nvue 原生 `movable-area` 子树仍保留第三模板的布局状态。正确顺序是：清 `watermarkSyncTimer`、pinch、move draft，按新模板计算并落下 `watermarkFrame` / `watermarkMovePosition`，递增稳定的 `watermarkRenderKey` 让 nvue 重建移动根，最后再替换 `activeWatermark`。

### Suggested Action
后续修改模板切换、恢复存储模板或重建水印 UI 时，不要先赋值 `activeWatermark` 再补 frame；需要重建图片/内容时，把 `:key="watermarkRenderKey"` 放在内部视觉内容层，不要放在原生 `movable-area` 根上。回归测试应同时覆盖源码顺序和状态序列：先选 `mixed-site`，再选 `image-logo`，第二次后的 frame/payload 高度必须至少为 `imageHeight + boxPadding * 2`。参见 LRN-20260623-C22。

### Metadata
- Source: user_feedback_and_subagent_audit
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, nvue, watermark, template-switch, movable-view, clipping
- See Also: LRN-20260623-C20, LRN-20260623-C13
- Pattern-Key: uts_markvideo.watermark_template_switch_state_reset
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T14:05:00+08:00
- **Commit/PR**: pending
- **Notes**: `applyWatermarkTemplate()` now clears old gesture/sync state, sets the new frame before `activeWatermark`, increments `watermarkRenderKey`, and true-device screenshot `screenshots/adb-switchfix-third-to-second-final-20260623-1404.png` confirms the third-to-second path no longer clips the logo.

---

## [LRN-20260623-C22] correction

**Logged**: 2026-06-23T14:22:00+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
水印模板切换不能用 `watermarkRenderKey` 重建原生 `movable-area` 根，否则位置会出现两阶段跳动。

### Details
用户反馈模板切换后水印会先出现在 `x1/y1`，约 0.5s 后跳到更低更右的 `x2/y2`，截图可能捕捉不明显。根因判断是上一轮为解决纯图片残缺把 `:key="watermarkRenderKey"` 放在 `<movable-area>` 上，导致 nvue 原生拖拽根被重建；随后绑定的 `watermarkMovePosition` 和晚到的 native `change` 事件会再次接管位置。同时 `handleWatermarkMoveChange()` 不应允许没有真实 `touchstart` 的 `source='touch'/'friction'` 等事件自行开启 move draft。

### Suggested Action
模板切换仍要先清 `watermarkSyncTimer`、pinch、move draft，并先计算新 `watermarkFrame` / `watermarkMovePosition` 再替换 `activeWatermark`；但 `watermarkRenderKey` 应下移到 `watermarkTransformBox`。`handleWatermarkMoveChange()` 只在 `watermarkMoveActive` 已由 `startWatermarkMove()` 开启时接受坐标，并在模板切换短窗口内关闭视觉 transition。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, nvue, watermark, template-switch, movable-view, position-jump
- See Also: LRN-20260623-C21
- Pattern-Key: uts_markvideo.watermark_template_switch_single_position_source
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

---

## [LRN-20260623-C23] correction

**Logged**: 2026-06-23T15:12:32+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
`logo3.png` 本身是正向素材，不能继续沿用 `logo2.png` 的上下翻转补偿。

### Details
用户反馈换成 `logo3` 后水印上下颠倒。根因是此前为 `logo2.png` 方向问题在 nvue 预览层 `watermarkImageStyle()` 加了 `scaleY(-1)`，并在 Android `drawWatermarkOnPhoto()` 绘制图片前局部 `canvas.scale(1f, -1f, center)`；换成正向 `logo3.png` 后，这两个补偿会把图片再次翻转。

### Suggested Action
水印图片方向修复必须绑定当前素材验证：换 logo 时同步检查 nvue 预览、Android 照片烧录、录像 overlay 是否还需要翻转。默认保持源图方向绘制；只有当前素材和运行输出明确相反时才加局部补偿，并用测试禁止遗留旧补偿。

### Metadata
- Source: user_feedback
- Related Files: static/watermark/logo3.png, pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, watermark, image-orientation, logo3, android, nvue
- See Also: LRN-20260623-C14
- Pattern-Key: uts_markvideo.watermark_logo_asset_specific_orientation
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

---

## [LRN-20260623-C24] best_practice

**Logged**: 2026-06-23T22:40:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
录像开始/停止反馈音要保留，但不能进入麦克风录制窗口。

### Details
用户先反馈成片开头能听到录像开始提示音，随后明确纠正：不能通过取消录像开始声音来“解决”，iOS 开始录像也有反馈音。正确合同是保留拍照、录像开始、录像停止声音反馈，同时调整时序：开始音应在 `AudioRecord` 启动前播放并留出隔离窗口，停止音应在录音/封装结束后播放，避免系统反馈音被麦克风录进 AAC 音轨。

### Suggested Action
Android 录像反馈不要删除 `MediaActionSound.START_VIDEO_RECORDING` / `STOP_VIDEO_RECORDING`；应把 recorder/audio 启动从主线程移到后台，并让开始音发生在 `AudioRecord` 前，必要时丢弃启动暖机音频。页面层还应提供点击震动，真机检查成片音轨开头没有提示音。

### Metadata
- Source: user_feedback
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, android, audio, MediaActionSound, recording
- Pattern-Key: uts_markvideo.recording_feedback_sound_not_in_audio_track
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

---

## [LRN-20260623-C25] best_practice

**Logged**: 2026-06-23T23:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Android 录像首秒卡顿要用 mp4 packet 时间戳验证，不能只靠 UI 体感或目标 fps 常量。

### Details
用户反馈录像开头仍卡一秒。真机 mp4 经 `ffprobe -show_packets` 证明第一帧 packet duration 约 `1.4s`，同时视频流仍是 `480x640`、约 `2.7-3.1 Mbps`。正确修法不是把 PTS 硬改成固定 30fps，因为设备实际只能处理 20fps 左右时会导致视频时长被压短；应让第一帧从 0 开始，后续按真实帧间隔递增，并丢弃启动预热段。

### Suggested Action
后续排查 Android 录像卡顿时，先拉取最新 mp4 并看 `format/streams` 与前几条 video packets；如果第一包 duration 异常，优先检查 PTS 基准、muxer track readiness、启动预热和帧生产节奏。输出尺寸应按实际预览框约束，不要只相信 Camera1 `supportedVideoSizes`。

### Metadata
- Source: user_feedback
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, android, recording, pts, bitrate, ffprobe
- See Also: ERR-20260623-011, LRN-20260623-C24
- Pattern-Key: uts_markvideo.recording_start_packet_timing_probe
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T23:05:00+08:00
- **Commit/PR**: pending
- **Notes**: Added warmup discard for video/audio startup, switched video PTS to first-frame-zero plus real elapsed frame intervals, raised target bitrate, and added structure tests for the contracts.

---

## [LRN-20260623-C18] correction

**Logged**: 2026-06-23T11:26:37+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
前摄成片左右镜像不能只靠 preview orientation 和 capture rotation 修复。

### Details
用户反馈前置摄像头成片仍然左右颠倒。当前 Camera1 链路已经把预览显示方向和 capture rotation 分开，且初次修复加入了前摄源图/源帧水平反镜像；但如果保存时只相信 `requestedCameraFacing`，运行态相机 id 与请求状态不同步时仍可能漏掉前摄分支。正确处理顺序是：先从实际 `activeCameraId` 冻结前后摄状态，再纠正相机源图/源帧镜像，最后绘制水印；不能最后整体 flip 成片，否则水印文字也会左右颠倒。

### Suggested Action
后续处理前摄输出时，冻结当次拍摄或录像的实际 `activeCameraFacing()`，在保存路径里让前摄照片经过 `applyFrontCameraOutputMirror()`，让录像 PixelCopy 帧经过 `applyFrontCameraFrameMirrorIfNeeded()`，并让水印绘制发生在反镜像后的源图/源帧上。无水印前摄照片也要经过同样路径，不能只修有水印分支。

### Metadata
- Source: user_feedback
- Related Files: uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, android, camera1, front-camera, mirror, media-output
- See Also: LRN-20260623-C17
- Pattern-Key: uts_markvideo.front_camera_media_unmirror_before_watermark
- Recurrence-Count: 1
- First-Seen: 2026-06-23
- Last-Seen: 2026-06-23

### Resolution
- **Resolved**: 2026-06-23T11:26:37+08:00
- **Commit/PR**: pending
- **Notes**: Front-camera photo writing and recording frames now apply horizontal source unmirror before watermark drawing, and structure tests cover the no-watermark photo branch too.

---

## [LRN-20260624-C01] correction

**Logged**: 2026-06-24T10:27:41+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
水印缩放闪到左上角这类几帧级问题，先打实时几何日志，不要靠截图或模拟推断。

### Details
用户指出缩放时水印会在几帧内闪到左上角最小尺寸，模拟和截图不一定能复现。正确诊断路径是让真机缩放过程输出 `[WATERMARK_TRACE]`，同时记录页面计算 frame、渲染根位置、内容尺寸、外接框、容器尺寸、内部 transform 位置，以及 nvue `movable-view` 原生 `@change` 回来的 `x/y`，用日志判断是页面几何突变还是原生移动根突然回到 `0/0`。

### Suggested Action
后续排查 `pages/cameraX/index.nvue` 的水印缩放/拖拽抽搐时，优先看 `pinch-start`、`pinch-update`、`pinch-native-change`、`pinch-commit` 的 `rootX/rootY/rootW/rootH/frameLeft/frameTop/frameW/frameH/scale/contentW/contentH/boxW/boxH/containerW/containerH/innerX/innerY/nativeX/nativeY/rawScale/appliedScale`。不要先依赖截图模板匹配或本地模拟；让用户真机复现并贴连续日志，再基于跳变字段定位。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, watermark, nvue, pinch, logging, geometry
- See Also: LRN-20260623-C12, LRN-20260623-C13
- Pattern-Key: uts_markvideo.watermark_pinch_realtime_geometry_log
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

---

## [LRN-20260624-C02] best_practice

**Logged**: 2026-06-24T11:20:12+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
nvue 水印缩放闪到左上角时，不能把可见水印绑在会被原生 pinch 重置的 `movable-view` 根上。

### Details
真机日志证明，`pinch-start` 时页面计算仍正常：`rootX=63.84 rootY=85.12 frameLeft=69.84 frameTop=175.12 scale=1`。22ms 后 `pinch-native-change` 里原生移动根返回 `nativeX=0 nativeY=0`，同时页面计算的 `frameLeft=69.84 frameTop=175.12 scale=1 innerX=63.84 innerY=85.12` 仍正常。根因不是页面 frame 先塌缩，而是 nvue 原生 `movable-view` 在 pinch 开始时把移动根抢回 `0/0`；如果可见水印仍在这个根里面，就会出现几帧闪到左上角的最小态。

### Suggested Action
后续修水印 pinch 闪烁时，pinch 期间让 `movable-view` 只做透明手势平面并保持在可接触层；把可见的 `watermarkTransformBox` 放到 sibling 普通 overlay，由页面计算的 preview frame 驱动。不要在 pinch 活跃期间把可见水印放进会回 `0/0` 的原生 movable 根里。

### Metadata
- Source: device_log
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, watermark, nvue, pinch, movable-view, flicker
- See Also: LRN-20260624-C01, LRN-20260623-C12, LRN-20260623-C13
- Pattern-Key: uts_markvideo.watermark_pinch_visible_overlay_separate_from_native_root
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

---

## [LRN-20260624-C03] correction

**Logged**: 2026-06-24T13:44:40+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
CameraX 底部声音按钮应控制相机提示音，不是录音状态提示。

### Details
用户纠正“视频照片 switch 左边的按键”应该是声音 switch，点击后开启或关闭拍照提示音、录像开始提示音和录像结束提示音。之前把它做成“录音开/录音中”的状态提示是概念错位；录音音轨和相机操作提示音是两件事，UI 文案和 native 控制路径都应该使用 camera action sound / MediaActionSound 语义。

### Suggested Action
后续处理 CameraX 声音按钮时，页面状态应命名为 `cameraSoundEnabled` 一类，并通过 Android 组件桥传给 native；native 的 `playCameraActionSound()` 需要先检查开关，再决定是否播放 `SHUTTER_CLICK`、`START_VIDEO_RECORDING`、`STOP_VIDEO_RECORDING`。不要用 `recordAudioEnabled` 或“录音开”文案表达提示音开关。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/index.vue, uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt, test/structure.test.mjs
- Tags: cameraX, sound, MediaActionSound, ui-switch
- See Also: LRN-20260623-C24
- Pattern-Key: uts_markvideo.camera_action_sound_switch_not_record_audio
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

---

## [LRN-20260624-C04] correction

**Logged**: 2026-06-24T14:32:50+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 声音 switch 复用闪光灯样式时，不能复用多层点击和 prop watcher 双写。

### Details
用户反馈喇叭 icon 有问题，且声音开关一直显示开启、切换失败。commit 前审计确认：声音按钮外层、pill、icon、text 都绑定 `@click="toggleCameraSound"` 时，一次点击会冒泡成多次切换；同时页面乐观修改 `cameraSoundEnabled` 后，组件 prop watcher 又写一次 native，页面 ref 调用再写一次 native，会放大竞态和回滚。正确收敛是 UI 沿用闪光灯的 64x36 pill 视觉，但声音按钮只保留一个点击入口，并用 `cameraSoundPending` 防连点；native 写入只走页面显式 ref 调用，组件 watcher 不再重复写。

### Suggested Action
后续处理 CameraX 小 pill 控件时，先区分“视觉同款”和“交互同款”：如果没有闪光灯那套 pending/tap throttle，就不要在多层子节点重复绑定 click。对通过 prop 传入又通过 ref 调用的 native setter，保留一条写路径，避免 watcher 和页面方法同时写入。

### Metadata
- Source: user_feedback, subagent_audit
- Related Files: pages/cameraX/index.nvue, uni_modules/xyc-markvideo/utssdk/app-android/index.vue, test/structure.test.mjs
- Tags: cameraX, sound, nvue, click-bubbling, UTS, native-bridge
- See Also: LRN-20260624-C03
- Pattern-Key: uts_markvideo.camera_sound_switch_single_click_single_native_write
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T14:32:50+08:00
- **Commit/PR**: pending
- **Notes**: Sound switch now has one outer click handler, `cameraSoundPending`, empty native-return success handling, no emoji speaker, and no Android component prop watcher duplicate write.

---

## [LRN-20260624-C05] correction

**Logged**: 2026-06-24T14:40:22+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
CameraX 声音 switch 的图标要干净，切换后要给轻提示。

### Details
用户指出用多个 `cover-view` 拼出来的喇叭 icon 太丑，并要求开启/关闭有 alert 提示。当前拍摄控制区不适合阻塞式确认弹窗，最小正确处理是换成更轻的符号型声音标识，并在成功切换后用 `uni.showToast({ icon: 'none' })` 显示“提示音已开启/已关闭”。

### Suggested Action
后续处理 CameraX 底部小 pill 控件时，别为了避免 emoji 就堆复杂几何图形；优先选稳定、简洁的文本符号或已有工作样式。状态变化要同时更新 `nativeStatus` 和给用户可见轻提示，但不要在拍摄页使用阻塞式 modal 打断操作。

### Metadata
- Source: user_feedback
- Related Files: pages/cameraX/index.nvue, test/structure.test.mjs
- Tags: cameraX, sound, ui-icon, toast, nvue
- See Also: LRN-20260624-C04
- Pattern-Key: uts_markvideo.camera_sound_switch_clean_icon_toast_feedback
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T14:40:22+08:00
- **Commit/PR**: pending
- **Notes**: Replaced the blocky speaker glyph with a compact music-note text icon and added non-blocking `uni.showToast` feedback after successful toggles.

---

## [LRN-20260624-C06] best_practice

**Logged**: 2026-06-24T23:00:09+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
CameraX 顶栏可见控件必须高于浮动控件层，否则会出现“看得到但点不到”的假失效。

### Details
闪光灯按钮真机表现为点击后仍显示或提示“关”。复查 logcat 发现点顶栏时输入事件进入 `UniAppActivity`，但没有任何 `XycMarkVideo flash mode request`，说明不是 native 闪光灯不支持，而是页面点击没有到达 `cycleFlashMode()`。截图和样式层级显示 `zoomRail` 的 `z-index: 6` 高于 `topBar` 的旧 `z-index: 5`，透明/浮动层会覆盖顶栏右侧胶囊。将 `.topBar` 提到 `z-index: 8` 后，真机连续点击得到 `requested=on -> auto -> off`，HAL 也出现 `torch mode = 1`。

### Suggested Action
后续 CameraX 顶栏、zoom rail、record HUD、bottom panel 同屏叠层时，先检查可见层和可点击层是否一致。顶栏控制区要高于浮动 rail；如果视觉控件可见但没有 native 日志，优先怀疑层级/命中区域，不要直接改 native 闪光灯逻辑。

### Metadata
- Source: device_log, subagent_audit
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, flash, z-index, touch-hit-test, uvue
- See Also: LRN-20260624-C04
- Pattern-Key: uts_markvideo.topbar_controls_above_floating_rails
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T23:00:09+08:00
- **Commit/PR**: pending
- **Notes**: Raised `.topBar` above `.zoomRail`, added structure-test guards for the layer order, and verified on SM-N9500 with `requested=on/auto/off`.

---

## [LRN-20260624-C07] best_practice

**Logged**: 2026-06-24T23:00:09+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
uni-app x `.uvue` 闪光灯状态机的字符串值判断不要用 `===`/`!==` 锁关键 UI 状态。

### Details
页面曾把 flash cycle 的核心比较改成 `==` 后，生成 Kotlin 的循环逻辑能正确识别 `on/auto/off`。但 `flashModeText()`、`flashPillClass()`、`flashModeLabel()` 等 UI/提示路径仍保留 `===`/`!==`，生成 Kotlin 里也保留 `===`，可能导致 runtime string 值被误判为默认“关”。这类判断会让 native 已经 `requested=on applied=true actual=torch` 时，页面仍有机会显示或 fallback 到“关”。

### Suggested Action
在 `.uvue` 里处理来自 native payload 的小枚举字符串时，关键状态机和显示逻辑统一用可生成 Kotlin 值比较的写法，并在 `test/structure.test.mjs` 加 `doesNotMatch` 约束防止闪光灯路径重引入 `===/!==`。

### Metadata
- Source: device_log, generated_kotlin
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs, unpackage/cache/.app-android/src/pages/cameraX/index.kt
- Tags: cameraX, flash, uvue, uts, kotlin, string-comparison
- See Also: LRN-20260624-C06
- Pattern-Key: uts_markvideo.flash_string_value_comparison
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T23:00:09+08:00
- **Commit/PR**: pending
- **Notes**: Replaced flash UI/status comparisons with value comparison, generated Kotlin shows `==`, and `npm test` now guards against flash path `===/!==` regressions.

---
## [LRN-20260624-C09] correction

**Logged**: 2026-06-24T23:06:52+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
uni-app x CameraX 水印长按拖拽不能只依赖外层 `movable-view` 或 `longpress`，水印本体需要明确的拖拽命中层。

### Details
用户连续反馈“缩放可以了，但是长按拖拽还是不行”。先只加 `longpress`，再恢复 `movable-view @change` 和 `event.detail.x/y` 后，真机仍不能按住水印本体拖动。commit 前审计确认：用户实际按住的是内部 `watermarkContent`、`image`、`text` 子树，而拖动状态门槛 `watermarkMoveActive` 只在 `startWatermarkMove()` 里打开；如果本体触摸没有进入这条入口，`@change` 即使有坐标也会被丢弃。右下角 resize 图标也不能留成无语义命中区。

### Suggested Action
后续改水印交互时，保留非 pinch 移动根内的 `watermarkDragSurface`：放在 `watermarkContent` 上方、delete/rotate/resize 控件下方，覆盖同一个 handle pad 内区域，直接绑定 `startWatermarkTouch` / `moveWatermarkTouch` / `finishWatermarkTouch`。pinch sibling overlay 不放这个命中层；resize 图标如果只是视觉提示，要和 delete/rotate 一样 `.stop`，避免抢拖动。不要为了绕过问题放宽 `handleWatermarkMoveChange()` 的 `watermarkMoveActive` 门槛，除非真机日志证明只有 native change 没有 page touchstart。

### Metadata
- Source: user_feedback, subagent_audit
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, watermark, uvue, movable-view, drag, touch-hit-test
- See Also: LRN-20260624-C08, LRN-20260624-C02, LRN-20260623-C13, LRN-20260623-C14
- Pattern-Key: uts_markvideo.watermark_body_drag_surface
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T23:06:52+08:00
- **Commit/PR**: pending
- **Notes**: Added `watermarkDragSurface` above content and below handles, stopped resize touch propagation, added regression tests, and verified `npm test` plus `git diff --check`.

---

## [LRN-20260624-C10] correction

**Logged**: 2026-06-24T23:42:00+08:00
**Priority**: critical
**Status**: resolved
**Area**: frontend

### Summary
uni-app x `.uvue` CameraX 水印拖拽和缩放不能再混用 `movable-view` 原生位移和页面手写 touch 数学。

### Details
用户继续反馈“长按拖拽还是不行”，随后指出“甚至缩放都有问题了，会缩放到右下角开始，本质是缩放和拖拽出了问题”。这说明上一轮只补 `watermarkDragSurface` 仍是症状修补：非 pinch 状态下可见水印在 `movable-view` 里，同时 `watermarkDragSurface` 和父级也绑定 `touchstart/touchmove`，会让原生 `movable-view` 位移、页面 `touchmove` 手算位移、pinch sibling overlay 三套状态争同一份 frame。正确修复是把水印交互根改成普通绝对定位 `view`，由 `watermarkGesturePlaneStyleValue()` 统一读取 `watermarkMovePosition`；拖拽热区使用 `.stop`，避免子层触摸再冒泡到父层重复启动手势；缩放继续只走 `watermarkPinchPreviewFrame()` / `updateWatermarkFrame()` 的同一套 frame。

### Suggested Action
后续处理 `.uvue` CameraX 水印拖拽、缩放、旋转时，保持单一控制器：不要恢复 `<movable-area>` / `<movable-view>`，不要重新绑定 `:x/:y`、`@change` 或 `watermarkBoxStyleValue()` 到水印层。页面 touch 事件可以直接更新 `watermarkMoveDraft` 和 `watermarkMovePosition`，松手后再提交 frame；pinch 更新只写 pinch gesture 预览，结束时一次性提交。结构测试必须持续保护“无 movable-view 原生状态”和“拖拽热区 `.stop` 防重复触发”。

### Metadata
- Source: user_feedback, systematic_debugging
- Related Files: pages/cameraX/index.uvue, test/structure.test.mjs
- Tags: cameraX, watermark, uvue, drag, pinch, movable-view, touch-hit-test
- See Also: LRN-20260624-C08, LRN-20260624-C09, LRN-20260624-C02, ERR-20260623-001
- Pattern-Key: uts_markvideo.watermark_single_page_touch_controller
- Recurrence-Count: 1
- First-Seen: 2026-06-24
- Last-Seen: 2026-06-24

### Resolution
- **Resolved**: 2026-06-24T23:42:00+08:00
- **Commit/PR**: pending
- **Notes**: Replaced the watermark `movable-area/movable-view` root with a normal `view`, routed positioning through `watermarkGesturePlaneStyleValue()`, stopped drag-surface propagation, removed unused movable-only helpers, and added regression tests. `node --test test/structure.test.mjs` and `git diff --check -- pages/cameraX/index.uvue test/structure.test.mjs` passed.

---
