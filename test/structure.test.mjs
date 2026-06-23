import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const testWatermarkHandlePad = 30;
const testWatermarkHandleSize = 42;
const testWatermarkHandleInset = 9;
const testWatermarkMinScale = 0.55;
const testWatermarkAbsoluteMinScale = 0.28;
const testWatermarkMaxScale = 2.2;
const testWatermarkPinchMinDistance = 8;

const requiredFiles = [
  'App.vue',
  'main.js',
  'manifest.json',
  'pages.json',
  'pages/index/index.nvue',
  'pages/cameraX/index.nvue',
  'docs/watermark-template-camera-prd.md',
  'static/watermark/logo2.png',
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

async function readPngDimensions(relativePath) {
  const data = await readFile(path.join(root, relativePath));
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function findTagBlock(source, openNeedle, tagName = 'view') {
  const start = source.indexOf(openNeedle);
  assert.notEqual(start, -1, `${openNeedle} should exist`);

  const tokenPattern = new RegExp(`<${tagName}(?=[\\s>])|</${tagName}>`, 'g');
  tokenPattern.lastIndex = start;
  let depth = 0;
  let match = tokenPattern.exec(source);

  while (match) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, tokenPattern.lastIndex);
      }
    } else {
      depth += 1;
    }
    match = tokenPattern.exec(source);
  }

  assert.fail(`${openNeedle} should have a closing </${tagName}>`);
}

function testWatermarkRotatedBounds(width, height, rotation) {
  const radians = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

function testWatermarkBoxMetrics(width, height, scale, rotation) {
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  const boxWidth = contentWidth + testWatermarkHandlePad * 2;
  const boxHeight = contentHeight + testWatermarkHandlePad * 2;
  const bounds = testWatermarkRotatedBounds(boxWidth, boxHeight, rotation);
  const containerWidth = Math.max(1, boxWidth, bounds.width);
  const containerHeight = Math.max(1, boxHeight, bounds.height);

  return {
    contentWidth,
    contentHeight,
    boxWidth,
    boxHeight,
    containerWidth,
    containerHeight,
    transformLeft: (containerWidth - boxWidth) / 2,
    transformTop: (containerHeight - boxHeight) / 2,
  };
}

function testMaxWatermarkScale(editWidth, editHeight, frameWidth, frameHeight, rotation) {
  const radians = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidthFactor = Math.max(1, frameWidth * cos + frameHeight * sin);
  const rotatedHeightFactor = Math.max(1, frameWidth * sin + frameHeight * cos);
  const maxWidthScale = editWidth / rotatedWidthFactor;
  const maxHeightScale = editHeight / rotatedHeightFactor;

  return Math.max(testWatermarkAbsoluteMinScale, Math.min(testWatermarkMaxScale, maxWidthScale, maxHeightScale));
}

function rotatePointAroundCenter(point, center, rotation) {
  const radians = rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function testWatermarkHandleScreenCenters(frame, rotation) {
  const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, rotation);
  const centerX = frame.left + metrics.contentWidth / 2;
  const centerY = frame.top + metrics.contentHeight / 2;
  const originX = centerX - metrics.containerWidth / 2;
  const originY = centerY - metrics.containerHeight / 2;
  const transformLeft = originX + metrics.transformLeft;
  const transformTop = originY + metrics.transformTop;
  const transformCenter = {
    x: transformLeft + metrics.boxWidth / 2,
    y: transformTop + metrics.boxHeight / 2,
  };
  const handleCenterOffset = testWatermarkHandleInset + testWatermarkHandleSize / 2;
  const rightHandleCenterX = metrics.boxWidth - testWatermarkHandleInset - testWatermarkHandleSize / 2;
  const bottomHandleCenterY = metrics.boxHeight - testWatermarkHandleInset - testWatermarkHandleSize / 2;

  const unrotated = {
    rotate: {
      x: transformLeft + handleCenterOffset,
      y: transformTop + handleCenterOffset,
    },
    delete: {
      x: transformLeft + rightHandleCenterX,
      y: transformTop + handleCenterOffset,
    },
    resize: {
      x: transformLeft + rightHandleCenterX,
      y: transformTop + bottomHandleCenterY,
    },
  };

  return Object.fromEntries(Object.entries(unrotated).map(([key, point]) => [
    key,
    rotatePointAroundCenter(point, transformCenter, rotation),
  ]));
}

function assertHandlePositionsRotateWithContent(frame) {
  const baseline = testWatermarkHandleScreenCenters(frame, 0);
  const closeTo = (actual, expected) => Math.abs(actual - expected) <= 0.001;

  for (const rotation of [90, 180, -90]) {
    const actual = testWatermarkHandleScreenCenters(frame, rotation);
    for (const key of ['rotate', 'delete', 'resize']) {
      assert.ok(
        !closeTo(actual[key].x, baseline[key].x) || !closeTo(actual[key].y, baseline[key].y),
        `${key} should move with the rotated watermark at ${rotation}deg`,
      );
    }
  }
}

function testPinchScale(startScale, startDistance, nextDistance) {
  if (startDistance < testWatermarkPinchMinDistance || nextDistance < testWatermarkPinchMinDistance) {
    return startScale;
  }
  return startScale * (nextDistance / startDistance);
}

function assertPinchScaleIsDirectional() {
  assert.equal(testPinchScale(1, 120, 180), 1.5);
  assert.equal(testPinchScale(1, 120, 60), 0.5);
  assert.ok(Math.abs(testPinchScale(0.8, 80, 120) - 1.2) < 0.0001);
}

function testWatermarkMovePositionFromFrame(frame, editBounds) {
  const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, frame.rotation);
  const contentWidth = frame.width * frame.scale;
  const contentHeight = frame.height * frame.scale;
  const centerX = frame.left + contentWidth / 2;
  const centerY = frame.top + contentHeight / 2;

  return {
    x: Math.round((centerX - metrics.containerWidth / 2 - editBounds.left) * 1000) / 1000,
    y: Math.round((centerY - metrics.containerHeight / 2 - editBounds.top) * 1000) / 1000,
  };
}

test('project contains the xyc-markvideo cameraX mainline files', async () => {
  for (const file of requiredFiles) {
    await access(path.join(root, file));
  }
});

test('watermark logo source asset is high enough for photo burn-in', async () => {
  const dimensions = await readPngDimensions('static/watermark/logo2.png');

  assert.ok(dimensions.width >= 512, `logo2.png width should be >= 512, got ${dimensions.width}`);
  assert.ok(dimensions.height >= 512, `logo2.png height should be >= 512, got ${dimensions.height}`);
});

test('watermark resize handle uses native view lines for the diagonal glyph', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.nvue'), 'utf8');

  assert.match(page, /<view class="watermarkResizeGlyph" :style="watermarkControlTextStyle">/);
  assert.match(page, /class="watermarkResizeTopHorizontal"/);
  assert.match(page, /class="watermarkResizeTopVertical"/);
  assert.match(page, /class="watermarkResizeTopDiagonal"/);
  assert.match(page, /class="watermarkResizeBottomHorizontal"/);
  assert.match(page, /class="watermarkResizeBottomVertical"/);
  assert.match(page, /class="watermarkResizeBottomDiagonal"/);
  assert.doesNotMatch(page, /watermarkResizeLine/);
  assert.doesNotMatch(page, /resize-diagonal\.svg/);
  assert.doesNotMatch(page, /<image[^>]*class="watermarkResizeIcon"/);
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
  assert.equal(pagesJson.globalStyle.pageOrientation, 'portrait');
  assert.doesNotMatch(JSON.stringify(pagesJson), /pages\/camera\/camera/);
});

test('app manifest locks the camera MVP to portrait orientations', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));

  assert.deepEqual(manifest['app-plus'].screenOrientation, [
    'portrait-primary',
    'portrait-secondary',
  ]);
  assert.equal(manifest.screenOrientation, undefined);
  assert.doesNotMatch(JSON.stringify(manifest['app-plus'].screenOrientation), /landscape/);
});

test('cameraX keeps portrait layout metrics when window reports landscape', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.nvue'), 'utf8');

  assert.match(page, /function normalizePortraitLayoutBounds\(width, height\)/);
  assert.match(page, /width: Math\.min\(safeWidth, safeHeight\)/);
  assert.match(page, /height: Math\.max\(safeWidth, safeHeight\)/);
  assert.doesNotMatch(page, /width: info\.windowWidth \|\| 375/);
  assert.doesNotMatch(page, /height: info\.windowHeight \|\| 812/);

  const normalizePortraitLayoutBounds = (width, height) => {
    const safeWidth = Math.max(1, Number(width) || 375);
    const safeHeight = Math.max(1, Number(height) || 812);
    return {
      width: Math.min(safeWidth, safeHeight),
      height: Math.max(safeWidth, safeHeight),
    };
  };

  assert.deepEqual(normalizePortraitLayoutBounds(812, 375), {
    width: 375,
    height: 812,
  });
  assert.deepEqual(normalizePortraitLayoutBounds(375, 812), {
    width: 375,
    height: 812,
  });
});

