import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');

function extractMethodBlock(text, methodName) {
  const match = text.match(new RegExp(`${methodName}\\([^)]*\\)(?:: [^{]+)? \\{([\\s\\S]*?)\\n    \\}`));
  assert.ok(match, `Missing method block: ${methodName}`);
  return match[1];
}

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
  'uni_modules/uts-markvideo/utssdk/app-android/index.vue',
  'uni_modules/uts-markvideo/utssdk/app-android/index.uts',
  'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoEmbeddedCameraView.kt',
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
  assert.doesNotMatch(cameraPage, /@\/uni_modules\/uts-markvideo\/utssdk\/app-android\/index\.vue/);
  assert.match(cameraPage, /ref="embeddedCamera"/);
  assert.match(cameraPage, /@nativeviewready="handleNativeViewReady"/);
  assert.match(cameraPage, /createCameraService/);
  assert.match(cameraPage, /uni\.getStorageSync\('embedded-camera-payload'\)/);
  assert.match(cameraPage, /resolveNativeCamera\(\)/);
  assert.match(cameraPage, /hasNativeCameraMethods\(nativeCamera\)/);
  assert.match(cameraPage, /this\.\$nextTick\(\(\) => \{[\s\S]*this\.bootstrapCamera\(\)/);
  assert.match(cameraPage, /const nativeCamera = await this\.waitForNativeCamera\(\)/);
  assert.match(cameraPage, /typeof nativeCamera\.mountCamera === 'function'/);
  assert.match(cameraPage, /typeof nativeCamera\.isNativeViewLoaded === 'function'/);
  assert.match(cameraPage, /nativeCamera\.isNativeViewLoaded\(\)/);
  assert.match(cameraPage, /cameraReady: false/);
  assert.match(cameraPage, /nativeViewReady: false/);
  assert.match(cameraPage, /mountingCamera: false/);
  assert.match(cameraPage, /cameraDestroyed: false/);
  assert.match(cameraPage, /this\.cameraReady = true/);
  assert.match(cameraPage, /const mountResult = await this\.service\.mountCamera/);
  assert.match(cameraPage, /maxNativeViewAttempts = 18/);
  assert.match(cameraPage, /maxPermissionAttempts = 120/);
  assert.match(cameraPage, /isPermissionPending\(mountResult\)/);
  assert.match(cameraPage, /isNativeViewLoading\(mountResult\)/);
  assert.match(cameraPage, /result\.nativeMessage\.includes\('permission request is pending'\)/);
  assert.match(cameraPage, /this\.status = '等待相机权限授权'/);
  assert.match(cameraPage, /await this\.wait\(600\)/);
  assert.match(cameraPage, /await this\.wait\(160\)/);
  assert.match(cameraPage, /continue/);
  assert.match(cameraPage, /const nativeCamera = await this\.waitForNativeCamera\(\)[\s\S]*if \(this\.cameraDestroyed\) \{[\s\S]*return[\s\S]*\}/);
  assert.match(cameraPage, /const mountResult = await this\.service\.mountCamera[\s\S]*if \(this\.cameraDestroyed\) \{[\s\S]*return[\s\S]*\}/);
  assert.match(cameraPage, /if \(this\.mountingCamera \|\| this\.cameraReady \|\| this\.cameraDestroyed\) \{[\s\S]*return/);
  assert.match(cameraPage, /this\.mountingCamera = true[\s\S]*finally \{[\s\S]*this\.mountingCamera = false/);
  assert.match(cameraPage, /handleNativeViewReady\(\) \{[\s\S]*this\.nativeViewReady = true[\s\S]*this\.retryBootstrapAfterNativeViewLoad\(\)/);
  assert.match(cameraPage, /beforeUnmount\(\) \{[\s\S]*this\.cameraDestroyed = true/);
  assert.match(cameraPage, /ensureCameraReady\(\) \{[\s\S]*if \(this\.cameraReady\) \{[\s\S]*return true[\s\S]*if \(!\/\^\\d\{4\}:\//);
  assert.match(cameraPage, /this\.status = '相机未就绪，请稍候'/);
  assert.match(cameraPage, /if \(!this\.ensureCameraReady\(\)\) \{[\s\S]*return[\s\S]*await this\.service\.takePhoto/);
  assert.doesNotMatch(cameraPage, /nativeCamera: this\.\$refs\.embeddedCamera/);
  assert.doesNotMatch(cameraPage, /uni\.getElementById\('embeddedCamera'\)/);
  assert.match(cameraPage, /onCameraReady/);
  assert.match(cameraPage, /onPhotoDone/);
  assert.match(cameraPage, /onRecordStart/);
  assert.match(cameraPage, /onRecordDone/);
  assert.match(cameraPage, /onError/);
  assert.match(cameraPage, /toggleFlash/);
  assert.match(cameraPage, /selectZoom/);
  assert.match(cameraPage, /pressShutter/);
  assert.match(cameraPage, /templateSheetOpen/);
  assert.match(cameraPage, /@tap="openTemplateSheet"/);
  assert.match(cameraPage, /class="sheetMask"/);
  assert.match(cameraPage, /class="templatePanel"/);
  assert.match(cameraPage, /class="templateOption"/);
  assert.match(cameraPage, /class="templatePreviewImage"/);
  assert.match(cameraPage, /class="optionTitle"/);
  assert.match(cameraPage, /class="optionSubtext"/);
  assert.match(cameraPage, /@tap="selectTemplate\(template\)"/);
  assert.match(cameraPage, /@tap="closeTemplateSheet"/);
  assert.match(cameraPage, /async selectTemplate\(template\)/);
  assert.doesNotMatch(cameraPage, /uni\.showActionSheet/);
  assert.doesNotMatch(cameraPage, /itemList/);
  assert.match(cameraPage, /await this\.applyTemplate\(template\)/);
  assert.doesNotMatch(cameraPage, /scrollToTemplatePanel\(\)/);
  assert.doesNotMatch(cameraPage, /selector: '\.templatePanel'/);
  assert.match(cameraPage, /class="zoomRail"/);
  assert.match(cameraPage, /<cover-view class="zoomRail">/);
  assert.match(cameraPage, /\.zoomRail \{[\s\S]*position: absolute[\s\S]*right: 10px[\s\S]*flex-direction: column/);
  assert.match(cameraPage, /class="templatePanel"/);
  assert.match(cameraPage, /视频/);
  assert.match(cameraPage, /照片/);
  assert.match(cameraPage, /广角/);
  assert.match(cameraPage, /class="templateButton"/);
  assert.match(cameraPage, /\.topBar \{[\s\S]*background: rgba\(3, 5, 5, 0\.72\)/);
  assert.match(cameraPage, /\.bottomPanel \{[\s\S]*background: rgba\(3, 5, 5, 0\.78\)/);
  assert.match(cameraPage, /\.flashButton \{[\s\S]*border: 1px solid[\s\S]*border-radius: 19px[\s\S]*background: rgba\(247, 250, 248, 0\.12\)/);
  assert.match(cameraPage, /\.zoomButton \{[\s\S]*width: 48px[\s\S]*height: 48px[\s\S]*border-radius: 50%/);
  assert.match(cameraPage, /\.templateButton \{[\s\S]*width: 54px[\s\S]*height: 54px[\s\S]*border-radius: 50%/);
  assert.match(cameraPage, /\.shutter \{[\s\S]*width: 86px[\s\S]*height: 86px[\s\S]*border: 2px solid rgba\(255, 255, 255, 0\.82\)[\s\S]*box-shadow:/);
  assert.match(cameraPage, /\.shutterCore \{[\s\S]*width: 82px[\s\S]*height: 82px/);
  assert.match(cameraPage, /\.templatePanel \{[\s\S]*background: rgba\(247, 250, 248, 0\.96\)/);
  assert.match(cameraPage, /\.templateOption \{[\s\S]*grid-template-columns: 54px 1fr 24px/);
  assert.match(cameraPage, /\.templatePreviewImage \{[\s\S]*width: 40px[\s\S]*height: 40px/);
  assert.match(cameraPage, /const previousTemplate = this\.currentTemplate[\s\S]*this\.currentTemplate = template/);
  assert.match(cameraPage, /this\.currentTemplate = template[\s\S]*this\.templateSheetOpen = false[\s\S]*if \(!this\.cameraReady\)/);
  assert.match(cameraPage, /const result = await this\.service\.setWatermark\(template\)/);
  assert.match(cameraPage, /if \(!result\.success\) \{[\s\S]*this\.currentTemplate = previousTemplate[\s\S]*return[\s\S]*\}/);
  assert.match(cameraPage, /\.cameraStage \{[\s\S]*position: absolute[\s\S]*bottom: 0/);
  assert.match(cameraPage, /\.nativePreview \{[\s\S]*height: 100%/);
  assert.doesNotMatch(cameraPage, /<button\b/);
  assert.doesNotMatch(cameraPage, /@click=/);
  assert.doesNotMatch(cameraPage, /<button[^>]*class="flashButton"/);
  assert.doesNotMatch(cameraPage, /<button[^>]*class="zoomButton"/);
  assert.doesNotMatch(cameraPage, /<button[^>]*class="templateButton"/);
  assert.doesNotMatch(cameraPage, /@click="applyTemplate\(template\)"/);
  assert.match(cameraPage, /isRecording/);
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
  assert.match(service, /async destroyCamera\(\) \{[\s\S]*if \(!nativeCamera\) \{[\s\S]*ready = false[\s\S]*recording = false[\s\S]*return ok\(\{\}\)/);
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
  const unmountedErrors = [];
  const unmountedService = createCameraService({
    onError: (payload) => unmountedErrors.push(payload),
  });
  assert.deepEqual(await unmountedService.destroyCamera(), ok({}));
  assert.deepEqual(unmountedErrors, []);

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

test('Android module API keeps legacy migration entry without fake embedded media methods', async () => {
  const androidBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.uts'),
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
    assert.doesNotMatch(androidBridge, new RegExp(`export const ${method}`));
  }

  assert.match(androidBridge, /export const recordWatermarkVideo/);
  assert.match(androidBridge, /MarkVideoNative\.openCameraRecorder/);
  assert.doesNotMatch(androidBridge, /pipeline is not bound/);
});

test('Android native component entry owns the PRD method surface', async () => {
  const component = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.vue'),
    'utf8',
  );
  const isNativeViewLoaded = extractMethodBlock(component, 'isNativeViewLoaded');

  assert.match(component, /name: 'uts-markvideo-camera'/);
  assert.match(component, /NVLoad\(\): FrameLayout/);
  assert.match(component, /MarkVideoEmbeddedCameraView/);
  assert.match(component, /view\.setEventCallback/);
  assert.match(component, /this\.emitNativeEvent\(eventName, parseObject\(payloadText\)\)/);
  assert.match(component, /'nativeviewready'/);
  assert.match(component, /this\.\$emit\('nativeviewready'/);
  assert.match(component, /cameraViewLoaded: false/);
  assert.match(component, /this\.cameraViewLoaded = true[\s\S]*this\.\$emit\('nativeviewready'/);
  assert.match(component, /this\.\$emit\('watermarkpositionchange', payload\)/);
  assert.match(component, /this\.\$emit\('nativeerror', payload\)/);
  assert.match(component, /JSON\.parse\(text\) as EmbeddedCameraResult/);
  assert.match(component, /JSON\.parse\(text\) \?\? \{\}/);
  assert.doesNotMatch(component, /result\.success/);
  assert.doesNotMatch(component, /__\$\$emit/);
  assert.doesNotMatch(component, /NVUnload/);
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
    assert.match(component, new RegExp(`\\$emit\\('${eventName}', payload\\)`));
  }
  assert.match(component, /expose: \[/);
  assert.match(component, /'isNativeViewLoaded'/);
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
  assert.match(component, /resolveCameraView\(\): MarkVideoEmbeddedCameraView \| null/);
  assert.match(isNativeViewLoaded, /return this\.cameraViewLoaded == true && this\.cameraView != null/);
  assert.doesNotMatch(isNativeViewLoaded, /resolveCameraView\(\)/);
  assert.doesNotMatch(component, /this\.\$el/);
  assert.match(component, /destroyCamera\(\): EmbeddedCameraResult \{[\s\S]*const view = this\.resolveCameraView\(\)[\s\S]*if \(view == null\)/);
  assert.match(component, /view\.takePhoto\(encode\(options\)\)/);
  assert.match(component, /view\.startRecord\(encode\(options\)\)/);
  assert.match(component, /view\.stopRecord\(\)/);
  assert.doesNotMatch(component, /Embedded Android camera media pipeline is not bound/);
  assert.doesNotMatch(component, /recordWatermarkVideo/);
});

test('Android embedded native view implements PRD preview, media, watermark, and events', async () => {
  const nativeView = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoEmbeddedCameraView.kt'),
    'utf8',
  );

  assert.match(nativeView, /class MarkVideoEmbeddedCameraView\(context: Context\) : FrameLayout\(context\)/);
  assert.match(nativeView, /TextureView/);
  assert.match(nativeView, /CameraDevice/);
  assert.match(nativeView, /MediaCodec/);
  assert.match(nativeView, /AudioRecord/);
  assert.match(nativeView, /MediaMuxer/);
  assert.match(nativeView, /fun mountCamera\(optionsJson: String\): String/);
  assert.match(nativeView, /fun takePhoto\(optionsJson: String\): String/);
  assert.match(nativeView, /fun startRecord\(optionsJson: String\): String/);
  assert.match(nativeView, /fun stopRecord\(\): String/);
  assert.match(nativeView, /private fun <T> runOnMainSync\(block: \(\) -> T\): T/);
  assert.match(nativeView, /MAIN_THREAD_TIMEOUT_MS/);
  assert.match(nativeView, /val waitResult = waitForCameraReady\(setup\.readyLatch\)/);
  assert.match(nativeView, /private fun cameraFacingAvailable\(facing: String\): Boolean/);
  assert.match(nativeView, /error\("No \$facing camera id available\."\)/);
  assert.doesNotMatch(nativeView, /\?: manager\.cameraIdList\.firstOrNull\(\)/);
  assert.match(nativeView, /recordingTemplate = mediaTemplate\(optionsJson, currentTemplate\)/);
  assert.match(nativeView, /drawWatermark\(snapshot, template\)/);
  assert.match(nativeView, /publishPhotoToGallery\(file\)/);
  assert.match(nativeView, /publishVideoToGallery\(file\)/);
  assert.match(nativeView, /emit\("photodone", data\)/);
  assert.match(nativeView, /emit\("recordstart", recordStartPayload\(\)\)/);
  assert.match(nativeView, /emit\("recorddone", data\)/);
  assert.match(nativeView, /emitError\("1501"/);
  assert.match(nativeView, /REQUEST_AUDIO_PERMISSION/);
  assert.match(nativeView, /cameraPermissionPending/);
  assert.match(nativeView, /Camera permission request is pending\./);
  assert.match(nativeView, /Microphone permission request is pending\./);
  assert.match(nativeView, /private fun permissionWasDenied\(permission: String, requestedAtMs: Long\): Boolean/);
  assert.match(nativeView, /shouldShowRequestPermissionRationale\(permission\)/);
  assert.match(nativeView, /failAndEmit\("1002"/);
  assert.match(nativeView, /return failAndEmit\("1403"/);
  assert.match(nativeView, /TemplateParseResult\.imageUnreadable/);
  assert.doesNotMatch(nativeView, /recordWatermarkVideo/);
  assert.doesNotMatch(nativeView, /MarkVideoCameraActivity/);
});

test('Android legacy native recorder remains available behind the adapter', async () => {
  const androidBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.uts'),
    'utf8',
  );
  const nativeBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt'),
    'utf8',
  );
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const manifest = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/AndroidManifest.xml'),
    'utf8',
  );

  assert.match(androidBridge, /export const recordWatermarkVideo/);
  assert.match(androidBridge, /MarkVideoNative\.openCameraRecorder/);
  assert.match(nativeBridge, /openCameraRecorder/);
  assert.match(nativeBridge, /EXTRA_WATERMARK_IMAGE_PATH/);
  assert.match(nativeBridge, /ERR_PHOTO_CAPTURE_FAILED = 1009/);
  assert.match(activity, /TextureView/);
  assert.match(activity, /AudioRecord/);
  assert.match(activity, /MediaStore\.Images\.Media/);
  assert.match(activity, /MediaStore\.Video\.Media/);
  assert.match(activity, /private fun takePhoto\(\)/);
  assert.match(activity, /private fun startRecording\(\)/);
  assert.match(manifest, /MarkVideoCameraActivity/);
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
