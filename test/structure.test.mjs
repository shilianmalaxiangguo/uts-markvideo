import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');

const requiredFiles = [
  'README.md',
  'docs/api.md',
  'docs/embedded-camera-component-prd.md',
  'camera-prototype.html',
  'App.vue',
  'main.js',
  'manifest.json',
  'pages.json',
  'pages/index/index.vue',
  'pages/index/cameraService.js',
  'pages/camera/camera.vue',
  'static/watermark/watermark-demo.png',
  'uni_modules/uts-markvideo/components/uts-markvideo-camera/uts-markvideo-camera.vue',
  'uni_modules/uts-markvideo/package.json',
  'uni_modules/uts-markvideo/utssdk/interface.uts',
  'uni_modules/uts-markvideo/utssdk/app-ios/index.vue',
  'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoEmbeddedCameraView.swift',
  'uni_modules/uts-markvideo/utssdk/app-android/index.uts',
  'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt',
  'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt',
  'uni_modules/uts-markvideo/utssdk/app-android/AndroidManifest.xml',
  'uni_modules/uts-markvideo/utssdk/app-ios/index.uts',
  'uni_modules/uts-markvideo/utssdk/app-ios/Info.plist',
  'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift',
];

test('project contains the embedded camera PRD implementation files', async () => {
  for (const file of requiredFiles) {
    await access(path.join(root, file));
  }
});

test('plugin package is named uts-markvideo', async () => {
  const text = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/package.json'),
    'utf8',
  );
  const pkg = JSON.parse(text);
  assert.equal(pkg.id, 'uts-markvideo');
  assert.equal(pkg.name, 'uts-markvideo');
  assert.equal(pkg.dcloudext.type, 'component-uts');
});

test('main docs make the embedded-camera PRD authoritative over legacy APIs', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const prd = await readFile(path.join(root, 'docs/embedded-camera-component-prd.md'), 'utf8');

  assert.match(api, /docs\/embedded-camera-component-prd\.md/);
  assert.match(api, /不作为新组件功能清单/);
  assert.match(api, /旧 `recordWatermarkVideo` API 只作为迁移参考/);
  assert.match(api, /业务页面只能依赖 PRD 的 service\/facade/);
  assert.match(prd, /页面内嵌原生相机组件/);
  assert.match(prd, /统一 service\/facade/);
  assert.match(prd, /title_text/);
  assert.match(prd, /title_subtitle_text/);
  assert.match(prd, /image_title_subtitle/);
});