test('index.nvue manages watermark templates before opening cameraX', async () => {
  const page = await readFile(path.join(root, 'pages/index/index.nvue'), 'utf8');

  assert.match(page, /uni\.navigateTo\(\{[\s\S]*url: '\/pages\/cameraX\/index'/);
  assert.match(page, /30 fps/);
  assert.match(page, /WATERMARK_STORAGE_KEY/);
  assert.match(page, /xyc-camera-watermark-template/);
  assert.match(page, /watermarkTemplates/);
  assert.match(page, /showWatermarkSheet/);
  assert.match(page, /selectWatermarkTemplate/);
  assert.match(page, /templateType: 'text'/);
  assert.match(page, /templateType: 'image'/);
  assert.match(page, /templateType: 'mixed'/);
  assert.match(page, /\/static\/watermark\/logo2\.png/);
  assert.match(page, /uni\.setStorageSync\(WATERMARK_STORAGE_KEY/);
  assert.match(page, /this\.currentTemplateId = ''[\s\S]*this\.currentTemplate = null/);
  assert.doesNotMatch(page, /embedded-camera-payload/);
  assert.doesNotMatch(page, /uts-markvideo/);
  assert.doesNotMatch(page, /recordWatermarkVideo/);
});

test('cameraX nvue page owns UI and calls xyc-markvideo native camera methods', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.nvue'), 'utf8');
  const stopBranch = page.match(/if \(typeof nativeCamera\.stopRecord !== 'function'\) \{[\s\S]*?formatRecordElapsed\(elapsedMs\) \{/)?.[0] || '';
  const topBar = page.match(/<cover-view class="topBar">[\s\S]*?<cover-view class="recordHud"/)?.[0] || '';
  const watermarkArea = page.match(/<movable-area class="watermarkLayer"[\s\S]*?<\/movable-area>/)?.[0] || '';
  const watermarkTransformBox = findTagBlock(page, '<view class="watermarkTransformBox"', 'view');

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
  assert.match(page, /const PORTRAIT_LAYOUT_FALLBACK_WIDTH = 375/);
  assert.match(page, /const PORTRAIT_LAYOUT_FALLBACK_HEIGHT = 812/);
  assert.match(page, /resolveScreenBounds\(\)/);
  assert.match(page, /normalizePortraitLayoutBounds\(/);
  assert.match(page, /info\.windowWidth \|\| PORTRAIT_LAYOUT_FALLBACK_WIDTH/);
  assert.match(page, /info\.windowHeight \|\| PORTRAIT_LAYOUT_FALLBACK_HEIGHT/);
  assert.match(page, /width: Math\.min\(safeWidth, safeHeight\)/);
  assert.match(page, /height: Math\.max\(safeWidth, safeHeight\)/);
  assert.doesNotMatch(page, /width: info\.windowWidth \|\| 375/);
  assert.doesNotMatch(page, /height: info\.windowHeight \|\| 812/);
  assert.doesNotMatch(page, /@shuttertap/);
  assert.doesNotMatch(page, /@modechange/);
  assert.doesNotMatch(page, /handleNativeShutter/);
  assert.doesNotMatch(page, /handleNativeMode/);
  assert.match(page, /resolveNativeCamera\(\)/);
  assert.match(page, /onShow\(\)/);
  assert.match(page, /prepareCameraPermissions\(\)/);
  assert.match(page, /prepareRecordPermissions\(\)/);
  assert.match(page, /retryCameraAfterPermission\(\)/);
  assert.match(page, /clearRecordPermissionRetry\(\)/);
  assert.match(page, /scheduleRecordPermissionRetry\(\)/);
  assert.match(page, /recordStartPending: false/);
  assert.match(page, /recordStartPendingTimer: null/);
  assert.match(page, /lastNativeError: null/);
  assert.match(page, /this\.nativeStatus === '相机权限未授权'/);
  assert.match(page, /nativeCamera\.preparePermissions\(\)/);
  assert.match(page, /nativeCamera\.prepareRecordPermissions\(\)/);
  assert.match(page, /this\.normalizeNativeCommandReturn\(nativeCamera\.prepareRecordPermissions\(\), '请先完成录像权限授权', '录像权限已准备', \['10'\]\)/);
  assert.doesNotMatch(page, /rawResult && rawResult\.success/);
  assert.match(page, /if \(mode === this\.mode\) \{[\s\S]*return[\s\S]*this\.mode = mode/);
  assert.doesNotMatch(page, /nativeCamera\.switchMode\(mode\)/);
  assert.match(page, /await nativeCamera\.setFlashMode\(mode\)/);
  assert.match(page, /nativeCamera\.setZoomMode\(mode\)/);
  assert.match(page, /zoomMode: '1x'/);
  assert.match(page, /zoomPending: false/);
  assert.match(page, /zoomRequestSilent: false/);
  assert.match(page, /zoomEventHandled: false/);
  assert.match(page, /zoomEventApplied: true/);
  assert.match(page, /zoomRail/);
  assert.match(page, /wideZoomButtonClass/);
  assert.match(page, /normalZoomButtonClass/);
  assert.match(page, /teleZoomButtonClass/);
  assert.match(page, /syncZoomMode/);
  assert.match(page, /setZoomMode\(mode\)/);
  assert.match(page, /zoomModeLabel\(mode\)/);
  assert.match(page, /this\.recordStartAfterPermission = true/);
  assert.match(page, /this\.clearRecordPermissionRetry\(\)/);
  assert.match(page, /this\.zoomRequestSilent = silent === true/);
  assert.match(page, /if \(result\.data && result\.data\.applied === false\)/);
  assert.match(page, /maxWatermarkScale\(left, top, rotation, width, height\)/);
  assert.match(page, /nativeCamera\.takePhoto\(\)/);
  assert.match(page, /handlePhotoDone\(event\)/);
  assert.match(page, /拍照请求已受理|拍照中/);
  assert.match(page, /nativeCamera\.startRecord\(\{ fps: this\.targetFps \}\)/);
  assert.match(page, /nativeCamera\.stopRecord\(\)/);
  assert.match(page, /WATERMARK_STORAGE_KEY/);
  assert.match(page, /watermarkTemplates/);
  assert.match(page, /activeWatermark/);
  assert.match(page, /watermarkFrame/);
  assert.match(page, /updateWatermarkFrame\(patch\)/);
  assert.doesNotMatch(page, /this\.watermarkFrame\.(left|top|scale|rotation)\s*=/);
  assert.match(page, /showWatermarkSheet/);
  assert.match(page, /openWatermarkSheet\(\)/);
  assert.match(page, /selectWatermarkTemplate/);
  assert.match(page, /clearActiveWatermark/);
  assert.match(page, /syncWatermarkToNative/);
  assert.match(page, /nativeCamera\.setWatermark/);
  assert.match(page, /nativeCamera\.clearWatermark/);
  assert.match(page, /<movable-area class="watermarkLayer" :style="watermarkLayerStyle" v-if="activeWatermark">/);
  assert.match(page, /<movable-view[\s\S]*class="watermarkBox"[\s\S]*:x="watermarkMoveX"[\s\S]*:y="watermarkMoveY"[\s\S]*direction="all"[\s\S]*:animation="false"[\s\S]*:disabled="watermarkMoveDisabled"[\s\S]*@touchstart="startWatermarkTouch"[\s\S]*@touchmove="moveWatermarkTouch"[\s\S]*@change="handleWatermarkMoveChange"[\s\S]*@touchend="finishWatermarkTouch"/);
  assert.match(page, /class="watermarkTransformBox"/);
  assert.match(page, /watermarkLayerStyle\(\)/);
  assert.match(page, /watermarkMoveX\(\)/);
  assert.match(page, /watermarkMoveY\(\)/);
  assert.match(page, /watermarkMovePosition: \{[\s\S]*x: 0,[\s\S]*y: 0/);
  assert.match(page, /watermarkMoveX\(\) \{[\s\S]*return this\.watermarkMovePosition\.x/);
  assert.match(page, /watermarkMoveY\(\) \{[\s\S]*return this\.watermarkMovePosition\.y/);
  assert.match(page, /watermarkMovePositionFromFrame\(\)/);
  assert.match(page, /this\.watermarkMovePosition = this\.watermarkMovePositionFromFrame\(\)/);
  const watermarkMoveDisabledBody = page.match(/watermarkMoveDisabled\(\) \{[\s\S]*?\n    \},/)?.[0] || '';
  assert.match(watermarkMoveDisabledBody, /return this\.isRecording \|\| this\.stopPending/);
  assert.doesNotMatch(watermarkMoveDisabledBody, /watermarkPinchGesture !== null|watermarkPinchActive/);
  assert.doesNotMatch(page, /:key="watermarkBoxKey"/);
  assert.doesNotMatch(page, /:key="watermarkControlKey \+ '-/);
  assert.doesNotMatch(page, /watermarkBoxKey\(\)/);
  assert.doesNotMatch(page, /watermarkControlKey\(\)/);
  assert.doesNotMatch(page, /watermarkGeometryKey\(prefix\)/);
  assert.match(page, /handleWatermarkMoveChange\(event\)/);
  assert.match(page, /finishWatermarkMove\(\)/);
  assert.match(page, /watermarkBoxMetrics\(width, height, scale, rotation\)/);
  assert.doesNotMatch(page, /startWatermarkDrag/);
  assert.match(page, /startWatermarkPinch\(touchPair\)/);
  assert.doesNotMatch(page, /@touchstart\.stop="startWatermarkDrag"/);
  assert.doesNotMatch(page, /@touchend\.stop="finishWatermarkEdit"/);
  assert.doesNotMatch(page, /@touchcancel\.stop="finishWatermarkEdit"/);
  assert.match(page, /@touchstart\.stop="stopWatermarkTouch"/);
  assert.match(page, /@touchcancel\.stop="stopWatermarkTouch"/);
  assert.match(page, /this\.clearWatermarkPinchGesture\(\)[\s\S]*this\.watermarkSyncVersion \+= 1[\s\S]*this\.activeWatermark = null/);
  assert.match(page, /watermarkSyncedVersion: -1/);
  assert.match(page, /const syncVersion = this\.watermarkSyncVersion[\s\S]*this\.watermarkSyncedVersion === syncVersion/);
  assert.match(page, /this\.watermarkSyncedVersion = syncVersion/);
  assert.doesNotMatch(page, /@touchstart\.stop="startWatermarkResize"/);
  assert.doesNotMatch(page, /@touchmove\.stop="moveWatermark"/);
  assert.doesNotMatch(page, /moveWatermark\(event\)/);
  assert.doesNotMatch(page, /finishWatermarkEdit\(\)/);
  assert.match(page, /stopPending: false/);
  assert.match(page, /recordStartedAt: 0/);
  assert.match(page, /recordElapsedMs: 0/);
  assert.match(page, /recordBlinkOn: true/);
  assert.match(page, /recordTimer: null/);
  assert.match(page, /recordStopPendingTimer: null/);
  assert.match(page, /this\.recordStartPending = true/);
  assert.match(page, /this\.clearRecordStartPendingTimer\(\)/);
  assert.match(page, /startRecordPendingTimeout\(\)/);
  assert.match(page, /const RECORD_STOP_TIMEOUT_MS = 12000/);
  assert.match(page, /clearRecordStopPendingTimer\(\) \{[\s\S]*clearTimeout\(this\.recordStopPendingTimer\)/);
  assert.match(page, /startRecordStopPendingTimeout\(\) \{[\s\S]*this\.nativeStatus = '视频保存超时，请重试'/);
  assert.doesNotMatch(page, /4500/);
  assert.match(stopBranch, /this\.isRecording = false[\s\S]*this\.stopPending = true[\s\S]*this\.nativeStatus = '正在保存视频'/);
  assert.match(stopBranch, /this\.stopRecordingClock\(\)[\s\S]*this\.startRecordStopPendingTimeout\(\)[\s\S]*try \{/);
  assert.match(stopBranch, /const stopResponse = await nativeCamera\.stopRecord\(\)/);
  assert.match(stopBranch, /const result = await this\.normalizeNativeCommandReturn\(stopResponse, '录像停止失败', '视频保存中', \['14'\]\)/);
  assert.match(stopBranch, /if \(!this\.stopPending\) \{[\s\S]*return[\s\S]*\}/);
  assert.match(stopBranch, /this\.nativeStatus = result\.data && result\.data\.message \? result\.data\.message : '视频保存中'/);
  assert.match(stopBranch, /if \(this\.nativeStatus !== '视频保存中'\) \{[\s\S]*this\.clearRecordStopPendingTimer\(\)[\s\S]*this\.stopPending = false/);
  assert.match(stopBranch, /else \{[\s\S]*this\.nativeStatus = result\.errorMessage \|\| '录像停止失败'[\s\S]*this\.clearRecordStopPendingTimer\(\)[\s\S]*this\.stopPending = false/);
  assert.match(stopBranch, /catch \(error\)[\s\S]*this\.nativeStatus = error && error\.message \? error\.message : '录像停止失败'[\s\S]*this\.clearRecordStopPendingTimer\(\)[\s\S]*this\.stopPending = false/);
  assert.match(page, /detail\.message \|\| \(detail\.savedToAlbum === true \? '视频已保存到相册' : '视频已生成'\)/);
  assert.doesNotMatch(page, /this\.nativeStatus = '视频已保存到相册'/);
  assert.match(page, /formatRecordElapsed\(elapsedMs\)/);
  assert.match(page, /startRecordingClock\(\)/);
  assert.match(page, /setInterval\(\(\) =>/);
  assert.match(page, /clearInterval\(this\.recordTimer\)/);
  assert.match(page, /onUnload\(\)[\s\S]*clearInterval\(this\.recordTimer\)/);
  assert.doesNotMatch(page, /@click="restartCamera"/);
  assert.doesNotMatch(page, /<text class="cameraIcon">↻<\/text>/);
  assert.match(page, /class="topBar"/);
  assert.match(page, /class="bottomPanel"/);
  assert.match(page, /class="recordHud"/);
  assert.match(page, /class="recordBubble"/);
  assert.match(page, /recordDotClass/);
  assert.match(page, /recordElapsedText/);
  assert.match(page, /class="topSide"/);
  assert.match(page, /class="topRightSide"/);
  assert.match(page, /class="zoomRail"/);
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
  assert.match(page, /nextFlashMode\(currentFlashMode\)/);
  assert.match(page, /return currentFlashMode === 'off' \? 'on' : \(currentFlashMode === 'on' \? 'auto' : 'off'\)/);
  assert.match(page, /typeof result === 'string'/);
  assert.match(page, /parseNativeResultText\(text, fallbackMessage\)/);
  assert.match(page, /nativeReturnIsEmpty\(result\)/);
  assert.match(page, /normalizeNativeCommandReturn\(result, fallbackMessage, acceptedMessage, watchedErrorCodes\)/);
  assert.match(page, /normalizeNativeCommandReturn\(nativeCamera\.prepareRecordPermissions\(\), '请先完成录像权限授权', '录像权限已准备', \['10'\]\)/);
  assert.match(page, /normalizeNativeCommandReturn\(await nativeCamera\.setWatermark\(payload\), '水印设置失败', '水印已更新', \['12', '14'\]\)/);
  assert.match(page, /normalizeNativeCommandReturn\(await nativeCamera\.takePhoto\(\), '拍照失败', '拍照中', \['10', '11', '13', '14'\]\)/);
  assert.match(page, /nativeResult && typeof nativeResult\.get === 'function'/);
  assert.match(topBar, /<text :class="flashIconClass" @click="cycleFlashMode">⚡︎<\/text>/);
  assert.match(page, /return '开'/);
  assert.match(page, /return '自动'/);
  assert.match(page, /return '关'/);
  assert.ok(topBar.indexOf('flashPillClass') > -1 && topBar.indexOf('class="fpsPill"') > -1);
  assert.ok(topBar.indexOf('flashPillClass') < topBar.indexOf('class="fpsPill"'));
  assert.match(page, /<text class="fpsText">/);
  assert.match(page, /<text :class="wideZoomTextClass">广角<\/text>/);
  assert.match(page, /<text :class="normalZoomTextClass">1x<\/text>/);
  assert.match(page, /<text :class="teleZoomTextClass">2x<\/text>/);
  assert.match(page, /class="shutterWrap"/);
  assert.match(page, /class="resultButton controlLeft"/);
  assert.match(page, /class="cameraButton controlRight"/);
  assert.match(page, /<text class="cameraIcon">印<\/text>/);
  assert.match(page, /class="watermarkLayer"/);
  assert.match(page, /class="watermarkDelete"/);
  assert.match(page, /class="watermarkRotate"/);
  assert.match(page, /@click\.stop="rotateWatermarkQuarterTurn"/);
  assert.match(page, /class="watermarkRotateText"/);
  assert.match(page, /class="watermarkResize"/);
  assert.match(watermarkArea, /class="watermarkDelete"/);
  assert.match(watermarkArea, /class="watermarkRotate"/);
  assert.match(watermarkArea, /class="watermarkResize"/);
  assert.match(watermarkTransformBox, /class="watermarkContent"/);
  assert.match(watermarkTransformBox, /class="watermarkDelete"/);
  assert.match(watermarkTransformBox, /class="watermarkRotate"/);
  assert.match(watermarkTransformBox, /class="watermarkResize"/);
  assert.match(page, /class="watermarkContent"/);
  assert.doesNotMatch(page, /class="watermarkDragHotspot"/);
  assert.doesNotMatch(page, /watermarkHotspotStyle\(\)/);
  assert.doesNotMatch(page, /@longpress\.stop="startWatermarkDrag"/);
  assert.match(page, /class="watermarkSheet"/);
  assert.match(page, /class="watermarkPreview"/);
  assert.match(page, /if \(this\.activeWatermark && !await this\.flushWatermarkSync\(true\)\) \{[\s\S]*return[\s\S]*nativeCamera\.takePhoto\(\)/);
  assert.match(page, /if \(this\.activeWatermark && !await this\.flushWatermarkSync\(true\)\) \{[\s\S]*return[\s\S]*nativeCamera\.startRecord\(\{ fps: this\.targetFps \}\)/);
  assert.match(page, /videoModeButtonClass/);
  assert.match(page, /photoModeTextClass/);
  assert.match(page, /shutterCoreClass/);
  assert.doesNotMatch(page, /recordStopCoreClass/);
  assert.doesNotMatch(page, /recordStopCore/);
  assert.match(page, /watermarkDelete/);
  assert.match(page, /const WATERMARK_HANDLE_PAD = 30/);
  assert.match(page, /const WATERMARK_HANDLE_SIZE = 42/);
  assert.match(page, /const WATERMARK_HANDLE_INSET = 9/);
  assert.match(page, /watermarkLayerStyle\(\) \{[\s\S]*const editBounds = this\.watermarkEditBounds\(\)[\s\S]*width: Math\.round\(editBounds\.right - editBounds\.left\) \+ 'px'/);
  assert.doesNotMatch(page, /\.watermarkBox \{[\s\S]*overflow: visible;/);
  assert.doesNotMatch(page, /\.watermarkTransformBox \{[\s\S]*overflow: visible;/);
  assert.match(page, /watermarkBoxStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*width: Math\.round\(metrics\.containerWidth\) \+ 'px'[\s\S]*height: Math\.round\(metrics\.containerHeight\) \+ 'px'/);
  assert.match(page, /watermarkTransformStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*const scaleRatio = this\.watermarkPinchScaleRatio\(\)[\s\S]*left: Math\.round\(metrics\.transformLeft\) \+ 'px'[\s\S]*top: Math\.round\(metrics\.transformTop\) \+ 'px'/);
  assert.match(page, /transformOrigin: '50% 50%'/);
  assert.match(page, /transform: 'rotate\(' \+ frame\.rotation \+ 'deg\) scale\(' \+ scaleRatio \+ '\)'/);
  assert.match(page, /watermarkImageStyle\(\) \{[\s\S]*width: Math\.round\(this\.activeWatermark\.imageWidth \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px'[\s\S]*height: Math\.round\(this\.activeWatermark\.imageHeight \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px'[\s\S]*transformOrigin: '50% 50%'[\s\S]*transform: 'scaleY\(-1\)'/);
  assert.doesNotMatch(page, /transformOrigin: '0% 0%'/);
  assert.match(page, /:style="watermarkDeleteStyle"/);
  assert.match(page, /:style="watermarkRotateStyle"/);
  assert.match(page, /:style="watermarkResizeStyle"/);
  assert.match(page, /watermarkRotateStyle\(\) \{[\s\S]*return this\.watermarkControlStyle\(WATERMARK_HANDLE_INSET, WATERMARK_HANDLE_INSET\)/);
  assert.match(page, /watermarkDeleteStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*metrics\.boxWidth - WATERMARK_HANDLE_INSET - WATERMARK_HANDLE_SIZE[\s\S]*WATERMARK_HANDLE_INSET/);
  assert.match(page, /watermarkResizeStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*metrics\.boxWidth - WATERMARK_HANDLE_INSET - WATERMARK_HANDLE_SIZE[\s\S]*metrics\.boxHeight - WATERMARK_HANDLE_INSET - WATERMARK_HANDLE_SIZE/);
  assert.match(page, /watermarkControlStyle\(left, top\) \{[\s\S]*left: Math\.round\(left\) \+ 'px'[\s\S]*top: Math\.round\(top\) \+ 'px'/);
  assert.match(page, /watermarkControlTextStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*transform: 'rotate\(' \+ \(-frame\.rotation\) \+ 'deg\)'/);
  assert.match(page, /:style="watermarkControlTextStyle"/);
  assert.match(page, /left: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /top: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /right: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /bottom: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /watermarkResize/);
  assert.match(page, /<view class="watermarkResizeGlyph" :style="watermarkControlTextStyle">/);
  assert.match(page, /class="watermarkResizeTopHorizontal"/);
  assert.match(page, /class="watermarkResizeBottomDiagonal"/);
  assert.doesNotMatch(page, /resize-diagonal\.svg/);
  assert.doesNotMatch(page, /watermarkResizeText/);
  assert.doesNotMatch(page, /watermarkResizeIcon/);
  assert.doesNotMatch(page, /<text[^>]*>[⤡↘]<\/text>/);
  assert.match(page, /\.watermarkResize \{[\s\S]*width: 42px;[\s\S]*height: 42px;[\s\S]*border-radius: 21px;[\s\S]*background-color: #ff8a00;/);
  assert.match(page, /\.watermarkResizeGlyph \{[\s\S]*width: 26px;[\s\S]*height: 26px;/);
  assert.match(page, /\.watermarkResizeTopHorizontal \{[\s\S]*position: absolute;[\s\S]*background-color: #ffffff;[\s\S]*border-radius: 2px;/);
  assert.match(page, /\.watermarkResizeBottomDiagonal \{[\s\S]*position: absolute;[\s\S]*background-color: #ffffff;[\s\S]*border-radius: 2px;[\s\S]*transform: rotate\(45deg\);/);
  assert.match(page, /watermarkTouchPair\(event, includeChangedTouches\)/);
  assert.match(page, /pickMoveNumber\(source, name\)/);
  assert.match(page, /startWatermarkMove\(\)/);
  assert.match(page, /watermarkMoveActive: false/);
  assert.match(page, /watermarkMoveDraft: null/);
  assert.match(page, /const moveX = this\.pickMoveNumber\(detail, 'x'\)/);
  assert.match(page, /const moveY = this\.pickMoveNumber\(detail, 'y'\)/);
  assert.match(page, /this\.watermarkMoveDraft = \{[\s\S]*x: moveX,[\s\S]*y: moveY/);
  assert.match(page, /commitWatermarkMoveDraft\(flushNow\)/);
  assert.match(page, /watermarkVisibleFrame\(\) \{/);
  assert.match(page, /watermarkFrameFromMovePosition\(moveX, moveY, frame\) \{/);
  assert.match(page, /const nextCenterX = editBounds\.left \+ moveX \+ metrics\.containerWidth \/ 2/);
  assert.match(page, /left: nextCenterX - metrics\.contentWidth \/ 2/);
  assert.match(page, /const movedFrame = this\.watermarkFrameFromMovePosition\(this\.watermarkMoveDraft\.x, this\.watermarkMoveDraft\.y, frame\)/);
  assert.match(page, /startWatermarkPinch\(touchPair\) \{[\s\S]*const distance = this\.pinchDistance\(touchPair\)[\s\S]*this\.commitWatermarkMoveDraft\(false\)[\s\S]*this\.clearWatermarkSyncTimer\(\)[\s\S]*const startFrame = \{[\s\S]*startScale: startFrame\.scale[\s\S]*previewScaleRatio: 1[\s\S]*commitFrame: null/);
  assert.match(page, /updateWatermarkPinch\(touchPair\) \{[\s\S]*const ratio = distance \/ this\.watermarkPinchGesture\.startDistance[\s\S]*const rawScale = this\.watermarkPinchGesture\.startScale \* ratio[\s\S]*previewScaleRatio: clamped\.scale \/ this\.watermarkPinchGesture\.startScale[\s\S]*commitFrame: \{/);
  const moveChangeBody = page.match(/handleWatermarkMoveChange\(event\) \{[\s\S]*?isWatermarkTouchMoveSource\(source\)/)?.[0] || '';
  assert.doesNotMatch(moveChangeBody, /updateWatermarkFrame|scheduleWatermarkSync|syncWatermarkToNative|flushWatermarkSync/);
  const pinchMoveBody = page.match(/updateWatermarkPinch\(touchPair\) \{[\s\S]*?finishWatermarkPinch\(\) \{/)?.[0] || '';
  assert.doesNotMatch(pinchMoveBody, /updateWatermarkFrame|scheduleWatermarkSync|syncWatermarkToNative|flushWatermarkSync/);
  assert.match(page, /if \(this\.watermarkPinchGesture\) \{[\s\S]*this\.watermarkMoveActive = false[\s\S]*this\.watermarkMoveDraft = null[\s\S]*return/);
  assert.match(page, /finishWatermarkMove\(\) \{[\s\S]*this\.commitWatermarkMoveDraft\(true\)/);
  assert.doesNotMatch(page, /@touchstart\.stop="startWatermarkResize"/);
  assert.doesNotMatch(page, /@touchmove\.stop="moveWatermark"/);
  assert.match(page, /rotateWatermarkQuarterTurn\(\) \{[\s\S]*const nextRotation = normalizeRotation\(this\.watermarkFrame\.rotation \+ 90\)[\s\S]*const clamped = this\.clampWatermarkFrame\([\s\S]*this\.flushWatermarkSync\(false\)/);
  assert.match(page, /\.watermarkRotate \{[\s\S]*width: 42px;[\s\S]*height: 42px;[\s\S]*border-radius: 21px;/);
  assert.match(page, /\.watermarkRotateText \{[\s\S]*width: 42px;[\s\S]*height: 42px;[\s\S]*font-size: 21px;[\s\S]*line-height: 42px;/);
  assert.match(page, /this\.updateWatermarkFrame\(\{[\s\S]*left: clamped\.left[\s\S]*top: clamped\.top[\s\S]*rotation: clamped\.rotation/);
  assert.match(page, /const maxScale = this\.maxWatermarkScale\(nextLeft, nextTop, this\.watermarkPinchGesture\.rotation, this\.watermarkPinchGesture\.width, this\.watermarkPinchGesture\.height\)/);
  assert.match(page, /scheduleWatermarkSync\(\) \{[\s\S]*setTimeout\(\(\) => \{[\s\S]*this\.syncWatermarkToNative\(false\)[\s\S]*\}, 160\)/);
  assert.match(page, /flushWatermarkSync\(showError\) \{[\s\S]*this\.clearWatermarkSyncTimer\(\)[\s\S]*this\.syncWatermarkToNative\(showError === true\)/);
  assert.match(page, /finishWatermarkPinch\(\) \{[\s\S]*const commitFrame = gesture \? gesture\.commitFrame : null[\s\S]*if \(changed && commitFrame\) \{[\s\S]*this\.updateWatermarkFrame\(commitFrame\)[\s\S]*this\.flushWatermarkSync\(false\)/);
  assert.match(page, /clearWatermarkSyncTimer\(\) \{[\s\S]*clearTimeout\(this\.watermarkSyncTimer\)/);
  assert.match(page, /watermarkSyncTimer: null/);
  assert.match(page, /this\.watermarkSyncVersion \+= 1/);
  assert.match(page, /watermarkEditBounds\(\) \{/);
  assert.match(page, /watermarkBoxMetrics\(width, height, scale, rotation\) \{/);
  assert.match(page, /const boxWidth = contentSize\.width \+ WATERMARK_HANDLE_PAD \* 2/);
  assert.match(page, /const bounds = this\.watermarkRotatedBounds\(boxWidth, boxHeight, rotation\)/);
  assert.match(page, /const containerWidth = Math\.max\(1, boxWidth, bounds\.width\)/);
  assert.match(page, /const containerHeight = Math\.max\(1, boxHeight, bounds\.height\)/);
  assert.match(page, /transformLeft: \(containerWidth - boxWidth\) \/ 2/);
  assert.doesNotMatch(page, /rotatedLeft: \(containerWidth - bounds\.width\) \/ 2/);
  assert.doesNotMatch(page, /rotatedTop: \(containerHeight - bounds\.height\) \/ 2/);
  assert.match(page, /watermarkRotatedBounds\(width, height, rotation\) \{/);
  assert.match(page, /clampCenterBySize\(center, minEdge, maxEdge, size\) \{/);
  assert.match(page, /clampWatermarkFrame\(left, top, scale, rotation, width, height\) \{/);
  assert.match(page, /const contentBounds = this\.watermarkRotatedBounds\(size\.width, size\.height, nextRotation\)/);
  assert.match(page, /const clampedCenterX = this\.clampCenterBySize\(centerX, editBounds\.left, editBounds\.right, contentBounds\.width\)/);
  assert.match(page, /const clampedCenterY = this\.clampCenterBySize\(centerY, editBounds\.top, editBounds\.bottom, contentBounds\.height\)/);
  assert.match(page, /x: roundWatermarkPx\(center\.x - metrics\.containerWidth \/ 2 - editBounds\.left\)/);
  assert.match(page, /y: roundWatermarkPx\(center\.y - metrics\.containerHeight \/ 2 - editBounds\.top\)/);
	  assert.doesNotMatch(page, /watermarkResizeAnchor\(frame\) \{/);
	  assert.match(page, /const WATERMARK_MIN_SCALE = 0\.55/);
	  assert.match(page, /const WATERMARK_ABSOLUTE_MIN_SCALE = 0\.28/);
	  assert.match(page, /const WATERMARK_MAX_SCALE = 2\.2/);
	  assert.match(page, /const WATERMARK_PINCH_MIN_DISTANCE = 8/);
	  assert.match(page, /Math\.min\(WATERMARK_MIN_SCALE, maxScale\)/);
	  assert.match(page, /watermarkPinchGesture: null/);
	  assert.match(page, /watermarkTouchPair\(event, includeChangedTouches\) \{/);
	  assert.match(page, /touchPointFromSource\(touch\) \{/);
	  assert.match(page, /pickTouchCoordinate\(touch, names\) \{/);
	  assert.match(page, /pinchDistance\(touchPair\) \{/);
	  assert.match(page, /finishWatermarkPinch\(\) \{/);
	  assert.match(page, /clearWatermarkPinchGesture\(\) \{/);
	  assert.doesNotMatch(page, /watermarkResizeVector\(point, anchor\) \{/);
	  assert.doesNotMatch(page, /resizeProjectionRatio\(point\) \{/);
	  assert.doesNotMatch(page, /resolveResizePointMode\(point, handleCenter\) \{/);
	  assert.doesNotMatch(page, /resizeGesturePoint\(event\) \{/);
	  assert.doesNotMatch(page, /watermarkResizeHandleCenter\(frame\) \{/);
	  assert.doesNotMatch(page, /watermarkGesture\.angle/);
	  assert.doesNotMatch(page, /watermarkGesture\.rotation/);
	  assert.doesNotMatch(page, /this\.watermarkGesture\.centerX - scaledWidth \/ 2/);
  assert.doesNotMatch(page, /const handleOffset = WATERMARK_HANDLE_PAD/);
  assert.doesNotMatch(page, /maxBoxWidthScale|maxBoxHeightScale/);
  assert.match(page, /return Math\.max\(WATERMARK_ABSOLUTE_MIN_SCALE, Math\.min\(WATERMARK_MAX_SCALE, maxWidthScale, maxHeightScale\)\)/);
  assert.doesNotMatch(page, /anchorX: anchor\.x/);
  assert.doesNotMatch(page, /nextAngle/);
  assert.doesNotMatch(page, /frameRotation: frame\.rotation/);
  assert.doesNotMatch(page, /angleBetween/);
  assert.doesNotMatch(page, /centerX: center\.x/);
  assert.match(page, /function roundWatermarkPx\(value\) \{[\s\S]*return Math\.round\(value \* 1000\) \/ 1000/);
  assert.doesNotMatch(page, /watermarkGestureTimer/);
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
  assert.match(page, /\.zoomRail \{[\s\S]*bottom: 188px;/);
  assert.match(page, /\.zoomButtonSelected \{[\s\S]*background-color: #ff8a00;[\s\S]*border-color: #ff8a00;/);
  assert.match(page, /\.zoomTextSelected \{[\s\S]*color: #ffffff;/);
  assert.match(page, /\.topTitleBox \{[\s\S]*position: absolute;[\s\S]*left: 0;[\s\S]*right: 0;[\s\S]*top: 30px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.doesNotMatch(page, /pointer-events\s*:/);
  assert.match(page, /\.topSide \{[\s\S]*position: absolute;[\s\S]*left: 14px;[\s\S]*top: 30px;/);
  assert.match(page, /\.topRightSide \{[\s\S]*position: absolute;[\s\S]*right: 14px;[\s\S]*top: 30px;/);
  assert.match(page, /color: #ffffff/);
  assert.match(page, /border-color: rgba\(255, 59, 48, 0\.72\)/);
  assert.match(page, /\.shutterWrap \{[\s\S]*left: 0;[\s\S]*right: 0;[\s\S]*justify-content: center;/);
  assert.match(page, /\.controlLeft \{[\s\S]*left: 22px;/);
  assert.match(page, /\.controlRight \{[\s\S]*right: 22px;/);
  assert.match(page, /transition-property: transform, background-color, border-radius;/);
  assert.match(page, /\.shutterRecording \{[\s\S]*background-color: rgba\(36, 36, 36, 0\.78\);/);
  assert.match(page, /\.shutterCoreRecording \{[\s\S]*border-radius: 14px;[\s\S]*transform: scale\(0\.6\);/);
  assert.match(page, /照片已保存到相册/);
  assert.match(page, /视频已保存到相册/);
  assert.match(page, /录像中不能编辑水印/);
  assert.match(page, /请先完成录像权限授权/);
  assert.match(page, /detail\.errorCode === '1501'/);
  assert.match(page, /视频/);
  assert.match(page, /照片/);
  assert.doesNotMatch(page, /resultStrip/);
  assert.doesNotMatch(page, /lastResultText/);
  assert.doesNotMatch(page, /toggleResultStrip/);
  assert.doesNotMatch(page, /<uts-markvideo-camera/);
  assert.doesNotMatch(page, /@\/uni_modules\/uts-markvideo/);
  assert.doesNotMatch(page, /recordWatermarkVideo/);
});

test('watermark edit handles rotate with content instead of staying in stale positions', () => {
  assertHandlePositionsRotateWithContent({
    left: 144,
    top: 260,
    width: 340,
    height: 160,
    scale: 1,
  });
  assertHandlePositionsRotateWithContent({
    left: 113.5,
    top: 227.25,
    width: 319,
    height: 147,
    scale: 0.83,
  });
});

test('watermark pinch scale follows two-finger distance', () => {
  assertPinchScaleIsDirectional();
});

test('watermark scale max is based on visible content, not edit handle padding', () => {
  const screenWidth = 375;
  const editWidth = screenWidth - 16;
  const editHeight = 526;
  const wideTemplateWidth = Math.round(screenWidth * 0.66);
  const wideTemplateHeight = Math.round(screenWidth * 0.16);

  assert.ok(testMaxWatermarkScale(editWidth, editHeight, wideTemplateWidth, wideTemplateHeight, 0) > 1.4);
  assert.ok(testMaxWatermarkScale(editWidth, editHeight, wideTemplateWidth, wideTemplateHeight, 90) > 2);
});

test('watermark pinch preview uses a stable full-area root while the visual box scales', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.nvue'), 'utf8');
  const editBounds = { left: 8, top: 96 };
  const startFrame = {
    left: 120,
    top: 260,
    width: 240,
    height: 96,
    scale: 0.5,
    rotation: 0,
  };
  const previewFrame = {
    ...startFrame,
    left: 30,
    top: 224,
    scale: 1.25,
  };
  const startMetrics = testWatermarkBoxMetrics(startFrame.width, startFrame.height, startFrame.scale, startFrame.rotation);
  const previewMetrics = testWatermarkBoxMetrics(previewFrame.width, previewFrame.height, previewFrame.scale, previewFrame.rotation);
  const previewCenterX = previewFrame.left + previewMetrics.contentWidth / 2 - editBounds.left;

  assert.ok(previewMetrics.containerWidth > startMetrics.containerWidth * 1.8);
  assert.ok(previewMetrics.containerHeight > startMetrics.containerHeight * 1.5);
  assert.ok(previewCenterX - previewMetrics.boxWidth / 2 < testWatermarkMovePositionFromFrame(startFrame, editBounds).x);
  assert.match(page, /watermarkPinchActive\(\) \{/);
  assert.match(page, /watermarkPinchPreviewFrame\(\) \{/);
  assert.match(page, /watermarkLayoutFrame\(\) \{[\s\S]*const pinchFrame = this\.watermarkPinchPreviewFrame\(\)[\s\S]*if \(pinchFrame\) \{[\s\S]*return pinchFrame/);
  assert.match(page, /watermarkPinchScaleRatio\(\) \{[\s\S]*if \(this\.watermarkPinchGesture && this\.watermarkPinchGesture\.commitFrame\) \{[\s\S]*return 1/);
  assert.match(page, /watermarkMoveX\(\) \{[\s\S]*if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*return 0/);
  assert.match(page, /watermarkMoveY\(\) \{[\s\S]*if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*return 0/);
  assert.doesNotMatch(page, /return this\.watermarkMovePositionFromFrame\(pinchFrame\)\.(x|y)/);
  assert.match(page, /watermarkBoxStyle\(\) \{[\s\S]*if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*const editBounds = this\.watermarkEditBounds\(\)[\s\S]*width: Math\.round\(editBounds\.right - editBounds\.left\) \+ 'px'/);
  assert.match(page, /watermarkTransformStyle\(\) \{[\s\S]*if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*const editBounds = this\.watermarkEditBounds\(\)[\s\S]*const centerX = frame\.left \+ metrics\.contentWidth \/ 2 - editBounds\.left[\s\S]*left: Math\.round\(centerX - metrics\.boxWidth \/ 2\) \+ 'px'/);
});

test('nvue and uts component styles avoid unsupported CSS values', async () => {
  const files = [
    ...await collectFiles('pages', ['.nvue', '.vue']),
    ...await collectFiles('uni_modules/xyc-markvideo', ['.nvue', '.vue']),
  ];

  for (const file of files) {
    const content = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(content, /margin[^\n;]*auto/, `${file} must not use margin auto centering`);
    assert.doesNotMatch(content, /overflow\s*:\s*visible/, `${file} must not use overflow visible`);
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
  assert.match(pkg.dcloudext.declaration.permissions, /写入相册权限/);
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
  assert.match(android, /'zoomchange'/);
  assert.doesNotMatch(android, /'shuttertap'/);
  assert.doesNotMatch(android, /'modechange'/);
  assert.doesNotMatch(android, /\$emit\('shuttertap'/);
  assert.doesNotMatch(android, /\$emit\('modechange'/);
  assert.match(android, /expose: \['setStatus', 'switchMode', 'setFlashMode', 'setZoomMode', 'setWatermark', 'clearWatermark', 'takePhoto', 'startRecord', 'stopRecord', 'restartCamera', 'preparePermissions', 'prepareRecordPermissions', 'destroyCamera'\]/);
  assert.match(android, /switchMode\(mode : string\)/);
  assert.match(android, /setFlashMode\(mode : string\) : string/);
  assert.match(android, /setZoomMode\(mode : string\) : string/);
  assert.match(android, /setWatermark\(template : any\) : string/);
  assert.match(android, /clearWatermark\(\) : string/);
  assert.match(android, /nativeViewUnavailable\(\) : string/);
  assert.doesNotMatch(android, /type NativeCameraResult/);
  assert.match(android, /return view\.setFlashMode\(mode\)/);
  assert.match(android, /return view\.setZoomMode\(mode\)/);
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
  assert.match(nativeView, /import android\.content\.pm\.ActivityInfo/);
  assert.match(nativeView, /lockHostActivityToPortrait\(\)/);
  assert.match(nativeView, /try \{[\s\S]*activity\.requestedOrientation = ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT[\s\S]*\} catch \(throwable: Throwable\)/);
  assert.match(nativeView, /Log\.w\(LOG_TAG, "Failed to lock host activity to portrait\.", throwable\)/);
  assert.match(nativeView, /requestedOrientation != ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(nativeView, /activity\.requestedOrientation = ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(nativeView, /override fun onWindowFocusChanged\(hasWindowFocus: Boolean\)[\s\S]*if \(hasWindowFocus\) \{[\s\S]*lockHostActivityToPortrait\(\)/);
  assert.match(nativeView, /resolveCameraRotationDegrees\(cameraId: Int\)/);
  assert.match(nativeView, /currentDisplayRotationDegrees\(\)/);
  assert.match(nativeView, /CAMERA_FACING_FRONT/);
  assert.match(nativeView, /setDisplayOrientation\(resolveCameraRotationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /setRotation\(resolveCameraRotationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /takePicture/);
  assert.match(nativeView, /private var pictureSize = XycSize\(1920, 1080\)/);
  assert.match(nativeView, /const val MAX_PHOTO_SIZE_PIXELS = 6_000_000/);
  assert.match(nativeView, /\.put\("pictureWidth", pictureSize\.width\)/);
  assert.match(nativeView, /\.put\("pictureHeight", pictureSize\.height\)/);
  assert.match(nativeView, /pictureSize = choosePhotoSize\(parameters\.supportedPictureSizes\)/);
  assert.match(nativeView, /parameters\.setPictureSize\(pictureSize\.width, pictureSize\.height\)/);
  assert.match(nativeView, /parameters\.jpegQuality = PHOTO_JPEG_QUALITY/);
  assert.match(nativeView, /fun setWatermark\(optionsJson: String\): String/);
  assert.match(nativeView, /fun clearWatermark\(\): String/);
  assert.match(nativeView, /decodeRequiredWatermarkBitmap\(nextWatermark\)/);
  assert.match(nativeView, /copyOrDecodeWatermarkBitmap\(frozenWatermark, activeWatermarkBitmap\)/);
  assert.match(nativeView, /copyWatermarkBitmap\(activeWatermarkBitmap\)/);
  assert.match(nativeView, /recycleBitmap\(activeWatermarkBitmap\)/);
  assert.match(nativeView, /failAndEmit\("1202", message, message\)/);
  assert.match(nativeView, /activeWatermark/);
  assert.match(nativeView, /drawWatermarkOnPhoto/);
  assert.match(nativeView, /cachedImageBitmap: Bitmap\?/);
  assert.match(nativeView, /readExifRotationDegrees/);
  assert.match(nativeView, /applyExifOrientation/);
  assert.match(nativeView, /ioHandler\.post/);
  assert.match(nativeView, /视频保存中/);
  assert.match(nativeView, /BitmapFactory\.decodeByteArray/);
  assert.match(nativeView, /Canvas\(outputBitmap\)/);
  assert.match(nativeView, /compress\(Bitmap\.CompressFormat\.JPEG, PHOTO_JPEG_QUALITY, output\)/);
  assert.match(nativeView, /val decodeOptions = BitmapFactory\.Options\(\)\.apply \{[\s\S]*inPreferredConfig = Bitmap\.Config\.ARGB_8888[\s\S]*inMutable = true/);
  assert.match(nativeView, /BitmapFactory\.decodeByteArray\(data, 0, data\.size, decodeOptions\)/);
  assert.match(nativeView, /ensureMutableBitmap\(orientedBitmap\)/);
  assert.match(nativeView, /watermarkOutputTransform\(outputWidth, outputHeight, watermark\)/);
  assert.match(nativeView, /WatermarkOutputTransform/);
  assert.match(nativeView, /val outputToPreviewScale = max\(previewWidth \/ max\(1f, outputWidth\.toFloat\(\)\), previewHeight \/ max\(1f, outputHeight\.toFloat\(\)\)\)/);
  assert.match(nativeView, /previewToOutputScale = 1f \/ max\(0\.0001f, outputToPreviewScale\)/);
  assert.match(nativeView, /previewOffsetX = max\(0f, \(outputWidth \* outputToPreviewScale - previewWidth\) \/ 2f\)/);
  assert.match(nativeView, /val boxWidth = transform\.previewWidth \* watermark\.boxWidth \* watermark\.scale \* transform\.previewToOutputScale/);
  assert.match(nativeView, /val left = \(\(transform\.previewWidth \* watermark\.positionX \+ transform\.previewOffsetX\) \* transform\.previewToOutputScale\)/);
  assert.match(nativeView, /val top = \(\(transform\.previewHeight \* watermark\.positionY \+ transform\.previewOffsetY\) \* transform\.previewToOutputScale\)/);
  assert.match(nativeView, /Paint\(Paint\.ANTI_ALIAS_FLAG\)\.apply \{[\s\S]*isFilterBitmap = true[\s\S]*isDither = true/);
  assert.match(nativeView, /canvas\.scale\(1f, -1f, imageRect\.centerX\(\), imageRect\.centerY\(\)\)[\s\S]*canvas\.drawBitmap\(imageBitmap, null, imageRect, imagePaint\)/);
  assert.match(nativeView, /Paint\(Paint\.ANTI_ALIAS_FLAG or Paint\.SUBPIXEL_TEXT_FLAG\)/);
  assert.doesNotMatch(nativeView, /val scale = min\(outputWidth \/ watermark\.previewWidth, outputHeight \/ watermark\.previewHeight\)/);
  assert.doesNotMatch(nativeView, /val boxWidth = outputWidth \* watermark\.boxWidth \* watermark\.scale/);
  assert.doesNotMatch(nativeView, /val previewScale = min\(outputWidth\.toFloat\(\) \/ previewWidth, outputHeight\.toFloat\(\) \/ previewHeight\)/);
  assert.match(nativeView, /watermarkTemplateSnapshot/);
  assert.match(nativeView, /watermarkPhotoBurnIn/);
  assert.match(nativeView, /watermarkVideoBurnIn/);
  assert.match(nativeView, /拍照请求已受理/);
  assert.match(nativeView, /PixelCopy\.request/);
  assert.match(nativeView, /CameraMp4Recorder/);
  assert.match(nativeView, /MediaCodec/);
  assert.match(nativeView, /AudioRecord/);
  assert.match(nativeView, /recordingVideoBurnIn = frozenWatermark != null/);
  assert.match(nativeView, /recordingFrameError = false/);
  assert.match(nativeView, /val invalidVideoReason = when \{[\s\S]*recorder\.frameCount <= 0 -> "录像没有写入有效视频帧"[\s\S]*else -> null/);
  assert.doesNotMatch(nativeView, /hadFrameError -> "录像帧编码失败"/);
  assert.match(nativeView, /if \(invalidVideoReason != null\) \{[\s\S]*outputTarget\.discard\(context\)[\s\S]*failAndEmit\("1402", "录像停止失败", invalidVideoReason\)/);
  assert.match(nativeView, /val finalVideoBurnIn = requestedVideoBurnIn && !hadFrameError && recorder\.frameCount > 0/);
  assert.match(nativeView, /if \(!recorder\.encodeFrame\(targetBitmap\)\) \{[\s\S]*Log\.d\(LOG_TAG, "record frame skipped because encoder input buffer was not ready\."\)/);
  assert.doesNotMatch(nativeView, /throw IllegalStateException\("视频帧编码未写入"\)/);
  assert.match(nativeView, /catch \(throwable: Throwable\) \{[\s\S]*recordingFrameError = true[\s\S]*Log\.w\(LOG_TAG, "record frame encode failed\.", throwable\)/);
  assert.doesNotMatch(nativeView, /emitError\("1402", "录像帧编码失败"/);
  assert.match(nativeView, /appendWatermarkResult\(startPayload, frozenWatermark, false, recordingVideoBurnIn\)/);
  assert.match(nativeView, /recordingWatermarkBitmap = frozenWatermarkBitmap/);
  assert.match(nativeView, /recycleBitmap\(frozenWatermarkBitmap\)/);
  assert.doesNotMatch(nativeView, /VideoSource\.CAMERA/);
  assert.match(nativeView, /requestedFlashMode = UI_FLASH_OFF/);
  assert.match(nativeView, /requestedZoomMode = UI_ZOOM_1X/);
  assert.match(nativeView, /val nextMode = if \(mode == "video"\) "video" else "photo"/);
  assert.match(nativeView, /if \(nextMode == currentMode\) \{[\s\S]*return[\s\S]*currentMode = nextMode/);
  assert.match(nativeView, /fun setFlashMode\(mode: String\): String/);
  assert.match(nativeView, /fun setZoomMode\(mode: String\): String/);
  assert.match(nativeView, /val normalizedMode = normalizeFlashMode\(mode\)/);
  assert.match(nativeView, /val normalizedMode = normalizeZoomMode\(mode\)/);
  assert.match(nativeView, /\.put\("requestedFlashMode", normalizedMode\)/);
  assert.match(nativeView, /\.put\("requestedZoomMode", normalizedMode\)/);
  assert.match(nativeView, /\.put\("applied", applied\)/);
  assert.match(nativeView, /unsupportedFlashModeMessage/);
  assert.match(nativeView, /unsupportedZoomModeMessage/);
  assert.match(nativeView, /camera \?: return requestedFlashMode == UI_FLASH_OFF/);
  assert.match(nativeView, /camera \?: return requestedZoomMode == UI_ZOOM_1X/);
  assert.match(nativeView, /supportedFlashModes/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_OFF/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_ON/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_AUTO/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_TORCH/);
  assert.match(nativeView, /val previousFlashMode = parameters\.flashMode/);
  assert.match(nativeView, /if \(parameters\.flashMode != previousFlashMode\) \{[\s\S]*activeCamera\.parameters = parameters[\s\S]*refreshPreviewForFlash\(activeCamera\)/);
  assert.match(nativeView, /refreshPreviewForFlash\(activeCamera\)/);
  assert.match(nativeView, /parameters\.isZoomSupported/);
  assert.match(nativeView, /parameters\.zoomRatios/);
  assert.match(nativeView, /parameters\.zoom = bestIndex/);
  assert.match(nativeView, /validateRecordingFlashMode\(activeCamera\)/);
  assert.match(nativeView, /failAndEmit\("1102", recordingFlashError, recordingFlashError\)/);
  assert.match(nativeView, /failAndEmit\("1102", "录像闪光灯设置失败", "录像闪光灯设置失败"\)/);
  assert.match(nativeView, /录像闪光灯设置失败/);
  assert.doesNotMatch(nativeView, /"1404"/);
  assert.match(nativeView, /supportedModes\.contains\(Camera\.Parameters\.FLASH_MODE_TORCH\)/);
  assert.match(nativeView, /applyFlashModeToParameters\(parameters, false\)/);
  assert.match(nativeView, /applyZoomModeToParameters\(parameters, false\)/);
  assert.match(nativeView, /applyZoomModeIfCameraOpen\(false\)/);
  assert.match(nativeView, /resolveCameraIdForZoomMode\(requestedZoomMode\)/);
  assert.match(nativeView, /resolveWideBackCameraId\(\)/);
  assert.match(nativeView, /Wide camera is not exposed by Camera1/);
  assert.match(nativeView, /if \(resolveWideBackCameraId\(\) >= 0\) \{[\s\S]*modes\.put\(UI_ZOOM_WIDE\)/);
  assert.match(nativeView, /zoomModesPayload/);
  assert.match(nativeView, /if \(muxerStarted\) \{[\s\S]*muxer\?\.stop\(\)/);
  assert.match(nativeView, /muxer\?\.release\(\)/);
  assert.match(nativeView, /targetFps = fps/);
  assert.match(nativeView, /DEFAULT_TARGET_FPS = 30/);
  assert.match(nativeView, /chooseCameraSize\(sizes: List<Camera\.Size>\?\)/);
  assert.match(nativeView, /sizeFitsQualityCap\(it\.width, it\.height\)/);
  assert.match(nativeView, /private fun shouldRotateRecordingOutput\(\): Boolean/);
  assert.match(nativeView, /val sourceWidth = if \(shouldRotateRecordingOutput\(\)\) videoSize\.height else videoSize\.width/);
  assert.match(nativeView, /val sourceHeight = if \(shouldRotateRecordingOutput\(\)\) videoSize\.width else videoSize\.height/);
  assert.doesNotMatch(nativeView, /previewView\.width\.takeIf \{ it > 0 \} \?: previewSize\.width/);
  assert.doesNotMatch(nativeView, /previewView\.height\.takeIf \{ it > 0 \} \?: previewSize\.height/);
  assert.match(nativeView, /MAX_CAMERA_SIZE_LONG_EDGE = 1920/);
  assert.match(nativeView, /MAX_CAMERA_SIZE_PIXELS = 2_073_600/);
  assert.match(nativeView, /MAX_PHOTO_SIZE_LONG_EDGE = 3000/);
  assert.match(nativeView, /MAX_PHOTO_SIZE_PIXELS = 6_000_000/);
  assert.match(nativeView, /PHOTO_JPEG_QUALITY = 90/);
  assert.match(nativeView, /\.filter \{ max\(it\.width, it\.height\) <= MAX_PHOTO_SIZE_LONG_EDGE && it\.width \* it\.height <= MAX_PHOTO_SIZE_PIXELS \}[\s\S]*\.maxByOrNull \{ it\.width \* it\.height \}[\s\S]*\?: available\.minByOrNull \{ it\.width \* it\.height \}/);
  assert.match(nativeView, /MAX_RECORDING_LONG_EDGE = 1280/);
  assert.match(nativeView, /MAX_RECORDING_PIXELS = 921_600/);
  assert.match(nativeView, /bitrate = chooseVideoBitrate\(recordingSize, targetFps\)/);
  assert.match(nativeView, /MIN_VIDEO_BITRATE = 4_000_000/);
  assert.match(nativeView, /MAX_VIDEO_BITRATE = 10_000_000/);
  assert.match(nativeView, /VIDEO_BITRATE_PIXEL_DIVISOR = 4/);
  assert.match(nativeView, /MIME_TYPE = "video\/avc"/);
  assert.match(nativeView, /AUDIO_SAMPLE_RATE = 44_100/);
  assert.match(nativeView, /AUDIO_CHANNEL_CONFIG = AudioFormat\.CHANNEL_IN_MONO/);
  assert.match(nativeView, /AUDIO_PCM_FORMAT = AudioFormat\.ENCODING_PCM_16BIT/);
  assert.match(nativeView, /AUDIO_CHANNEL_COUNT = 1/);
  assert.match(nativeView, /AUDIO_BIT_RATE = 64_000/);
  assert.match(nativeView, /TIMEOUT_US = 10_000L/);
  assert.match(nativeView, /FINISH_TIMEOUT_MS = 5_000L/);
  assert.match(nativeView, /setPreviewFpsRange/);
  assert.match(nativeView, /onWindowFocusChanged/);
  assert.match(nativeView, /recordPermissionRequested && recordMissingPermissions\(\)\.isEmpty\(\)/);
  assert.match(nativeView, /scheduleCameraPermissionRetry/);
  assert.match(nativeView, /cameraPermissionRequested/);
  assert.match(nativeView, /recordPermissionRequested/);
  assert.match(nativeView, /recordPermissionRetryCount/);
  assert.match(nativeView, /statusView\.visibility/);
  assert.match(nativeView, /MediaStore/);
  assert.match(nativeView, /private var recordingOutputSize = XycSize\(1280, 720\)/);
  assert.match(nativeView, /private var videoOutputTarget: VideoOutputTarget\? = null/);
  assert.match(nativeView, /val recordTarget = createVideoOutputTarget\(\)/);
  assert.match(nativeView, /outputFileDescriptor = recordTarget\.fileDescriptor/);
  assert.doesNotMatch(nativeView, /recorder\.start\(\)[\s\S]{0,120}recordTarget\.closeDescriptor\(\)/);
  assert.match(nativeView, /recorder\.start\(\)[\s\S]{0,160}recordingOutputSize = recordingSize/);
  assert.doesNotMatch(nativeView, /videoSize = recordingSize/);
  assert.match(nativeView, /width = recordingOutputSize\.width,\n\s*height = recordingOutputSize\.height/);
  assert.match(nativeView, /videoOutputTarget = recordTarget/);
  assert.match(nativeView, /private fun createVideoOutputTarget\(\): VideoOutputTarget/);
  assert.match(nativeView, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.Q[\s\S]*MediaStore\.Video\.Media\.getContentUri\(MediaStore\.VOLUME_EXTERNAL_PRIMARY\)[\s\S]*resolver\.openFileDescriptor\(uri, "w"\)/);
  assert.match(nativeView, /android\.media\.MediaMuxer\(outputFileDescriptor\.fileDescriptor, android\.media\.MediaMuxer\.OutputFormat\.MUXER_OUTPUT_MPEG_4\)/);
  assert.match(nativeView, /publishVideoOutput\(outputTarget\)/);
  assert.match(nativeView, /publishPendingMediaStoreItem\(uri\)/);
  assert.match(nativeView, /val updatedRows = context\.contentResolver\.update\(uri, publishValues, null, null\)/);
  assert.match(nativeView, /if \(updatedRows <= 0\) \{[\s\S]*throw IllegalStateException\("Failed to publish MediaStore item\."\)/);
  assert.match(nativeView, /Environment\.getExternalStoragePublicDirectory\(Environment\.DIRECTORY_MOVIES\)/);
  assert.match(nativeView, /file = File\(targetDirectory, fileName\)/);
  assert.match(nativeView, /preparePermissions\(\)/);
  assert.match(nativeView, /prepareRecordPermissions\(\)/);
  assert.match(nativeView, /photoMissingPermissions\(\)/);
  assert.match(nativeView, /REQUEST_PREPARE_PHOTO_PERMISSIONS/);
  assert.match(nativeView, /photoPermissionMessage\(missingPermissions\)/);
  assert.match(nativeView, /recordMissingPermissions/);
  assert.match(nativeView, /recordPermissionMessage/);
  assert.match(nativeView, /requestRecordPermissionsIfNeeded/);
  assert.match(nativeView, /scheduleRecordPermissionRetry/);
  assert.match(nativeView, /requestPermissions/);
  assert.match(nativeView, /REQUEST_PREPARE_PERMISSIONS/);
  assert.match(nativeView, /REQUEST_PREPARE_RECORD_PERMISSIONS/);
  assert.match(nativeView, /saveMediaToAlbum/);
  assert.match(nativeView, /android_asset\//);
  assert.match(nativeView, /resolveWatermarkRelativePath/);
  assert.match(nativeView, /decodeWatermarkAsset/);
  assert.match(nativeView, /savedToAlbum/);
  assert.match(nativeView, /appendAlbumFailure/);
  assert.match(nativeView, /if \(source\.absolutePath != targetFile\.absolutePath\) \{[\s\S]*source\.copyTo\(targetFile, overwrite = true\)/);
  assert.match(nativeView, /appendRecordTiming/);
  assert.match(nativeView, /appendPhotoTiming/);
  assert.match(nativeView, /\.put\("photoCaptureCallbackMs", max\(0L, captureCallbackMs\)\)/);
  assert.match(nativeView, /\.put\("photoWatermarkWriteMs", max\(0L, watermarkWriteMs\)\)/);
  assert.match(nativeView, /\.put\("photoAlbumSaveMs", max\(0L, albumSaveMs\)\)/);
  assert.match(nativeView, /\.put\("photoTotalSaveMs", max\(0L, totalSaveMs\)\)/);
  assert.match(nativeView, /Log\.i\([\s\S]*LOG_TAG[\s\S]*photo timing/);
  assert.match(nativeView, /\.put\("recordFinishMs", max\(0L, finishMs\)\)/);
  assert.match(nativeView, /\.put\("recordAlbumSaveMs", max\(0L, albumSaveMs\)\)/);
  assert.match(nativeView, /\.put\("recordTotalSaveMs", max\(0L, totalSaveMs\)\)/);
  assert.match(nativeView, /\.put\("recordFrameCount", recorder\.frameCount\)/);
  assert.match(nativeView, /\.put\("recordFileBytes", max\(0L, fileBytes\)\)/);
  assert.match(nativeView, /Log\.i\([\s\S]*LOG_TAG[\s\S]*record stop timing/);
  assert.match(nativeView, /var stopFailure: Throwable\? = null/);
  assert.match(nativeView, /stopFailure\?\.let \{ throw it \}/);
  assert.doesNotMatch(nativeView, /createVideoOutputFile/);
  assert.match(nativeView, /相册保存失败/);
  assert.match(nativeView, /照片已保存到相册/);
  assert.match(nativeView, /视频已保存到相册/);
  assert.match(nativeView, /RECORD_AUDIO/);
  assert.match(nativeView, /UI_ZOOM_WIDE = "wide"/);
  assert.match(nativeView, /UI_ZOOM_1X = "1x"/);
  assert.match(nativeView, /UI_ZOOM_2X = "2x"/);
  assert.doesNotMatch(nativeView, /requestPermission\(/);
});

test('watermark PRD documents the staged Android delivery contract', async () => {
  const prd = await readFile(path.join(root, 'docs/watermark-template-camera-prd.md'), 'utf8');

  assert.match(prd, /pages\/index\/index\.nvue/);
  assert.match(prd, /pages\/cameraX\/index\.nvue/);
  assert.match(prd, /\/static\/watermark\/logo2\.png/);
  assert.match(prd, /最多 1 个/);
  assert.match(prd, /双指捏合缩放/);
  assert.match(prd, /右下角缩放图标作为贴纸缩放提示/);
  assert.match(prd, /左上角按钮每次旋转 90 度/);
  assert.match(prd, /松手、拍照前和录像前必须 flush 最新水印/);
  assert.match(prd, /内容及编辑控件不得超出预览可编辑区域/);
  assert.match(prd, /编辑控件不随内容旋转/);
  assert.match(prd, /照片输出/);
  assert.match(prd, /PixelCopy/);
  assert.match(prd, /MediaCodec/);
  assert.match(prd, /AudioRecord/);
  assert.match(prd, /watermarkVideoBurnIn=true/);
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
  const permissions = manifest['app-plus'].distribute.android.permissions.join('\n');

  assert.match(main, /createSSRApp/);
  assert.equal(manifest.vueVersion, '3');
  assert.match(permissions, /android\.permission\.CAMERA/);
  assert.match(permissions, /android\.permission\.RECORD_AUDIO/);
  assert.match(permissions, /android\.permission\.WRITE_EXTERNAL_STORAGE/);
  assert.match(permissions, /android:maxSdkVersion="28"/);
});
