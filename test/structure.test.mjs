import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');

const requiredFiles = [
  'App.vue',
  'main.js',
  'manifest.json',
  'pages.json',
  'pages/index/index.nvue',
  'pages/cameraX/index.nvue',
  'uni_modules/xyc-markvideo/package.json',
  'uni_modules/xyc-markvideo/utssdk/app-android/AndroidManifest.xml',
  'uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt',
  'uni_modules/xyc-markvideo/utssdk/app-android/index.vue',
  'uni_modules/xyc-markvideo/utssdk/app-ios/index.vue',
];

const removedPaths = [
  'pages/index/index.vue',
  'pages/index/cameraService.js',
  'pages/camera',
  'pages/camera/camera.vue',
  'uni_modules/uts-markvideo',
  'uni_modules/uts-markvideo/package.json',
];

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(relativePath, extensions) {
  const absolutePath = path.join(root, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(childPath, extensions));
      continue;
    }
    if (extensions.includes(path.extname(entry.name))) {
      files.push(childPath);
    }
  }

  return files;
}

test('project contains the xyc-markvideo cameraX mainline files', async () => {
  for (const file of requiredFiles) {
    await access(path.join(root, file));
  }
});

test('legacy uts-markvideo route and plugin files are deleted', async () => {
  for (const file of removedPaths) {
    assert.equal(await exists(file), false, `${file} should not exist`);
  }
});

test('pages.json routes only the new nvue camera mainline', async () => {
  const pagesJson = JSON.parse(await readFile(path.join(root, 'pages.json'), 'utf8'));
  const paths = pagesJson.pages.map((page) => page.path);

  assert.deepEqual(paths, [
    'pages/index/index',
    'pages/cameraX/index',
  ]);
  assert.doesNotMatch(JSON.stringify(pagesJson), /pages\/camera\/camera/);
});

