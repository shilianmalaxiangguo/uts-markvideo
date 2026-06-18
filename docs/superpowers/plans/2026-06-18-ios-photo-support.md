# iOS 拍照支持 实施计划

> **给代理执行用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务执行。步骤使用复选框（`- [ ]`）格式跟踪。

**目标：** 让 `uts-markvideo` 的 iOS 分支真正支持拍照，并把拍照结果回传到 demo 页和相册。

**实现思路：** 先把 `enablePhoto` 和拍照结果数组加进共享契约，再在 iOS 原生录制器里复用当前预览帧做水印照片，最后把页面展示和测试补齐。保持 Android 现有录像路径不变，只扩展公共结构和 iOS 行为。

**技术栈：** UTS、Swift、UIKit、AVFoundation、Photos、Node test

---

### 任务 1：先把共享契约写成拍照版本

**文件：**
- 修改：`uni_modules/uts-markvideo/utssdk/interface.uts`
- 修改：`uni_modules/uts-markvideo/utssdk/app-ios/index.uts`
- 测试：`test/structure.test.mjs`

- [ ] **步骤 1：先写失败测试**

```js
test('iOS recorder can optionally capture watermarked photos', async () => {
  const interfaceText = await readFile(path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'), 'utf8')
  const iosBridge = await readFile(path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'), 'utf8')
  const swift = await readFile(path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'), 'utf8')
  const manifest = await readFile(path.join(root, 'manifest.json'), 'utf8')
  const iosPlist = await readFile(path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/Info.plist'), 'utf8')

  assert.match(interfaceText, /enablePhoto\?: boolean/)
  assert.match(interfaceText, /photoTempFilePaths\?: string\[\]/)
  assert.match(interfaceText, /photoSavedFilePaths\?: string\[\]/)
  assert.match(iosBridge, /const enablePhoto = options\.camera\?\.enablePhoto \?\? false/)
  assert.match(swift, /_ enablePhoto: Bool/)
  assert.match(manifest, /NSPhotoLibraryAddUsageDescription/)
  assert.match(iosPlist, /NSPhotoLibraryAddUsageDescription/)
})
```

- [ ] **步骤 2：运行测试，确认它按预期失败**

运行：`node --test test/structure.test.mjs`
预期：失败，缺少 `enablePhoto`、照片数组和相册权限声明。

- [ ] **步骤 3：写最小实现**

在 `interface.uts` 里补 `camera.enablePhoto` 与照片数组；在 iOS bridge 里把 `enablePhoto` 传进原生层，并把照片路径文本解码成数组。

- [ ] **步骤 4：运行测试，确认通过**

运行：`node --test test/structure.test.mjs`
预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add uni_modules/uts-markvideo/utssdk/interface.uts uni_modules/uts-markvideo/utssdk/app-ios/index.uts test/structure.test.mjs
git commit -m "feat: extend ios contract for photos"
```

### 任务 2：实现 iOS 原生拍照和相册保存

**文件：**
- 修改：`uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift`
- 测试：`test/structure.test.mjs`

- [ ] **步骤 1：先写失败测试**

```js
test('iOS recorder shows a photo button and saves preview-frame photos', async () => {
  const swift = await readFile(path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'), 'utf8')
  assert.match(swift, /import Photos/)
  assert.match(swift, /private var photoButton = UIButton\(type: \.system\)/)
  assert.match(swift, /private func takePhoto\(\)/)
  assert.match(swift, /private func savePhotoToGallery/)
  assert.match(swift, /PHPhotoLibrary/)
  assert.match(swift, /PHAssetChangeRequest/)
})
```

- [ ] **步骤 2：运行测试，确认它按预期失败**

运行：`node --test test/structure.test.mjs`
预期：失败，Swift 代码尚未包含拍照按钮、预览帧截图和相册保存。

- [ ] **步骤 3：写最小实现**

在 `MarkVideoRecorder.swift` 中：
`enablePhoto` 为真时显示 `拍照` / `完成` 按钮；
`captureOutput` 持续记录最新视频帧；
`takePhoto()` 复用最新预览帧生成带水印 JPG，并写入临时目录；
`savePhotoToGallery()` 使用 `PHPhotoLibrary` 保存到系统相册；
`finishPhotoSession()` 返回 `photoTempFilePaths` / `photoSavedFilePaths`。

- [ ] **步骤 4：运行测试，确认通过**

运行：`node --test test/structure.test.mjs`
预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift test/structure.test.mjs
git commit -m "feat: add ios photo capture"
```

### 任务 3：把 demo 页和配置补齐

**文件：**
- 修改：`pages/index/index.vue`
- 修改：`manifest.json`
- 修改：`uni_modules/uts-markvideo/utssdk/app-ios/Info.plist`
- 修改：`uni_modules/uts-markvideo/package.json`
- 修改：`README.md`
- 测试：`test/structure.test.mjs`

- [ ] **步骤 1：先写失败测试**

```js
test('native app declares photo-library add permission', async () => {
  const manifest = await readFile(path.join(root, 'manifest.json'), 'utf8')
  const iosPlist = await readFile(path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/Info.plist'), 'utf8')
  assert.match(manifest, /NSPhotoLibraryAddUsageDescription/)
  assert.match(iosPlist, /NSPhotoLibraryAddUsageDescription/)
})
```

- [ ] **步骤 2：运行测试，确认它按预期失败**

运行：`node --test test/structure.test.mjs`
预期：失败，权限声明和页面照片结果展示尚未补齐。

- [ ] **步骤 3：写最小实现**

在 demo 页加 `enablePhoto` 开关、照片结果展示和 `camera.enablePhoto` 传参；在 `manifest.json` 和 `Info.plist` 补相册写入权限；在 `package.json` 说明权限变更；在 `README.md` 补一句 iOS 也支持拍照。

- [ ] **步骤 4：运行测试，确认通过**

运行：`node --test test/structure.test.mjs`
预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add pages/index/index.vue manifest.json uni_modules/uts-markvideo/utssdk/app-ios/Info.plist uni_modules/uts-markvideo/package.json README.md test/structure.test.mjs
git commit -m "feat: surface ios photo support"
```

### 任务 4：做提交前审计

**文件：**
- 复查：本次修改涉及的全部文件

- [ ] **步骤 1：跑结构测试**

运行：`node --test test/structure.test.mjs`
预期：PASS。

- [ ] **步骤 2：跑打包配置测试**

运行：`node --test test/pack-config.test.mjs`
预期：PASS。

- [ ] **步骤 3：人工复核关键路径**

确认 `enablePhoto` 从页面 -> UTS bridge -> iOS 原生 -> 相册保存 -> 回传路径 这一条链路完整。

- [ ] **步骤 4：整理最终说明**

说明这次改动新增了什么、默认行为是什么、以及打包后 iOS 侧如何开启拍照。
