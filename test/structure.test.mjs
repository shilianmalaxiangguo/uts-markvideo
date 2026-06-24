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
const testWatermarkPinchMaxScaleStep = 0.12;
const testWatermarkPinchSmoothing = 0.45;
const testCameraTopBarHeight = 60;
const testCameraModeSwitchHeight = 36;
const testCameraMainControlsHeight = 88;
const testCameraControlsRegularTop = 8;
const testCameraControlsCompactTop = 4;
const testCameraControlsRegularGap = 12;
const testCameraControlsCompactGap = 4;
const testCameraControlsMinBottomSafe = 4;
const testCameraControlsRegularBottomSafe = 16;
const testCameraControlsMaxBottomSafe = 64;
const testCameraControlsUltraCompactHeight = 140;
const testCameraControlsCompactHeight = 172;
const testCameraControlsRelaxedHeight = 200;
const testCameraViewportAspectWidth = 3;
const testCameraViewportAspectHeight = 4;
const testCameraFrameAspectShortOverLong = 3 / 4;
const testWatermarkDefaultMinWidth = 92;
const testWatermarkDefaultMinHeight = 64;

const requiredFiles = [
  'App.uvue',
  'main.uts',
  'manifest.json',
  'pages.json',
  'pages/index/index.uvue',
  'pages/cameraX/index.uvue',
  'docs/watermark-template-camera-prd.md',
  'static/watermark/logo3.png',
  'uni_modules/xyc-markvideo/package.json',
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

function findStyleBlock(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedSelector} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${selector} style block should exist`);
  return match[0];
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
  const containerWidth = Math.max(1, bounds.width, boxWidth);
  const containerHeight = Math.max(1, bounds.height, boxHeight);

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
  const handlePadding = testWatermarkHandlePad * 2;
  const rotatedHandlePadding = handlePadding * (cos + sin);
  const layerWidth = editWidth + handlePadding;
  const layerHeight = editHeight + handlePadding;
  const maxWidthScale = (layerWidth - rotatedHandlePadding) / rotatedWidthFactor;
  const maxHeightScale = (layerHeight - rotatedHandlePadding) / rotatedHeightFactor;
  const contentMaxWidthScale = editWidth / frameWidth;
  const contentMaxHeightScale = editHeight / frameHeight;

  return Math.max(
    testWatermarkAbsoluteMinScale,
    Math.min(testWatermarkMaxScale, maxWidthScale, maxHeightScale, contentMaxWidthScale, contentMaxHeightScale),
  );
}

function testCameraViewportBounds(width, height) {
  const targetWidth = width;
  const targetHeight = targetWidth * testCameraViewportAspectHeight / testCameraViewportAspectWidth;
  const left = (width - targetWidth) / 2;
  const top = testCameraTopBarHeight;
  return {
    left,
    top,
    right: left + targetWidth,
    bottom: top + targetHeight,
    width: targetWidth,
    height: targetHeight,
  };
}

function testCameraBottomPanelBounds(width, height) {
  const viewport = testCameraViewportBounds(width, height);
  const top = viewport.bottom;
  const bottom = Math.max(top + 1, height);
  return {
    left: 0,
    top,
    right: width,
    bottom,
    width,
    height: bottom - top,
  };
}

function testCameraControlsLayout(panelHeight) {
  const safePanelHeight = Math.max(1, Number(panelHeight) || 1);
  const ultraCompact = safePanelHeight < testCameraControlsUltraCompactHeight;
  const compact = safePanelHeight < testCameraControlsCompactHeight;
  const modeTop = ultraCompact ? 0 : (compact ? testCameraControlsCompactTop : testCameraControlsRegularTop);
  const modeHeight = ultraCompact ? 0 : testCameraModeSwitchHeight;
  const modeOpacity = ultraCompact ? 0 : 1;
  const gap = ultraCompact ? 0 : (compact ? testCameraControlsCompactGap : testCameraControlsRegularGap);
  const relaxedBottomSafe = Math.min(
    testCameraControlsMaxBottomSafe,
    safePanelHeight >= testCameraControlsRelaxedHeight
      ? testCameraControlsMaxBottomSafe
      : testCameraControlsRegularBottomSafe,
  );
  const bottomSafe = compact ? testCameraControlsMinBottomSafe : relaxedBottomSafe;
  const minMainTop = modeTop + modeHeight + gap;
  const mainScale = ultraCompact
    ? Math.max(0, Math.min(1, (safePanelHeight - bottomSafe - testCameraMainControlsHeight / 2) / (testCameraMainControlsHeight / 2)))
    : 1;
  const scaledMainHalfHeight = testCameraMainControlsHeight * mainScale / 2;
  const bottomAlignedTop = ultraCompact
    ? safePanelHeight - bottomSafe - (testCameraMainControlsHeight / 2 + scaledMainHalfHeight)
    : safePanelHeight - testCameraMainControlsHeight - bottomSafe;
  const maxMainTop = Math.max(0, safePanelHeight - testCameraMainControlsHeight - testCameraControlsMinBottomSafe);
  const preferredMainTop = Math.max(minMainTop, bottomAlignedTop);
  return {
    modeTop,
    modeHeight,
    modeOpacity,
    mainTop: ultraCompact ? bottomAlignedTop : Math.min(preferredMainTop, maxMainTop),
    mainScale,
    bottomSafe,
  };
}

function testWatermarkLayerBounds(editBounds) {
  return {
    left: editBounds.left - testWatermarkHandlePad,
    top: editBounds.top - testWatermarkHandlePad,
    right: editBounds.right + testWatermarkHandlePad,
    bottom: editBounds.bottom + testWatermarkHandlePad,
  };
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 0.001, `${message}: expected ${expected}, got ${actual}`);
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

function testLimitWatermarkPinchScale(rawScale, previousScale, minScale, maxScale) {
  const targetScale = testClampNumber(rawScale, minScale, maxScale);
  if (typeof previousScale !== 'number') {
    return targetScale;
  }
  const delta = targetScale - previousScale;
  if (Math.abs(delta) <= testWatermarkPinchMaxScaleStep) {
    return targetScale;
  }
  const smoothedDelta = delta * testWatermarkPinchSmoothing;
  const limitedDelta = testClampNumber(smoothedDelta, -testWatermarkPinchMaxScaleStep, testWatermarkPinchMaxScaleStep);
  return testClampNumber(previousScale + limitedDelta, minScale, maxScale);
}

function assertPinchScaleIsDirectional() {
  assert.equal(testPinchScale(1, 120, 180), 1.5);
  assert.equal(testPinchScale(1, 120, 60), 0.5);
  assert.ok(Math.abs(testPinchScale(0.8, 80, 120) - 1.2) < 0.0001);
}

function testClampNumber(value, min, max) {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function testClampCenterBySize(center, minEdge, maxEdge, size) {
  if (maxEdge <= minEdge || size >= maxEdge - minEdge) {
    return (minEdge + maxEdge) / 2;
  }
  return testClampNumber(center, minEdge + size / 2, maxEdge - size / 2);
}

function testClampWatermarkFrame(frame, editBounds) {
  const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, frame.rotation);
  const layerBounds = testWatermarkLayerBounds(editBounds);
  const centerX = frame.left + metrics.contentWidth / 2;
  const centerY = frame.top + metrics.contentHeight / 2;
  const clampedCenterX = testClampCenterBySize(centerX, layerBounds.left, layerBounds.right, metrics.containerWidth);
  const clampedCenterY = testClampCenterBySize(centerY, layerBounds.top, layerBounds.bottom, metrics.containerHeight);
  const contentLeft = testClampNumber(clampedCenterX - metrics.contentWidth / 2, editBounds.left, editBounds.right - metrics.contentWidth);
  const contentTop = testClampNumber(clampedCenterY - metrics.contentHeight / 2, editBounds.top, editBounds.bottom - metrics.contentHeight);

  return {
    ...frame,
    left: contentLeft,
    top: contentTop,
  };
}

function testWatermarkMovePositionFromFrame(frame, editBounds) {
  const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, frame.rotation);
  const layerBounds = testWatermarkLayerBounds(editBounds);
  const contentWidth = frame.width * frame.scale;
  const contentHeight = frame.height * frame.scale;
  const centerX = frame.left + contentWidth / 2;
  const centerY = frame.top + contentHeight / 2;

  return {
    x: Math.round((centerX - metrics.containerWidth / 2 - layerBounds.left) * 1000) / 1000,
    y: Math.round((centerY - metrics.containerHeight / 2 - layerBounds.top) * 1000) / 1000,
  };
}

function testNativeWatermarkPayloadFromFrame(frame, viewport) {
  const effectiveWidth = Math.max(1, Math.round(frame.width * frame.scale));
  const effectiveHeight = Math.max(1, Math.round(frame.height * frame.scale));
  const payloadLeft = testClampNumber(frame.left, viewport.left, viewport.right - effectiveWidth);
  const payloadTop = testClampNumber(frame.top, viewport.top, viewport.bottom - effectiveHeight);

  return {
    positionX: (payloadLeft - viewport.left) / viewport.width,
    positionY: (payloadTop - viewport.top) / viewport.height,
    boxWidth: effectiveWidth / viewport.width,
    boxHeight: effectiveHeight / viewport.height,
  };
}

function testAspectRatioForMatch(width, height) {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  return shortEdge / longEdge;
}

function testSizeFitsQualityCap(width, height) {
  return Math.max(width, height) <= 1920 && width * height <= 2073600;
}

function testPhotoSizeFitsQualityCap(width, height) {
  return Math.max(width, height) <= 3000 && width * height <= 6000000;
}

function testChooseCameraSizeForTarget(sizes, targetSize) {
  const targetAspect = testAspectRatioForMatch(targetSize.width, targetSize.height);
  return [...sizes].sort((left, right) => {
    const leftDelta = Math.abs(testAspectRatioForMatch(left.width, left.height) - targetAspect);
    const rightDelta = Math.abs(testAspectRatioForMatch(right.width, right.height) - targetAspect);
    if (leftDelta !== rightDelta) {
      return leftDelta - rightDelta;
    }
    if (testSizeFitsQualityCap(left.width, left.height) !== testSizeFitsQualityCap(right.width, right.height)) {
      return testSizeFitsQualityCap(right.width, right.height) - testSizeFitsQualityCap(left.width, left.height);
    }
    return right.width * right.height - left.width * left.height;
  })[0];
}

function testChoosePhotoSizeForFixedFrame(sizes) {
  return [...sizes].sort((left, right) => {
    const leftDelta = Math.abs(testAspectRatioForMatch(left.width, left.height) - testCameraFrameAspectShortOverLong);
    const rightDelta = Math.abs(testAspectRatioForMatch(right.width, right.height) - testCameraFrameAspectShortOverLong);
    if (leftDelta !== rightDelta) {
      return leftDelta - rightDelta;
    }
    if (testPhotoSizeFitsQualityCap(left.width, left.height) !== testPhotoSizeFitsQualityCap(right.width, right.height)) {
      return testPhotoSizeFitsQualityCap(right.width, right.height) - testPhotoSizeFitsQualityCap(left.width, left.height);
    }
    return right.width * right.height - left.width * left.height;
  })[0];
}

function testWatermarkTemplateMinimumFrameSize(template) {
  const padding = Math.max(0, template.boxPadding || 0);
  const imageWidth = template.imagePath ? Math.max(0, template.imageWidth || 0) : 0;
  const imageHeight = template.imagePath ? Math.max(0, template.imageHeight || 0) : 0;
  const textWidth = template.mainTitleText || template.subtitleText ? 1 : 0;
  const imageTextGap = imageWidth > 0 && textWidth > 0 ? Math.max(0, template.imageTextGap || 0) : 0;

  return {
    width: imageWidth + imageTextGap + textWidth + padding * 2,
    height: imageHeight + padding * 2,
  };
}

function testWatermarkTemplateFrameSize(template, viewport) {
  const minimumFrameSize = testWatermarkTemplateMinimumFrameSize(template);
  return {
    width: Math.max(
      testWatermarkDefaultMinWidth,
      minimumFrameSize.width,
      Math.round(viewport.width * (template.boxWidth || 0.58)),
    ),
    height: Math.max(
      testWatermarkDefaultMinHeight,
      minimumFrameSize.height,
      Math.round(viewport.height * (template.boxHeight || 0.14)),
    ),
  };
}

function testApplyWatermarkTemplateState(template, viewport) {
  const frameSize = testWatermarkTemplateFrameSize(template, viewport);
  const frame = {
    left: viewport.left + viewport.width * (template.positionX || 0.12),
    top: viewport.top + viewport.height * (template.positionY || 0.16),
    width: frameSize.width,
    height: frameSize.height,
    scale: template.scale || 1,
    rotation: template.rotation || 0,
  };

  return {
    activeWatermark: { ...template },
    frame,
    payload: testNativeWatermarkPayloadFromFrame(frame, viewport),
  };
}

test('project contains the xyc-markvideo cameraX mainline files', async () => {
  for (const file of requiredFiles) {
    await access(path.join(root, file));
  }
});

test('watermark logo source asset is high enough for photo burn-in', async () => {
  const dimensions = await readPngDimensions('static/watermark/logo3.png');

  assert.ok(dimensions.width >= 512, `logo3.png width should be >= 512, got ${dimensions.width}`);
  assert.ok(dimensions.height >= 512, `logo3.png height should be >= 512, got ${dimensions.height}`);
});

test('watermark resize handle uses native view lines for the diagonal glyph', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');

  assert.match(page, /<view class="watermarkResizeGlyph" :style="watermarkControlTextStyleValue\(\)">/);
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

test('pages.json routes only the new uvue camera mainline', async () => {
  const pagesJson = JSON.parse(await readFile(path.join(root, 'pages.json'), 'utf8'));
  const paths = pagesJson.pages.map((page) => page.path);
  const indexPage = pagesJson.pages.find((page) => page.path === 'pages/index/index');
  const cameraPage = pagesJson.pages.find((page) => page.path === 'pages/cameraX/index');

  assert.deepEqual(paths, [
    'pages/index/index',
    'pages/cameraX/index',
  ]);
  assert.equal(pagesJson.globalStyle.pageOrientation, 'portrait');
  assert.equal(pagesJson.globalStyle.backgroundColor, '#f5f7f9');
  assert.equal(pagesJson.globalStyle.backgroundColorContent, '#f5f7f9');
  assert.equal(indexPage.style.navigationBarBackgroundColor, '#f5f7f9');
  assert.equal(indexPage.style.backgroundColorContent, '#f5f7f9');
  assert.equal(cameraPage.style.backgroundColor, '#101614');
  assert.equal(cameraPage.style.backgroundColorContent, '#e2e6e4');
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
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');

  assert.match(page, /function normalizePortraitLayoutBounds\(width(?:: number)?, height(?:: number)?\)/);
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

test('cameraX bottom controls compress without overlap and relax on tall panels', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');

  assert.match(page, /function resolveCameraControlsLayout\(panelHeight(?:: number)?\)(?:: CameraControlsLayout)?/);
  assert.match(page, /<view class="modeSwitchWrap" :style="modeSwitchWrapStyle">/);
  assert.match(page, /<view class="mainControls" :style="mainControlsStyle">/);

  const compactCases = [81.33333333333331, 107, 128, 139, 140, 150, 172, 200, 237, 260];
  for (const panelHeight of compactCases) {
    const layout = testCameraControlsLayout(panelHeight);
    const modeBottom = layout.modeTop + layout.modeHeight;
    const mainVisualTop = layout.mainTop + testCameraMainControlsHeight * (1 - layout.mainScale) / 2;
    const mainVisualBottom = layout.mainTop + testCameraMainControlsHeight * (1 + layout.mainScale) / 2;

    assert.ok(layout.modeTop >= 0, `mode row should stay inside panel for ${panelHeight}`);
    assert.ok(layout.modeOpacity === 0 || mainVisualTop >= modeBottom, `main controls should not overlap visible mode row for ${panelHeight}`);
    assert.ok(mainVisualBottom <= panelHeight - testCameraControlsMinBottomSafe + 0.001, `main controls should leave bottom safe area for ${panelHeight}`);
  }

  assert.equal(testCameraControlsLayout(81.33333333333331).modeOpacity, 0, 'very short panels should hide the mode row');
  assert.ok(testCameraControlsLayout(81.33333333333331).mainScale < 1, 'very short panels should shrink main controls');
  assert.equal(testCameraControlsLayout(107).mainScale, 1, 'short panels should keep full-size controls when possible');
  assert.equal(testCameraControlsLayout(140).modeOpacity, 1, 'regular compact panels should show the mode row again');
  assert.ok(testCameraControlsLayout(237).mainTop > 84, 'tall real-device panel should move shutter lower than the old fixed 84px cap');
  assert.ok(testCameraControlsLayout(237).mainTop + testCameraMainControlsHeight < 237 - 20, 'real-device panel should keep the shutter above the bottom safe area');
  assert.ok(testCameraControlsLayout(260).mainTop > testCameraControlsLayout(200).mainTop, 'extra tall panel should relax toward the bottom');
});

test('index.uvue manages watermark templates before opening cameraX', async () => {
  const page = await readFile(path.join(root, 'pages/index/index.uvue'), 'utf8');

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
  assert.match(page, /\/static\/watermark\/logo3\.png/);
  assert.match(page, /uni\.setStorageSync\(WATERMARK_STORAGE_KEY/);
  assert.match(page, /JSON\.stringify\(nextTemplate\)/);
  assert.match(page, /JSON\.stringify\(currentTemplate\)/);
  assert.match(page, /storedWatermarkTemplate\(stored\)/);
  assert.match(page, /storageValueToJSONObject\(value(?:: any \| null)?\)/);
  assert.doesNotMatch(page, /stored as UTSJSONObject/);
  assert.match(page, /this\.currentTemplateId = ''[\s\S]*this\.currentTemplate = null/);
  assert.doesNotMatch(page, /embedded-camera-payload/);
  assert.doesNotMatch(page, /uts-markvideo/);
  assert.doesNotMatch(page, /recordWatermarkVideo/);
});

test('uvue runtime value boundaries avoid Android ClassCastException regressions', async () => {
  const indexPage = await readFile(path.join(root, 'pages/index/index.uvue'), 'utf8');
  const cameraPage = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const indexStorageBody = indexPage.match(/function storageValueToJSONObject\(value(?:: any \| null)?\)(?:: UTSJSONObject \| null)? \{[\s\S]*?\n\}\n\nfunction safeString/)?.[0] || '';
  const cameraStorageBody = cameraPage.match(/function storageValueToJSONObject\(value(?:: any \| null)?\)(?:: UTSJSONObject \| null)? \{[\s\S]*?\n\}\n\nfunction safeString/)?.[0] || '';
  const eventDetailBody = cameraPage.match(/eventDetail\(payload(?:: UTSJSONObject \| null)?\)(?:: UTSJSONObject)? \{[\s\S]*?\n    \},\n    applyNativeCameraState/)?.[0] || '';
  const touchPairBody = cameraPage.match(/watermarkTouchPair\(event(?:: UniTouchEvent \| null)?, includeChangedTouches(?:: boolean)?\)(?:: WatermarkTouchPair \| null)? \{[\s\S]*?\n    \},\n    touchPointFromSource/)?.[0] || '';
  const touchPointBody = cameraPage.match(/touchPoint\(event(?:: UniTouchEvent \| null)?\)(?:: WatermarkPoint)? \{[\s\S]*?\n    \},\n    cameraViewportBounds/)?.[0] || '';
  const touchCoordinateBody = cameraPage.match(/pickTouchCoordinate\(touch(?:: UniTouch \| null)?, names(?:: Array<string>)?\)(?:: number)? \{[\s\S]*?\n    \},\n    pinchDistance/)?.[0] || '';

  assert.notEqual(indexStorageBody, '', 'index storage parser body should be inspectable');
  assert.notEqual(cameraStorageBody, '', 'cameraX storage parser body should be inspectable');
  for (const body of [indexStorageBody, cameraStorageBody]) {
    assert.match(body, /typeof value === 'string'/);
    assert.match(body, /const text = value\.trim\(\)/);
    assert.match(body, /if \(text == ''\)/);
    assert.match(body, /JSON\.parse\(text\) as UTSJSONObject \| null/);
    assert.match(body, /catch \(error\)[\s\S]*return null/);
    assert.match(body, /typeof value === 'object'/);
    assert.match(body, /return null/);
  }

  assert.notEqual(eventDetailBody, '', 'native event detail parser body should be inspectable');
  assert.match(eventDetailBody, /eventDetail\(payload(?:: UTSJSONObject \| null)?\)/);
  assert.match(eventDetailBody, /return payload != null \? payload : \{\}/);
  assert.doesNotMatch(eventDetailBody, /event as UTSJSONObject|nativeEvent\['detail'\]/);
  assert.match(cameraPage, /handleCameraReady\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handleNativeError\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handlePhotoDone\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handleRecordStart\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handleRecordDone\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handleFlashChange\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handleZoomChange\(event: UTSJSONObject \| null\)/);
  assert.match(cameraPage, /handleCameraChange\(event: UTSJSONObject \| null\)/);

  assert.match(cameraPage, /import \{ XycMarkvideoElement \} from 'uts\.sdk\.modules\.xycMarkvideo'/);
  assert.match(cameraPage, /resolveNativeCamera\(\)(?:: XycMarkvideoElement \| null)? \{[\s\S]*\$refs\['nativeCamera'\] as XycMarkvideoElement \| null/);
  assert.doesNotMatch(cameraPage, /as NativeCameraRef/);

  assert.notEqual(touchPairBody, '', 'watermarkTouchPair body should be inspectable');
  assert.notEqual(touchPointBody, '', 'touchPoint body should be inspectable');
  assert.notEqual(touchCoordinateBody, '', 'pickTouchCoordinate body should be inspectable');
  assert.match(cameraPage, /startWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.match(cameraPage, /moveWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.match(cameraPage, /finishWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.doesNotMatch(touchPairBody + touchPointBody, /eventDetail\(event\)|event as UTSJSONObject|touch as UTSJSONObject/);
  assert.doesNotMatch(touchCoordinateBody, /touchSource\[name\]|source\[names\[i\]\]|as UTSJSONObject/);
  assert.match(touchCoordinateBody, /touch\.pageX[\s\S]*touch\.clientX[\s\S]*touch\.screenX[\s\S]*touch\.pageY[\s\S]*touch\.clientY[\s\S]*touch\.screenY/);
});

test('cameraX uvue page owns UI and calls xyc-markvideo native camera methods', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const stopBranch = page.match(/this\.isRecording = false[\s\S]*?formatRecordElapsed\(elapsedMs(?:: number)?\)(?:: string)? \{/)?.[0] || '';
  const topBar = page.match(/<view class="topBar">[\s\S]*?<view class="recordHud"/)?.[0] || '';
  const watermarkArea = findTagBlock(page, '<view class="watermarkLayer"', 'view');
  const watermarkTransformBox = findTagBlock(page, '<view class="watermarkTransformBox"', 'view');
  const bottomPanelStyle = findStyleBlock(page, '.bottomPanel');
  assert.match(page, /<xyc-markvideo/);
  assert.match(page, /ref="nativeCamera"/);
  assert.match(page, /<view class="cameraViewport" :style="cameraViewportStyleText"><\/view>/);
  assert.match(page, /<xyc-markvideo[\s\S]*class="nativePreview"[\s\S]*:style="cameraViewportStyleText"/);
  assert.match(page, /<view class="cameraDebugBorder" :style="cameraViewportStyleText"><\/view>/);
  assert.match(page, /:target-fps="targetFps"/);
  assert.match(page, /targetFps: 30/);
  assert.match(page, /flashMode: 'off'/);
  assert.match(page, /flashTapAt: 0/);
  assert.match(page, /flashPending: false/);
  assert.match(page, /flashCycleMode: 'off'/);
  assert.match(page, /flashLastRequestedMode: 'off'/);
  assert.match(page, /flashEventHandled: false/);
  assert.match(page, /flashEventApplied: true/);
  assert.match(page, /@cameraready="handleCameraReady"/);
  assert.match(page, /@photodone="handlePhotoDone"/);
  assert.match(page, /@recordstart="handleRecordStart"/);
  assert.match(page, /@recorddone="handleRecordDone"/);
  assert.match(page, /@camerachange="handleCameraChange"/);
  assert.match(page, /const PORTRAIT_LAYOUT_FALLBACK_WIDTH = 375/);
  assert.match(page, /const PORTRAIT_LAYOUT_FALLBACK_HEIGHT = 812/);
  assert.match(page, /const CAMERA_TOP_BAR_HEIGHT = 60/);
  assert.match(page, /const CAMERA_MODE_SWITCH_HEIGHT = 36/);
  assert.match(page, /const CAMERA_MAIN_CONTROLS_HEIGHT = 88/);
  assert.match(page, /const CAMERA_CONTROLS_REGULAR_TOP = 8/);
  assert.match(page, /const CAMERA_CONTROLS_COMPACT_TOP = 4/);
  assert.match(page, /const CAMERA_CONTROLS_REGULAR_GAP = 12/);
  assert.match(page, /const CAMERA_CONTROLS_COMPACT_GAP = 4/);
  assert.match(page, /const CAMERA_CONTROLS_MIN_BOTTOM_SAFE = 4/);
  assert.match(page, /const CAMERA_CONTROLS_REGULAR_BOTTOM_SAFE = 16/);
  assert.match(page, /const CAMERA_CONTROLS_MAX_BOTTOM_SAFE = 64/);
  assert.match(page, /const CAMERA_CONTROLS_ULTRA_COMPACT_HEIGHT = 140/);
  assert.match(page, /const CAMERA_CONTROLS_COMPACT_HEIGHT = 172/);
  assert.match(page, /const CAMERA_CONTROLS_RELAXED_HEIGHT = 200/);
  assert.match(page, /const CAMERA_VIEWPORT_ASPECT_WIDTH = 3/);
  assert.match(page, /const CAMERA_VIEWPORT_ASPECT_HEIGHT = 4/);
  assert.match(page, /const RESULT_CACHE_LIMIT = 4/);
  assert.match(page, /resolveScreenBounds\(\)/);
  assert.match(page, /normalizePortraitLayoutBounds\(/);
  assert.match(page, /resolveCameraViewportBounds\(screen\.width, screen\.height\)/);
  assert.match(page, /cameraViewportStyle\(\) \{[\s\S]*const viewport = this\.cameraViewportBounds\(\)[\s\S]*width: Math\.round\(viewport\.width\) \+ 'px'[\s\S]*height: Math\.round\(viewport\.height\) \+ 'px'/);
  assert.match(page, /cameraViewportStyleText\(\) \{[\s\S]*const viewport = this\.cameraViewportBounds\(\)[\s\S]*return 'left:' \+ Math\.round\(viewport\.left\) \+ 'px;top:' \+ Math\.round\(viewport\.top\) \+ 'px;width:' \+ Math\.round\(viewport\.width\) \+ 'px;height:' \+ Math\.round\(viewport\.height\) \+ 'px;'/);
  assert.match(page, /bottomPanelStyle\(\) \{[\s\S]*const panel = this\.cameraBottomPanelBounds\(\)[\s\S]*top: Math\.round\(panel\.top\) \+ 'px'[\s\S]*height: Math\.round\(panel\.height\) \+ 'px'/);
  assert.match(bottomPanelStyle, /background-color: #e2e6e4;/);
  assert.match(bottomPanelStyle, /overflow: hidden;/);
  assert.doesNotMatch(bottomPanelStyle, /background-color: rgba/);
  assert.match(page, /<view class="modeSwitchWrap" :style="modeSwitchWrapStyle">/);
  assert.match(page, /modeSwitchWrapStyle\(\) \{[\s\S]*const panel = this\.cameraBottomPanelBounds\(\)[\s\S]*const layout = resolveCameraControlsLayout\(panel\.height\)[\s\S]*top: Math\.round\(layout\.modeTop\) \+ 'px'[\s\S]*height: Math\.round\(layout\.modeHeight\) \+ 'px'[\s\S]*opacity: layout\.modeOpacity/);
  assert.match(page, /mainControlsStyle\(\) \{[\s\S]*const panel = this\.cameraBottomPanelBounds\(\)[\s\S]*const layout = resolveCameraControlsLayout\(panel\.height\)[\s\S]*top: Math\.round\(layout\.mainTop\) \+ 'px'[\s\S]*transform: 'scale\(' \+ \(Math\.round\(layout\.mainScale \* 1000\) \/ 1000\) \+ '\)'/);
  assert.match(page, /zoomRailStyle\(\) \{[\s\S]*const viewport = this\.cameraViewportBounds\(\)[\s\S]*top: Math\.round\(viewport\.bottom - 56\) \+ 'px'/);
  assert.match(page, /function resolveCameraViewportBounds\(width(?:: number)?, height(?:: number)?\)/);
  assert.match(page, /const targetWidth = safeWidth/);
  assert.match(page, /const targetHeight = targetWidth \* CAMERA_VIEWPORT_ASPECT_HEIGHT \/ CAMERA_VIEWPORT_ASPECT_WIDTH/);
  assert.match(page, /const top = CAMERA_TOP_BAR_HEIGHT/);
  assert.match(page, /function resolveCameraBottomPanelBounds\(width(?:: number)?, height(?:: number)?\)/);
  assert.match(page, /const viewport = resolveCameraViewportBounds\(safeWidth, safeHeight\)/);
  assert.match(page, /const top = viewport\.bottom/);
  assert.match(page, /function resolveCameraControlsLayout\(panelHeight(?:: number)?\)(?:: CameraControlsLayout)?/);
  assert.match(page, /const ultraCompact = safePanelHeight < CAMERA_CONTROLS_ULTRA_COMPACT_HEIGHT/);
  assert.match(page, /const compact = safePanelHeight < CAMERA_CONTROLS_COMPACT_HEIGHT/);
  assert.match(page, /const modeHeight = ultraCompact \? 0 : CAMERA_MODE_SWITCH_HEIGHT/);
  assert.match(page, /const modeOpacity = ultraCompact \? 0 : 1/);
  assert.match(page, /const minMainTop = modeTop \+ modeHeight \+ gap/);
  assert.match(page, /const mainScale = ultraCompact/);
  assert.match(page, /const bottomAlignedTop = ultraCompact/);
  assert.match(page, /const maxMainTop = Math\.max\(0, safePanelHeight - CAMERA_MAIN_CONTROLS_HEIGHT - CAMERA_CONTROLS_MIN_BOTTOM_SAFE\)/);
  assert.match(page, /const left = \(safeWidth - targetWidth\) \/ 2/);
  assert.match(page, /safeNumber\(info\.windowWidth, PORTRAIT_LAYOUT_FALLBACK_WIDTH\)/);
  assert.match(page, /const windowHeight = safeNumber\(info\.windowHeight, PORTRAIT_LAYOUT_FALLBACK_HEIGHT\)/);
  assert.match(page, /const screenHeight = safeNumber\(info\.screenHeight, windowHeight\)/);
  assert.match(page, /const safeArea = info\.safeArea/);
  assert.match(page, /const safeAreaBottom = safeArea != null \? safeNumber\(safeArea\.bottom, windowHeight\) : windowHeight/);
  assert.match(page, /Math\.max\(windowHeight, screenHeight, safeAreaBottom\)/);
  assert.match(page, /width: Math\.min\(safeWidth, safeHeight\)/);
  assert.match(page, /height: Math\.max\(safeWidth, safeHeight\)/);
  assert.doesNotMatch(page, /width: info\.windowWidth \|\| 375/);
  assert.doesNotMatch(page, /height: info\.windowHeight \|\| 812/);
  assert.doesNotMatch(page, /@shuttertap/);
  assert.doesNotMatch(page, /@modechange/);
  assert.doesNotMatch(page, /handleNativeShutter/);
  assert.doesNotMatch(page, /handleNativeMode/);
  assert.match(page, /import \{ XycMarkvideoElement \} from 'uts\.sdk\.modules\.xycMarkvideo'/);
  assert.match(page, /resolveNativeCamera\(\)(?:: XycMarkvideoElement \| null)? \{[\s\S]*const nativeCamera = this\.\$refs\['nativeCamera'\] as XycMarkvideoElement \| null/);
  assert.doesNotMatch(page, /as NativeCameraRef/);
  assert.match(page, /storedWatermarkTemplate\(stored\)/);
  assert.match(page, /storageValueToJSONObject\(value(?:: any \| null)?\)/);
  assert.match(page, /JSON\.stringify\(nextTemplate\)/);
  assert.doesNotMatch(page, /storedTemplate = stored as UTSJSONObject/);
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
  assert.match(page, /goBack\(\) \{[\s\S]*if \(this\.isRecording \|\| this\.stopPending \|\| this\.recordStartPending\)/);
  assert.match(page, /this\.recordStartPending \? '录像启动中' : '请先停止录像'/);
  assert.match(page, /setMode\(mode(?:: string)?\)(?:: void)? \{[\s\S]*if \(this\.isRecording \|\| this\.stopPending \|\| this\.recordStartPending\)/);
  assert.match(page, /this\.recordStartPending \? '录像启动中不能切换模式' : '录像中不能切换模式'/);
  assert.match(page, /if \(mode === this\.mode\) \{[\s\S]*return[\s\S]*this\.mode = mode/);
  assert.doesNotMatch(page, /nativeCamera\.switchMode\(mode\)/);
  assert.match(page, /await nativeCamera\.setFlashMode\(mode\)/);
  assert.match(page, /nativeCamera\.setZoomMode\(mode\)/);
  assert.match(page, /zoomMode: '1x'/);
  assert.match(page, /zoomSelectedMode: '1x'/);
  assert.match(page, /availableZoomModes: \['1x'\] as Array<string>/);
  assert.match(page, /zoomPending: false/);
  assert.match(page, /zoomLatestRequestMode: '1x'/);
  assert.match(page, /zoomQueuedMode: ''/);
  assert.match(page, /zoomRequestSeq: 0/);
  assert.match(page, /zoomRequestSilent: false/);
  assert.match(page, /zoomEventHandled: false/);
  assert.match(page, /zoomEventApplied: true/);
  assert.match(page, /cameraFacing: 'back'/);
  assert.match(page, /cameraSwitchPending: false/);
  assert.match(page, /cameraSwitchTapAt: 0/);
  assert.match(page, /applyNativeCameraState\(detail(?:: UTSJSONObject \| null)?\)/);
  assert.match(page, /const cameraFacing = safeString\(detail\['cameraFacing'\], ''\)[\s\S]*if \(hasText\(cameraFacing\)\) \{[\s\S]*this\.cameraFacing = cameraFacing/);
  assert.match(page, /this\.updateAvailableZoomModes\(detail\['availableZoomModes'\]\)/);
  assert.doesNotMatch(page, /const normalizedRequestedZoomMode = hasText\(requestedZoomMode\)/);
  assert.doesNotMatch(page, /zoomRequestMatchesLatestRequest/);
  assert.match(page, /const normalizedZoomMode = normalizeUiZoomMode\(zoomMode\)[\s\S]*const zoomStateMatchesLatestRequest = normalizedZoomMode == this\.zoomLatestRequestMode[\s\S]*const zoomStateCanUpdateSelection = this\.cameraSwitchPending \|\| zoomStateMatchesLatestRequest[\s\S]*if \(zoomStateCanUpdateSelection\) \{[\s\S]*this\.zoomMode = normalizedZoomMode[\s\S]*if \(!this\.zoomPending && !hasText\(this\.zoomQueuedMode\)\) \{[\s\S]*this\.zoomSelectedMode = normalizedZoomMode[\s\S]*this\.zoomLatestRequestMode = normalizedZoomMode/);
  assert.match(page, /handleCameraChange\(event: UTSJSONObject \| null\)/);
  assert.match(page, /zoomRail/);
  assert.match(page, /wideZoomButtonClass/);
  assert.match(page, /normalZoomButtonClass/);
  assert.match(page, /teleZoomButtonClass/);
  assert.match(page, /syncZoomMode/);
  assert.match(page, /setZoomMode\(mode(?:: string)?\)/);
  assert.match(page, /zoomModeLabel\(mode(?:: string)?\)/);
  assert.match(page, /const normalizedRequestedMode = hasText\(requestedZoomMode\) \? normalizeUiZoomMode\(requestedZoomMode\) : ''[\s\S]*if \(hasText\(normalizedRequestedMode\) && normalizedRequestedMode != this\.zoomLatestRequestMode\) \{[\s\S]*return[\s\S]*\}/);
  assert.match(page, /async setZoomMode\(mode(?:: string)?\)(?:: Promise<void>)? \{[\s\S]*if \(this\.stopPending\) \{[\s\S]*return[\s\S]*\}\s*this\.triggerHaptic\('light'\)\s*if \(this\.zoomPending\)/);
  assert.match(page, /const targetMode = normalizeUiZoomMode\(mode\)[\s\S]*if \(this\.zoomPending\) \{[\s\S]*this\.zoomQueuedMode = targetMode[\s\S]*this\.zoomLatestRequestMode = targetMode[\s\S]*return[\s\S]*\}[\s\S]*this\.zoomRequestSeq = this\.zoomRequestSeq \+ 1[\s\S]*const requestId = this\.zoomRequestSeq[\s\S]*this\.zoomLatestRequestMode = targetMode[\s\S]*this\.zoomQueuedMode = ''/);
  const setZoomModeBody = page.match(/async setZoomMode\(mode(?:: string)?\)(?:: Promise<void>)? \{[\s\S]*?\n    \},\n    async syncZoomMode/)?.[0] || '';
  assert.notEqual(setZoomModeBody, '', 'setZoomMode body should be inspectable');
  assert.doesNotMatch(setZoomModeBody, /zoomSelectedMode = targetMode/);
  assert.doesNotMatch(page, /const previousZoomMode = this\.zoomMode/);
  assert.doesNotMatch(page, /const previousSelectedMode = this\.zoomSelectedMode/);
  assert.match(page, /const queuedMode = this\.zoomQueuedMode[\s\S]*this\.zoomQueuedMode = ''[\s\S]*if \(hasText\(queuedMode\)\) \{[\s\S]*await this\.setZoomMode\(queuedMode\)/);
  assert.match(page, /async syncZoomMode\(mode(?:: string)?, silent(?:: boolean)?, requestId(?:: number)? = 0\)(?:: Promise<boolean>)? \{[\s\S]*this\.zoomLatestRequestMode = mode[\s\S]*this\.zoomRequestSilent = silent[\s\S]*const nativeResponse = await nativeCamera\.setZoomMode\(mode\)/);
  assert.match(page, /await this\.syncZoomMode\(targetMode, false, requestId\)/);
  assert.doesNotMatch(page, /this\.zoomMode = previousMode/);
  assert.match(page, /if \(\(requestId > 0 && requestId !== this\.zoomRequestSeq\) \|\| mode != this\.zoomLatestRequestMode\) \{[\s\S]*return true[\s\S]*\}/);
  assert.match(page, /showZoomToast\(message(?:: string)?\)(?:: void)? \{[\s\S]*uni\.showToast\(\{[\s\S]*title: message,[\s\S]*icon: 'none',[\s\S]*duration: 900/);
  assert.match(page, /showCameraControlToast\(message(?:: string)?\)(?:: void)? \{[\s\S]*uni\.showToast\(\{[\s\S]*title: message,[\s\S]*icon: 'none',[\s\S]*duration: 900/);
  assert.match(page, /nativePreviewStatusText\(\) \{[\s\S]*toastOnlyStatus\(this\.nativeStatus\)[\s\S]*return ''[\s\S]*return this\.nativeStatus/);
  assert.match(page, /toastOnlyStatus\(text(?:: string)?\)(?:: boolean)? \{[\s\S]*text === '焦段：1x'[\s\S]*text === '闪光灯切换中'[\s\S]*text === '闪光灯：开'[\s\S]*text === '摄像头切换中'[\s\S]*text === '前置摄像头'[\s\S]*text === '当前设备不支持切换摄像头'/);
  assert.match(page, /normalizeUiZoomMode\(mode(?:: string)?\)(?:: string)? \{[\s\S]*mode == 'wide'[\s\S]*mode == '1x'[\s\S]*mode == '2x'[\s\S]*return '1x'/);
  assert.match(page, /normalizeAvailableZoomModes\(value(?:: any \| null)?\)(?:: Array<string>)?/);
  assert.doesNotMatch(page, /if \(!this\.zoomModeAvailable\(mode\)\)/);
  assert.doesNotMatch(page, /zoomModeAvailable\(mode(?:: string)?\)/);
  assert.match(page, /switchCameraFacing\(\)/);
  assert.match(page, /nativeCamera\.switchCamera\(\)/);
  assert.match(page, /cameraFacingLabel\(facing(?:: string)?\)/);
  assert.match(page, /原生摄像头切换接口不可用/);
  assert.match(page, /录像中不能切换摄像头/);
  assert.match(page, /this\.recordStartAfterPermission = true/);
  assert.match(page, /this\.clearRecordPermissionRetry\(\)/);
  assert.match(page, /this\.zoomRequestSilent = silent/);
  assert.match(page, /if \(result\.data != null && isBooleanFalse\(result\.data\['applied'\]\)\)/);
  assert.match(page, /if \(!applied && hasText\(normalizedRequestedMode\)\) \{[\s\S]*this\.zoomMode = hasText\(zoomMode\) \? normalizeUiZoomMode\(zoomMode\) : '1x'[\s\S]*this\.zoomSelectedMode = this\.zoomMode[\s\S]*this\.zoomLatestRequestMode = this\.zoomMode[\s\S]*this\.showZoomToast\(safeString\(detail\['message'\], '当前设备不支持该焦段'\)\)/);
  assert.match(page, /if \(result\.data != null && isBooleanFalse\(result\.data\['applied'\]\)\) \{[\s\S]*const resultZoomMode = safeString\(result\.data\['zoomMode'\], ''\)[\s\S]*this\.zoomMode = hasText\(resultZoomMode\) \? normalizeUiZoomMode\(resultZoomMode\) : '1x'[\s\S]*this\.zoomSelectedMode = this\.zoomMode[\s\S]*this\.showZoomToast\(safeString\(result\.data\['message'\], this\.unsupportedZoomModeLabel\(mode\)\)\)/);
  assert.match(page, /const appliedZoomMode = hasText\(zoomMode\) \? normalizeUiZoomMode\(zoomMode\) : \(hasText\(normalizedRequestedMode\) \? normalizedRequestedMode : this\.zoomLatestRequestMode\)[\s\S]*this\.zoomMode = appliedZoomMode[\s\S]*this\.zoomSelectedMode = appliedZoomMode[\s\S]*this\.zoomLatestRequestMode = appliedZoomMode/);
  assert.doesNotMatch(page, /if \(hasText\(zoomMode\)\) \{[\s\S]*this\.zoomMode = normalizeUiZoomMode\(zoomMode\)[\s\S]*this\.zoomSelectedMode = this\.zoomMode/);
  assert.match(page, /if \(this\.zoomEventHandled\) \{[\s\S]*return this\.zoomEventApplied[\s\S]*\}[\s\S]*const zoomMode = result\.data != null \? safeString\(result\.data\['zoomMode'\], ''\) : ''/);
  assert.doesNotMatch(page, /resultRequestedZoomMode|normalizedResultRequestedMode/);
  assert.match(page, /const appliedZoomMode = hasText\(zoomMode\) \? normalizeUiZoomMode\(zoomMode\) : normalizeUiZoomMode\(mode\)[\s\S]*this\.zoomMode = appliedZoomMode[\s\S]*this\.zoomSelectedMode = appliedZoomMode[\s\S]*this\.zoomLatestRequestMode = appliedZoomMode/);
  assert.match(page, /maxWatermarkScale\(left(?:: number)?, top(?:: number)?, rotation(?:: number)?, width(?:: number)?, height(?:: number)?\)/);
  assert.match(page, /nativeCamera\.takePhoto\(\)/);
  assert.match(page, /handlePhotoDone\(event: UTSJSONObject \| null\)/);
  assert.match(page, /拍照请求已受理|拍照中/);
  assert.match(page, /nativeCamera\.startRecord\(\{ fps: this\.targetFps \}\)/);
  assert.match(page, /nativeCamera\.stopRecord\(\)/);
  assert.match(page, /WATERMARK_STORAGE_KEY/);
  assert.match(page, /watermarkTemplates/);
  assert.match(page, /activeWatermark/);
  assert.match(page, /watermarkFrame/);
  assert.match(page, /updateWatermarkFrame\(patch(?:: WatermarkFramePatch)?\)/);
  assert.doesNotMatch(page, /this\.watermarkFrame\.(left|top|scale|rotation)\s*=/);
  assert.match(page, /showWatermarkSheet/);
  assert.match(page, /lastMediaResult: null/);
  assert.match(page, /recentMediaResults: \[\]/);
  assert.match(page, /openSystemAlbum\(\)/);
  assert.doesNotMatch(page, /openResultSheet\(\)/);
  assert.doesNotMatch(page, /showResultSheet/);
  assert.match(page, /lastMediaThumbClass\(\)/);
  assert.match(page, /lastMediaThumbSource\(\)/);
  assert.match(page, /rememberMediaResult\(kind(?:: string)?, detail(?:: UTSJSONObject \| null)?\)/);
  assert.match(page, /this\.lastMediaResult = nextItem/);
  assert.match(page, /thumbnailPath: this\.pickMediaThumbnailPath\(kind, source, path\)/);
  assert.match(page, /const statusText = safeString\(source\['message'\], savedToAlbum \? '已保存到相册' : '已生成，相册保存失败'\)/);
  assert.match(page, /this\.recentMediaResults = nextResults\.slice\(0, RESULT_CACHE_LIMIT\)/);
  assert.match(page, /this\.rememberMediaResult\('photo', detail\)/);
  assert.match(page, /this\.rememberMediaResult\('video', detail\)/);
  assert.match(page, /openWatermarkSheet\(\)/);
  assert.match(page, /selectWatermarkTemplate/);
  assert.match(page, /clearActiveWatermark/);
  assert.match(page, /syncWatermarkToNative/);
  assert.match(page, /nativeCamera\.setWatermark/);
  assert.match(page, /nativeCamera\.clearWatermark/);
  assert.match(page, /<view class="watermarkLayer" :style="watermarkLayerStyleValue\(\)" v-if="activeWatermark != null">/);
  assert.doesNotMatch(page, /<movable-area|<movable-view/);
  assert.doesNotMatch(page, /<view class="watermarkLayer" :key="watermarkRenderKey"/);
  assert.match(watermarkArea, /class="watermarkGesturePlane"[\s\S]*:style="watermarkGesturePlaneStyleValue\(\)"[\s\S]*@touchstart="startWatermarkTouch"[\s\S]*@touchmove="moveWatermarkTouch"[\s\S]*@touchend="finishWatermarkTouch"[\s\S]*@touchcancel="finishWatermarkTouch"/);
  assert.doesNotMatch(watermarkArea, /:x="watermarkMoveX"|:y="watermarkMoveY"|direction="all"|:disabled="watermarkMoveDisabled"|:style="watermarkBoxStyleValue\(\)"|@change="handleWatermarkMoveChange"/);
  assert.match(watermarkArea, /class="watermarkGesturePlane"[\s\S]*<view[\s\S]*v-if="!watermarkPinchActive\(\)"[\s\S]*class="watermarkTransformBox"/);
  assert.match(page, /<view class="watermarkTransformBox"[\s\S]*:key="watermarkRenderKey"[\s\S]*:style="watermarkTransformStyleValue\(\)"/);
  assert.match(page, /watermarkLayerStyle\(\)/);
  assert.match(page, /watermarkMovePosition: \{[\s\S]*x: 0,[\s\S]*y: 0/);
  assert.match(page, /watermarkGesturePlaneStyleValue\(\)/);
  assert.match(page, /left: Math\.round\(this\.watermarkPinchActive\(\) \? 0 : this\.watermarkMovePosition\.x\) \+ 'px'/);
  assert.match(page, /top: Math\.round\(this\.watermarkPinchActive\(\) \? 0 : this\.watermarkMovePosition\.y\) \+ 'px'/);
  assert.match(page, /watermarkMovePositionFromFrame\(\)/);
  assert.match(page, /this\.watermarkMovePosition = this\.watermarkMovePositionFromFrame\(\)/);
  assert.doesNotMatch(page, /:key="watermarkBoxKey"/);
  assert.doesNotMatch(page, /:key="watermarkControlKey \+ '-/);
  assert.doesNotMatch(page, /watermarkBoxKey\(\)/);
  assert.doesNotMatch(page, /watermarkControlKey\(\)/);
  assert.doesNotMatch(page, /watermarkGeometryKey\(prefix\)/);
  assert.match(page, /handleWatermarkMoveChange\(event: UTSJSONObject \| null\)/);
  assert.match(page, /startWatermarkTouch\(event: UniTouchEvent \| null\)/);
  assert.match(page, /moveWatermarkTouch\(event: UniTouchEvent \| null\)/);
  assert.match(page, /finishWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.match(page, /finishWatermarkMove\(\)/);
  assert.match(page, /watermarkBoxMetrics\(width(?:: number)?, height(?:: number)?, scale(?:: number)?, rotation(?:: number)?\)/);
  assert.doesNotMatch(page, /startWatermarkDrag/);
  assert.match(page, /startWatermarkPinch\(touchPair(?:: WatermarkTouchPair)?\)/);
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
  assert.match(page, /clearRecordStopPendingTimer\(\) \{[\s\S]*const timer = this\.recordStopPendingTimer[\s\S]*clearTimeout\(timer\)/);
  assert.match(page, /startRecordStopPendingTimeout\(\) \{[\s\S]*this\.nativeStatus = '视频保存超时，请重试'/);
  assert.doesNotMatch(page, /4500/);
  assert.match(stopBranch, /this\.isRecording = false[\s\S]*this\.stopPending = true[\s\S]*this\.nativeStatus = '正在保存视频'/);
  assert.match(stopBranch, /this\.stopRecordingClock\(\)[\s\S]*this\.startRecordStopPendingTimeout\(\)[\s\S]*try \{/);
  assert.match(stopBranch, /const stopResponse = await nativeCamera\.stopRecord\(\)/);
  assert.match(stopBranch, /const result = await this\.normalizeNativeCommandReturn\(stopResponse, '录像停止失败', '视频保存中', \['14'\]\)/);
  assert.match(stopBranch, /if \(!this\.stopPending\) \{[\s\S]*return[\s\S]*\}/);
  assert.match(stopBranch, /const message = result\.data != null \? safeString\(result\.data\['message'\], ''\) : ''[\s\S]*this\.nativeStatus = hasText\(message\) \? message : '视频保存中'/);
  assert.match(stopBranch, /if \(this\.nativeStatus !== '视频保存中'\) \{[\s\S]*this\.clearRecordStopPendingTimer\(\)[\s\S]*this\.stopPending = false/);
  assert.match(stopBranch, /else \{[\s\S]*this\.nativeStatus = safeString\(result\.errorMessage, '录像停止失败'\)[\s\S]*this\.clearRecordStopPendingTimer\(\)[\s\S]*this\.stopPending = false/);
  assert.match(stopBranch, /catch \(error\)[\s\S]*this\.nativeStatus = safeErrorMessage\(error, '录像停止失败'\)[\s\S]*this\.clearRecordStopPendingTimer\(\)[\s\S]*this\.stopPending = false/);
  assert.match(page, /const savedToAlbum = isBooleanTrue\(detail\['savedToAlbum'\]\)[\s\S]*safeString\(detail\['message'\], savedToAlbum \? '视频已保存到相册' : '视频已生成'\)/);
  assert.doesNotMatch(page, /this\.nativeStatus = '视频已保存到相册'/);
  assert.match(page, /formatRecordElapsed\(elapsedMs(?:: number)?\)/);
  assert.match(page, /startRecordingClock\(\)/);
  assert.match(page, /setInterval\(\(\) =>/);
  assert.match(page, /stopRecordingClock\(\) \{[\s\S]*const timer = this\.recordTimer[\s\S]*clearInterval\(timer\)/);
  assert.match(page, /onUnload\(\)[\s\S]*const recordTimer = this\.recordTimer[\s\S]*clearInterval\(recordTimer\)/);
  assert.doesNotMatch(page, /@click="restartCamera"/);
  assert.doesNotMatch(page, /<text class="cameraIcon">↻<\/text>/);
  assert.match(page, /class="topBar"/);
  assert.match(page, /class="bottomPanel" :style="bottomPanelStyle"/);
  assert.match(page, /class="recordHud"/);
  assert.match(page, /class="recordBubble"/);
  assert.match(page, /recordDotClass/);
  assert.match(page, /recordElapsedText/);
  assert.match(page, /:camera-sound-enabled="cameraSoundEnabled"/);
  assert.match(page, /cameraSoundEnabled: true/);
  assert.match(page, /cameraSoundPending: false/);
  assert.match(page, /cameraSoundPillClass\(\) \{[\s\S]*return this\.cameraSoundEnabled \? \['cameraSoundPill', 'cameraSoundPillActive'\] : \['cameraSoundPill'\]/);
  assert.match(page, /cameraSoundTextClass\(\) \{[\s\S]*return this\.cameraSoundEnabled \? \['cameraSoundText', 'cameraSoundTextActive'\] : \['cameraSoundText'\]/);
  assert.match(page, /cameraSoundModeText\(\) \{[\s\S]*return this\.cameraSoundEnabled \? '开' : '关'/);
  assert.match(page, /cameraSoundIconTextClass\(\) \{[\s\S]*return this\.cameraSoundEnabled \? \['cameraSoundIconText', 'cameraSoundTextActive'\] : \['cameraSoundIconText'\]/);
  assert.match(page, /toggleCameraSound\(\) \{[\s\S]*if \(this\.cameraSoundPending\) \{[\s\S]*return[\s\S]*this\.cameraSoundPending = true[\s\S]*this\.triggerHaptic\('light'\)[\s\S]*const nativeResponse = await nativeCamera\.setCameraSoundEnabled\(nextEnabled\)[\s\S]*if \(!this\.nativeReturnIsEmpty\(nativeResponse\)\) \{[\s\S]*finally \{[\s\S]*this\.cameraSoundPending = false/);
  assert.match(page, /const statusMessage = this\.cameraSoundEnabled \? '提示音已开启' : '提示音已关闭'[\s\S]*this\.nativeStatus = statusMessage[\s\S]*this\.showCameraSoundToast\(statusMessage\)/);
  assert.match(page, /showCameraSoundToast\(message(?:: string)?\)(?:: void)? \{[\s\S]*uni\.showToast\(\{[\s\S]*title: message,[\s\S]*icon: 'none',[\s\S]*duration: 900/);
  assert.doesNotMatch(page, /recordAudioHint|recordAudioEnabled|录音开|录音关|录音中|录像录音|声开|声关/);
  assert.match(page, /class="topSide"/);
  assert.match(page, /class="topRightSide"/);
  assert.match(page, /class="zoomRail"/);
  assert.match(page, /class="flashTapArea" @click="cycleFlashMode"/);
  assert.match(page, /:class="flashPillClass"/);
  const flashControl = page.slice(page.indexOf('class="flashTapArea"'), page.indexOf('class="switchCameraTapArea"', page.indexOf('class="flashTapArea"')));
  assert.equal((flashControl.match(/@click="cycleFlashMode"/g) || []).length, 1);
  assert.doesNotMatch(flashControl, /:class="flashPillClass" @click="cycleFlashMode"/);
  assert.doesNotMatch(flashControl, /:class="flashIconClass" @click="cycleFlashMode"/);
  assert.doesNotMatch(flashControl, /:class="flashTextClass" @click="cycleFlashMode"/);
  assert.match(page, /flashPillClass/);
  assert.match(page, /flashIconClass/);
  assert.match(page, /flashTextClass/);
  assert.match(page, /flashModeText/);
  assert.match(page, /flashPillClass\(\) \{[\s\S]*return this\.flashMode == 'off'/);
  assert.match(page, /flashIconClass\(\) \{[\s\S]*return this\.flashMode == 'off'/);
  assert.match(page, /flashTextClass\(\) \{[\s\S]*return this\.flashMode == 'off'/);
  assert.match(page, /flashModeText\(\) \{[\s\S]*if \(this\.flashMode == 'on'\)[\s\S]*if \(this\.flashMode == 'auto'\)/);
  assert.match(page, /cycleFlashMode/);
  assert.match(page, /if \(this\.flashPending\) \{[\s\S]*return/);
  assert.match(page, /tappedAt - this\.flashTapAt < 280/);
  assert.match(page, /const flashApplied = await this\.syncFlashMode\(this\.flashMode, true\)/);
  assert.match(page, /if \(!flashApplied\) \{[\s\S]*this\.flashMode = 'off'[\s\S]*this\.flashLastRequestedMode = 'off'/);
  assert.match(page, /const zoomSyncBlockedByUserRequest = this\.zoomPending \|\| hasText\(this\.zoomQueuedMode\)[\s\S]*if \(!zoomSyncBlockedByUserRequest\) \{[\s\S]*const zoomApplied = await this\.syncZoomMode\(this\.zoomMode, true\)[\s\S]*const fallbackZoomMode = safeString\(detail\['zoomMode'\], '1x'\)[\s\S]*const normalizedFallbackZoomMode = normalizeUiZoomMode\(fallbackZoomMode\)[\s\S]*this\.zoomMode = normalizedFallbackZoomMode[\s\S]*this\.zoomSelectedMode = normalizedFallbackZoomMode[\s\S]*this\.zoomLatestRequestMode = normalizedFallbackZoomMode[\s\S]*\}/);
  assert.match(page, /const currentFlashMode = this\.flashMode/);
  assert.match(page, /const cycleBaseMode = this\.flashCycleBaseMode\(currentFlashMode, this\.flashCycleMode\)/);
  assert.match(page, /const nextMode = this\.nextFlashMode\(cycleBaseMode\)/);
  assert.match(page, /this\.flashCycleMode = nextMode/);
  assert.match(page, /this\.flashLastRequestedMode = nextMode/);
  assert.match(page, /flashCycleBaseMode\(visibleMode(?:: string)?, cycleMode(?:: string)?\)(?:: string)? \{[\s\S]*const normalizedVisibleMode = this\.normalizeFlashModeForCycle\(visibleMode, 'off'\)[\s\S]*const normalizedCycleMode = this\.normalizeFlashModeForCycle\(cycleMode, normalizedVisibleMode\)[\s\S]*if \(normalizedVisibleMode == 'off' && normalizedCycleMode == 'auto'\) \{[\s\S]*return normalizedVisibleMode[\s\S]*return normalizedCycleMode/);
  assert.match(page, /normalizeFlashModeForCycle\(mode(?:: string)?, fallbackMode(?:: string)?\)(?:: string)? \{[\s\S]*if \(mode == 'off' \|\| mode == 'on' \|\| mode == 'auto'\) \{[\s\S]*return mode[\s\S]*if \(fallbackMode == 'off' \|\| fallbackMode == 'on' \|\| fallbackMode == 'auto'\) \{[\s\S]*return fallbackMode[\s\S]*return 'off'/);
  assert.match(page, /const normalizedMode = this\.normalizeFlashModeForCycle\(currentFlashMode, 'off'\)[\s\S]*return normalizedMode == 'off' \? 'on' : \(normalizedMode == 'on' \? 'auto' : 'off'\)/);
  assert.match(page, /this\.flashPending = true/);
  assert.match(page, /this\.nativeStatus = '闪光灯切换中'/);
  assert.match(page, /cycleFlashMode\(\)[\s\S]*this\.triggerHaptic\('light'\)[\s\S]*const currentFlashMode = this\.flashMode/);
  assert.match(page, /const applied = await this\.syncFlashMode\(nextMode, false\)/);
  assert.match(page, /if \(!applied\) \{[\s\S]*this\.flashMode = currentFlashMode/);
  assert.match(page, /cycleFlashMode\(\)[\s\S]*const applied = await this\.syncFlashMode\(nextMode, false\)[\s\S]*this\.showCameraControlToast\(this\.nativeStatus\)[\s\S]*finally \{/);
  assert.match(page, /finally \{[\s\S]*this\.flashPending = false/);
  assert.match(page, /isBooleanFalse\(result\.data\['applied'\]\)/);
  assert.match(page, /isBooleanFalse\(value(?:: any \| null)?\)(?:: boolean)? \{[\s\S]*typeof value === 'boolean'[\s\S]*return !value[\s\S]*typeof value === 'string'[\s\S]*value\.trim\(\)\.toLowerCase\(\)[\s\S]*normalized == 'false' \|\| normalized == '0'[\s\S]*typeof value === 'number'[\s\S]*return value == 0/);
  assert.match(page, /this\.flashEventHandled = true/);
  assert.match(page, /this\.flashEventApplied = applied/);
  assert.match(page, /原生闪光灯接口不可用/);
  assert.match(page, /this\.flashEventHandled = false/);
  assert.match(page, /const eventHandled = this\.flashEventHandled/);
  assert.match(page, /const eventApplied = this\.flashEventApplied/);
  assert.match(page, /if \(eventHandled\) \{[\s\S]*return eventApplied/);
  assert.match(page, /catch \(error\)[\s\S]*闪光灯设置失败/);
  assert.match(page, /flashModeLabel\(mode\)/);
  assert.match(page, /flashModeLabel\(mode(?:: string)?\)(?:: string)? \{[\s\S]*if \(mode == 'on'\)[\s\S]*if \(mode == 'auto'\)/);
  assert.match(page, /nextFlashMode\(cycleBaseMode\)/);
  assert.match(page, /normalizeFlashModeForCycle\(mode(?:: string)?, fallbackMode(?:: string)?\)/);
  const flashComparisonScope = [
    page.match(/handleFlashChange\(event(?:: UTSJSONObject \| null)?\)(?:: void)? \{[\s\S]*?\n    \},\n    handleZoomChange/)?.[0] || '',
    page.match(/async syncFlashMode\(mode(?:: string)?, silent(?:: boolean)?\)(?:: Promise<boolean>)? \{[\s\S]*?\n    \},\n    normalizeFlashModeForCycle/)?.[0] || '',
    page.match(/flashModeLabel\(mode(?:: string)?\)(?:: string)? \{[\s\S]*?\n    \},\n    async setZoomMode/)?.[0] || '',
  ].join('\n');
  assert.notEqual(flashComparisonScope, '', 'flash comparison paths should be inspectable');
  assert.doesNotMatch(flashComparisonScope, /this\.flashMode === '(?:off|on|auto)'|mode === '(?:on|auto)'|requestedFlashMode !== 'off'|mode !== 'off'/);
  const zoomComparisonScope = [
    page.match(/wideZoomButtonClass\(\) \{[\s\S]*?\n    nativePreviewStatusText/)?.[0] || '',
    page.match(/applyNativeCameraState\(detail(?:: UTSJSONObject \| null)?\)(?:: void)? \{[\s\S]*?\n    \},\n    normalizeNativeResult/)?.[0] || '',
    page.match(/handleZoomChange\(event(?:: UTSJSONObject \| null)?\)(?:: void)? \{[\s\S]*?\n    \},\n    handleCameraChange/)?.[0] || '',
    page.match(/async setZoomMode\(mode(?:: string)?\)(?:: Promise<void>)? \{[\s\S]*?\n    \},\n    async syncZoomMode/)?.[0] || '',
    page.match(/async syncZoomMode\(mode(?:: string)?, silent(?:: boolean)?, requestId(?:: number)? = 0\)(?:: Promise<boolean>)? \{[\s\S]*?\n    \},\n    showZoomToast/)?.[0] || '',
    page.match(/zoomModeLabel\(mode(?:: string)?\)(?:: string)? \{[\s\S]*?\n    \},\n    updateAvailableZoomModes/)?.[0] || '',
    page.match(/function normalizeAvailableZoomModes\(value(?:: any \| null)?\)(?:: Array<string>)? \{[\s\S]*?\nfunction normalizeHapticType/)?.[0] || '',
  ].join('\n');
  assert.notEqual(zoomComparisonScope, '', 'zoom comparison paths should be inspectable');
  assert.doesNotMatch(zoomComparisonScope, /zoomSelectedMode ===|normalizedZoomMode === this\.zoomLatestRequestMode|normalizedRequestedZoomMode === this\.zoomLatestRequestMode|normalizedRequestedMode !== this\.zoomLatestRequestMode|targetMode === previousZoomMode|mode !== this\.zoomLatestRequestMode|mode === '(?:wide|1x|2x)'|values\[i\] === target/);
  assert.match(page, /typeof result === 'string'/);
  assert.match(page, /parseNativeResultText\(text(?:: string)?, fallbackMessage(?:: string)?\)/);
  assert.match(page, /nativeReturnIsEmpty\(result(?:: any \| null)?\)/);
  assert.match(page, /typeof result === 'string' && result\.trim\(\) === ''/);
  assert.match(page, /triggerHaptic\(type(?:: any \| null)?\)/);
  assert.match(page, /triggerHaptic\(type(?:: any \| null)?\)(?:: void)? \{[\s\S]*normalizeHapticType\(safeString\(type, 'light'\)\)[\s\S]*const nativeCamera = this\.resolveNativeCamera\(\)[\s\S]*nativeCamera\.performHapticFeedback\(hapticType\)/);
  assert.match(page, /normalizeHapticType\(value(?:: string)?\)(?:: HapticType)?/);
  assert.doesNotMatch(page, /uni\.vibrateShort/);
  assert.match(page, /const WATERMARK_TRACE_LOG = false/);
  assert.match(page, /writeWatermarkTrace\(message(?:: string)?\)(?:: void)? \{[\s\S]*console\.log\(message\)/);
  assert.doesNotMatch(page, /plus\.android|watermarkTraceAndroidLog/);
  assert.match(page, /setMode\(mode(?:: string)?\)(?:: void)? \{[\s\S]*this\.triggerHaptic\('light'\)[\s\S]*this\.mode = mode/);
  assert.match(page, /if \(this\.mode === 'photo'\) \{[\s\S]*this\.triggerHaptic\('light'\)[\s\S]*nativeCamera\.takePhoto\(\)/);
  assert.match(page, /if \(!this\.isRecording\) \{[\s\S]*this\.triggerHaptic\('medium'\)[\s\S]*prepareRecordPermissions\(\)[\s\S]*this\.recordStartPending = true[\s\S]*nativeCamera\.startRecord\(\{ fps: this\.targetFps \}\)/);
  assert.match(page, /this\.triggerHaptic\('medium'\)[\s\S]*this\.isRecording = false[\s\S]*nativeCamera\.stopRecord\(\)/);
  assert.match(page, /normalizeNativeCommandReturn\(result(?:: any \| null)?, fallbackMessage(?:: string)?, acceptedMessage(?:: string)?, watchedErrorCodes(?:: Array<string>)?\)/);
  assert.match(page, /normalizeNativeCommandReturn\(nativeCamera\.prepareRecordPermissions\(\), '请先完成录像权限授权', '录像权限已准备', \['10'\]\)/);
  assert.match(page, /normalizeNativeCommandReturn\(await nativeCamera\.setWatermark\(payload\), '水印设置失败', '水印已更新', \['12', '14'\]\)/);
  assert.match(page, /normalizeNativeCommandReturn\(await nativeCamera\.takePhoto\(\), '拍照失败', '拍照中', \['10', '11', '13', '14'\]\)/);
  assert.match(page, /nativeResultFromJSONObject\(source: UTSJSONObject, fallbackMessage: string\)[\s\S]*const rawData = source\['data'\]/);
  assert.match(topBar, /<text :class="flashIconClass">⚡︎<\/text>/);
  assert.match(page, /return '开'/);
  assert.match(page, /return '自动'/);
  assert.match(page, /return '关'/);
  assert.ok(topBar.indexOf('flashPillClass') > -1 && topBar.indexOf('switchCameraButtonClass') > -1);
  assert.ok(topBar.indexOf('flashPillClass') < topBar.indexOf('switchCameraButtonClass'));
  assert.match(page, /class="switchCameraTapArea" @click\.stop="switchCameraFacing"/);
  assert.doesNotMatch(page, /@touchend\.stop="switchCameraFacing"/);
  assert.match(page, /switchCameraFacing\(\)[\s\S]*this\.triggerHaptic\('light'\)[\s\S]*this\.cameraSwitchPending = true/);
  assert.match(page, /switchCameraFacing\(\)[\s\S]*this\.nativeStatus = hasText\(message\) \? message : this\.cameraFacingLabel\(this\.cameraFacing\)[\s\S]*this\.showCameraControlToast\(this\.nativeStatus\)/);
  assert.match(page, /<text class="switchCameraIcon">⇄<\/text>/);
  assert.doesNotMatch(page, /class="switchCameraGlyph"/);
  assert.doesNotMatch(page, /class="switchCameraLens"/);
  assert.doesNotMatch(page, /class="switchCameraTopLine"/);
  assert.doesNotMatch(page, /class="fpsPill"/);
  assert.doesNotMatch(page, /class="fpsText"/);
  assert.match(page, /class="cameraSoundTapArea" @click="toggleCameraSound"/);
  assert.match(page, /:class="cameraSoundPillClass"/);
  assert.match(page, /class="cameraSoundIcon"/);
  assert.match(page, /:class="cameraSoundIconTextClass">♪<\/text>/);
  assert.match(page, /:class="cameraSoundTextClass">\{\{ cameraSoundModeText \}\}<\/text>/);
  const soundControl = page.slice(page.indexOf('class="cameraSoundTapArea"'), page.indexOf('class="modeSwitch"', page.indexOf('class="cameraSoundTapArea"')));
  assert.equal((soundControl.match(/@click="toggleCameraSound"/g) || []).length, 1);
  assert.doesNotMatch(soundControl, /cameraSoundSpeakerBody|cameraSoundSpeakerCone|cameraSoundSpeakerWave/);
  assert.doesNotMatch(page, /🔊|🔈|🔇/);
  assert.ok(page.indexOf('class="cameraSoundTapArea"') > -1 && page.indexOf('class="modeSwitch"') > -1);
  assert.ok(page.indexOf('class="cameraSoundTapArea"') < page.indexOf('class="modeSwitch"'));
  assert.match(page, /<view :class="wideZoomButtonClass" @click="setZoomMode\('wide'\)">/);
  assert.match(page, /<text :class="wideZoomTextClass">广角<\/text>/);
  assert.match(page, /<text :class="normalZoomTextClass">1x<\/text>/);
  assert.match(page, /<view :class="teleZoomButtonClass" @click="setZoomMode\('2x'\)">/);
  assert.match(page, /<text :class="teleZoomTextClass">2x<\/text>/);
  assert.doesNotMatch(page, /v-if="zoomModeAvailable\('wide'\)"/);
  assert.doesNotMatch(page, /v-if="zoomModeAvailable\('2x'\)"/);
  assert.match(page, /class="shutterWrap"/);
  assert.match(page, /class="resultButton controlLeft" @click="openSystemAlbum"/);
  assert.match(page, /class="cameraButton controlRight" @click="openWatermarkSheet"/);
  assert.match(page, /<image v-if="lastMediaHasThumb\(\)" class="resultThumbImage" :src="lastMediaThumbSourceValue\(\)"><\/image>/);
  assert.match(page, /<text v-if="lastMediaThumbMissing\(\)" class="resultThumbIcon">相<\/text>/);
  assert.match(page, /<text v-if="lastMediaIsVideo\(\)" class="resultVideoBadge">▶<\/text>/);
  assert.doesNotMatch(page, /class="resultSheet"/);
  assert.doesNotMatch(page, /v-for="item in recentMediaResults"/);
  assert.doesNotMatch(page, /openSystemAlbumPlaceholder\(\)/);
  assert.doesNotMatch(page, /系统相册跳转占位/);
  assert.match(page, /xyc-markvideo/);
  assert.match(page, /<text class="cameraIcon">印<\/text>/);
  assert.match(page, /class="watermarkLayer"/);
  assert.match(page, /class="watermarkPinchVisualLayer"/);
  assert.match(page, /<view class="watermarkPinchVisualLayer" :style="watermarkLayerStyleValue\(\)" v-if="activeWatermark != null && watermarkPinchActive\(\)">/);
  const watermarkLayerStyleBlock = findStyleBlock(page, '.watermarkLayer');
  const gesturePlaneStyleBlock = findStyleBlock(page, '.watermarkGesturePlane');
  const pinchVisualLayerStyleBlock = findStyleBlock(page, '.watermarkPinchVisualLayer');
  const dragSurfaceStyleBlock = findStyleBlock(page, '.watermarkDragSurface');
  assert.match(watermarkLayerStyleBlock, /z-index: 4;/);
  assert.match(pinchVisualLayerStyleBlock, /z-index: 3;/);
  assert.doesNotMatch(gesturePlaneStyleBlock, /background-color|opacity/);
  assert.match(page, /class="watermarkDelete"/);
  assert.match(page, /class="watermarkRotate"/);
  assert.match(page, /@click\.stop="rotateWatermarkQuarterTurn"/);
  assert.match(page, /class="watermarkRotateText"/);
  assert.match(page, /class="watermarkResize"/);
  assert.match(watermarkArea, /class="watermarkGesturePlane"/);
  assert.match(watermarkArea, /class="watermarkGesturePlane"[\s\S]*<view[\s\S]*v-if="!watermarkPinchActive\(\)"[\s\S]*class="watermarkTransformBox"/);
  assert.doesNotMatch(watermarkArea, /class="watermarkContent"[\s\S]*v-if="watermarkPinchActive\(\)"/);
  const pinchVisualLayer = findTagBlock(page, '<view class="watermarkPinchVisualLayer"', 'view');
  assert.notEqual(pinchVisualLayer, '', 'pinch visual overlay should be inspectable');
  assert.match(pinchVisualLayer, /class="watermarkTransformBox"/);
  assert.match(pinchVisualLayer, /class="watermarkContent"/);
  assert.match(pinchVisualLayer, /class="watermarkDelete"/);
  assert.match(pinchVisualLayer, /class="watermarkRotate"/);
  assert.match(pinchVisualLayer, /class="watermarkResize"/);
  assert.doesNotMatch(pinchVisualLayer, /<movable-view/);
  assert.doesNotMatch(pinchVisualLayer, /class="watermarkDragSurface"/);
  assert.match(watermarkTransformBox, /class="watermarkContent"/);
  assert.match(watermarkArea, /class="watermarkContent"[\s\S]*class="watermarkDragSurface"[\s\S]*class="watermarkDelete"[\s\S]*class="watermarkRotate"[\s\S]*class="watermarkResize"/);
  assert.match(watermarkTransformBox, /class="watermarkDelete"/);
  assert.match(watermarkTransformBox, /class="watermarkRotate"/);
  assert.match(watermarkTransformBox, /class="watermarkResize"/);
  assert.match(page, /class="watermarkContent"/);
  assert.match(page, /class="watermarkDragSurface"/);
  assert.match(page, /:style="watermarkDragSurfaceStyleValue\(\)"/);
  assert.match(watermarkArea, /class="watermarkDragSurface"[\s\S]*@touchstart\.stop="startWatermarkTouch"[\s\S]*@touchmove\.stop="moveWatermarkTouch"[\s\S]*@touchend\.stop="finishWatermarkTouch"[\s\S]*@touchcancel\.stop="finishWatermarkTouch"/);
  assert.match(watermarkArea, /class="watermarkResize"[\s\S]*:style="watermarkResizeStyleValue\(\)"[\s\S]*@touchstart\.stop="stopWatermarkTouch"[\s\S]*@touchmove\.stop="stopWatermarkTouch"[\s\S]*@touchend\.stop="stopWatermarkTouch"[\s\S]*@touchcancel\.stop="stopWatermarkTouch"/);
  assert.match(page, /watermarkDragSurfaceStyleValue\(\) \{[\s\S]*left: WATERMARK_HANDLE_PAD \+ 'px'[\s\S]*top: WATERMARK_HANDLE_PAD \+ 'px'[\s\S]*right: WATERMARK_HANDLE_PAD \+ 'px'[\s\S]*bottom: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(dragSurfaceStyleBlock, /position: absolute;/);
  assert.match(dragSurfaceStyleBlock, /background-color: rgba\(255, 255, 255, 0\.01\);/);
  assert.match(dragSurfaceStyleBlock, /z-index: 2;/);
  assert.doesNotMatch(page, /@longpress\.stop="startWatermarkDrag"/);
  assert.match(page, /class="watermarkSheet"/);
  assert.match(page, /class="watermarkPreview"/);
  const visibleFrameBody = page.match(/watermarkVisibleFrame\(\)(?:: WatermarkFrame)? \{[\s\S]*?\n    \},\n    watermarkInteractionFrame/)?.[0] || '';
  assert.match(page, /if \(this\.activeWatermark != null && !await this\.flushWatermarkSync\(true\)\) \{[\s\S]*return[\s\S]*nativeCamera\.takePhoto\(\)/);
  assert.match(page, /if \(this\.activeWatermark != null && !await this\.flushWatermarkSync\(true\)\) \{[\s\S]*return[\s\S]*nativeCamera\.startRecord\(\{ fps: this\.targetFps \}\)/);
  assert.match(page, /modeThumbClass/);
  assert.doesNotMatch(page, /videoModeButtonClass/);
  assert.doesNotMatch(page, /photoModeButtonClass/);
  assert.doesNotMatch(page, /modeThumbText/);
  assert.match(page, /<text :class="videoModeTextClass">视频<\/text>/);
  assert.match(page, /<text :class="photoModeTextClass">照片<\/text>/);
  assert.match(page, /videoModeTextClass/);
  assert.match(page, /photoModeTextClass/);
  assert.match(page, /shutterCoreClass/);
  assert.doesNotMatch(page, /recordStopCoreClass/);
  assert.doesNotMatch(page, /recordStopCore/);
  assert.match(page, /watermarkDelete/);
  assert.match(page, /const WATERMARK_HANDLE_PAD = 30/);
  assert.match(page, /const WATERMARK_HANDLE_SIZE = 42/);
  assert.match(page, /const WATERMARK_HANDLE_INSET = 9/);
  assert.match(page, /watermarkLayerStyle\(\) \{[\s\S]*const layerBounds = this\.watermarkLayerBounds\(\)[\s\S]*width: Math\.round\(layerBounds\.right - layerBounds\.left\) \+ 'px'/);
  assert.match(page, /watermarkEditBounds\(\)(?:: CameraViewportBounds)? \{[\s\S]*return this\.cameraViewportBounds\(\)/);
  assert.match(page, /watermarkLayerBounds\(\)(?:: WatermarkBounds)? \{[\s\S]*const editBounds = this\.watermarkEditBounds\(\)[\s\S]*left: editBounds\.left - WATERMARK_HANDLE_PAD[\s\S]*bottom: editBounds\.bottom \+ WATERMARK_HANDLE_PAD/);
  assert.match(page, /applyWatermarkTemplate\(template(?:: WatermarkTemplate)?\)(?:: void)? \{[\s\S]*const viewport = this\.cameraViewportBounds\(\)[\s\S]*const initialLeft = viewport\.left \+ viewport\.width \* safeNumber\(nextTemplate\.positionX, 0\.12\)[\s\S]*const initialTop = viewport\.top \+ viewport\.height \* safeNumber\(nextTemplate\.positionY, 0\.16\)/);
  assert.match(page, /buildNativeWatermarkPayload\(\)(?:: Promise<WatermarkTemplate>)? \{[\s\S]*const viewport = this\.cameraViewportBounds\(\)[\s\S]*const payloadLeft = this\.clampNumber\(frame\.left, viewport\.left, viewport\.right - effectiveWidth\)[\s\S]*template\.positionX = \(payloadLeft - viewport\.left\) \/ viewport\.width[\s\S]*template\.previewHeight = viewport\.height/);
  assert.doesNotMatch(page, /\.watermarkGesturePlane \{[\s\S]*overflow: visible;/);
  assert.doesNotMatch(page, /\.watermarkTransformBox \{[\s\S]*overflow: visible;/);
  assert.match(page, /watermarkBoxStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*width: Math\.round\(metrics\.containerWidth\) \+ 'px'[\s\S]*height: Math\.round\(metrics\.containerHeight\) \+ 'px'/);
  assert.match(page, /watermarkTransformStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*const scaleRatio = this\.watermarkPinchScaleRatio\(\)[\s\S]*left: Math\.round\(metrics\.transformLeft\) \+ 'px'[\s\S]*top: Math\.round\(metrics\.transformTop\) \+ 'px'/);
  assert.match(page, /transformOrigin: '50% 50%'/);
  assert.match(page, /transform: 'rotate\(' \+ frame\.rotation \+ 'deg\) scale\(' \+ scaleRatio \+ '\)'/);
  assert.match(page, /watermarkImageStyle\(\) \{[\s\S]*width: Math\.round\(this\.activeWatermark\.imageWidth \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px'[\s\S]*height: Math\.round\(this\.activeWatermark\.imageHeight \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px'[\s\S]*marginRight: this\.watermarkHasText \? Math\.round\(this\.activeWatermark\.imageTextGap \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px' : '0px'/);
  assert.doesNotMatch(page, /transform: 'scaleY\(-1\)'/);
  assert.doesNotMatch(page, /transformOrigin: '0% 0%'/);
  assert.match(page, /:style="watermarkDeleteStyleValue\(\)"/);
  assert.match(page, /:style="watermarkRotateStyleValue\(\)"/);
  assert.match(page, /:style="watermarkResizeStyleValue\(\)"/);
  assert.match(page, /watermarkRotateStyle\(\) \{[\s\S]*return this\.watermarkControlStyle\(WATERMARK_HANDLE_INSET, WATERMARK_HANDLE_INSET\)/);
  assert.match(page, /watermarkDeleteStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*metrics\.boxWidth - WATERMARK_HANDLE_INSET - WATERMARK_HANDLE_SIZE[\s\S]*WATERMARK_HANDLE_INSET/);
  assert.match(page, /watermarkResizeStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*metrics\.boxWidth - WATERMARK_HANDLE_INSET - WATERMARK_HANDLE_SIZE[\s\S]*metrics\.boxHeight - WATERMARK_HANDLE_INSET - WATERMARK_HANDLE_SIZE/);
  assert.match(page, /watermarkControlStyle\(left(?:: number)?, top(?:: number)?\)(?:: UTSJSONObject)? \{[\s\S]*left: Math\.round\(left\) \+ 'px'[\s\S]*top: Math\.round\(top\) \+ 'px'/);
  assert.match(page, /watermarkControlTextStyle\(\) \{[\s\S]*const frame = this\.watermarkLayoutFrame\(\)[\s\S]*transform: 'rotate\(' \+ \(-frame\.rotation\) \+ 'deg\)'/);
  assert.match(page, /:style="watermarkControlTextStyleValue\(\)"/);
  assert.match(page, /left: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /top: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /right: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /bottom: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(page, /watermarkResize/);
  assert.match(page, /<view class="watermarkResizeGlyph" :style="watermarkControlTextStyleValue\(\)">/);
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
  assert.match(page, /startWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.match(page, /moveWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.match(page, /finishWatermarkTouch\(event(?:: UniTouchEvent \| null)?\)(?:: void)?/);
  assert.match(page, /watermarkTouchPair\(event(?:: UniTouchEvent \| null)?, includeChangedTouches(?:: boolean)?\)/);
  assert.match(page, /pickMoveNumber\(source(?:: any \| null)?, name(?:: string)?\)/);
  assert.match(page, /startWatermarkMove\(event(?:: UniTouchEvent \| null)?\)/);
  assert.match(page, /startWatermarkMove\(event(?:: UniTouchEvent \| null)?\)(?:: void)? \{[\s\S]*if \(this\.pickTouchSource\(event\) == null\) \{[\s\S]*return[\s\S]*\}[\s\S]*const point = this\.touchPoint\(event\)/);
  assert.match(page, /updateWatermarkMove\(event(?:: UniTouchEvent \| null)?\)/);
  assert.match(page, /watermarkMoveActive: false/);
  assert.match(page, /watermarkMoveDraft: null/);
  assert.match(page, /watermarkDragGesture: null/);
  assert.match(page, /this\.watermarkDragGesture = \{[\s\S]*startX: point\.x,[\s\S]*startY: point\.y,[\s\S]*originX: this\.watermarkMovePosition\.x,[\s\S]*originY: this\.watermarkMovePosition\.y/);
  assert.match(page, /watermarkTransitionDisabled: false/);
  assert.match(page, /watermarkTransitionTimer: null/);
  assert.match(page, /const moveX = this\.pickMoveNumber\(detail, 'x'\)/);
  assert.match(page, /const moveY = this\.pickMoveNumber\(detail, 'y'\)/);
  assert.match(page, /this\.watermarkMoveDraft = \{[\s\S]*x: moveX,[\s\S]*y: moveY/);
  assert.match(page, /commitWatermarkMoveDraft\(flushNow(?:: boolean)?\)/);
  assert.match(page, /watermarkVisibleFrame\(\)(?:: WatermarkFrame)? \{/);
  assert.match(page, /watermarkInteractionFrame\(\)(?:: WatermarkFrame)? \{/);
  assert.match(page, /watermarkFrameFromMovePosition\(moveX(?:: number)?, moveY(?:: number)?, frame(?:: WatermarkFrame \| null)?\)(?:: WatermarkPosition)? \{/);
  assert.match(page, /const nextCenterX = layerBounds\.left \+ moveX \+ metrics\.containerWidth \/ 2/);
  assert.match(page, /left: nextCenterX - metrics\.contentWidth \/ 2/);
  assert.notEqual(visibleFrameBody, '', 'watermarkVisibleFrame body should be inspectable');
  assert.match(visibleFrameBody, /return this\.watermarkFrame/);
  assert.doesNotMatch(visibleFrameBody, /watermarkMoveDraft/);
  assert.match(page, /buildNativeWatermarkPayload\(\)(?:: Promise<WatermarkTemplate>)? \{[\s\S]*const frame = this\.watermarkInteractionFrame\(\)/);
  assert.match(page, /watermarkInteractionFrame\(\)(?:: WatermarkFrame)? \{[\s\S]*const pinchFrame = this\.watermarkPinchPreviewFrame\(\)[\s\S]*if \(pinchFrame != null\) \{[\s\S]*return pinchFrame[\s\S]*if \(this\.watermarkMoveDraft != null && this\.activeWatermark != null\) \{[\s\S]*const movedFrame = this\.watermarkFrameFromMovePosition\(this\.watermarkMoveDraft\.x, this\.watermarkMoveDraft\.y, this\.watermarkFrame\)[\s\S]*left: movedFrame\.left[\s\S]*top: movedFrame\.top[\s\S]*scale: this\.watermarkFrame\.scale[\s\S]*rotation: this\.watermarkFrame\.rotation/);
  assert.match(page, /startWatermarkPinch\(touchPair(?:: WatermarkTouchPair)?\)(?:: void)? \{[\s\S]*const distance = this\.pinchDistance\(touchPair\)[\s\S]*this\.commitWatermarkMoveDraft\(false\)[\s\S]*this\.clearWatermarkSyncTimer\(\)[\s\S]*const startFrame(?:: WatermarkFrame)? = \{[\s\S]*startScale: startFrame\.scale[\s\S]*previewScaleRatio: 1[\s\S]*commitFrame: null/);
  assert.match(page, /buildWatermarkPinchUpdate\(touchPair(?:: WatermarkTouchPair)?\)(?:: WatermarkPinchUpdate \| null)? \{[\s\S]*const gesture = this\.watermarkPinchGesture[\s\S]*const ratio = distance \/ gesture\.startDistance[\s\S]*const rawScale = gesture\.startScale \* ratio[\s\S]*previewScaleRatio: clamped\.scale \/ gesture\.startScale[\s\S]*commitFrame: \{/);
  assert.match(page, /const WATERMARK_PINCH_FRAME_INTERVAL_MS = 16/);
  assert.match(page, /pendingFrame: null/);
  assert.match(page, /lastUpdateAt: 0/);
  assert.match(page, /now - gesture\.lastUpdateAt < WATERMARK_PINCH_FRAME_INTERVAL_MS/);
  assert.match(page, /finishWatermarkPinch\(\) \{[\s\S]*activeGesture\.pendingFrame[\s\S]*this\.applyWatermarkPinchUpdate\(activeGesture\.pendingFrame, Date\.now\(\)\)/);
  const moveChangeBody = page.match(/handleWatermarkMoveChange\(event(?:: UTSJSONObject \| null)?\)(?:: void)? \{[\s\S]*?\n    \},\n    watermarkMoveEventDetail/)?.[0] || '';
  const moveDetailBody = page.match(/watermarkMoveEventDetail\(event(?:: UTSJSONObject \| null)?\)(?:: UTSJSONObject)? \{[\s\S]*?\n    \},\n    commitWatermarkMoveDraft/)?.[0] || '';
  assert.notEqual(moveChangeBody, '', 'handleWatermarkMoveChange body should be inspectable');
  assert.notEqual(moveDetailBody, '', 'watermarkMoveEventDetail body should be inspectable');
  assert.match(moveChangeBody, /const detail = this\.watermarkMoveEventDetail\(event\)/);
  assert.match(moveDetailBody, /const detail = event\['detail'\]/);
  assert.match(moveDetailBody, /return detail as UTSJSONObject/);
  assert.match(moveDetailBody, /return event/);
  assert.doesNotMatch(moveChangeBody, /updateWatermarkFrame|scheduleWatermarkSync|syncWatermarkToNative|flushWatermarkSync/);
  assert.match(moveChangeBody, /if \(!this\.watermarkMoveActive\) \{[\s\S]*return[\s\S]*\}/);
  assert.doesNotMatch(moveChangeBody, /isWatermarkTouchMoveSource/);
  assert.doesNotMatch(moveChangeBody, /this\.watermarkMoveActive = true/);
  const pinchMoveBody = page.match(/updateWatermarkPinch\(touchPair(?:: WatermarkTouchPair)?\)(?:: void)? \{[\s\S]*?finishWatermarkPinch\(\) \{/)?.[0] || '';
  assert.doesNotMatch(pinchMoveBody, /updateWatermarkFrame|scheduleWatermarkSync|syncWatermarkToNative|flushWatermarkSync/);
  assert.match(page, /if \(this\.watermarkPinchGesture != null\) \{[\s\S]*this\.watermarkMoveActive = false[\s\S]*this\.watermarkMoveDraft = null[\s\S]*return/);
  assert.match(page, /const traceFrame = this\.watermarkPinchPreviewFrame\(\)[\s\S]*traceWatermarkGeometry\('pinch-native-change', traceFrame != null \? traceFrame : this\.watermarkFrame, \{[\s\S]*nativeX: moveX,[\s\S]*nativeY: moveY/);
  assert.match(page, /finishWatermarkMove\(\) \{[\s\S]*this\.commitWatermarkMoveDraft\(true\)/);
  assert.doesNotMatch(page, /@touchstart\.stop="startWatermarkResize"/);
  assert.doesNotMatch(page, /@touchmove\.stop="moveWatermark"/);
  assert.match(page, /rotateWatermarkQuarterTurn\(\) \{[\s\S]*const nextRotation = normalizeRotation\(this\.watermarkFrame\.rotation \+ 90\)[\s\S]*const clamped = this\.clampWatermarkFrame\([\s\S]*this\.flushWatermarkSync\(false\)/);
  assert.match(page, /\.watermarkRotate \{[\s\S]*width: 42px;[\s\S]*height: 42px;[\s\S]*border-radius: 21px;/);
  assert.match(page, /\.watermarkRotateText \{[\s\S]*width: 42px;[\s\S]*height: 42px;[\s\S]*font-size: 21px;[\s\S]*line-height: 42px;/);
  assert.match(page, /this\.updateWatermarkFrame\(\{[\s\S]*left: clamped\.left[\s\S]*top: clamped\.top[\s\S]*rotation: clamped\.rotation/);
  assert.match(page, /const maxScale = this\.maxWatermarkScale\(nextLeft, nextTop, gesture\.rotation, gesture\.width, gesture\.height\)/);
  assert.match(page, /scheduleWatermarkSync\(\) \{[\s\S]*setTimeout\(\(\) => \{[\s\S]*this\.syncWatermarkToNative\(false\)[\s\S]*\}, 160\)/);
  assert.match(page, /flushWatermarkSync\(showError(?:: boolean)?\)(?:: Promise<boolean>)? \{[\s\S]*this\.clearWatermarkSyncTimer\(\)[\s\S]*this\.syncWatermarkToNative\(showError\)/);
  assert.match(page, /finishWatermarkPinch\(\) \{[\s\S]*const commitFrame = gesture != null \? gesture\.commitFrame : null[\s\S]*if \(changed && commitFrame != null && gesture != null\) \{[\s\S]*this\.traceWatermarkGeometry\('pinch-commit', traceFrame, null\)[\s\S]*this\.updateWatermarkFrame\(\{[\s\S]*left: commitFrame\.left[\s\S]*rotation: commitFrame\.rotation[\s\S]*\}\)[\s\S]*this\.flushWatermarkSync\(false\)/);
  assert.match(page, /clearWatermarkSyncTimer\(\) \{[\s\S]*const timer = this\.watermarkSyncTimer[\s\S]*clearTimeout\(timer\)/);
  assert.match(page, /watermarkSyncTimer: null/);
  assert.match(page, /this\.watermarkSyncVersion \+= 1/);
  assert.match(page, /watermarkEditBounds\(\)(?:: CameraViewportBounds)? \{/);
  assert.match(page, /watermarkBoxMetrics\(width(?:: number)?, height(?:: number)?, scale(?:: number)?, rotation(?:: number)?\)(?:: WatermarkMetrics)? \{/);
  assert.match(page, /const boxWidth = contentSize\.width \+ WATERMARK_HANDLE_PAD \* 2/);
  assert.match(page, /const bounds = this\.watermarkRotatedBounds\(boxWidth, boxHeight, rotation\)/);
  assert.match(page, /const containerWidth = Math\.max\(1, bounds\.width, boxWidth\)/);
  assert.match(page, /const containerHeight = Math\.max\(1, bounds\.height, boxHeight\)/);
  assert.match(page, /transformLeft: \(containerWidth - boxWidth\) \/ 2/);
  assert.doesNotMatch(page, /rotatedLeft: \(containerWidth - bounds\.width\) \/ 2/);
  assert.doesNotMatch(page, /rotatedTop: \(containerHeight - bounds\.height\) \/ 2/);
  assert.match(page, /watermarkRotatedBounds\(width(?:: number)?, height(?:: number)?, rotation(?:: number)?\)(?:: WatermarkSize)? \{/);
  assert.match(page, /clampCenterBySize\(center(?:: number)?, minEdge(?:: number)?, maxEdge(?:: number)?, size(?:: number)?\)(?:: number)? \{/);
  assert.match(page, /clampWatermarkFrame\(left(?:: number)?, top(?:: number)?, scale(?:: number)?, rotation(?:: number)?, width(?:: number \| null = null)?, height(?:: number \| null = null)?\)(?:: WatermarkClampResult)? \{/);
  assert.match(page, /const metrics = this\.watermarkBoxMetrics\(frameWidth, frameHeight, nextScale, nextRotation\)/);
  assert.match(page, /const clampedCenterX = this\.clampCenterBySize\(centerX, layerBounds\.left, layerBounds\.right, metrics\.containerWidth\)/);
  assert.match(page, /const clampedCenterY = this\.clampCenterBySize\(centerY, layerBounds\.top, layerBounds\.bottom, metrics\.containerHeight\)/);
  assert.match(page, /const contentLeft = this\.clampNumber\(clampedCenterX - size\.width \/ 2, editBounds\.left, editBounds\.right - size\.width\)/);
  assert.match(page, /const contentTop = this\.clampNumber\(clampedCenterY - size\.height \/ 2, editBounds\.top, editBounds\.bottom - size\.height\)/);
  assert.match(page, /x: roundWatermarkPx\(center\.x - metrics\.containerWidth \/ 2 - layerBounds\.left\)/);
  assert.match(page, /y: roundWatermarkPx\(center\.y - metrics\.containerHeight \/ 2 - layerBounds\.top\)/);
	  assert.doesNotMatch(page, /watermarkResizeAnchor\(frame\) \{/);
	  assert.match(page, /const WATERMARK_MIN_SCALE = 0\.55/);
	  assert.match(page, /const WATERMARK_ABSOLUTE_MIN_SCALE = 0\.28/);
	  assert.match(page, /const WATERMARK_MAX_SCALE = 2\.2/);
	  assert.match(page, /const WATERMARK_PINCH_MIN_DISTANCE = 8/);
	  assert.match(page, /Math\.min\(WATERMARK_MIN_SCALE, maxScale\)/);
	  assert.match(page, /watermarkPinchGesture: null/);
		  assert.match(page, /watermarkTouchPair\(event(?:: UniTouchEvent \| null)?, includeChangedTouches(?:: boolean)?\)(?:: WatermarkTouchPair \| null)? \{/);
		  assert.match(page, /touchPointFromSource\(touch(?:: UniTouch \| null)?\)(?:: WatermarkPoint)? \{/);
		  assert.match(page, /pickTouchCoordinate\(touch(?:: UniTouch \| null)?, names(?:: Array<string>)?\)(?:: number)? \{/);
		  const touchPairBody = page.match(/watermarkTouchPair\(event(?:: UniTouchEvent \| null)?, includeChangedTouches(?:: boolean)?\)(?:: WatermarkTouchPair \| null)? \{[\s\S]*?\n    \},\n    touchPointFromSource/)?.[0] || '';
		  assert.notEqual(touchPairBody, '', 'watermarkTouchPair body should be inspectable');
		  assert.doesNotMatch(touchPairBody, /eventDetail\(event\)|event as UTSJSONObject|touch as UTSJSONObject/);
		  const touchPointBody = page.match(/touchPoint\(event(?:: UniTouchEvent \| null)?\)(?:: WatermarkPoint)? \{[\s\S]*?\n    \},\n    cameraViewportBounds/)?.[0] || '';
		  assert.notEqual(touchPointBody, '', 'touchPoint body should be inspectable');
		  assert.doesNotMatch(touchPointBody, /eventDetail\(event\)|event as UTSJSONObject|touch as UTSJSONObject/);
		  assert.doesNotMatch(touchPointBody, /pickTouchNumber|touchSource\[name\]|source\[names\[i\]\]/);
		  const touchCoordinateBody = page.match(/pickTouchCoordinate\(touch(?:: UniTouch \| null)?, names(?:: Array<string>)?\)(?:: number)? \{[\s\S]*?\n    \},\n    pinchDistance/)?.[0] || '';
		  assert.notEqual(touchCoordinateBody, '', 'pickTouchCoordinate body should be inspectable');
		  assert.doesNotMatch(touchCoordinateBody, /touchSource\[name\]|source\[names\[i\]\]|as UTSJSONObject/);
		  assert.match(touchCoordinateBody, /touch\.pageX[\s\S]*touch\.clientX[\s\S]*touch\.screenX[\s\S]*touch\.pageY[\s\S]*touch\.clientY[\s\S]*touch\.screenY/);
		  assert.match(page, /pinchDistance\(touchPair(?:: WatermarkTouchPair)?\)(?:: number)? \{/);
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
  assert.match(page, /return Math\.max\(WATERMARK_ABSOLUTE_MIN_SCALE, Math\.min\(WATERMARK_MAX_SCALE, maxWidthScale, maxHeightScale, contentMaxWidthScale, contentMaxHeightScale\)\)/);
  assert.doesNotMatch(page, /anchorX: anchor\.x/);
  assert.doesNotMatch(page, /nextAngle/);
  assert.doesNotMatch(page, /frameRotation: frame\.rotation/);
  assert.doesNotMatch(page, /angleBetween/);
  assert.doesNotMatch(page, /centerX: center\.x/);
  assert.match(page, /function roundWatermarkPx\(value(?:: number)?\)(?:: number)? \{[\s\S]*return Math\.round\(value \* 1000\) \/ 1000/);
  assert.doesNotMatch(page, /watermarkGestureTimer/);
  assert.match(page, /classes\.push\('shutterRecording'\)/);
  assert.doesNotMatch(page, /:class="\{/);
  assert.match(page, /width: 76px/);
  assert.match(page, /class="modeSwitch"/);
  assert.match(page, /width: 176px/);
  assert.match(page, /\.cameraSoundTapArea \{[\s\S]*left: 22px;[\s\S]*top: -3px;[\s\S]*width: 64px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.match(page, /\.cameraSoundPill \{[\s\S]*width: 64px;[\s\S]*height: 36px;[\s\S]*border-radius: 18px;[\s\S]*background-color: rgba\(255, 255, 255, 0\.9\);[\s\S]*border-color: rgba\(255, 255, 255, 0\.72\);/);
  assert.match(page, /\.cameraSoundPillActive \{[\s\S]*background-color: #ff8a00;[\s\S]*border-color: #ff8a00;/);
  assert.match(page, /\.cameraSoundIcon \{[\s\S]*width: 18px;[\s\S]*height: 36px;[\s\S]*justify-content: center;[\s\S]*\}/);
  assert.match(page, /\.cameraSoundIconText \{[\s\S]*width: 18px;[\s\S]*height: 36px;[\s\S]*color: #111917;[\s\S]*font-size: 17px;[\s\S]*line-height: 35px;/);
  assert.match(page, /\.cameraSoundText \{[\s\S]*width: 36px;[\s\S]*color: #111917;[\s\S]*line-height: 36px;/);
  assert.match(page, /\.cameraSoundTextActive \{[\s\S]*color: #ffffff;/);
  assert.match(page, /modeTextSelected/);
  assert.match(page, /background-color: rgba\(255, 255, 255, 0\.78\)/);
  assert.match(bottomPanelStyle, /background-color: #e2e6e4;/);
  assert.doesNotMatch(bottomPanelStyle, /rgba/);
  assert.match(page, /background-color: rgba\(255, 255, 255, 0\.42\)/);
  assert.match(page, /border-color: rgba\(255, 255, 255, 0\.86\)/);
  assert.match(page, /\.shutterCore \{[\s\S]*background-color: #ffffff;/);
  assert.match(page, /background-color: rgba\(17, 25, 23, 0\.08\)/);
  assert.match(page, /:class="modeThumbClass"/);
  assert.doesNotMatch(page, /class="modeThumbText"/);
  assert.match(page, /<text :class="videoModeTextClass">视频<\/text>/);
  assert.match(page, /<text :class="photoModeTextClass">照片<\/text>/);
  assert.match(page, /modeThumbClass\(\) \{[\s\S]*return this\.mode == 'video' \? \['modeThumb', 'modeThumbVideo'\] : \['modeThumb', 'modeThumbPhoto'\]/);
  assert.match(page, /videoModeTextClass\(\) \{[\s\S]*return this\.mode == 'video' \? \['modeText', 'modeTextSelected'\] : \['modeText'\]/);
  assert.match(page, /photoModeTextClass\(\) \{[\s\S]*return this\.mode == 'photo' \? \['modeText', 'modeTextSelected'\] : \['modeText'\]/);
  const modeSwitchStyle = page.match(/\.modeSwitch \{[\s\S]*?\n\}/)?.[0] || '';
  const modeTextStyle = page.match(/\.modeText \{[\s\S]*?\n\}/)?.[0] || '';
  assert.notEqual(modeSwitchStyle, '', 'modeSwitch style block should be inspectable');
  assert.notEqual(modeTextStyle, '', 'modeText style block should be inspectable');
  assert.match(page, /\.modeSwitch \{[\s\S]*width: 176px;[\s\S]*height: 36px;/);
  for (const selector of ['.backButton', '.flashPill', '.switchCameraButton', '.cameraSoundPill', '.zoomButton']) {
    const pillStyle = findStyleBlock(page, selector);
    assert.match(pillStyle, /height: 36px;/, `${selector} should match modeSwitch height`);
    assert.match(pillStyle, /border-radius: 18px;/, `${selector} should keep modeSwitch capsule radius`);
  }
  assert.match(page, /\.zoomText \{[\s\S]*height: 36px;[\s\S]*line-height: 36px;/);
  assert.doesNotMatch(modeSwitchStyle, /padding:/);
  assert.match(page, /\.modeThumb \{[\s\S]*position: absolute;[\s\S]*left: 3px;[\s\S]*top: 2px;[\s\S]*width: 78px;[\s\S]*height: 30px;[\s\S]*border-radius: 15px;[\s\S]*background-color: #ff8a00;[\s\S]*transition-property: transform;[\s\S]*transition-duration: 260ms;[\s\S]*z-index: 0;/);
  assert.doesNotMatch(page, /\.modeThumbText \{/);
  assert.match(page, /\.modeThumbVideo \{[\s\S]*transform: translateX\(0px\);/);
  assert.match(page, /\.modeThumbPhoto \{[\s\S]*transform: translateX\(88px\);/);
  assert.match(page, /\.modeButton \{[\s\S]*position: relative;[\s\S]*width: 88px;[\s\S]*height: 36px;[\s\S]*z-index: 1;/);
  assert.match(modeTextStyle, /position: relative;[\s\S]*width: 88px;[\s\S]*height: 20px;[\s\S]*font-weight: 600;[\s\S]*line-height: 20px;/);
  assert.doesNotMatch(modeTextStyle, /transform:/);
  assert.match(page, /\.modeTextSelected \{[\s\S]*color: #ffffff;/);
  assert.doesNotMatch(page, /modeSelected/);
  assert.match(page, /\.flashPillActive \{[\s\S]*background-color: #ff8a00;[\s\S]*border-color: #ff8a00;/);
  assert.match(page, /\.flashTextActive \{[\s\S]*color: #ffffff;/);
  assert.match(page, /\.flashTapArea \{[\s\S]*width: 64px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.match(page, /\.topSide \{[\s\S]*width: 64px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.match(page, /\.backButton \{[\s\S]*width: 64px;[\s\S]*height: 36px;[\s\S]*border-radius: 18px;/);
  assert.match(page, /\.flashPill \{[\s\S]*width: 64px;[\s\S]*height: 36px;[\s\S]*border-radius: 18px;/);
  assert.match(page, /\.switchCameraTapArea \{[\s\S]*width: 64px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.match(page, /\.switchCameraButton \{[\s\S]*width: 64px;[\s\S]*height: 36px;[\s\S]*border-radius: 18px;/);
  assert.match(page, /<view class="zoomRail" :style="zoomRailStyle">/);
  assert.doesNotMatch(page, /\.zoomRail \{[\s\S]*bottom: 188px;/);
  assert.match(page, /\.cameraViewport \{[\s\S]*position: absolute;[\s\S]*overflow: hidden;[\s\S]*background-color: #0b100e;[\s\S]*z-index: 1;/);
  const nativePreviewStyleBlock = findStyleBlock(page, '.nativePreview');
  assert.match(nativePreviewStyleBlock, /position: absolute;/);
  assert.match(nativePreviewStyleBlock, /background-color: #0b100e;/);
  assert.match(nativePreviewStyleBlock, /z-index: 2;/);
  assert.doesNotMatch(nativePreviewStyleBlock, /width: 100%|height: 100%|left: 0|top: 0/);
  assert.match(page, /\.topBar \{[\s\S]*z-index: 8;/);
  assert.match(page, /\.zoomRail \{[\s\S]*z-index: 6;/);
  assert.match(page, /\.cameraDebugBorder \{[\s\S]*border: 1px red solid;[\s\S]*pointer-events: none;[\s\S]*z-index: 7;/);
  assert.match(page, /\.zoomButtonSelected \{[\s\S]*background-color: #ff8a00;[\s\S]*border-color: #ff8a00;/);
  assert.match(page, /\.zoomTextSelected \{[\s\S]*color: #ffffff;/);
  assert.match(page, /\.topTitleBox \{[\s\S]*position: absolute;[\s\S]*left: 0;[\s\S]*right: 0;[\s\S]*top: 16px;[\s\S]*height: 42px;[\s\S]*justify-content: center;/);
  assert.match(page, /\.topSide \{[\s\S]*position: absolute;[\s\S]*left: 14px;[\s\S]*top: 16px;/);
  assert.match(page, /\.topRightSide \{[\s\S]*position: absolute;[\s\S]*right: 14px;[\s\S]*top: 16px;/);
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
  assert.match(page, /if \(errorCode === '1501'\)/);
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

test('watermark edit handle centers sit on the content corners', () => {
  const frame = {
    left: 84,
    top: 212,
    width: 240,
    height: 96,
    scale: 1,
  };
  const centers = testWatermarkHandleScreenCenters(frame, 0);

  assertClose(centers.rotate.x, frame.left, 'rotate handle should sit on top-left corner x');
  assertClose(centers.rotate.y, frame.top, 'rotate handle should sit on top-left corner y');
  assertClose(centers.delete.x, frame.left + frame.width * frame.scale, 'delete handle should sit on top-right corner x');
  assertClose(centers.delete.y, frame.top, 'delete handle should sit on top-right corner y');
  assertClose(centers.resize.x, frame.left + frame.width * frame.scale, 'resize handle should sit on bottom-right corner x');
  assertClose(centers.resize.y, frame.top + frame.height * frame.scale, 'resize handle should sit on bottom-right corner y');
});

test('watermark pinch scale follows two-finger distance', () => {
  assertPinchScaleIsDirectional();
});

test('camera viewport keeps a full-width 3:4 area below the top controls', () => {
  const tallViewport = testCameraViewportBounds(375, 812);
  const tallPanel = testCameraBottomPanelBounds(375, 812);
  assertClose(tallViewport.left, 0, 'tall viewport should use full width');
  assertClose(tallViewport.width, 375, 'tall viewport width');
  assertClose(tallViewport.height, 500, 'tall viewport height');
  assertClose(tallViewport.width / tallViewport.height, 3 / 4, 'tall viewport aspect');
  assertClose(tallViewport.left, (375 - tallViewport.width) / 2, 'tall viewport horizontal centering');
  assertClose(tallViewport.top, testCameraTopBarHeight, 'tall viewport should start below top controls');
  assertClose(tallPanel.top, tallViewport.bottom, 'bottom panel should start after the camera viewport');
  assertClose(tallPanel.height, 252, 'tall bottom panel uses remaining safe area');

  const shortViewport = testCameraViewportBounds(375, 667);
  const shortPanel = testCameraBottomPanelBounds(375, 667);
  assertClose(shortViewport.width, 375, 'short viewport should use full width');
  assertClose(shortViewport.height, 500, 'short viewport keeps 3:4 full-width height');
  assertClose(shortViewport.left, 0, 'short viewport should fill horizontally');
  assertClose(shortViewport.top, testCameraTopBarHeight, 'short viewport should start below top controls');
  assertClose(shortViewport.width / shortViewport.height, 3 / 4, 'short viewport aspect');
  assertClose(shortViewport.left, (375 - shortViewport.width) / 2, 'short viewport horizontal centering');
  assertClose(shortPanel.top, shortViewport.bottom, 'short bottom panel should start after the camera viewport');
  assertClose(shortPanel.height, 107, 'short bottom panel uses remaining compact safe area');

  const compactViewport = testCameraViewportBounds(320, 568);
  const compactPanel = testCameraBottomPanelBounds(320, 568);
  assertClose(compactViewport.width, 320, 'compact viewport should use full width');
  assertClose(compactViewport.height, 426.6666666666667, 'compact viewport keeps 3:4 full-width height');
  assertClose(compactViewport.left, 0, 'compact viewport should fill horizontally');
  assertClose(compactViewport.top, testCameraTopBarHeight, 'compact viewport should start below top controls');
  assertClose(compactViewport.width / compactViewport.height, 3 / 4, 'compact viewport aspect');
  assertClose(compactPanel.top, compactViewport.bottom, 'compact bottom panel should start after the camera viewport');
  assertClose(compactPanel.height, 81.33333333333331, 'compact bottom panel uses remaining safe area');
});

test('watermark scale max keeps the full edit box inside the camera viewport', () => {
  const screenWidth = 375;
  const viewport = testCameraViewportBounds(screenWidth, 812);
  const editWidth = viewport.width;
  const editHeight = viewport.height;
  const wideTemplateWidth = Math.round(screenWidth * 0.66);
  const wideTemplateHeight = Math.round(screenWidth * 0.16);

  assert.ok(testMaxWatermarkScale(editWidth, editHeight, wideTemplateWidth, wideTemplateHeight, 0) > 1.2);
  assert.ok(testMaxWatermarkScale(editWidth, editHeight, wideTemplateWidth, wideTemplateHeight, 90) > 1.5);
});

test('rotated watermark drag root keeps the full transform box inside the expanded layer', () => {
  const screenWidth = 375;
  const editBounds = testCameraViewportBounds(screenWidth, 812);
  const layerBounds = testWatermarkLayerBounds(editBounds);
  const layerWidth = layerBounds.right - layerBounds.left;
  const frame = {
    width: Math.round(screenWidth * 0.66),
    height: Math.round(screenWidth * 0.16),
    scale: 1,
    rotation: 90,
  };
  const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, frame.rotation);
  const currentMoveRange = layerWidth - metrics.containerWidth;

  assert.equal(metrics.boxWidth, metrics.contentWidth + testWatermarkHandlePad * 2, 'edit box should reserve visible handle padding');
  assert.equal(metrics.boxHeight, metrics.contentHeight + testWatermarkHandlePad * 2, 'edit box should reserve visible handle padding');
  assert.ok(metrics.containerWidth >= metrics.boxWidth, '90deg root should keep the full transform box width visible');
  assert.ok(metrics.containerHeight >= metrics.boxHeight, '90deg root should keep the full transform box height visible');
  assert.ok(metrics.transformLeft >= 0, '90deg root should not need a negative horizontal offset');
  assert.ok(metrics.transformTop >= 0, '90deg root should not need a negative vertical offset');
  assert.ok(currentMoveRange > editBounds.width / 3, 'expanded layer keeps a materially wider horizontal drag range');
});

test('rotated watermark clamp keeps touch-view x inside native bounds at edit edges', () => {
  const editBounds = testCameraViewportBounds(375, 812);
  for (const rotation of [0, 90, 180, 270]) {
    const frame = {
      width: Math.round(375 * 0.66),
      height: Math.round(375 * 0.16),
      scale: 1,
      rotation,
    };
    const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, frame.rotation);
    const layerBounds = testWatermarkLayerBounds(editBounds);
    const maxMoveX = layerBounds.right - layerBounds.left - metrics.containerWidth;
    const maxMoveY = layerBounds.bottom - layerBounds.top - metrics.containerHeight;
    const edgeFrames = [
      { ...frame, left: -80, top: 140 },
      { ...frame, left: editBounds.right - metrics.contentWidth + 80, top: 140 },
      { ...frame, left: 80, top: -60 },
      { ...frame, left: 80, top: editBounds.bottom - metrics.contentHeight + 90 },
    ];

    for (const edgeFrame of edgeFrames) {
      const clamped = testClampWatermarkFrame(edgeFrame, editBounds);
      const move = testWatermarkMovePositionFromFrame(clamped, editBounds);
      const contentWidth = clamped.width * clamped.scale;
      const contentHeight = clamped.height * clamped.scale;
      const payload = testNativeWatermarkPayloadFromFrame(clamped, editBounds);

      assert.ok(move.x >= -0.001, `${rotation}deg move.x should not be negative: ${move.x}`);
      assert.ok(move.x <= maxMoveX + 0.001, `${rotation}deg move.x should not exceed native max: ${move.x}`);
      assert.ok(move.y >= -0.001, `${rotation}deg move.y should not be negative: ${move.y}`);
      assert.ok(move.y <= maxMoveY + 0.001, `${rotation}deg move.y should not exceed native max: ${move.y}`);
      assert.ok(clamped.left >= editBounds.left - 0.001, `${rotation}deg content left should stay in viewport: ${clamped.left}`);
      assert.ok(clamped.top >= editBounds.top - 0.001, `${rotation}deg content top should stay in viewport: ${clamped.top}`);
      assert.ok(clamped.left + contentWidth <= editBounds.right + 0.001, `${rotation}deg content right should stay in viewport: ${clamped.left + contentWidth}`);
      assert.ok(clamped.top + contentHeight <= editBounds.bottom + 0.001, `${rotation}deg content bottom should stay in viewport: ${clamped.top + contentHeight}`);
      assert.ok(payload.positionX >= -0.001 && payload.positionX <= 1, `${rotation}deg native positionX should not rely on native clamp: ${payload.positionX}`);
      assert.ok(payload.positionY >= -0.001 && payload.positionY <= 1, `${rotation}deg native positionY should not rely on native clamp: ${payload.positionY}`);
      assert.ok(payload.positionX + payload.boxWidth <= 1.001, `${rotation}deg native x rect should fit viewport: ${payload.positionX + payload.boxWidth}`);
      assert.ok(payload.positionY + payload.boxHeight <= 1.001, `${rotation}deg native y rect should fit viewport: ${payload.positionY + payload.boxHeight}`);
    }
  }
});

test('unrotated watermark can align burned content with viewport bottom edge', () => {
  const editBounds = testCameraViewportBounds(375, 812);
  const frame = {
    left: editBounds.left + 80,
    top: editBounds.bottom + 120,
    width: 180,
    height: 72,
    scale: 1,
    rotation: 0,
  };
  const clamped = testClampWatermarkFrame(frame, editBounds);
  const move = testWatermarkMovePositionFromFrame(clamped, editBounds);
  const payload = testNativeWatermarkPayloadFromFrame(clamped, editBounds);
  const metrics = testWatermarkBoxMetrics(frame.width, frame.height, frame.scale, frame.rotation);
  const layerBounds = testWatermarkLayerBounds(editBounds);
  const maxMoveY = layerBounds.bottom - layerBounds.top - metrics.containerHeight;

  assertClose(clamped.top + metrics.contentHeight, editBounds.bottom, 'content bottom should touch viewport bottom');
  assertClose(move.y, maxMoveY, 'touch-view bottom should match content bottom');
  assertClose(payload.positionY + payload.boxHeight, 1, 'native payload bottom should touch output bottom');
});

test('pure image watermark frame fits the image plus template padding', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const viewport = testCameraViewportBounds(320, 568);
  const pureImageTemplate = {
    templateId: 'image-logo',
    templateType: 'image',
    imagePath: '/static/watermark/logo3.png',
    imageWidth: 72,
    imageHeight: 72,
    boxWidth: 0.34,
    boxHeight: 0.18,
    boxPadding: 12,
    imageTextGap: 0,
    mainTitleText: '',
    subtitleText: '',
  };
  const oldDefaultHeight = Math.max(
    testWatermarkDefaultMinHeight,
    Math.round(viewport.height * pureImageTemplate.boxHeight),
  );
  const minimumFrameSize = testWatermarkTemplateMinimumFrameSize(pureImageTemplate);
  const frameSize = testWatermarkTemplateFrameSize(pureImageTemplate, viewport);
  const payload = testNativeWatermarkPayloadFromFrame({
    left: viewport.left + viewport.width * 0.16,
    top: viewport.top + viewport.height * 0.16,
    width: frameSize.width,
    height: frameSize.height,
    scale: 1,
    rotation: 0,
  }, viewport);

  assert.ok(oldDefaultHeight < minimumFrameSize.height, 'old compact viewport default reproduces image clipping');
  assert.equal(minimumFrameSize.width, 96);
  assert.equal(minimumFrameSize.height, 96);
  assert.ok(frameSize.width >= minimumFrameSize.width);
  assert.ok(frameSize.height >= minimumFrameSize.height);
  assert.ok(payload.boxWidth * viewport.width >= minimumFrameSize.width);
  assert.ok(payload.boxHeight * viewport.height >= minimumFrameSize.height);
  assert.match(page, /const WATERMARK_DEFAULT_MIN_WIDTH = 92/);
  assert.match(page, /const WATERMARK_DEFAULT_MIN_HEIGHT = 64/);
  assert.match(page, /watermarkTemplateMinimumFrameSize\(template(?:: WatermarkTemplate)?\)(?:: WatermarkSize)? \{/);
  assert.match(page, /watermarkTemplateFrameSize\(template(?:: WatermarkTemplate)?, viewport(?:: CameraViewportBounds)?\)(?:: WatermarkSize)? \{/);
  assert.match(page, /Math\.round\(viewport\.width \* safeNumber\(template\.boxWidth, 0\.58\)\)/);
  assert.match(page, /Math\.round\(viewport\.height \* safeNumber\(template\.boxHeight, 0\.14\)\)/);
  assert.match(page, /imageWidth \+ imageTextGap \+ textWidth \+ padding \* 2/);
  assert.match(page, /imageHeight \+ padding \* 2/);
  assert.match(page, /const defaultSize = this\.watermarkTemplateFrameSize\(nextTemplate, viewport\)/);
  assert.match(page, /width: defaultSize\.width/);
  assert.match(page, /height: defaultSize\.height/);
  assert.match(page, /padding: Math\.round\(this\.activeWatermark\.boxPadding \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px'/);
  assert.match(page, /marginRight: this\.watermarkHasText \? Math\.round\(this\.activeWatermark\.imageTextGap \* this\.watermarkLayoutFrame\(\)\.scale\) \+ 'px' : '0px'/);
  assert.doesNotMatch(page, /\.watermarkContent \{[^}]*padding: 10px;/);
  assert.doesNotMatch(page, /\.watermarkImage \{[^}]*margin-right: 8px;/);
});

test('Android preview size matches photo aspect so camera UI and captured photo align', async () => {
  const nativeView = await readFile(path.join(root, 'uni_modules/xyc-markvideo/utssdk/app-android/XycNativeCameraView.kt'), 'utf8');
  const photoSelected = testChoosePhotoSizeForFixedFrame([
    { width: 3840, height: 2160 },
    { width: 2560, height: 1920 },
    { width: 1920, height: 1080 },
  ]);
  const selected = testChooseCameraSizeForTarget([
    { width: 1920, height: 1080 },
    { width: 1440, height: 1080 },
    { width: 1280, height: 720 },
  ], photoSelected);

  assert.deepEqual(photoSelected, { width: 2560, height: 1920 });
  assert.deepEqual(selected, { width: 1440, height: 1080 });
  assert.deepEqual(testChoosePhotoSizeForFixedFrame([
    { width: 4000, height: 3000 },
    { width: 1920, height: 1080 },
  ]), { width: 4000, height: 3000 });
  assert.deepEqual(testChooseCameraSizeForTarget([
    { width: 4000, height: 3000 },
    { width: 1920, height: 1080 },
  ], { width: 4000, height: 3000 }), { width: 4000, height: 3000 });
  assert.match(nativeView, /pictureSize = choosePhotoSize\(parameters\.supportedPictureSizes\)[\s\S]*val selectedPreviewSize = chooseCameraSize\(parameters\.supportedPreviewSizes, pictureSize\)/);
  assert.match(nativeView, /videoSize = chooseVideoSize\(parameters, pictureSize\)/);
  assert.match(nativeView, /private fun chooseCameraSize\(sizes: List<Camera\.Size>\?, targetSize: XycSize\? = null\): Camera\.Size/);
  assert.match(nativeView, /private fun chooseVideoSize\(parameters: Camera\.Parameters, targetSize: XycSize\): XycSize/);
  assert.match(nativeView, /val targetAspect = targetCameraFrameAspect\(\)/);
  assert.match(nativeView, /CAMERA_FRAME_ASPECT_SHORT_EDGE = 3f/);
  assert.match(nativeView, /CAMERA_FRAME_ASPECT_LONG_EDGE = 4f/);
  assert.match(nativeView, /val selected = chooseCameraSize\(videoSizes, targetSize\)/);
  assert.match(nativeView, /val targetAspect = targetSize\?\.let \{ aspectRatioForMatch\(it\.width, it\.height\) \}/);
  assert.match(nativeView, /aspectDelta\(it\.width, it\.height, targetAspect\)/);
  assert.match(nativeView, /\.thenByDescending \{ photoSizeFitsQualityCap\(it\.width, it\.height\) \}/);
  assert.match(nativeView, /\.thenByDescending \{ sizeFitsQualityCap\(it\.width, it\.height\) \}/);
});

test('switching from mixed template to pure image rebuilds layout from the pure image frame', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const applyBody = page.match(/applyWatermarkTemplate\(template(?:: WatermarkTemplate)?\)(?:: void)? \{[\s\S]*?\n    \},\n    clearActiveWatermark\(\) \{/)?.[0] || '';
  const activeAssignmentIndex = applyBody.indexOf('this.activeWatermark = nextTemplate');
  const frameAssignmentIndex = applyBody.indexOf('this.watermarkFrame = {');
  const mixedTemplate = {
    templateId: 'mixed-site',
    templateType: 'mixed',
    imagePath: '/static/watermark/logo3.png',
    imageWidth: 36,
    imageHeight: 36,
    boxWidth: 0.66,
    boxHeight: 0.16,
    boxPadding: 12,
    imageTextGap: 8,
    mainTitleText: '南京西路',
    subtitleText: '门店巡检 · 2026-06-22',
    positionX: 0.12,
    positionY: 0.16,
    scale: 1,
    rotation: 0,
  };
  const pureImageTemplate = {
    templateId: 'image-logo',
    templateType: 'image',
    imagePath: '/static/watermark/logo3.png',
    imageWidth: 72,
    imageHeight: 72,
    boxWidth: 0.34,
    boxHeight: 0.18,
    boxPadding: 12,
    imageTextGap: 0,
    mainTitleText: '',
    subtitleText: '',
    positionX: 0.16,
    positionY: 0.16,
    scale: 1,
    rotation: 0,
  };
  const viewport = testCameraViewportBounds(320, 568);
  const mixedSize = testWatermarkTemplateFrameSize(mixedTemplate, viewport);
  const pureSize = testWatermarkTemplateFrameSize(pureImageTemplate, viewport);
  const mixedState = testApplyWatermarkTemplateState(mixedTemplate, viewport);
  const pureImageState = testApplyWatermarkTemplateState(pureImageTemplate, viewport);
  const pureImageMinimumHeight = testWatermarkTemplateMinimumFrameSize(pureImageTemplate).height;

  assert.ok(mixedSize.height < pureImageMinimumHeight);
  assert.equal(pureSize.height, 96);
  assert.equal(mixedState.activeWatermark.templateId, 'mixed-site');
  assert.equal(pureImageState.activeWatermark.templateId, 'image-logo');
  assert.equal(pureImageState.activeWatermark.mainTitleText, '');
  assert.equal(pureImageState.activeWatermark.subtitleText, '');
  assert.equal(pureImageState.activeWatermark.imageTextGap, 0);
  assert.equal(pureImageState.frame.height, pureImageMinimumHeight);
  assert.ok(pureImageState.payload.boxHeight * viewport.height >= pureImageMinimumHeight);
  assert.notEqual(pureImageState.frame.height, mixedState.frame.height);
  assert.notEqual(applyBody, '', 'applyWatermarkTemplate body should be inspectable');
  assert.ok(frameAssignmentIndex !== -1 && activeAssignmentIndex !== -1);
  assert.ok(frameAssignmentIndex < activeAssignmentIndex, 'template switch should set the new frame before rendering the new template');
  assert.match(applyBody, /this\.clearWatermarkSyncTimer\(\)/);
  assert.match(applyBody, /this\.clearWatermarkTransitionTimer\(\)/);
  assert.match(applyBody, /this\.watermarkTransitionDisabled = true/);
  assert.match(applyBody, /this\.clearWatermarkPinchGesture\(\)/);
  assert.match(applyBody, /this\.watermarkMoveActive = false/);
  assert.match(applyBody, /this\.watermarkMoveDraft = null/);
  assert.match(applyBody, /this\.watermarkRenderKey \+= 1/);
  assert.match(applyBody, /this\.watermarkTransitionTimer = setTimeout\(\(\) => \{[\s\S]*this\.watermarkTransitionDisabled = false[\s\S]*\}, 180\)/);
  assert.match(page, /const transitionDuration = this\.watermarkPinchActive\(\) \|\| this\.watermarkTransitionDisabled \? '0ms' : '120ms'/);
  assert.match(page, /clearWatermarkTransitionTimer\(\) \{[\s\S]*const timer = this\.watermarkTransitionTimer[\s\S]*clearTimeout\(timer\)/);
  assert.match(page, /if \(!this\.watermarkMoveActive\) \{[\s\S]*return[\s\S]*\}/);
  assert.doesNotMatch(page, /if \(!this\.watermarkMoveActive && !this\.isWatermarkTouchMoveSource\(source\)\)/);
  assert.doesNotMatch(page, /isWatermarkTouchMoveSource\(source\)/);
  assert.match(page, /watermarkRenderKey: 0/);
  assert.doesNotMatch(page, /<movable-area class="watermarkLayer" :key="watermarkRenderKey"/);
  assert.match(page, /<view class="watermarkTransformBox"[\s\S]*:key="watermarkRenderKey"[\s\S]*:style="watermarkTransformStyleValue\(\)"/);
});

test('watermark pinch keeps the touch root stable while the inner transform follows the preview frame', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const moveXBody = page.match(/watermarkMoveX\(\)(?:: number)? \{[\s\S]*?\n    \},/)?.[0] || '';
  const moveYBody = page.match(/watermarkMoveY\(\)(?:: number)? \{[\s\S]*?\n    \},/)?.[0] || '';
  const boxStyleBody = page.match(/watermarkBoxStyle\(\) \{[\s\S]*?\n    \},/)?.[0] || '';
  const transformStyleBody = page.match(/watermarkTransformStyle\(\) \{[\s\S]*?\n    \},/)?.[0] || '';
  const editBounds = testCameraViewportBounds(375, 812);
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
  const startMove = testWatermarkMovePositionFromFrame(startFrame, editBounds);
  const previewMove = testWatermarkMovePositionFromFrame(previewFrame, editBounds);

  assert.ok(previewMetrics.containerWidth > startMetrics.containerWidth * 1.8);
  assert.ok(previewMetrics.containerHeight > startMetrics.containerHeight * 1.5);
  assert.notEqual(previewMove.x, 0, 'the visual preview still has a non-zero frame position inside the stable root');
  assert.notEqual(previewMove.y, 0, 'the visual preview still has a non-zero frame position inside the stable root');
  assert.ok(previewMove.x < startMove.x, 'zoom-out/in preview should move the inner transform with its scaled geometry');
  assert.match(page, /watermarkPinchActive\(\) \{/);
  assert.match(page, /watermarkPinchPreviewFrame\(\)(?:: WatermarkFrame \| null)? \{/);
  assert.match(page, /watermarkLayoutFrame\(\)(?:: WatermarkFrame)? \{[\s\S]*const pinchFrame = this\.watermarkPinchPreviewFrame\(\)[\s\S]*if \(pinchFrame != null\) \{[\s\S]*return pinchFrame/);
  assert.match(page, /watermarkPinchScaleRatio\(\) \{[\s\S]*if \(this\.watermarkPinchGesture != null && this\.watermarkPinchGesture\.commitFrame != null\) \{[\s\S]*return 1/);
  assert.match(moveXBody, /if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*return 0[\s\S]*\}/);
  assert.match(moveYBody, /if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*return 0[\s\S]*\}/);
  assert.match(boxStyleBody, /if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*const layerBounds = this\.watermarkLayerBounds\(\)[\s\S]*width: Math\.round\(layerBounds\.right - layerBounds\.left\) \+ 'px'[\s\S]*height: Math\.round\(layerBounds\.bottom - layerBounds\.top\) \+ 'px'/);
  assert.match(transformStyleBody, /if \(this\.watermarkPinchActive\(\)\) \{[\s\S]*const layerBounds = this\.watermarkLayerBounds\(\)[\s\S]*const centerX = frame\.left \+ metrics\.contentWidth \/ 2 - layerBounds\.left[\s\S]*left: Math\.round\(centerX - metrics\.boxWidth \/ 2\) \+ 'px'[\s\S]*top: Math\.round\(centerY - metrics\.boxHeight \/ 2\) \+ 'px'/);
});

test('watermark pinch updates limit noisy scale jumps before applying root coordinates', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const startScale = 1.789;
  const rawScale = 2.055;
  const appliedScale = testLimitWatermarkPinchScale(rawScale, startScale, testWatermarkMinScale, testWatermarkMaxScale);

  assert.equal(testWatermarkPinchMaxScaleStep, 0.12);
  assert.equal(testWatermarkPinchSmoothing, 0.45);
  assert.ok(rawScale - startScale > 0.26);
  assert.ok(appliedScale - startScale <= testWatermarkPinchMaxScaleStep);
  assert.ok(appliedScale < rawScale);
  assert.match(page, /const WATERMARK_PINCH_MAX_SCALE_STEP = 0\.12/);
  assert.match(page, /const WATERMARK_PINCH_SMOOTHING = 0\.45/);
  assert.match(page, /limitWatermarkPinchScale\(rawScale(?:: number)?, previousScale(?:: number)?, minScale(?:: number)?, maxScale(?:: number)?\)(?:: number)? \{/);
  assert.match(page, /const previousScale = typeof gesture\.lastScale === 'number' \? gesture\.lastScale : gesture\.startScale/);
  assert.match(page, /const nextScale = this\.limitWatermarkPinchScale\(rawScale, previousScale, Math\.min\(WATERMARK_MIN_SCALE, maxScale\), maxScale\)/);
  assert.match(page, /lastScale: startFrame\.scale/);
  assert.match(page, /lastScale: update\.commitFrame\.scale/);
  assert.match(page, /rawScale: rawScale/);
  assert.match(page, /appliedScale: nextScale/);
  assert.match(page, /if \(activeGesture != null && activeGesture\.pendingFrame != null\) \{[\s\S]*this\.applyWatermarkPinchUpdate\(activeGesture\.pendingFrame, Date\.now\(\)\)[\s\S]*\}/);
  assert.doesNotMatch(page, /const shouldApplyPending = activeGesture\.lastUpdateAt <= 0 \|\| Date\.now\(\) - activeGesture\.lastUpdateAt >= WATERMARK_PINCH_FRAME_INTERVAL_MS/);
  assert.match(page, /if \(traceScaleValue != null\) \{[\s\S]*parts\.push\('rawScale=' \+ this\.formatTraceNumber\(traceScaleNumber\)\)/);
  assert.match(page, /if \(appliedScaleValue != null\) \{[\s\S]*parts\.push\('appliedScale=' \+ this\.formatTraceNumber\(appliedScaleNumber\)\)/);
  assert.match(page, /rootW=' \+ this\.formatTraceNumber\(rootWidth\)/);
  assert.match(page, /rootH=' \+ this\.formatTraceNumber\(rootHeight\)/);
  assert.match(page, /frameW=' \+ this\.formatTraceNumber\(traceFrame\.width\)/);
  assert.match(page, /frameH=' \+ this\.formatTraceNumber\(traceFrame\.height\)/);
  assert.match(page, /contentW=' \+ this\.formatTraceNumber\(metrics\.contentWidth\)/);
  assert.match(page, /contentH=' \+ this\.formatTraceNumber\(metrics\.contentHeight\)/);
  assert.match(page, /boxW=' \+ this\.formatTraceNumber\(metrics\.boxWidth\)/);
  assert.match(page, /boxH=' \+ this\.formatTraceNumber\(metrics\.boxHeight\)/);
  assert.match(page, /innerX=' \+ this\.formatTraceNumber\(innerLeft\)/);
  assert.match(page, /innerY=' \+ this\.formatTraceNumber\(innerTop\)/);
  assert.match(page, /if \(nativeXValue != null\) \{[\s\S]*parts\.push\('nativeX=' \+ this\.formatTraceNumber\(nativeXNumber\)\)/);
  assert.match(page, /if \(nativeYValue != null\) \{[\s\S]*parts\.push\('nativeY=' \+ this\.formatTraceNumber\(nativeYNumber\)\)/);
});

test('watermark drag change keeps the touch root synced without committing the frame', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const moveChangeBody = page.match(/\n    handleWatermarkMoveChange\(event(?:: UTSJSONObject \| null)?\)(?:: void)? \{[\s\S]*?\n    \},\n    watermarkMoveEventDetail/)?.[0] || '';

  assert.notEqual(moveChangeBody, '', 'handleWatermarkMoveChange body should be inspectable');
  assert.match(moveChangeBody, /this\.watermarkMoveDraft = \{[\s\S]*x: moveX,[\s\S]*y: moveY[\s\S]*\}/);
  assert.match(moveChangeBody, /this\.watermarkMovePosition = \{[\s\S]*x: moveX,[\s\S]*y: moveY[\s\S]*\}/);
  assert.doesNotMatch(moveChangeBody, /updateWatermarkFrame|scheduleWatermarkSync|syncWatermarkToNative|flushWatermarkSync/);
});

test('watermark body has a direct drag hit surface above content and below handles', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const watermarkArea = findTagBlock(page, '<view class="watermarkLayer"', 'view');
  const pinchVisualLayer = findTagBlock(page, '<view class="watermarkPinchVisualLayer"', 'view');
  const dragSurfaceStyleBlock = findStyleBlock(page, '.watermarkDragSurface');
  const contentStyleBlock = findStyleBlock(page, '.watermarkContent');
  const resizeStyleBlock = findStyleBlock(page, '.watermarkResize');

  assert.match(watermarkArea, /class="watermarkContent"[\s\S]*class="watermarkDragSurface"[\s\S]*class="watermarkDelete"[\s\S]*class="watermarkRotate"[\s\S]*class="watermarkResize"/);
  assert.match(watermarkArea, /class="watermarkDragSurface"[\s\S]*@touchstart\.stop="startWatermarkTouch"[\s\S]*@touchmove\.stop="moveWatermarkTouch"[\s\S]*@touchend\.stop="finishWatermarkTouch"[\s\S]*@touchcancel\.stop="finishWatermarkTouch"/);
  assert.match(page, /watermarkDragSurfaceStyleValue\(\) \{[\s\S]*left: WATERMARK_HANDLE_PAD \+ 'px'[\s\S]*top: WATERMARK_HANDLE_PAD \+ 'px'[\s\S]*right: WATERMARK_HANDLE_PAD \+ 'px'[\s\S]*bottom: WATERMARK_HANDLE_PAD \+ 'px'/);
  assert.match(contentStyleBlock, /z-index: 1;/);
  assert.match(dragSurfaceStyleBlock, /z-index: 2;/);
  assert.match(resizeStyleBlock, /z-index: 4;/);
  assert.doesNotMatch(pinchVisualLayer, /class="watermarkDragSurface"/);
  assert.match(watermarkArea, /class="watermarkResize"[\s\S]*@touchstart\.stop="stopWatermarkTouch"[\s\S]*@touchmove\.stop="stopWatermarkTouch"[\s\S]*@touchend\.stop="stopWatermarkTouch"[\s\S]*@touchcancel\.stop="stopWatermarkTouch"/);
  assert.doesNotMatch(page, /class="watermarkDragHotspot"|watermarkHotspotStyle\(\)|@longpress\.stop="startWatermarkDrag"/);
});

test('watermark gestures are driven by page touch math without movable-view native state', async () => {
  const page = await readFile(path.join(root, 'pages/cameraX/index.uvue'), 'utf8');
  const watermarkLayer = findTagBlock(page, '<view class="watermarkLayer"', 'view');

  assert.doesNotMatch(page, /<movable-area|<movable-view/);
  assert.match(watermarkLayer, /class="watermarkGesturePlane"[\s\S]*:style="watermarkGesturePlaneStyleValue\(\)"[\s\S]*@touchstart="startWatermarkTouch"[\s\S]*@touchmove="moveWatermarkTouch"[\s\S]*@touchend="finishWatermarkTouch"[\s\S]*@touchcancel="finishWatermarkTouch"/);
  assert.doesNotMatch(watermarkLayer, /:x="watermarkMoveX"|:y="watermarkMoveY"|direction="all"|:disabled="watermarkMoveDisabled"|@change="handleWatermarkMoveChange"/);
  assert.match(page, /watermarkGesturePlaneStyleValue\(\) \{[\s\S]*left: Math\.round\(this\.watermarkPinchActive\(\) \? 0 : this\.watermarkMovePosition\.x\) \+ 'px'[\s\S]*top: Math\.round\(this\.watermarkPinchActive\(\) \? 0 : this\.watermarkMovePosition\.y\) \+ 'px'/);
});

test('uvue and uts component styles avoid unsupported CSS values', async () => {
  const files = [
    ...await collectFiles('pages', ['.uvue', '.vue']),
    ...await collectFiles('uni_modules/xyc-markvideo', ['.uvue', '.vue']),
  ];

  for (const file of files) {
    const content = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(content, /margin[^\n;]*auto/, `${file} must not use margin auto centering`);
    assert.doesNotMatch(content, /overflow\s*:\s*visible/, `${file} must not use overflow visible`);
  }
});

test('xyc-markvideo package keeps the Android component support declaration', async () => {
  const pkg = JSON.parse(await readFile(
    path.join(root, 'uni_modules/xyc-markvideo/package.json'),
    'utf8',
  ));

  assert.equal(pkg.id, 'xyc-markvideo');
  assert.equal(pkg.name, 'xyc-markvideo');
  assert.equal(pkg.dcloudext.type, 'component-uts');
  assert.equal(pkg.uni_modules.platforms.client.Vue.vue3, 'y');
  assert.equal(pkg.uni_modules.platforms.client.App['app-android'], 'y');
  assert.equal(pkg.uni_modules.platforms.client.App['app-ios'], '-');
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
  assert.match(android, /'camerachange'/);
  assert.doesNotMatch(android, /'shuttertap'/);
  assert.doesNotMatch(android, /'modechange'/);
  assert.doesNotMatch(android, /\$emit\('shuttertap'/);
  assert.doesNotMatch(android, /\$emit\('modechange'/);
  assert.match(android, /cameraSoundEnabled: \{[\s\S]*type: Boolean,[\s\S]*default: true/);
  assert.match(android, /statusText: \{[\s\S]*type: String,[\s\S]*default: ''/);
  assert.doesNotMatch(android, /XYC native camera preview/);
  assert.doesNotMatch(android, /cameraSoundEnabled: \{[\s\S]*handler\(newValue : boolean, oldValue : boolean\)[\s\S]*setCameraSoundEnabled\(newValue\)/);
  assert.match(android, /expose: \['setStatus', 'switchMode', 'setFlashMode', 'setZoomMode', 'switchCamera', 'setCameraSoundEnabled', 'performHapticFeedback', 'setWatermark', 'clearWatermark', 'takePhoto', 'startRecord', 'stopRecord', 'openSystemAlbum', 'restartCamera', 'preparePermissions', 'prepareRecordPermissions', 'destroyCamera'\]/);
  assert.match(android, /switchMode\(mode : string\)/);
  assert.match(android, /setFlashMode\(mode : string\) : string/);
  assert.match(android, /setZoomMode\(mode : string\) : string/);
  assert.match(android, /switchCamera\(\) : string/);
  assert.match(android, /setCameraSoundEnabled\(enabled : boolean\) : string/);
  assert.match(android, /performHapticFeedback\(type : string = 'light'\) : string/);
  assert.match(android, /setWatermark\(template : any\) : string/);
  assert.match(android, /clearWatermark\(\) : string/);
  assert.match(android, /nativeViewUnavailable\(\) : string/);
  assert.doesNotMatch(android, /type NativeCameraResult/);
  assert.match(android, /return view\.setFlashMode\(mode\)/);
  assert.match(android, /return view\.setZoomMode\(mode\)/);
  assert.match(android, /return view\.switchCamera\(\)/);
  assert.match(android, /return view\.setCameraSoundEnabled\(enabled\)/);
  assert.match(android, /return view\.performHapticFeedback\(type\)/);
  assert.match(android, /view\.setCameraSoundEnabled\(this\.cameraSoundEnabled\)/);
  assert.doesNotMatch(android, /JSON\.parse<NativeCameraResult>\(text\)/);
  assert.doesNotMatch(android, /JSON\.parse\(text\) as NativeCameraResult/);
  assert.match(android, /takePhoto\(\)/);
  assert.match(android, /startRecord\(options : any = \{\}\)/);
  assert.match(android, /stopRecord\(\)/);
  assert.match(android, /openSystemAlbum\(mediaUri : string = ''\) : string/);
  assert.match(android, /return view\.openSystemAlbum\(mediaUri\)/);
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
  assert.match(nativeView, /TextureView\.SurfaceTextureListener/);
  assert.match(nativeView, /previewView = TextureView\(context\)/);
  assert.match(nativeView, /previewView\.surfaceTextureListener = this/);
  assert.match(nativeView, /onSurfaceTextureAvailable\(surface: android\.graphics\.SurfaceTexture, width: Int, height: Int\)/);
  assert.match(nativeView, /onSurfaceTextureDestroyed\(surface: android\.graphics\.SurfaceTexture\): Boolean/);
  assert.match(nativeView, /previewReady = false[\s\S]*closeCamera\(\)[\s\S]*return true/);
  assert.match(nativeView, /activeCamera\.setPreviewTexture\(previewTexture\)/);
  assert.doesNotMatch(nativeView, /SurfaceView/);
  assert.doesNotMatch(nativeView, /SurfaceHolder/);
  assert.doesNotMatch(nativeView, /setPreviewDisplay/);
  assert.match(nativeView, /Camera\.open/);
  assert.match(nativeView, /import android\.content\.pm\.ActivityInfo/);
  assert.match(nativeView, /import android\.content\.Intent/);
  assert.match(nativeView, /import android\.media\.MediaMetadataRetriever/);
  assert.match(nativeView, /import android\.provider\.MediaStore/);
  assert.match(nativeView, /import android\.view\.OrientationEventListener/);
  assert.match(nativeView, /lockHostActivityToPortrait\(\)/);
  assert.match(nativeView, /try \{[\s\S]*activity\.requestedOrientation = ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT[\s\S]*\} catch \(throwable: Throwable\)/);
  assert.match(nativeView, /Log\.w\(LOG_TAG, "Failed to lock host activity to portrait\.", throwable\)/);
  assert.match(nativeView, /requestedOrientation != ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(nativeView, /activity\.requestedOrientation = ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(nativeView, /private var deviceOrientationDegrees = 0/);
  assert.match(nativeView, /captureOrientationListener = object : OrientationEventListener\(context\.applicationContext\)/);
  assert.match(nativeView, /OrientationEventListener\.ORIENTATION_UNKNOWN/);
  assert.match(nativeView, /deviceOrientationDegrees = roundDeviceOrientationDegrees\(orientation\)/);
  assert.match(nativeView, /captureOrientationListener\.enable\(\)/);
  assert.match(nativeView, /captureOrientationListener\.disable\(\)/);
  assert.match(nativeView, /override fun onWindowFocusChanged\(hasWindowFocus: Boolean\)[\s\S]*if \(hasWindowFocus\) \{[\s\S]*lockHostActivityToPortrait\(\)/);
  assert.match(nativeView, /resolveCameraDisplayOrientationDegrees\(cameraId: Int\)/);
  assert.match(nativeView, /resolveCameraCaptureRotationDegrees\(cameraId: Int\)/);
  assert.match(nativeView, /currentDisplayRotationDegrees\(\)/);
  assert.match(nativeView, /currentCaptureOrientationDegrees\(\)/);
  assert.match(nativeView, /roundDeviceOrientationDegrees\(orientation: Int\)/);
  assert.match(nativeView, /CAMERA_FACING_FRONT/);
  assert.match(nativeView, /setDisplayOrientation\(resolveCameraDisplayOrientationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /setRotation\(resolveCameraCaptureRotationDegrees\(activeCameraId\)\)/);
  assert.match(nativeView, /val mirroredResult = \(info\.orientation \+ displayRotationDegrees\) % 360[\s\S]*\(360 - mirroredResult\) % 360/);
  assert.match(nativeView, /val captureOrientationDegrees = currentCaptureOrientationDegrees\(\)/);
  assert.match(nativeView, /resolveCameraCaptureRotationDegrees\(cameraId: Int\)[\s\S]*\(info\.orientation - captureOrientationDegrees \+ 360\) % 360/);
  assert.match(nativeView, /resolveCameraCaptureRotationDegrees\(cameraId: Int\)[\s\S]*\(info\.orientation \+ captureOrientationDegrees\) % 360/);
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
  assert.match(nativeView, /copyOrDecodeWatermarkBitmap\(frozenWatermark, frozenWatermarkBitmapSource\)/);
  assert.match(nativeView, /copyWatermarkBitmap\(activeWatermarkBitmap\)/);
  assert.match(nativeView, /recycleBitmap\(activeWatermarkBitmap\)/);
  assert.match(nativeView, /failAndEmit\("1202", message, message\)/);
  assert.match(nativeView, /activeWatermark/);
  assert.match(nativeView, /drawWatermarkOnPhoto/);
  assert.match(nativeView, /cachedImageBitmap: Bitmap\?/);
  assert.match(nativeView, /val frozenCameraFacing = activeCameraFacing\(\)/);
  assert.match(nativeView, /writePhotoWithWatermark\(file, data, frozenWatermark, frozenWatermarkBitmap, frozenCameraFacing\)/);
  assert.match(nativeView, /cameraFacing: String/);
  assert.match(nativeView, /val needsFrontCameraUnmirror = cameraFacing == UI_CAMERA_FRONT/);
  assert.match(nativeView, /if \(watermark == null && !needsFrontCameraUnmirror\) \{/);
  assert.match(nativeView, /readExifRotationDegrees/);
  assert.match(nativeView, /applyExifOrientation/);
  assert.match(nativeView, /applyFrontCameraOutputMirror\(orientedBitmap, cameraFacing\)/);
  assert.match(nativeView, /private fun applyFrontCameraOutputMirror\(source: Bitmap, cameraFacing: String\): Bitmap/);
  assert.match(nativeView, /private var recordingCameraFacing = UI_CAMERA_BACK/);
  assert.match(nativeView, /private var reusableMirroredVideoFrame: Bitmap\? = null/);
  assert.match(nativeView, /recordingCameraFacing = frozenCameraFacing/);
  assert.match(nativeView, /val frozenCameraFacing = recordingCameraFacing/);
  assert.match(nativeView, /val frameCameraFacing = recordingCameraFacing/);
  assert.match(nativeView, /applyFrontCameraFrameMirrorIfNeeded\(targetBitmap, frameCameraFacing\)/);
  assert.match(nativeView, /applyFrontCameraFrameMirrorIfNeeded\(targetBitmap, cameraFacing\)/);
  assert.match(nativeView, /private fun applyFrontCameraFrameMirrorIfNeeded\(target: Bitmap, cameraFacing: String\)/);
  assert.match(nativeView, /reusableMirroredVideoFrame\?\.takeIf/);
  assert.match(nativeView, /Canvas\(mirrorFrame\)\.drawBitmap\(target, frontCameraMirrorMatrix\(target\.width\), null\)/);
  assert.match(nativeView, /Canvas\(target\)\.drawBitmap\(mirrorFrame, 0f, 0f, null\)/);
  assert.match(nativeView, /ensureVideoFrameBeforeFinish\(recorder, frozenWatermark, frozenWatermarkBitmap, frozenWatermarkOverlay, cameraFacing\)/);
  assert.match(nativeView, /if \(cameraFacing != UI_CAMERA_FRONT\) \{[\s\S]*return source[\s\S]*\}/);
  assert.match(nativeView, /private fun activeCameraFacing\(\): String/);
  assert.match(nativeView, /Camera\.getCameraInfo\(activeCameraId, info\)/);
  assert.match(nativeView, /private fun frontCameraMirrorMatrix\(width: Int\): Matrix/);
  assert.match(nativeView, /matrix\.postScale\(-1f, 1f\)/);
  assert.match(nativeView, /matrix\.postTranslate\(width\.toFloat\(\), 0f\)/);
  assert.match(nativeView, /ioHandler\.post/);
  assert.match(nativeView, /视频保存中/);
  assert.match(nativeView, /BitmapFactory\.decodeByteArray/);
  assert.match(nativeView, /Canvas\(outputBitmap\)/);
  assert.match(nativeView, /compress\(Bitmap\.CompressFormat\.JPEG, PHOTO_JPEG_QUALITY, output\)/);
  assert.match(nativeView, /val decodeOptions = BitmapFactory\.Options\(\)\.apply \{[\s\S]*inPreferredConfig = Bitmap\.Config\.ARGB_8888[\s\S]*inMutable = true/);
  assert.match(nativeView, /BitmapFactory\.decodeByteArray\(data, 0, data\.size, decodeOptions\)/);
  assert.match(nativeView, /val cameraAlignedBitmap = applyFrontCameraOutputMirror\(orientedBitmap, cameraFacing\)[\s\S]*val outputBitmap = ensureMutableBitmap\(cameraAlignedBitmap\)[\s\S]*drawWatermarkOnPhoto\(Canvas\(outputBitmap\)/);
  assert.match(nativeView, /watermarkOutputTransform\(outputWidth, outputHeight, watermark\)/);
  assert.match(nativeView, /WatermarkOutputTransform/);
  assert.match(nativeView, /val outputToPreviewScale = max\(previewWidth \/ max\(1f, outputWidth\.toFloat\(\)\), previewHeight \/ max\(1f, outputHeight\.toFloat\(\)\)\)/);
  assert.match(nativeView, /previewToOutputScale = 1f \/ max\(0\.0001f, outputToPreviewScale\)/);
  assert.match(nativeView, /previewOffsetX = max\(0f, \(outputWidth \* outputToPreviewScale - previewWidth\) \/ 2f\)/);
  assert.match(nativeView, /val boxWidth = transform\.previewWidth \* watermark\.boxWidth \* watermark\.scale \* transform\.previewToOutputScale/);
  assert.match(nativeView, /val left = \(\(transform\.previewWidth \* watermark\.positionX \+ transform\.previewOffsetX\) \* transform\.previewToOutputScale\)/);
  assert.match(nativeView, /val top = \(\(transform\.previewHeight \* watermark\.positionY \+ transform\.previewOffsetY\) \* transform\.previewToOutputScale\)/);
  assert.match(nativeView, /Paint\(Paint\.ANTI_ALIAS_FLAG\)\.apply \{[\s\S]*isFilterBitmap = true[\s\S]*isDither = true/);
  assert.match(nativeView, /val hasTitle = watermark\.mainTitleText\.isNotBlank\(\)[\s\S]*val hasSubtitle = watermark\.subtitleText\.isNotBlank\(\)[\s\S]*val contentRight = rect\.right - padding/);
  assert.match(nativeView, /val imageLeft = if \(!hasTitle && !hasSubtitle\) \{[\s\S]*contentLeft \+ max\(0f, \(contentRight - contentLeft - imageWidth\) \/ 2f\)[\s\S]*\} else \{[\s\S]*contentLeft[\s\S]*\}/);
  assert.match(nativeView, /val imageRect = RectF\(imageLeft, imageTop, imageLeft \+ imageWidth, imageTop \+ imageHeight\)/);
  assert.doesNotMatch(nativeView, /canvas\.scale\(1f, -1f, imageRect\.centerX\(\), imageRect\.centerY\(\)\)/);
  assert.match(nativeView, /Paint\(Paint\.ANTI_ALIAS_FLAG or Paint\.SUBPIXEL_TEXT_FLAG\)/);
  assert.doesNotMatch(nativeView, /val scale = min\(outputWidth \/ watermark\.previewWidth, outputHeight \/ watermark\.previewHeight\)/);
  assert.doesNotMatch(nativeView, /val boxWidth = outputWidth \* watermark\.boxWidth \* watermark\.scale/);
  assert.doesNotMatch(nativeView, /val previewScale = min\(outputWidth\.toFloat\(\) \/ previewWidth, outputHeight\.toFloat\(\) \/ previewHeight\)/);
  assert.match(nativeView, /watermarkTemplateSnapshot/);
  assert.match(nativeView, /watermarkPhotoBurnIn/);
  assert.match(nativeView, /watermarkVideoBurnIn/);
  assert.match(nativeView, /拍照请求已受理/);
  assert.match(nativeView, /private fun copyPreviewFrameInto\(targetBitmap: Bitmap\): Boolean/);
  assert.match(nativeView, /previewView\.getBitmap\(targetBitmap\)[\s\S]*true/);
  assert.doesNotMatch(nativeView, /PixelCopy\.request/);
  assert.match(nativeView, /CameraMp4Recorder/);
  assert.match(nativeView, /MediaCodec/);
  assert.match(nativeView, /AudioRecord/);
  assert.match(nativeView, /recordingVideoBurnIn = frozenWatermark != null/);
  assert.match(nativeView, /recordingFrameError = false/);
  assert.match(nativeView, /private var recordingStopRequested = false/);
  assert.match(nativeView, /if \(!recording && recordingStopRequested\) \{[\s\S]*return@runOnMainSync ok\(payload\(\)\.put\("message", "视频保存中"\)\)/);
  assert.match(nativeView, /recordingStopRequested = true/);
  assert.match(nativeView, /stopVideoFrameLoop\(cancelPending = false\)/);
  assert.match(nativeView, /finishRecordWhenFramesIdle\(/);
  assert.match(nativeView, /if \(\(!recording && !recordingStopRequested\) \|\| \(!videoFrameLoopRunning && !recordingStopRequested\)\) \{/);
  assert.match(nativeView, /ensureVideoFrameBeforeFinish\(recorder, frozenWatermark, frozenWatermarkBitmap, frozenWatermarkOverlay, cameraFacing\)/);
  assert.match(nativeView, /RECORD_STAGE_WATERMARK_DRAW = "watermark_draw"/);
  assert.match(nativeView, /RECORD_STAGE_BITMAP_TO_YUV = "bitmap_to_yuv"/);
  assert.match(nativeView, /RECORD_STAGE_VIDEO_INPUT_BUFFER = "video_input_buffer"/);
  assert.match(nativeView, /RECORD_STAGE_VIDEO_DRAIN = "video_drain"/);
  assert.match(nativeView, /RECORD_STAGE_VIDEO_EOS = "video_eos"/);
  assert.match(nativeView, /RECORD_STAGE_MUXER_ADD_TRACK = "muxer_add_track"/);
  assert.match(nativeView, /RECORD_STAGE_MUXER_WRITE_VIDEO_SAMPLE = "muxer_write_video_sample"/);
  assert.match(nativeView, /RECORD_STAGE_MUXER_STOP = "muxer_stop"/);
  assert.match(nativeView, /RECORD_STAGE_PUBLISH_ALBUM = "publish_album"/);
  assert.match(nativeView, /recordingFrameErrorStage = ""/);
  assert.match(nativeView, /recordingFrameSkipStage = ""/);
  assert.match(nativeView, /quitIoThreadAfterRecordStop = false/);
  assert.doesNotMatch(nativeView, /recordingCameraFacing = UI_CAMERA_BACK[\s\S]{0,120}recycleBitmap\(reusableMirroredVideoFrame\)/);
  assert.match(nativeView, /private fun recycleReusableVideoFrame\(\) \{[\s\S]*reusableVideoFrame\?\.recycle\(\)[\s\S]*recycleBitmap\(reusableMirroredVideoFrame\)[\s\S]*reusableMirroredVideoFrame = null/);
  assert.match(nativeView, /recordingWatermarkOverlay: WatermarkOverlay\? = null/);
  assert.match(nativeView, /createVideoWatermarkOverlay\(recordingSize, frozenWatermark, frozenWatermarkBitmap\)/);
  assert.match(nativeView, /recordingWatermarkOverlay = frozenWatermarkOverlay/);
  assert.match(nativeView, /val frameWatermarkOverlay = recordingWatermarkOverlay/);
  assert.match(nativeView, /drawWatermarkOverlay\(targetBitmap, frameWatermarkOverlay\)/);
  assert.doesNotMatch(nativeView, /canvas\.scale\(1f, -1f, imageRect\.centerX\(\), imageRect\.centerY\(\)\)/);
  assert.match(nativeView, /private data class WatermarkOverlay\(val bitmap: Bitmap, val dirtyRect: Rect\)/);
  assert.match(nativeView, /private fun createVideoWatermarkOverlay\([\s\S]*val dirtyRect = watermarkDirtyRect\(size\.width, size\.height, watermark\)[\s\S]*Bitmap\.createBitmap\(dirtyRect\.width\(\), dirtyRect\.height\(\), Bitmap\.Config\.ARGB_8888\)/);
  assert.match(nativeView, /overlayCanvas\.translate\(-dirtyRect\.left\.toFloat\(\), -dirtyRect\.top\.toFloat\(\)\)[\s\S]*drawWatermarkOnPhoto/);
  assert.match(nativeView, /catch \(throwable: Throwable\) \{[\s\S]*overlayBitmap\.recycle\(\)[\s\S]*throw throwable/);
  assert.match(nativeView, /private fun drawWatermarkOverlay\(targetBitmap: Bitmap, overlay: WatermarkOverlay\)[\s\S]*drawBitmap\(overlay\.bitmap, overlay\.dirtyRect\.left\.toFloat\(\), overlay\.dirtyRect\.top\.toFloat\(\), null\)/);
  assert.match(nativeView, /private fun watermarkDirtyRect\(outputWidth: Int, outputHeight: Int, watermark: NativeWatermark\): Rect/);
  assert.match(nativeView, /return WatermarkOverlay\([\s\S]*bitmap = overlayBitmap,[\s\S]*dirtyRect = dirtyRect/);
  assert.match(nativeView, /recycleWatermarkOverlay\(frozenWatermarkOverlay\)/);
  assert.match(nativeView, /recycleWatermarkOverlay\(recordingWatermarkOverlay\)/);
  assert.match(nativeView, /override fun onDetachedFromWindow\(\) \{[\s\S]*if \(recordingStopRequested\) \{[\s\S]*quitIoThreadAfterRecordStop = true[\s\S]*\} else \{[\s\S]*ioThread\.quitSafely\(\)/);
  assert.match(nativeView, /markRecordingFrameError\(RECORD_STAGE_WATERMARK_DRAW, throwable\)/);
  assert.match(nativeView, /markRecordingFrameError\(recorder\.currentStage\(\), throwable\)/);
  assert.match(nativeView, /markRecordingFrameSkip\(RECORD_STAGE_PREVIEW_COPY, "copied=false"\)/);
  assert.match(nativeView, /markRecordingFrameSkip\(RECORD_STAGE_FINAL_PREVIEW_COPY, "copied=\$\{copied\}; success=\$\{copyResult\[0\]\}"\)/);
  assert.match(nativeView, /markRecordingFrameSkip\(RECORD_STAGE_VIDEO_INPUT_BUFFER, recorder\.diagnostics\(RECORD_STAGE_VIDEO_INPUT_BUFFER\)\)/);
  assert.match(nativeView, /record frame encode failed: \$\{recorder\.diagnostics\(\)\}/);
  assert.match(nativeView, /private fun recordStopDiagnostics\([\s\S]*recorder\.diagnostics\(stage\)[\s\S]*frameError=\$\{frameErrorDiagnostics\(\)\}[\s\S]*frameSkip=\$\{frameSkipDiagnostics\(\)\}/);
  assert.match(nativeView, /private fun recordValidationStage\(\): String \{[\s\S]*return if \(recordingFrameSkipStage\.isBlank\(\)\) RECORD_STAGE_VIDEO_VALIDATE else recordingFrameSkipStage/);
  assert.match(nativeView, /fun diagnostics\(stage: String = currentStage\(\)\): String[\s\S]*failureStage=\$\{failureStage\}[\s\S]*audioSamples=\$\{audioSampleCount\}[\s\S]*audioPeak=\$\{audioPcmPeakAbs\}[\s\S]*videoOffsetUs=\$\{videoPresentationOffsetUs\}[\s\S]*audioOffsetUs=\$\{audioPresentationOffsetUs\}/);
  assert.match(nativeView, /private fun stageFailure\(stage: String, throwable: Throwable\): IllegalStateException[\s\S]*if \(lastFailureStage\.isBlank\(\)\) \{[\s\S]*lastFailureStage = stage[\s\S]*lastStageError = summary/);
  assert.match(nativeView, /if \(recordingStopRequested\) \{[\s\S]*releaseReusableFrameAfterRecordStop = true[\s\S]*\} else \{[\s\S]*resetRecordStopState\(\)/);
  assert.match(nativeView, /val recordedDurationMs = data\.optLong\("durationMs", 0L\)[\s\S]*val invalidVideoReason = when \{[\s\S]*recorder\.videoSampleCount <= 0 -> "录像没有写入有效视频帧"[\s\S]*recorder\.includeAudio && recorder\.audioSampleCount <= 0 && recordedDurationMs >= RECORD_AUDIO_REQUIRED_AFTER_MS -> "录像没有写入有效音频"[\s\S]*else -> null/);
  assert.doesNotMatch(nativeView, /hadFrameError -> "录像帧编码失败"/);
  assert.match(nativeView, /if \(invalidVideoReason != null\) \{[\s\S]*val validationStage = recordValidationStage\(\)[\s\S]*stage = validationStage[\s\S]*discardVideoOutput\(outputTarget, validationStage\)[\s\S]*failAndEmit\("1402", invalidVideoReason, diagnostics\)/);
  assert.match(nativeView, /Log\.e\([\s\S]*"record stop failed during finish: \$\{diagnostics\}"/);
  assert.match(nativeView, /Log\.e\(LOG_TAG, "record stop failed validation: reason=\$\{invalidVideoReason\}; \$\{diagnostics\}"\)/);
  assert.match(nativeView, /failAndEmit\("1402", stopErrorMessage, diagnostics\)/);
  assert.match(nativeView, /failAndEmit\("1402", "录像停止失败", diagnostics\)/);
  assert.match(nativeView, /val finalVideoBurnIn = requestedVideoBurnIn && !hadFrameError && recorder\.videoSampleCount > 0/);
  assert.match(nativeView, /if \(!recorder\.encodeFrame\(targetBitmap\)\) \{[\s\S]*recorder\.diagnostics\(RECORD_STAGE_VIDEO_INPUT_BUFFER\)/);
  assert.doesNotMatch(nativeView, /throw IllegalStateException\("视频帧编码未写入"\)/);
  assert.match(nativeView, /catch \(throwable: Throwable\) \{[\s\S]*markRecordingFrameError\(recorder\.currentStage\(\), throwable\)[\s\S]*"record frame encode failed: \$\{recorder\.diagnostics\(\)\}"/);
  assert.doesNotMatch(nativeView, /emitError\("1402", "录像帧编码失败"/);
  assert.match(nativeView, /appendWatermarkResult\(startPayload, frozenWatermark, false, recordingVideoBurnIn\)/);
  assert.match(nativeView, /recordingWatermarkBitmap = frozenWatermarkBitmap/);
  assert.match(nativeView, /recycleBitmap\(frozenWatermarkBitmap\)/);
  assert.doesNotMatch(nativeView, /VideoSource\.CAMERA/);
  assert.match(nativeView, /requestedFlashMode = UI_FLASH_OFF/);
  assert.match(nativeView, /requestedZoomMode = UI_ZOOM_1X/);
  assert.match(nativeView, /requestedCameraFacing = UI_CAMERA_BACK/);
  assert.match(nativeView, /val nextMode = if \(mode == "video"\) "video" else "photo"/);
  assert.match(nativeView, /if \(nextMode == currentMode\) \{[\s\S]*return[\s\S]*currentMode = nextMode/);
  assert.match(nativeView, /fun setFlashMode\(mode: String\): String/);
  assert.match(nativeView, /fun setZoomMode\(mode: String\): String/);
  assert.match(nativeView, /fun switchCamera\(\): String/);
  assert.match(nativeView, /fun openSystemAlbum\(mediaUri: String\): String/);
  assert.match(nativeView, /Intent\(Intent\.ACTION_VIEW, targetUri\)/);
  assert.match(nativeView, /addFlags\(Intent\.FLAG_ACTIVITY_NEW_TASK\)/);
  assert.match(nativeView, /context\.startActivity\(intent\)/);
  assert.match(nativeView, /lastPublishedMediaUri/);
  assert.match(nativeView, /lastPublishedMediaKind/);
  assert.match(nativeView, /lastPublishedAlbumUri/);
  assert.match(nativeView, /private fun rememberPublishedMedia\(albumResult: AlbumSaveResult, kind: String\)/);
  assert.match(nativeView, /private fun albumOpenUri\(mediaUri: String\): Uri/);
  assert.match(nativeView, /private fun albumOpenMimeType\(mediaUri: String\): String/);
  assert.match(nativeView, /return Uri\.parse\(preferredUri\)/);
  assert.match(nativeView, /Intent\.FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(nativeView, /if \(recording \|\| recordingStartPending \|\| recordingStopRequested \|\| photoBusy\) \{[\s\S]*failAndEmit\("1105", "拍摄或保存中不能切换摄像头", "switchCamera while busy"\)/);
  assert.match(nativeView, /val previousFacing = requestedCameraFacing/);
  assert.match(nativeView, /val nextFacing = nextCameraFacing\(previousFacing\)/);
  assert.match(nativeView, /val targetCameraId = resolveCameraIdForFacing\(nextFacing\)/);
  assert.match(nativeView, /requestedCameraFacing = nextFacing/);
  assert.match(nativeView, /requestedZoomMode = UI_ZOOM_1X/);
  assert.match(nativeView, /if \(requestedCameraFacing == UI_CAMERA_FRONT\) \{[\s\S]*requestedFlashMode = UI_FLASH_OFF/);
  assert.match(nativeView, /requestedCameraFacing = previousFacing[\s\S]*requestedZoomMode = previousZoomMode[\s\S]*requestedFlashMode = previousFlashMode/);
  assert.match(nativeView, /emit\("camerachange", data\)/);
  assert.match(nativeView, /val normalizedMode = normalizeFlashMode\(mode\)/);
  assert.match(nativeView, /val normalizedMode = normalizeZoomMode\(mode\)/);
  assert.match(nativeView, /fun setZoomMode\(mode: String\): String \{[\s\S]*if \(!applied && requestedZoomMode != UI_ZOOM_1X\) \{[\s\S]*requestedZoomMode = UI_ZOOM_1X/);
  assert.match(nativeView, /flashModePayload\(normalizedMode, previousMode, applied\)/);
  assert.match(nativeView, /\.put\("requestedFlashMode", requestedMode\)/);
  assert.match(nativeView, /\.put\("requestedZoomMode", normalizedMode\)/);
  assert.match(nativeView, /\.put\("applied", applied\)/);
  assert.match(nativeView, /unsupportedFlashModeMessage/);
  assert.match(nativeView, /unsupportedZoomModeMessage/);
  assert.match(nativeView, /unsupportedCameraFacingMessage/);
  assert.match(nativeView, /cameraSwitchPayload/);
  assert.match(nativeView, /camera \?: return requestedFlashMode == UI_FLASH_OFF/);
  assert.match(nativeView, /camera \?: return requestedZoomMode == UI_ZOOM_1X/);
  assert.match(nativeView, /supportedFlashModes/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_OFF/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_AUTO/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_TORCH/);
  assert.match(nativeView, /UI_FLASH_ON -> \{[\s\S]*if \(supportedModes\.contains\(Camera\.Parameters\.FLASH_MODE_TORCH\)\) \{[\s\S]*Camera\.Parameters\.FLASH_MODE_TORCH/);
  assert.match(nativeView, /currentMode == "photo" && supportedModes\.contains\(Camera\.Parameters\.FLASH_MODE_ON\)/);
  assert.match(nativeView, /Camera\.Parameters\.FLASH_MODE_ON/);
  assert.match(nativeView, /val previousFlashMode = parameters\.flashMode/);
  assert.match(nativeView, /if \(parameters\.flashMode != previousFlashMode\) \{[\s\S]*activeCamera\.parameters = parameters[\s\S]*refreshPreviewForFlash\(activeCamera\)/);
  assert.match(nativeView, /flashModePayload\(normalizedMode, previousMode, applied\)/);
  assert.match(nativeView, /\.put\("supportedFlashModes", flashModesPayload\(supportedModes\)\)/);
  assert.match(nativeView, /\.put\("nativeFlashMode", resolvedNativeMode \?: ""\)/);
  assert.match(nativeView, /\.put\("actualFlashMode", actualFlashMode\)/);
  assert.match(nativeView, /Log\.i\([\s\S]*LOG_TAG,[\s\S]*"flash mode request requested=\$\{normalizedMode\}/);
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
  assert.match(nativeView, /resolveCameraIdForFacing\(facing: String\)/);
  assert.match(nativeView, /findFrontCameraId\(\)/);
  assert.match(nativeView, /findCameraIdByFacing\(Camera\.CameraInfo\.CAMERA_FACING_FRONT\)/);
  assert.match(nativeView, /if \(requestedCameraFacing == UI_CAMERA_FRONT\) \{[\s\S]*return findFrontCameraId\(\)/);
  assert.match(nativeView, /resolveWideBackCameraId\(\)/);
  assert.match(nativeView, /Wide camera is not exposed by Camera1/);
  assert.match(nativeView, /if \(requestedCameraFacing == UI_CAMERA_BACK && resolveWideBackCameraId\(\) >= 0\) \{[\s\S]*modes\.put\(UI_ZOOM_WIDE\)/);
  assert.match(nativeView, /zoomModesPayload/);
  assert.match(nativeView, /zoomModesPayload\(parameters: Camera\.Parameters\?\)[\s\S]*val score = abs\(ratios\[index\] - 200\)[\s\S]*if \(ratios\[bestIndex\] >= 190\) \{[\s\S]*modes\.put\(UI_ZOOM_2X\)/);
  assert.match(nativeView, /cameraFacingsPayload/);
  assert.match(nativeView, /\.put\("cameraFacing", activeCameraFacing\(\)\)/);
  assert.match(nativeView, /\.put\("availableCameraFacings", cameraFacingsPayload\(\)\)/);
  assert.match(nativeView, /const val UI_CAMERA_BACK = "back"/);
  assert.match(nativeView, /const val UI_CAMERA_FRONT = "front"/);
  assert.match(nativeView, /if \(muxerStarted && videoSampleCount > 0\) \{[\s\S]*muxer\?\.stop\(\)/);
  assert.match(nativeView, /muxer\?\.release\(\)/);
  assert.match(nativeView, /throw stageFailure\(RECORD_STAGE_VIDEO_EOS, IllegalStateException\("Timed out waiting for video encoder input buffer\."\)\)/);
  assert.match(nativeView, /writeMuxerSample\(activeMuxer, videoTrackIndex, encodedData, bufferInfo, isAudio = false, RECORD_STAGE_MUXER_WRITE_VIDEO_SAMPLE\)/);
  assert.match(nativeView, /targetFps = fps/);
  assert.match(nativeView, /DEFAULT_TARGET_FPS = 30/);
  assert.match(nativeView, /chooseCameraSize\(sizes: List<Camera\.Size>\?, targetSize: XycSize\? = null\)/);
  assert.match(nativeView, /sizeFitsQualityCap\(it\.width, it\.height\)/);
  assert.match(nativeView, /private fun shouldRotateRecordingOutput\(\): Boolean/);
  assert.match(nativeView, /val fallbackWidth = if \(shouldRotateRecordingOutput\(\)\) videoSize\.height else videoSize\.width/);
  assert.match(nativeView, /val fallbackHeight = if \(shouldRotateRecordingOutput\(\)\) videoSize\.width else videoSize\.height/);
  assert.match(nativeView, /previewView\.width\.takeIf \{ it > 0 \} \?: fallbackWidth/);
  assert.match(nativeView, /previewView\.height\.takeIf \{ it > 0 \} \?: fallbackHeight/);
  assert.match(nativeView, /MAX_CAMERA_SIZE_LONG_EDGE = 1920/);
  assert.match(nativeView, /MAX_CAMERA_SIZE_PIXELS = 2_073_600/);
  assert.match(nativeView, /MAX_PHOTO_SIZE_LONG_EDGE = 3000/);
  assert.match(nativeView, /MAX_PHOTO_SIZE_PIXELS = 6_000_000/);
  assert.match(nativeView, /CAMERA_FRAME_ASPECT_SHORT_EDGE = 3f/);
  assert.match(nativeView, /CAMERA_FRAME_ASPECT_LONG_EDGE = 4f/);
  assert.match(nativeView, /PHOTO_JPEG_QUALITY = 90/);
  assert.match(nativeView, /val targetAspect = targetCameraFrameAspect\(\)[\s\S]*compareBy<Camera\.Size> \{ aspectDelta\(it\.width, it\.height, targetAspect\) \}[\s\S]*\.thenByDescending \{ it\.width \* it\.height \}/);
  assert.match(nativeView, /MAX_RECORDING_LONG_EDGE = 960/);
  assert.match(nativeView, /MAX_RECORDING_PIXELS = 691_200/);
  assert.match(nativeView, /WATERMARK_OVERLAY_DIRTY_PADDING_PX = 4/);
  assert.match(nativeView, /bitrate = chooseVideoBitrate\(recordingSize, fps\)/);
  assert.match(nativeView, /includeAudio = RECORD_AUDIO_ENABLED/);
  assert.match(nativeView, /import android\.media\.MediaActionSound/);
  assert.match(nativeView, /MediaActionSound\(\)\.apply \{[\s\S]*load\(MediaActionSound\.SHUTTER_CLICK\)/);
  assert.match(nativeView, /load\(MediaActionSound\.START_VIDEO_RECORDING\)/);
  assert.match(nativeView, /load\(MediaActionSound\.STOP_VIDEO_RECORDING\)/);
  assert.match(nativeView, /@Volatile private var cameraSoundEnabled = true/);
  assert.match(nativeView, /fun setCameraSoundEnabled\(enabled: Boolean\): String \{[\s\S]*cameraSoundEnabled = enabled[\s\S]*\.put\("cameraSoundEnabled", cameraSoundEnabled\)[\s\S]*"提示音已开启"[\s\S]*"提示音已关闭"/);
  assert.match(nativeView, /import android\.view\.HapticFeedbackConstants/);
  assert.match(nativeView, /fun performHapticFeedback\(type: String\): String \{[\s\S]*val normalizedType = normalizeHapticType\(type\)[\s\S]*HapticFeedbackConstants\.LONG_PRESS[\s\S]*HapticFeedbackConstants\.KEYBOARD_TAP[\s\S]*this@XycNativeCameraView\.performHapticFeedback\(feedbackType\)[\s\S]*\.put\("hapticType", normalizedType\)[\s\S]*\.put\("applied", applied\)/);
  assert.match(nativeView, /private fun shouldShowCenterStatus\(text: String\): Boolean \{[\s\S]*!text\.startsWith\("焦段："\)[\s\S]*!text\.startsWith\("闪光灯："\)[\s\S]*!text\.startsWith\("提示音已"\)[\s\S]*text != "闪光灯切换中"[\s\S]*text != "摄像头切换中"[\s\S]*text != "当前设备不支持切换摄像头"[\s\S]*text != "前置摄像头"[\s\S]*text != "后置摄像头"/);
  assert.match(nativeView, /val defaultShutterSoundDisabled = disableDefaultShutterSound\(activeCamera\)[\s\S]*takePicture\(Camera\.ShutterCallback \{/);
  assert.match(nativeView, /takePicture\(Camera\.ShutterCallback \{[\s\S]*if \(defaultShutterSoundDisabled\) \{[\s\S]*playCameraActionSound\(MediaActionSound\.SHUTTER_CLICK\)/);
  assert.doesNotMatch(nativeView, /takePicture\(Camera\.ShutterCallback \{\s*playCameraActionSound\(MediaActionSound\.SHUTTER_CLICK\)/);
  assert.match(nativeView, /playCameraActionSound\(MediaActionSound\.START_VIDEO_RECORDING\)[\s\S]*ioHandler\.postDelayed\(\{[\s\S]*startRecordOnIo\(/);
  assert.match(nativeView, /recorder\.finish\(\)[\s\S]*playCameraActionSound\(MediaActionSound\.STOP_VIDEO_RECORDING\)/);
  assert.match(nativeView, /private fun playCameraActionSound\(soundName: Int\) \{[\s\S]*if \(!cameraSoundEnabled\) \{[\s\S]*return[\s\S]*mediaActionSound\.play\(soundName\)/);
  assert.match(nativeView, /private fun disableDefaultShutterSound\(activeCamera: Camera\): Boolean \{[\s\S]*activeCamera\.enableShutterSound\(false\)[\s\S]*disable default shutter sound failed/);
  assert.doesNotMatch(nativeView, /finally \{[\s\S]{0,120}playCameraActionSound\(MediaActionSound\.STOP_VIDEO_RECORDING\)/);
  assert.match(nativeView, /private fun releaseCameraActionSound\(\) \{[\s\S]*mediaActionSound\.release\(\)/);
  assert.match(nativeView, /MIN_VIDEO_BITRATE = 12_000_000/);
  assert.match(nativeView, /MAX_VIDEO_BITRATE = 30_000_000/);
  assert.match(nativeView, /VIDEO_BITRATE_PIXEL_DIVISOR = 1/);
  assert.match(nativeView, /RECORD_START_SOUND_GUARD_MS = 180L/);
  assert.match(nativeView, /RECORD_START_WARMUP_MS = 700L/);
  assert.match(nativeView, /RECORD_AUDIO_REQUIRED_AFTER_MS = RECORD_START_WARMUP_MS \+ 500L/);
  assert.match(nativeView, /RECORD_AUDIO_ENABLED = true/);
  assert.doesNotMatch(nativeView, /RECORD_AUDIO_ENABLED = false/);
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
  assert.match(nativeView, /createVideoThumbnail\(outputTarget\)/);
  assert.match(nativeView, /MediaMetadataRetriever/);
  assert.match(nativeView, /\.put\("thumbnailPath", thumbnailPath\)/);
  assert.match(nativeView, /\.put\("mediaKind", kind\)/);
  assert.match(nativeView, /appendAlbumSuccess\(dataPayload, albumResult, "照片已保存到相册", "photo"\)/);
  assert.match(nativeView, /appendAlbumSuccess\(data, albumResult, "视频已保存到相册", "video"\)/);
  assert.match(nativeView, /private var recordingOutputSize = XycSize\(1280, 720\)/);
  assert.match(nativeView, /@Volatile private var recordingStartPending = false/);
  assert.match(nativeView, /private var videoOutputTarget: VideoOutputTarget\? = null/);
  assert.match(nativeView, /val recordTarget = createVideoOutputTarget\(\)/);
  assert.match(nativeView, /outputFileDescriptor = recordTarget\.fileDescriptor/);
  assert.doesNotMatch(nativeView, /recorder\.start\(\)[\s\S]{0,120}recordTarget\.closeDescriptor\(\)/);
  assert.doesNotMatch(nativeView, /fun startRecord\(optionsJson: String\): String \{[\s\S]*recorder\.start\(\)/);
  assert.match(nativeView, /private fun startRecordOnIo\([\s\S]*val recordTarget = createVideoOutputTarget\(\)[\s\S]*createVideoWatermarkOverlay\(recordingSize, frozenWatermark, frozenWatermarkBitmap\)[\s\S]*nextRecorder\.start\(\)/);
  assert.match(nativeView, /recordingStartPending = true[\s\S]*playCameraActionSound\(MediaActionSound\.START_VIDEO_RECORDING\)[\s\S]*ioHandler\.postDelayed\(\{[\s\S]*startRecordOnIo/);
  assert.match(nativeView, /transferredToRecording = runOnMainSync \{[\s\S]*recordingOutputSize = recordingSize[\s\S]*recording = true[\s\S]*recordingStartPending = false[\s\S]*startVideoFrameLoop\(\)[\s\S]*emit\("recordstart", startPayload\)/);
  assert.match(nativeView, /if \(recordingStartPending\) \{[\s\S]*return@runOnMainSync ok\(payload\(\)\.put\("message", "录像启动中"\)\)/);
  assert.match(nativeView, /recording \|\| recordingStartPending \|\| recordingStopRequested \|\| photoBusy/);
  assert.match(nativeView, /recording \|\| recordingStartPending \|\| photoBusy/);
  assert.match(nativeView, /recordingStartPending = false[\s\S]*recordingFramesCanWriteAt = 0L/);
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
  assert.match(nativeView, /\.put\("recordVideoSampleCount", recorder\.videoSampleCount\)/);
  assert.match(nativeView, /\.put\("recordVideoBitrate", recorder\.bitrate\)/);
  assert.match(nativeView, /\.put\("recordAudioEnabled", recorder\.includeAudio\)/);
  assert.match(nativeView, /\.put\("recordAudioSampleCount", recorder\.audioSampleCount\)/);
  assert.match(nativeView, /\.put\("recordAudioPcmPeakAbs", recorder\.audioPcmPeakAbs\)/);
  assert.match(nativeView, /\.put\("recordAudioReadErrorCount", recorder\.audioReadErrorCount\)/);
  assert.match(nativeView, /\.put\("recordFileBytes", max\(0L, fileBytes\)\)/);
  assert.match(nativeView, /var videoSampleCount: Int = 0[\s\S]*private set/);
  assert.match(nativeView, /var audioSampleCount: Int = 0[\s\S]*private set/);
  assert.match(nativeView, /var audioPcmPeakAbs: Int = 0[\s\S]*private set/);
  assert.match(nativeView, /var audioReadErrorCount: Int = 0[\s\S]*private set/);
  assert.match(nativeView, /var audioDiscardedReadCount: Int = 0[\s\S]*private set/);
  assert.match(nativeView, /private var videoStartedAtNs = 0L/);
  assert.match(nativeView, /private var lastVideoPresentationTimeUs = -1L/);
  assert.match(nativeView, /lastVideoPresentationTimeUs = -1L/);
  assert.match(nativeView, /private var videoPresentationOffsetUs = -1L/);
  assert.match(nativeView, /private var audioPresentationOffsetUs = -1L/);
  assert.match(nativeView, /audioThread\?\.join\(max\(1L, deadlineMs - System\.currentTimeMillis\(\)\)\)/);
  assert.match(nativeView, /if \(audioThread\?\.isAlive == true\) \{[\s\S]*throw stageFailure\(RECORD_STAGE_AUDIO_THREAD_JOIN, IllegalStateException\("Timed out waiting for audio encoder thread\."\)\)/);
  assert.match(nativeView, /recordingFramesCanWriteAt = recordingStartedAt \+ RECORD_START_WARMUP_MS/);
  assert.match(nativeView, /if \(frameStartedAt < recordingFramesCanWriteAt\) \{/);
  assert.doesNotMatch(nativeView, /shouldRecycleImageBitmap && imageBitmap != null/);
  assert.match(nativeView, /if \(writeMuxerSample\(activeMuxer, videoTrackIndex, encodedData, bufferInfo, isAudio = false, RECORD_STAGE_MUXER_WRITE_VIDEO_SAMPLE\)\) \{[\s\S]*videoSampleCount \+= 1/);
  assert.match(nativeView, /if \(System\.nanoTime\(\) - audioStartedAtNs < RECORD_START_WARMUP_MS \* 1_000_000L\) \{[\s\S]*audioDiscardedReadCount \+= 1/);
  assert.match(nativeView, /if \(audioCaptureStartedAtNs == 0L\) \{[\s\S]*audioCaptureStartedAtNs = System\.nanoTime\(\)/);
  assert.match(nativeView, /updateAudioPeak\(inputBuffer, bytesRead\)[\s\S]*codec\.queueInputBuffer\(inputIndex, 0, bytesRead, audioPresentationTimeUs\(\), 0\)/);
  assert.match(nativeView, /else if \(bytesRead < 0\) \{[\s\S]*audioReadErrorCount \+= 1/);
  assert.match(nativeView, /if \(writeMuxerSample\(activeMuxer, audioTrackIndex, encodedData, bufferInfo, isAudio = true, RECORD_STAGE_MUXER_WRITE_AUDIO_SAMPLE\)\) \{[\s\S]*audioSampleCount \+= 1/);
  assert.match(nativeView, /private fun updateAudioPeak\(inputBuffer: java\.nio\.ByteBuffer, bytesRead: Int\) \{/);
  assert.match(nativeView, /private fun nextVideoPresentationTimeUs\(\): Long \{[\s\S]*val nowNs = System\.nanoTime\(\)[\s\S]*if \(videoStartedAtNs == 0L\) \{[\s\S]*videoStartedAtNs = nowNs[\s\S]*val elapsedUs = max\(0L, \(nowNs - videoStartedAtNs\) \/ 1000L\)[\s\S]*max\(lastVideoPresentationTimeUs \+ 1L, elapsedUs\)/);
  assert.match(nativeView, /private fun writeMuxerSample\([\s\S]*isAudio: Boolean,[\s\S]*stage: String[\s\S]*\): Boolean \{[\s\S]*if \(!muxerStarted \|\| trackIndex < 0\) return false[\s\S]*val originalPresentationTimeUs = bufferInfo\.presentationTimeUs[\s\S]*videoPresentationOffsetUs = originalPresentationTimeUs[\s\S]*bufferInfo\.presentationTimeUs = max\(0L, originalPresentationTimeUs - videoPresentationOffsetUs\)[\s\S]*activeMuxer\.writeSampleData\(trackIndex, encodedData, bufferInfo\)[\s\S]*bufferInfo\.presentationTimeUs = originalPresentationTimeUs[\s\S]*return true/);
  assert.match(nativeView, /private fun applyVideoBitrateMode\(format: MediaFormat, codecInfo: MediaCodecInfo\) \{[\s\S]*BITRATE_MODE_CBR/);
  assert.match(nativeView, /recordAudioDiscardedReadCount/);
  assert.match(nativeView, /recordStartWarmupMs/);
  assert.match(nativeView, /RECORD_STAGE_AUDIO_THREAD_JOIN = "audio_thread_join"/);
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

  assert.match(prd, /pages\/index\/index\.uvue/);
  assert.match(prd, /pages\/cameraX\/index\.uvue/);
  assert.match(prd, /\/static\/watermark\/logo3\.png/);
  assert.match(prd, /最多 1 个/);
  assert.match(prd, /双指捏合缩放/);
  assert.match(prd, /右下角缩放图标作为贴纸缩放提示/);
  assert.match(prd, /左上角按钮每次旋转 90 度/);
  assert.match(prd, /松手、拍照前和录像前必须 flush 最新水印/);
  assert.match(prd, /固定画幅合同/);
  assert.match(prd, /原生相机画幅目标固定为 4:3/);
  assert.match(prd, /竖屏预览为 3:4/);
  assert.match(prd, /预览、拍照、录像和水印坐标必须共享同一个画幅模型/);
  assert.match(prd, /尺寸上限不得改变 4:3 目标/);
  assert.match(prd, /相机视角为顶部白色控制区和底部白色控制区之间的居中 3:4 区域/);
  assert.match(prd, /内容及编辑控件不得超出相机视角可编辑区域/);
  assert.match(prd, /拍照键左侧展示最近一次拍照或录像缩略图，点击打开本机相册；右侧入口为水印设置/);
  assert.doesNotMatch(prd, /系统相册跳转先保留占位提示/);
  assert.doesNotMatch(prd, /拍照键左侧入口打开本次拍照\/录像结果缓存弹层/);
  assert.match(prd, /编辑控件不随内容旋转/);
  assert.match(prd, /照片输出/);
  assert.match(prd, /PixelCopy/);
  assert.match(prd, /MediaCodec/);
  assert.match(prd, /AudioRecord/);
  assert.match(prd, /watermarkVideoBurnIn=true/);
});

test('xyc-markvideo avoids plugin Android manifest so standard base uses app permissions', async () => {
  await assert.rejects(
    readFile(path.join(root, 'uni_modules/xyc-markvideo/utssdk/app-android/AndroidManifest.xml'), 'utf8'),
    /ENOENT/,
  );
});

test('uni-app x app entry is declared in manifest', async () => {
  const main = await readFile(path.join(root, 'main.uts'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const permissions = manifest['app-plus'].distribute.android.permissions.join('\n');

  assert.match(main, /createSSRApp/);
  assert.equal(manifest.vueVersion, '3');
  assert.deepEqual(manifest['uni-app-x'], {});
  assert.match(permissions, /android\.permission\.CAMERA/);
  assert.match(permissions, /android\.permission\.RECORD_AUDIO/);
  assert.match(permissions, /android\.permission\.WRITE_EXTERNAL_STORAGE/);
  assert.match(permissions, /android:maxSdkVersion="28"/);
});