test('index.nvue navigates directly to cameraX without watermark payload setup', async () => {
  const page = await readFile(path.join(root, 'pages/index/index.nvue'), 'utf8');

  assert.match(page, /uni\.navigateTo\(\{[\s\S]*url: '\/pages\/cameraX\/index'/);
  assert.match(page, /30 fps/);
  assert.doesNotMatch(page, /DEFAULT_TEMPLATES/);
  assert.doesNotMatch(page, /xyc-camera-payload/);
  assert.doesNotMatch(page, /embedded-camera-payload/);
  assert.doesNotMatch(page, /uts-markvideo/);
  assert.doesNotMatch(page, /recordWatermarkVideo/);
  assert.doesNotMatch(page, /setWatermark|clearWatermark|watermarkTemplate/);
});

test('cameraX nvue page owns UI and calls xyc-markvideo native camera methods', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.nvue'), 'utf8');
  const stopBranch = page.match(/if \(typeof nativeCamera\.stopRecord !== 'function'\) \{[\s\S]*?formatRecordElapsed\(elapsedMs\) \{/)?.[0] || '';
  const topBar = page.match(/<cover-view class="topBar">[\s\S]*?<cover-view class="recordHud"/)?.[0] || '';

  assert.match(page, /<xyc-markvideo/);
  assert.match(page, /ref="nativeCamera"/);
  assert.match(page, /:target-fps="targetFps"/);
  assert.match(page, /targetFps: 30/);
  assert.match(page, /flashMode: 'off'/);
  assert.match(page, /flashTapAt: 0/);
  assert.match(page, /flashPending: false/);
  assert.match(page, /flashEventHandled: false/);
  assert.match(page, /flashEventApplied: true/);
  assert.match(page, /@cameraready="handleCameraReady"/);
  assert.match(page, /@photodone="handlePhotoDone"/);
  assert.match(page, /@recordstart="handleRecordStart"/);
  assert.match(page, /@recorddone="handleRecordDone"/);
  assert.match(page, /resolveNativeCamera\(\)/);
  assert.match(page, /onShow\(\)/);
  assert.match(page, /prepareCameraPermissions\(\)/);
  assert.match(page, /prepareRecordPermissions\(\)/);
  assert.match(page, /retryCameraAfterPermission\(\)/);
  assert.match(page, /this\.nativeStatus === '相机权限未授权'/);
  assert.match(page, /nativeCamera\.preparePermissions\(\)/);
  assert.match(page, /nativeCamera\.prepareRecordPermissions\(\)/);
  assert.match(page, /this\.normalizeNativeResult\(nativeCamera\.prepareRecordPermissions\(\), '请先完成录像权限授权'\)/);
  assert.doesNotMatch(page, /rawResult && rawResult\.success/);
  assert.match(page, /nativeCamera\.switchMode\(mode\)/);
  assert.match(page, /await nativeCamera\.setFlashMode\(mode\)/);
  assert.match(page, /const shouldResetFlash = mode === 'video' && this\.flashMode === 'auto'/);
  assert.match(page, /if \(shouldResetFlash\) \{[\s\S]*this\.flashMode = 'off'/);
  assert.match(page, /nativeCamera\.takePhoto\(\)/);
  assert.match(page, /handlePhotoDone\(event\)/);
  assert.match(page, /拍照请求已受理|拍照中/);
  assert.match(page, /nativeCamera\.startRecord\(\{ fps: this\.targetFps \}\)/);
  assert.match(page, /nativeCamera\.stopRecord\(\)/);
  assert.match(page, /stopPending: false/);
  assert.match(page, /recordStartedAt: 0/);
  assert.match(page, /recordElapsedMs: 0/);
  assert.match(page, /recordBlinkOn: true/);
  assert.match(page, /recordTimer: null/);
  assert.match(stopBranch, /this\.isRecording = false[\s\S]*this\.stopPending = true[\s\S]*this\.nativeStatus = '正在保存视频'/);
  assert.match(stopBranch, /this\.stopRecordingClock\(\)[\s\S]*try \{/);
  assert.match(stopBranch, /const result = this\.normalizeNativeResult\(await nativeCamera\.stopRecord\(\), '录像停止失败'\)/);
  assert.match(stopBranch, /catch \(error\)[\s\S]*this\.nativeStatus = error && error\.message \? error\.message : '录像停止失败'/);
  assert.match(stopBranch, /finally \{[\s\S]*this\.stopPending = false/);
  assert.match(page, /formatRecordElapsed\(elapsedMs\)/);
  assert.match(page, /startRecordingClock\(\)/);
  assert.match(page, /setInterval\(\(\) =>/);
  assert.match(page, /clearInterval\(this\.recordTimer\)/);
  assert.match(page, /onUnload\(\)[\s\S]*clearInterval\(this\.recordTimer\)/);
  assert.match(page, /nativeCamera\.restartCamera\(\)/);
  assert.match(page, /class="topBar"/);
  assert.match(page, /class="bottomPanel"/);
  assert.match(page, /class="recordHud"/);
  assert.match(page, /class="recordBubble"/);
  assert.match(page, /recordDotClass/);
  assert.match(page, /recordElapsedText/);
  assert.match(page, /class="topSide"/);
  assert.match(page, /class="topRightSide"/);
  assert.match(page, /class="flashTapArea" @click="cycleFlashMode"/);
  assert.match(page, /:class="flashPillClass" @click="cycleFlashMode"/);
  assert.match(page, /flashPillClass/);
  assert.match(page, /flashIconClass/);
  assert.match(page, /flashTextClass/);
  assert.match(page, /flashModeText/);
  assert.match(page, /cycleFlashMode/);
  assert.match(page, /if \(this\.flashPending\) \{[\s\S]*return/);
  assert.match(page, /tappedAt - this\.flashTapAt < 280/);
  assert.match(page, /const flashApplied = await this\.syncFlashMode\(this\.flashMode, true\)/);
  assert.match(page, /if \(!flashApplied\) \{[\s\S]*this\.flashMode = 'off'/);
  assert.match(page, /const currentFlashMode = this\.flashMode/);
  assert.match(page, /const nextMode = this\.nextFlashMode\(currentFlashMode\)/);
  assert.match(page, /nextFlashMode\(currentFlashMode\)/);
  assert.match(page, /if \(this\.mode === 'video'\) \{[\s\S]*return currentFlashMode === 'off' \? 'on' : 'off'/);
  assert.match(page, /return currentFlashMode === 'off' \? 'on' : \(currentFlashMode === 'on' \? 'auto' : 'off'\)/);
  assert.match(page, /this\.flashPending = true/);
  assert.match(page, /this\.nativeStatus = '闪光灯切换中'/);
  assert.match(page, /const applied = await this\.syncFlashMode\(nextMode, false\)/);
  assert.match(page, /if \(!applied\) \{[\s\S]*this\.flashMode = currentFlashMode/);
  assert.match(page, /finally \{[\s\S]*this\.flashPending = false/);
  assert.match(page, /result\.data\.applied === false/);
  assert.match(page, /this\.flashEventHandled = true/);
  assert.match(page, /this\.flashEventApplied = detail\.applied !== false/);
  assert.match(page, /原生闪光灯接口不可用/);
  assert.match(page, /this\.flashEventHandled = false/);
  assert.match(page, /const eventHandled = this\.flashEventHandled === true/);
  assert.match(page, /const eventApplied = this\.flashEventApplied === true/);
  assert.match(page, /if \(eventHandled\) \{[\s\S]*return eventApplied/);
  assert.match(page, /catch \(error\)[\s\S]*闪光灯设置失败/);
  assert.match(page, /flashModeLabel\(mode\)/);
  assert.match(page, /typeof result === 'string'/);
  assert.match(page, /JSON\.parse\(result\)/);
  assert.match(page, /nativeResult && typeof nativeResult\.get === 'function'/);
  assert.match(topBar, /<text :class="flashIconClass" @click="cycleFlashMode">⚡<\/text>/);
  assert.match(page, /return '开'/);
  assert.match(page, /return '自动'/);
  assert.match(page, /return '关'/);
  assert.ok(topBar.indexOf('flashPillClass') > -1 && topBar.indexOf('class="fpsPill"') > -1);
  assert.ok(topBar.indexOf('flashPillClass') < topBar.indexOf('class="fpsPill"'));
  assert.match(page, /<text class="fpsText">/);
  assert.match(page, /class="shutterWrap"/);
  assert.match(page, /class="resultButton controlLeft"/);
  assert.match(page, /class="cameraButton controlRight"/);
  assert.match(page, /videoModeButtonClass/);
  assert.match(page, /photoModeTextClass/);
  assert.match(page, /shutterCoreClass/);
  assert.match(page, /recordStopCoreClass/);
  assert.match(page, /classes\.push\('shutterRecording'\)/);
  assert.doesNotMatch(page, /:class="\{/);
  assert.match(page, /width: 76px/);
  assert.match(page, /class="modeSwitch"/);
  assert.match(page, /width: 176px/);
  assert.match(page, /modeTextSelected/);
  assert.match(page, /background-color: rgba\(255, 255, 255, 0\.78\)/);
  assert.match(page, /background-color: rgba\(245, 248, 246, 0\.92\)/);
  assert.match(page, /background-color: rgba\(255, 255, 255, 0\.42\)/);
  assert.match(page, /border-color: rgba\(255, 255, 255, 0\.86\)/);
  assert.match(page, /\.shutterCore \{[\s\S]*background-color: #ffffff;/);
  assert.match(page, /background-color: rgba\(255, 138, 0, 0\.14\)/);
  assert.match(page, /\.modeSelected \{[\s\S]*background-color: #ff8a00;/);
  assert.match(page, /\.modeTextSelected \{[\s\S]*color: #ffffff;/);
  assert.match(page, /\.flashPillActive \{[\s\S]*background-color: #ff8a00;[\s\S]*border-color: #ff8a00;/);
  assert.match(page, /\.flashTextActive \{[\s\S]*color: #ffffff;/);
  assert.match(page, /\.flashTapArea \{[\s\S]*width: 64px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.match(page, /\.topTitleBox \{[\s\S]*position: absolute;[\s\S]*left: 0;[\s\S]*right: 0;[\s\S]*justify-content: center;[\s\S]*pointer-events: none;/);
  assert.match(page, /\.topSide \{[\s\S]*position: absolute;[\s\S]*left: 14px;[\s\S]*top: 30px;/);
  assert.match(page, /\.topRightSide \{[\s\S]*position: absolute;[\s\S]*right: 14px;[\s\S]*top: 30px;/);
  assert.match(page, /color: #ffffff/);
  assert.match(page, /border-color: rgba\(255, 59, 48, 0\.72\)/);
  assert.match(page, /\.shutterWrap \{[\s\S]*left: 0;[\s\S]*right: 0;[\s\S]*justify-content: center;/);
  assert.match(page, /\.controlLeft \{[\s\S]*left: 22px;/);
  assert.match(page, /\.controlRight \{[\s\S]*right: 22px;/);
  assert.match(page, /transition-property: transform, background-color, opacity;/);
  assert.match(page, /\.shutterRecording \{[\s\S]*background-color: rgba\(36, 36, 36, 0\.78\);/);
  assert.match(page, /\.shutterCoreRecording \{[\s\S]*opacity: 0;[\s\S]*transform: scale\(0\.48\);/);
  assert.match(page, /\.recordStopCore \{[\s\S]*width: 48px;[\s\S]*height: 48px;[\s\S]*border-radius: 8px;[\s\S]*transform: scale\(0\.58\);/);
  assert.match(page, /\.recordStopCoreActive \{[\s\S]*opacity: 1;[\s\S]*transform: scale\(1\);/);
  assert.match(page, /照片已保存到相册/);
  assert.match(page, /视频已保存到相册/);
  assert.match(page, /detail\.errorCode === '1501'/);
  assert.match(page, /视频/);
  assert.match(page, /照片/);
  assert.doesNotMatch(page, /resultStrip/);
  assert.doesNotMatch(page, /lastResultText/);
  assert.doesNotMatch(page, /toggleResultStrip/);
  assert.doesNotMatch(page, /<uts-markvideo-camera/);
  assert.doesNotMatch(page, /@\/uni_modules\/uts-markvideo/);
  assert.doesNotMatch(page, /recordWatermarkVideo/);
  assert.doesNotMatch(page, /setWatermark|clearWatermark|watermarkTemplate|watermarkFrame/);
});

test('nvue and uts component styles avoid unsupported margin auto centering', async () => {
  const files = [
    ...await collectFiles('pages', ['.nvue', '.vue']),
    ...await collectFiles('uni_modules/xyc-markvideo', ['.nvue', '.vue']),
  ];

  for (const file of files) {
    const content = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(content, /margin[^\n;]*auto/, `${file} must not use margin auto centering`);
  }
});

test('xyc-markvideo package advertises Android nvue component support only', async () => {
  const pkg = JSON.parse(await readFile(
    path.join(root, 'uni_modules/xyc-markvideo/package.json'),
    'utf8',
  ));

  assert.equal(pkg.id, 'xyc-markvideo');
  assert.equal(pkg.name, 'xyc-markvideo');
  assert.equal(pkg.dcloudext.type, 'component-uts');
  assert.equal(pkg.uni_modules.platforms.client['uni-app'].app.nvue, 'y');
  assert.equal(pkg.uni_modules.platforms.client['uni-app'].app.android, 'y');
  assert.equal(pkg.uni_modules.platforms.client['uni-app'].app.ios, '-');
  assert.equal(pkg.uni_modules.platforms.client['uni-app-x'].app.android, 'y');
  assert.equal(pkg.uni_modules.platforms.client['uni-app-x'].app.ios, '-');
});

test('xyc-markvideo Android component bridges to native camera view', async () => {
  const android = await readFile(
    path.join(root, 'uni_modules/xyc-markvideo/utssdk/app-android/index.vue'),
    'utf8',
  );

  assert.match(android, /name: 'xyc-markvideo'/);
  assert.match(android, /import \{ XycNativeCameraView \} from 'uts\.xyc\.markvideo\.android'/);
  assert.match(android, /NVLoad\(\) : FrameLayout/);
  assert.match(android, /new XycNativeCameraView/);
  assert.match(android, /new XycNativeCameraView\(\$androidContext!\)/);
  assert.match(android, /'nativeviewready'/);
  assert.match(android, /'cameraready'/);
  assert.match(android, /'photodone'/);
  assert.match(android, /'recordstart'/);
  assert.match(android, /'recorddone'/);
  assert.match(android, /expose: \['setStatus', 'switchMode', 'setFlashMode', 'takePhoto', 'startRecord', 'stopRecord', 'restartCamera', 'preparePermissions', 'prepareRecordPermissions', 'destroyCamera'\]/);
  assert.match(android, /switchMode\(mode : string\)/);
  assert.match(android, /setFlashMode\(mode : string\) : string/);
  assert.match(android, /nativeViewUnavailable\(\) : string/);
  assert.doesNotMatch(android, /type NativeCameraResult/);
  assert.match(android, /return view\.setFlashMode\(mode\)/);
  assert.doesNotMatch(android, /JSON\.parse<NativeCameraResult>\(text\)/);
  assert.doesNotMatch(android, /JSON\.parse\(text\) as NativeCameraResult/);
  assert.match(android, /takePhoto\(\)/);
  assert.match(android, /startRecord\(options : any = \{\}\)/);
  assert.match(android, /stopRecord\(\)/);
  assert.match(android, /preparePermissions\(\)/);
  assert.match(android, /prepareRecordPermissions\(\)/);
  assert.doesNotMatch(android, /createPendingResult/);
  assert.doesNotMatch(android, /待接入/);
  assert.doesNotMatch(android, /uts-markvideo/);
  assert.doesNotMatch(android, /recordWatermarkVideo/);
});

test('xyc-markvideo Android native view uses camera preview, photo, and 30fps recording', async () => {
  const nativeView = await readFile(
    path.join(root, 'uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt'),
    'utf8',
  );

  assert.match(nativeView, /class XycNativeCameraView/);
  assert.match(nativeView, /SurfaceView/);
  assert.match(nativeView, /Camera\.open/);
  assert.match(nativeView, /resolveCameraRotationDegrees\(cameraId: Int\)/);
  assert.match(nativeView, /currentDisplayRotationDegrees\(\)/);
  assert.match(nativeView, /CAMERA_FACING_FRONT/);
  assert.match(nativeView, /setDisplayOrientation\(resolveCameraRotationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /setRotation\(resolveCameraRotationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /takePicture/);
  assert.match(nativeView, /拍照请求已受理/);
  assert.match(nativeView, /MediaRecorder/);
  assert.match(nativeView, /setOrientationHint\(resolveCameraRotationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /requestedFlashMode = UI_FLASH_OFF/);
  assert.match(nativeView, /fun setFlashMode\(mode: String\): String/);
  assert.match(nativeView, /if \(currentMode == "video" && requestedFlashMode == UI_FLASH_AUTO\) \{[\s\S]*requestedFlashMode = UI_FLASH_OFF/);
  assert.match(nativeView, /val normalizedMode = normalizeFlashMode\(mode\)/);
  assert.match(nativeView, /currentMode == "video" && normalizedMode == UI_FLASH_AUTO/);
  assert.match(nativeView, /\.put\("requestedFlashMode", normalizedMode\)/);
  assert.match(nativeView, /\.put\("applied", applied\)/);
  assert.match(nativeView, /unsupportedFlashModeMessage/);
  assert.match(nativeView, /camera \?: return requestedFlashMode == UI_FLASH_OFF/);
  assert.match(nativeView, /supportedFlashModes/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_OFF/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_ON/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_AUTO/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_TORCH/);
  assert.match(nativeView, /validateRecordingFlashMode\(activeCamera\)/);
  assert.match(nativeView, /failAndEmit\("1102", recordingFlashError, recordingFlashError\)/);
  assert.match(nativeView, /failAndEmit\("1102", "录像闪光灯设置失败", "录像闪光灯设置失败"\)/);
  assert.match(nativeView, /视频录像不支持自动闪光/);
  assert.match(nativeView, /录像闪光灯设置失败/);
  assert.doesNotMatch(nativeView, /"1404"/);
  assert.match(nativeView, /currentMode != "video" && supportedModes\.contains\(Camera\.Parameters\.FLASH_MODE_TORCH\)/);
  assert.match(nativeView, /applyFlashModeToParameters\(parameters, false\)/);
  assert.match(nativeView, /setVideoFrameRate\(targetFps\)/);
  assert.match(nativeView, /DEFAULT_TARGET_FPS = 30/);
  assert.match(nativeView, /setPreviewFpsRange/);
  assert.match(nativeView, /onWindowFocusChanged/);
  assert.match(nativeView, /scheduleCameraPermissionRetry/);
  assert.match(nativeView, /cameraPermissionRequested/);
  assert.match(nativeView, /statusView\.visibility/);
  assert.match(nativeView, /MediaStore/);
  assert.match(nativeView, /preparePermissions\(\)/);
  assert.match(nativeView, /prepareRecordPermissions\(\)/);
  assert.match(nativeView, /recordMissingPermissions/);
  assert.match(nativeView, /recordPermissionMessage/);
  assert.match(nativeView, /requestPermissions/);
  assert.match(nativeView, /REQUEST_PREPARE_PERMISSIONS/);
  assert.match(nativeView, /REQUEST_PREPARE_RECORD_PERMISSIONS/);
  assert.match(nativeView, /saveMediaToAlbum/);
  assert.match(nativeView, /savedToAlbum/);
  assert.match(nativeView, /appendAlbumFailure/);
  assert.match(nativeView, /相册保存失败/);
  assert.match(nativeView, /照片已保存到相册/);
  assert.match(nativeView, /视频已保存到相册/);
  assert.match(nativeView, /RECORD_AUDIO/);
  assert.doesNotMatch(nativeView, /requestPermission\(/);
  assert.doesNotMatch(nativeView, /Watermark|watermark|setWatermark|clearWatermark/);
});

test('xyc-markvideo Android manifest declares camera and microphone permissions', async () => {
  const androidManifest = await readFile(
    path.join(root, 'uni_modules/xyc-markvideo/utssdk/app-android/AndroidManifest.xml'),
    'utf8',
  );

  assert.match(androidManifest, /android\.permission\.CAMERA/);
  assert.match(androidManifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(androidManifest, /android\.permission\.WRITE_EXTERNAL_STORAGE/);
  assert.match(androidManifest, /android:maxSdkVersion="28"/);
});

test('Vue 3 app entry is still declared in manifest', async () => {
  const main = await readFile(path.join(root, 'main.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));

  assert.match(main, /createSSRApp/);
  assert.equal(manifest.vueVersion, '3');
});