test('App.vue simulator page carries three default templates into business camera page', async () => {
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');
  const service = await readFile(path.join(root, 'pages/index/cameraService.js'), 'utf8');

  assert.match(service, /DEFAULT_WATERMARK_TEMPLATES/);
  assert.match(service, /templateId: 'title-only'/);
  assert.match(service, /templateId: 'title-subtitle'/);
  assert.match(service, /templateId: 'png-title-subtitle'/);
  assert.match(service, /imageMimeType: 'image\/png'/);
  assert.match(service, /imagePath: '\/static\/watermark\/watermark-demo\.png'/);
  assert.match(page, /DEFAULT_WATERMARK_TEMPLATES/);
  assert.match(page, /uni\.setStorageSync\('embedded-camera-payload'/);
  assert.match(page, /uni\.navigateTo\(\{[\s\S]*url: '\/pages\/camera\/camera'/);
  assert.match(page, /模拟模板编辑/);
});

test('business camera page embeds the native camera component and owns camera controls', async () => {
  const cameraPage = await readFile(path.join(root, 'pages/camera/camera.vue'), 'utf8');
  const pagesJson = await readFile(path.join(root, 'pages.json'), 'utf8');

  assert.match(pagesJson, /pages\/camera\/camera/);
  assert.match(cameraPage, /<uts-markvideo-camera/);
  assert.match(cameraPage, /ref="embeddedCamera"/);
  assert.match(cameraPage, /createCameraService/);
  assert.match(cameraPage, /uni\.getStorageSync\('embedded-camera-payload'\)/);
  assert.match(cameraPage, /nativeCamera: this\.\$refs\.embeddedCamera/);
  assert.match(cameraPage, /onCameraReady/);
  assert.match(cameraPage, /onPhotoDone/);
  assert.match(cameraPage, /onRecordStart/);
  assert.match(cameraPage, /onRecordDone/);
  assert.match(cameraPage, /onError/);
  assert.match(cameraPage, /toggleFlash/);
  assert.match(cameraPage, /selectZoom/);
  assert.match(cameraPage, /pressShutter/);
  assert.match(cameraPage, /templateSheetOpen/);
  assert.match(cameraPage, /视频/);
  assert.match(cameraPage, /照片/);
  assert.match(cameraPage, /广角/);
  assert.match(cameraPage, /class="templateButton"/);
  assert.match(cameraPage, /isRecording/);
  assert.match(cameraPage, /var\(--status-bar-height\)/);
  assert.doesNotMatch(cameraPage, /class="watermarkBox"/);
});

test('business page depends on cameraService rather than direct legacy recorder API', async () => {
  const indexPage = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');
  const cameraPage = await readFile(path.join(root, 'pages/camera/camera.vue'), 'utf8');
  const service = await readFile(path.join(root, 'pages/index/cameraService.js'), 'utf8');

  assert.doesNotMatch(indexPage, /recordWatermarkVideo/);
  assert.doesNotMatch(cameraPage, /recordWatermarkVideo/);
  assert.doesNotMatch(service, /recordWatermarkVideo/);
  assert.doesNotMatch(service, /@\/uni_modules\/uts-markvideo/);
  assert.match(service, /createCameraService/);
  assert.match(service, /validateWatermarkTemplate/);
  assert.match(service, /callNative\(nativeCamera, 'mountCamera'/);
  assert.match(service, /function createResult\(success, data, errorCode, errorMessage, nativeMessage\)/);
  assert.match(service, /success: success/);
  assert.match(service, /return createResult\(true, data, '', '', ''\)/);
  assert.match(service, /errorCode: success \? '' : errorCode/);
  assert.match(service, /data: success \? \(data \|\| \{\}\) : \{\}/);
  assert.match(service, /录像中不能切换水印模板/);
  assert.match(service, /录像中不能切换摄像头/);
  assert.match(service, /frozenTemplate = cloneTemplate\(currentTemplate\)/);
  assert.match(service, /nativeCamera = options\.nativeCamera/);
});

test('cameraService normalizes templates and drives the embedded component instance', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'pages/index/cameraService.js')).href;
  const {
    createCameraService,
    normalizeWatermarkTemplate,
  } = await import(moduleUrl);
  const events = [];
  const nativeCalls = [];
  const ok = (data = {}) => ({
    success: true,
    errorCode: '',
    errorMessage: '',
    nativeMessage: '',
    data,
  });
  const nativeCamera = {
    async mountCamera(options) {
      nativeCalls.push(['mountCamera', options]);
      return ok({
        availableZooms: ['wide', '1x', '2x'],
        zoom: options.zoom,
        flashAvailable: true,
        flashEnabled: options.flashEnabled,
        cameraFacing: options.cameraFacing,
        previewWidth: options.previewWidth,
        previewHeight: options.previewHeight,
      });
    },
    async setWatermark(template) {
      nativeCalls.push(['setWatermark', template]);
      return ok({});
    },
    async takePhoto(options) {
      nativeCalls.push(['takePhoto', options]);
      return ok({
        tempFilePath: '/tmp/photo.jpg',
        albumFilePath: '/album/photo.jpg',
        width: 1080,
        height: 1920,
        watermarkTemplateId: options.watermarkTemplate.templateId,
        watermarkPositionX: options.watermarkTemplate.positionX,
        watermarkPositionY: options.watermarkTemplate.positionY,
        watermarkBoxWidth: options.watermarkTemplate.boxWidth,
        watermarkBoxHeight: options.watermarkTemplate.boxHeight,
        watermarkTemplateSnapshot: options.watermarkTemplate,
      });
    },
    async startRecord(options) {
      nativeCalls.push(['startRecord', options]);
      return ok({});
    },
    async stopRecord() {
      nativeCalls.push(['stopRecord']);
      return ok({
        tempFilePath: '/tmp/video.mp4',
        albumFilePath: '/album/video.mp4',
        durationMs: 1200,
        width: 1080,
        height: 1920,
        watermarkTemplateId: 'title-only',
        watermarkPositionX: 0.18,
        watermarkPositionY: 0.25,
        watermarkBoxWidth: 0.64,
        watermarkBoxHeight: 0.14,
        watermarkTemplateSnapshot: { templateId: 'title-only' },
      });
    },
    async switchFlash(enabled) {
      nativeCalls.push(['switchFlash', enabled]);
      return ok({ enabled });
    },
    async setZoom(zoom) {
      nativeCalls.push(['setZoom', zoom]);
      return ok({ zoom });
    },
    async switchCamera(cameraFacing) {
      nativeCalls.push(['switchCamera', cameraFacing]);
      return ok({ cameraFacing });
    },
    async clearWatermark() {
      nativeCalls.push(['clearWatermark']);
      return ok({});
    },
    async getWatermarkPosition() {
      nativeCalls.push(['getWatermarkPosition']);
      return ok({ x: 0.18, y: 0.25, width: 0.64, height: 0.14 });
    },
    async destroyCamera() {
      nativeCalls.push(['destroyCamera']);
      return ok({});
    },
  };
  const service = createCameraService({
    onCameraReady: (payload) => events.push(['ready', payload]),
    onPhotoDone: (payload) => events.push(['photo', payload]),
    onRecordStart: (payload) => events.push(['recordStart', payload]),
    onRecordDone: (payload) => events.push(['recordDone', payload]),
    onError: (payload) => events.push(['error', payload]),
  });
  const partialTemplate = {
    templateId: 'title-only',
    templateName: '纯主标题',
    templateType: 'title_text',
    mainTitleText: '今日水印相机',
  };
  const normalized = normalizeWatermarkTemplate(partialTemplate);
  assert.equal(normalized.reason, '');
  assert.equal(normalized.template.subtitleText, '');
  assert.equal(normalized.template.imageWidth, 0);
  assert.equal(normalized.template.mainTitleColor, '#26313B');

  assert.deepEqual(await service.mountCamera({
    nativeCamera,
    containerId: 'embeddedCamera',
    previewWidth: 390,
    previewHeight: 560,
    cameraFacing: 'back',
    zoom: '1x',
    flashEnabled: false,
  }), ok({}));
  assert.deepEqual(await service.setWatermark(partialTemplate), ok({}));
  const photoResult = await service.takePhoto();
  assert.equal(photoResult.success, true);
  assert.equal(photoResult.data.tempFilePath, '/tmp/photo.jpg');
  assert.equal(photoResult.data.watermarkTemplateSnapshot.templateId, 'title-only');
  assert.deepEqual(await service.startRecord(), ok({}));
  const blockedWatermark = await service.setWatermark({
    ...partialTemplate,
    templateId: 'next',
  });
  assert.equal(blockedWatermark.success, false);
  assert.equal(blockedWatermark.errorCode, '1403');
  const blockedCamera = await service.switchCamera('front');
  assert.equal(blockedCamera.success, false);
  assert.equal(blockedCamera.errorCode, '1403');
  const videoResult = await service.stopRecord();
  assert.equal(videoResult.success, true);
  assert.equal(videoResult.data.tempFilePath, '/tmp/video.mp4');
  assert.deepEqual(nativeCalls.map(([name]) => name), [
    'mountCamera',
    'setWatermark',
    'takePhoto',
    'startRecord',
    'stopRecord',
  ]);
  assert.equal(events.some(([name]) => name === 'recordStart'), true);
  assert.equal(events.some(([name]) => name === 'recordDone'), true);
});

test('UTS interface exposes the PRD facade contract and keeps legacy recorder types for migration', async () => {
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );

  assert.match(interfaceText, /EmbeddedCameraResult/);
  assert.match(interfaceText, /EmbeddedCameraMountOptions/);
  assert.match(interfaceText, /WatermarkTemplate/);
  assert.match(interfaceText, /MountCamera/);
  assert.match(interfaceText, /SetWatermark/);
  assert.match(interfaceText, /ClearWatermark/);
  assert.match(interfaceText, /GetWatermarkPosition/);
  assert.match(interfaceText, /TakePhoto/);
  assert.match(interfaceText, /StartRecord/);
  assert.match(interfaceText, /StopRecord/);
  assert.match(interfaceText, /SwitchFlash/);
  assert.match(interfaceText, /SetZoom/);
  assert.match(interfaceText, /SwitchCamera/);
  assert.match(interfaceText, /DestroyCamera/);
  assert.match(interfaceText, /RecordWatermarkVideo/);
});

test('iOS module API keeps legacy migration entry without fake embedded media methods', async () => {
  const iosBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'),
    'utf8',
  );

  for (const method of [
    'mountCamera',
    'setWatermark',
    'clearWatermark',
    'getWatermarkPosition',
    'takePhoto',
    'startRecord',
    'stopRecord',
    'switchFlash',
    'setZoom',
    'switchCamera',
    'destroyCamera',
  ]) {
    assert.doesNotMatch(iosBridge, new RegExp(`export const ${method}`));
  }

  assert.match(iosBridge, /export const recordWatermarkVideo/);
  assert.match(iosBridge, /MarkVideoRecorder\.openCameraRecorder/);
  assert.doesNotMatch(iosBridge, /pipeline is not bound/);
});

test('iOS native component entry owns the PRD method surface', async () => {
  const component = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.vue'),
    'utf8',
  );

  assert.match(component, /name: 'uts-markvideo-camera'/);
  assert.match(component, /NVLoad\(\): UIView/);
  assert.match(component, /MarkVideoEmbeddedCameraView/);
  assert.match(component, /view\.setEventHandlers/);
  for (const eventName of [
    'photodone',
    'recordstart',
    'recorddone',
    'flashchange',
    'zoomchange',
    'camerafacingchange',
    'cameraready',
  ]) {
    assert.match(component, new RegExp(`'${eventName}'`));
  }
  assert.match(component, /expose: \[/);
  for (const method of [
    'mountCamera',
    'setWatermark',
    'clearWatermark',
    'getWatermarkPosition',
    'takePhoto',
    'startRecord',
    'stopRecord',
    'switchFlash',
    'setZoom',
    'switchCamera',
    'destroyCamera',
  ]) {
    assert.match(component, new RegExp(`${method}`));
  }
  assert.match(component, /type EmbeddedCameraMountOptions/);
  assert.match(component, /this\.\$emit\('watermarkpositionchange', parsePayload\(payload\)\)/);
  assert.match(component, /this\.\$emit\('nativeerror'/);
  assert.match(component, /view!\.mountCamera/);
  assert.match(component, /view!\.takePhoto\(stringify\(options\)\)/);
  assert.match(component, /view!\.startRecord\(stringify\(options\)\)/);
  assert.match(component, /view!\.stopRecord\(\)/);
  assert.match(component, /if \(!result\.success\) \{[\s\S]*result\.errorCode == '1402'[\s\S]*this\.recording = false[\s\S]*this\.frozenTemplate = null[\s\S]*return result/);
  assert.doesNotMatch(component, /__\$\$emit/);
  assert.doesNotMatch(component, /JSON\.parse\(JSON\.stringify/);
  assert.doesNotMatch(component, /result\.data\./);
  assert.doesNotMatch(component, /Embedded iOS camera media pipeline is not bound/);
  assert.doesNotMatch(component, /recordWatermarkVideo/);
});

test('iOS embedded native view implements PRD preview, media, watermark, and events', async () => {
  const nativeView = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoEmbeddedCameraView.swift'),
    'utf8',
  );

  assert.match(nativeView, /public final class MarkVideoEmbeddedCameraView: UIView/);
  assert.match(nativeView, /AVCaptureSession/);
  assert.match(nativeView, /AVCaptureVideoPreviewLayer/);
  assert.match(nativeView, /AVCaptureVideoDataOutput/);
  assert.match(nativeView, /AVCaptureAudioDataOutput/);
  assert.match(nativeView, /AVAssetWriter/);
  assert.match(nativeView, /public func mountCamera/);
  assert.match(nativeView, /public func takePhoto\(_ optionsJSON: String\) -> String/);
  assert.match(nativeView, /public func startRecord\(_ optionsJSON: String\) -> String/);
  assert.match(nativeView, /public func stopRecord\(\) -> String/);
  assert.match(nativeView, /private static let captureQueueKey = DispatchSpecificKey<Bool>\(\)/);
  assert.match(nativeView, /private func runOnCaptureQueueSync<T>\(_ block: \(\) -> T\) -> T/);
  assert.match(nativeView, /let started = runOnCaptureQueueSync \{[\s\S]*session\.startRunning\(\)[\s\S]*session\.isRunning/);
  assert.match(nativeView, /private func configureCameraSessionOnCaptureQueue\(facing: String, zoom requestedZoom: String\) -> NativeStatus/);
  assert.match(nativeView, /runOnCaptureQueueSync \{[\s\S]*session\.stopRunning\(\)[\s\S]*session\.beginConfiguration\(\)/);
  assert.match(nativeView, /var didBeginConfiguration = false/);
  assert.match(nativeView, /if didBeginConfiguration \{[\s\S]*session\.commitConfiguration\(\)/);
  assert.doesNotMatch(nativeView, /AVCaptureDevice\.default\(\.builtInWideAngleCamera, for: \.video, position: position\) \?\?[\s\S]*AVCaptureDevice\.default\(for: \.video\)/);
  assert.match(nativeView, /frozenTemplate = outputTemplate/);
  assert.match(nativeView, /makeWatermarkedImage/);
  assert.match(nativeView, /saveImageToGallerySynchronously/);
  assert.match(nativeView, /saveVideoToGallerySynchronously/);
  assert.match(nativeView, /emitNativeError\("1501"/);
  assert.match(nativeView, /requestAudioAccessSynchronously/);
  assert.match(nativeView, /return fail\("1002"/);
  assert.match(nativeView, /return fail\("1403"/);
  assert.match(nativeView, /EmbeddedWatermarkTemplate\.parse/);
  assert.doesNotMatch(nativeView, /openCameraRecorder/);
});

test('iOS legacy native recorder remains available behind the adapter', async () => {
  const iosBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'),
    'utf8',
  );
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(iosBridge, /export const recordWatermarkVideo/);
  assert.match(iosBridge, /MarkVideoRecorder\.openCameraRecorder/);
  assert.match(swift, /openCameraRecorder/);
  assert.match(swift, /AVCaptureSession/);
  assert.match(swift, /AVCaptureAudioDataOutput/);
  assert.match(swift, /AVAssetWriter/);
  assert.match(swift, /import Photos/);
  assert.match(swift, /private func savePhotoToGallery/);
  assert.match(swift, /@objc private func takePhoto\(\)/);
  assert.match(swift, /@objc private func startRecording\(\)/);
});

test('native app declares camera, microphone, and photo-library descriptions', async () => {
  const manifest = await readFile(path.join(root, 'manifest.json'), 'utf8');
  const iosPlist = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/Info.plist'),
    'utf8',
  );

  assert.match(manifest, /NSCameraUsageDescription/);
  assert.match(manifest, /NSMicrophoneUsageDescription/);
  assert.match(iosPlist, /NSCameraUsageDescription/);
  assert.match(iosPlist, /NSMicrophoneUsageDescription/);
});

test('Vue 3 app entry is declared in manifest', async () => {
  const main = await readFile(path.join(root, 'main.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));

  assert.match(main, /createSSRApp/);
  assert.equal(manifest.vueVersion, '3');
});
