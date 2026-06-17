import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');

const requiredFiles = [
  'README.md',
  'docs/api.md',
  'docs/roadmap.md',
  'App.vue',
  'main.js',
  'manifest.json',
  'pages.json',
  'pages/index/index.vue',
  'uni_modules/uts-markvideo/package.json',
  'uni_modules/uts-markvideo/utssdk/interface.uts',
  'uni_modules/uts-markvideo/utssdk/app-android/index.uts',
  'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt',
  'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt',
  'uni_modules/uts-markvideo/utssdk/app-android/AndroidManifest.xml',
  'uni_modules/uts-markvideo/utssdk/app-ios/index.uts',
  'uni_modules/uts-markvideo/utssdk/app-ios/Info.plist',
  'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift',
];

test('demo app contains the native UTS plugin MVP files', async () => {
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
});

test('camera MVP exposes a recordWatermarkVideo API', async () => {
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );
  const androidBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.uts'),
    'utf8',
  );
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');

  assert.match(interfaceText, /RecordWatermarkVideo/);
  assert.match(androidBridge, /recordWatermarkVideo/);
  assert.match(page, /recordWatermarkVideo/);
});

test('recordWatermarkVideo API spec documents grouped options and legacy compatibility', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');

  assert.match(api, /watermark/);
  assert.match(api, /video/);
  assert.match(api, /camera/);
  assert.match(api, /limits/);
  assert.match(api, /Compatibility/);
  assert.match(api, /watermark\.text.*text/s);
  assert.match(api, /video\.fps.*fps/s);
  assert.match(api, /fps.*bitrate.*includeAudio.*width.*height/s);
  assert.match(api, /Camera recording ignores[\s\S]*native preview display size/);
  assert.match(api, /maxDurationMs.*minDurationMs/s);
  assert.match(api, /diagnostics/);
  assert.match(api, /perfLogging/);
});

test('optimization roadmap records Android APK stutter diagnosis', async () => {
  const roadmap = await readFile(path.join(root, 'docs/roadmap.md'), 'utf8');

  assert.match(roadmap, /Android APK smoke test/);
  assert.match(roadmap, /visibly stuttery/);
  assert.match(roadmap, /visible loading delay/);
  assert.match(roadmap, /YUV_420_888/);
  assert.match(roadmap, /Convert ARGB back to YUV420/);
  assert.match(roadmap, /measurement instrumentation/);
  assert.match(roadmap, /demo test controls/);
  assert.match(roadmap, /GPU\/surface pipeline/);
  assert.match(roadmap, /OpenGL/);
  assert.match(roadmap, /CameraX/);
});

test('recordWatermarkVideo API documents Android frame statistics', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );

  assert.match(interfaceText, /stats\?: MarkVideoFrameStats/);
  assert.match(api, /stats\?:/);
  assert.match(api, /received/);
  assert.match(api, /droppedBusy/);
  assert.match(api, /droppedFps/);
  assert.match(api, /processed/);
  assert.match(api, /encoded/);
});

test('recordWatermarkVideo supports Android image and mixed watermark inputs', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );
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
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');

  assert.match(interfaceText, /imagePath\?: string/);
  assert.match(api, /imagePath/);
  assert.match(api, /image alone/);
  assert.match(api, /next to `text`/);
  assert.match(page, /chooseWatermarkImage/);
  assert.match(page, /uni\.chooseImage/);
  assert.match(page, /watermarkImagePath/);
  assert.match(page, /imagePath: this\.watermarkImagePath/);
  assert.match(androidBridge, /const imagePath = options\.watermark\?\.imagePath \?\? ''/);
  assert.match(androidBridge, /MarkVideoNative\.openCameraRecorder\(\s*text,\s*imagePath,/s);
  assert.match(nativeBridge, /EXTRA_WATERMARK_IMAGE_PATH/);
  assert.match(nativeBridge, /putExtra\(EXTRA_WATERMARK_IMAGE_PATH, imagePath\)/);
  assert.match(activity, /BitmapFactory/);
  assert.match(activity, /watermarkImagePath/);
  assert.match(activity, /loadWatermarkImage/);
  assert.match(activity, /contentResolver\.openInputStream/);
  assert.match(activity, /drawBitmap\(logo/);
  assert.match(activity, /releaseWatermarkImages/);
});

test('recordWatermarkVideo supports configurable Android watermark styling', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );
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
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');

  assert.doesNotMatch(interfaceText, /MarkVideoWatermarkTextStyle/);
  assert.doesNotMatch(interfaceText, /MarkVideoWatermarkImageStyle/);
  assert.doesNotMatch(interfaceText, /MarkVideoWatermarkBoxStyle/);
  assert.match(interfaceText, /x\?: number/);
  assert.match(interfaceText, /textColor\?: string/);
  assert.match(interfaceText, /textBold\?: boolean/);
  assert.match(interfaceText, /imageWidth\?: number/);
  assert.match(interfaceText, /boxWidth\?: number/);
  assert.doesNotMatch(interfaceText, /textStyle\?:/);
  assert.doesNotMatch(interfaceText, /imageStyle\?:/);
  assert.doesNotMatch(interfaceText, /boxStyle\?:/);
  assert.match(api, /Keep these style options flat/);
  assert.match(api, /JSONObject/);
  assert.match(api, /textColor/);
  assert.match(api, /imageWidth/);
  assert.match(api, /backgroundColor/);
  assert.match(androidBridge, /options\.watermark\?\.textColor/);
  assert.match(androidBridge, /options\.watermark\?\.imageHeight/);
  assert.match(androidBridge, /options\.watermark\?\.backgroundColor/);
  assert.doesNotMatch(androidBridge, /textStyle/);
  assert.doesNotMatch(androidBridge, /imageStyle/);
  assert.doesNotMatch(androidBridge, /boxStyle/);
  assert.match(nativeBridge, /EXTRA_WATERMARK_TEXT_COLOR/);
  assert.match(nativeBridge, /EXTRA_WATERMARK_IMAGE_WIDTH/);
  assert.match(nativeBridge, /EXTRA_WATERMARK_BOX_BACKGROUND_COLOR/);
  assert.match(nativeBridge, /putExtra\(EXTRA_WATERMARK_TEXT_FONT_SIZE, textFontSize/);
  assert.match(activity, /parseColorExtra/);
  assert.match(activity, /watermarkTextColor/);
  assert.match(activity, /watermarkTextFontSize/);
  assert.match(activity, /watermarkImageWidth/);
  assert.match(activity, /watermarkBoxBackgroundColor/);
  assert.match(activity, /watermarkBoxWidthRatio/);
  assert.match(activity, /watermarkBoxBorderRadius/);
  assert.match(activity, /getScaledWatermarkImage\(defaultLogoHeight/);
  assert.match(activity, /canvas\.drawRoundRect\(bandRect, watermarkBoxBorderRadius, watermarkBoxBorderRadius, bandPaint\)/);
  assert.match(page, /textColor: '#ffffff'/);
  assert.match(page, /imageHeight: 58/);
  assert.match(page, /boxWidth: 0\.88/);
  assert.doesNotMatch(page, /textStyle: \{/);
  assert.doesNotMatch(page, /imageStyle: \{/);
  assert.doesNotMatch(page, /boxStyle: \{/);
});

test('Android recorder previews the same draggable watermark style that it records', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(api, /long-press and drag the watermark preview/);
  assert.match(activity, /import android\.view\.MotionEvent/);
  assert.match(activity, /import android\.view\.ViewConfiguration/);
  assert.match(activity, /private lateinit var watermarkOverlay: WatermarkOverlayView/);
  assert.match(activity, /private inner class WatermarkOverlayView/);
  assert.match(activity, /override fun onDraw\(canvas: Canvas\)/);
  assert.match(activity, /drawWatermarkOnCanvas\(canvas, width, height\)/);
  assert.match(activity, /private fun drawWatermark\(source: Bitmap\)[\s\S]*drawWatermarkOnCanvas\(Canvas\(source\), source\.width, source\.height\)/);
  assert.match(activity, /private fun drawWatermarkOnCanvas\(canvas: Canvas, width: Int, height: Int\)/);
  assert.match(activity, /watermarkCenterXRatio/);
  assert.match(activity, /watermarkCenterYRatio/);
  assert.match(activity, /watermarkLongPressRunnable/);
  assert.match(activity, /ViewConfiguration\.getLongPressTimeout\(\)/);
  assert.match(activity, /handleWatermarkOverlayTouch/);
  assert.match(activity, /ACTION_DOWN/);
  assert.match(activity, /ACTION_MOVE/);
  assert.match(activity, /ACTION_UP/);
  assert.match(activity, /updateWatermarkOverlayPosition/);
  assert.match(activity, /updateWatermarkRatiosFromOverlay/);
  assert.match(activity, /positionWatermarkOverlayFromRatio/);
  assert.match(activity, /updateWatermarkRatiosFromOverlay\(\)[\s\S]*recordingSize = chooseRecordingSizeFromPreview/);
  assert.match(activity, /width \* watermarkCenterXRatio/);
  assert.match(activity, /height \* watermarkCenterYRatio/);
  assert.match(activity, /Long-press watermark to drag before recording/);
});

test('recordWatermarkVideo result exposes gallery-saved video path', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );
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
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');

  assert.match(interfaceText, /savedFilePath\?: string/);
  assert.match(api, /savedFilePath\?: string/);
  assert.match(api, /system gallery/);
  assert.match(androidBridge, /savedFilePath: savedFilePath/);
  assert.match(nativeBridge, /onSuccess: \(String, String, Long/);
  assert.match(nativeBridge, /callback\?\.invoke\(\s*path,\s*savedPath,/s);
  assert.match(activity, /MediaStore\.Video\.Media/);
  assert.match(activity, /RELATIVE_PATH/);
  assert.match(activity, /IS_PENDING/);
  assert.match(activity, /Movies\/uts-markvideo/);
  assert.match(activity, /publishToGallery\(file\)/);
  assert.match(page, /res\.savedFilePath \|\| res\.tempFilePath/);
  assert.match(page, /savedFilePath/);
});

test('recordWatermarkVideo exposes stable recorder error codes', async () => {
  const api = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');
  const androidBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.uts'),
    'utf8',
  );
  const iosBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'),
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
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  for (const code of ['1000', '1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008']) {
    assert.match(api, new RegExp(`\`${code}\``));
    assert.match(page, new RegExp(`${code}:`));
  }

  assert.match(api, /1100/);
  assert.match(api, /2100/);
  assert.match(androidBridge, /\(code: number, message: string\)/);
  assert.match(androidBridge, /errCode: code/);
  assert.match(androidBridge, /errCode: 1100/);
  assert.match(iosBridge, /\(code: number, message: string\)/);
  assert.match(iosBridge, /errCode: code/);
  assert.match(iosBridge, /errCode: 2100/);
  assert.doesNotMatch(androidBridge, /errCode: 1101/);
  assert.doesNotMatch(iosBridge, /errCode: 2101/);
  assert.match(nativeBridge, /ERR_PERMISSION_DENIED = 1001/);
  assert.match(nativeBridge, /ERR_ENCODER_UNAVAILABLE = 1008/);
  assert.match(nativeBridge, /try \{\s*val intent = Intent/s);
  assert.match(nativeBridge, /Open native recorder activity failed/);
  assert.match(activity, /classifyRecorderStartError/);
  assert.match(activity, /MarkVideoException/);
  assert.match(swift, /ErrorCode\.permissionDenied/);
  assert.match(swift, /ErrorCode\.recordingTooShort/);
  assert.match(page, /errorLabel\(err\.errCode\)/);
});

test('UTS interface exposes grouped recorder option types', async () => {
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );
  const androidBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.uts'),
    'utf8',
  );
  const iosBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'),
    'utf8',
  );

  assert.match(interfaceText, /MarkVideoWatermarkOptions/);
  assert.match(interfaceText, /MarkVideoVideoOptions/);
  assert.match(interfaceText, /MarkVideoCameraOptions/);
  assert.match(interfaceText, /MarkVideoRecordLimits/);
  assert.match(interfaceText, /MarkVideoDiagnosticsOptions/);
  assert.match(interfaceText, /MarkVideoFrameStats/);
  assert.match(interfaceText, /MarkVideoErrorCode/);
  assert.match(androidBridge, /options\.watermark\?\.text/);
  assert.match(androidBridge, /options\.video\?\.fps/);
  assert.match(androidBridge, /options\.video\?\.includeAudio/);
  assert.match(androidBridge, /options\.camera\?\.facing/);
  assert.match(androidBridge, /options\.limits\?\.maxDurationMs/);
  assert.match(androidBridge, /options\.diagnostics\?\.perfLogging/);
  assert.match(iosBridge, /options\.watermark\?\.text/);
  assert.match(iosBridge, /options\.video\?\.fps/);
  assert.match(iosBridge, /options\.video\?\.includeAudio/);
  assert.match(iosBridge, /options\.camera\?\.facing/);
  assert.match(iosBridge, /options\.limits\?\.maxDurationMs/);
  assert.match(iosBridge, /options\.diagnostics\?\.perfLogging/);
});

test('demo page exposes Android APK tuning controls', async () => {
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');

  assert.match(page, /v-model\.number="fps"/);
  assert.match(page, /fps: 30/);
  assert.match(page, /fps: this\.safeNumber\(this\.fps, 30\)/);
  assert.doesNotMatch(page, /v-model\.number="width"/);
  assert.doesNotMatch(page, /v-model\.number="height"/);
  assert.match(page, /v-model\.number="bitrate"/);
  assert.match(page, /actual \$\{actualFps\}fps/);
  assert.match(page, /includeAudio/);
  assert.match(page, /perfLogging/);
  assert.match(page, /facing === 'back'/);
  assert.match(page, /facing === 'front'/);
  assert.match(page, /maxDurationMs/);
  assert.match(page, /minDurationMs/);
  assert.match(page, /diagnostics: \{\s*perfLogging: this\.perfLogging/s);
});

test('Android manifest registers the native camera activity', async () => {
  const manifest = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/AndroidManifest.xml'),
    'utf8',
  );

  assert.match(manifest, /MarkVideoCameraActivity/);
});

test('Android camera MVP records microphone audio into the MP4', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /AudioRecord/);
  assert.match(activity, /MIMETYPE_AUDIO_AAC/);
  assert.match(activity, /audio\/mp4a-latm/);
});

test('Android recorder receives grouped video, camera, audio, and limit options', async () => {
  const nativeBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt'),
    'utf8',
  );
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.doesNotMatch(nativeBridge, /EXTRA_WIDTH/);
  assert.doesNotMatch(nativeBridge, /EXTRA_HEIGHT/);
  assert.match(nativeBridge, /coerceIn\(8, 60\)/);
  assert.match(nativeBridge, /EXTRA_BITRATE/);
  assert.match(nativeBridge, /EXTRA_INCLUDE_AUDIO/);
  assert.match(nativeBridge, /EXTRA_CAMERA_FACING/);
  assert.match(nativeBridge, /EXTRA_MAX_DURATION_MS/);
  assert.match(nativeBridge, /EXTRA_PERF_LOGGING/);
  assert.doesNotMatch(activity, /preferredWidth/);
  assert.doesNotMatch(activity, /preferredHeight/);
  assert.match(activity, /targetBitrate/);
  assert.match(activity, /includeAudio/);
  assert.match(activity, /selectCamera/);
  assert.match(activity, /coerceIn\(8, 60\)/);
  assert.match(activity, /CONTROL_AE_TARGET_FPS_RANGE/);
  assert.match(activity, /postDelayed\(autoStopRunnable, maxDurationMs\)/);
  assert.match(activity, /Recording is shorter than/);
  assert.match(activity, /if \(includeAudio\) \{\s*startAudioEncoder\(\)/s);
  assert.match(activity, /if \(!muxerStarted && videoTrackIndex >= 0 && \(!includeAudio \|\| audioTrackIndex >= 0\)\)/);
});

test('Android recorder emits tagged performance logs when enabled', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /PERF_TAG = "UTSMarkVideoPerf"/);
  assert.match(activity, /EXTRA_PERF_LOGGING/);
  assert.match(activity, /perfLog\("activity_on_create"\)/);
  assert.match(activity, /perfLogDuration\("camera_opened"/);
  assert.match(activity, /perfLogDuration\("session_configured"/);
  assert.match(activity, /perfLogDuration\("first_encoded_frame_after_start"/);
  assert.match(activity, /perfLogFrameDuration\("frame_to_bitmap"/);
  assert.match(activity, /perfLogFrameDuration\("frame_draw_watermark"/);
  assert.match(activity, /perfLogFrameDuration\("frame_encode"/);
  assert.match(activity, /val logFramePerf = perfLogging && previewFrameCounter % 30 == 0/);
  assert.match(activity, /shouldLog: Boolean/);
  assert.match(activity, /perfLogDuration\("record_stop_finish"/);
  assert.match(activity, /perfLog\(\s*"frame_stats received=/s);
});

test('Android frame path throttles CPU work and uses native preview surface', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /lastProcessedFrameAtMs/);
  assert.match(activity, /getIntExtra\(MarkVideoNative\.EXTRA_FPS, 30\)/);
  assert.match(activity, /shouldProcessFrame\(\)/);
  assert.match(activity, /1000L \/ targetFps/);
  assert.match(activity, /TextureView/);
  assert.match(activity, /SurfaceTextureListener/);
  assert.match(activity, /previewSurface/);
  assert.match(activity, /setDefaultBufferSize\(captureSize\.width, captureSize\.height\)/);
  assert.match(activity, /chooseRecordingSizeFromPreview/);
  assert.match(activity, /MAX_RECORDING_LONG_EDGE/);
  assert.match(activity, /MAX_RECORDING_PIXELS/);
  assert.match(activity, /previewView\.width/);
  assert.match(activity, /previewView\.height/);
  assert.match(activity, /listOf\(preview, reader\.surface\)/);
  assert.match(activity, /addTarget\(preview\)/);
  assert.match(activity, /addTarget\(reader\.surface\)/);
  assert.match(activity, /try \{\s*camera\.createCaptureSession/s);
  assert.match(activity, /try \{\s*perfLogDuration\("session_configured"/s);
  assert.match(activity, /Camera preview request failed/);
  assert.match(activity, /Create camera session failed/);
  assert.match(activity, /sourceBitmap\.recycle\(\)/);
  assert.doesNotMatch(activity, /setImageBitmap/);
  assert.doesNotMatch(activity, /lastPreviewBitmap/);
});

test('Android TextureView preview does not set a background drawable', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const textureStart = activity.indexOf('previewView = TextureView(this).apply');
  const textureEnd = activity.indexOf('root.addView(previewView', textureStart);

  assert.notEqual(textureStart, -1, 'TextureView preview block should be present');
  assert.notEqual(textureEnd, -1, 'TextureView preview block should end before root.addView');
  const textureBlock = activity.slice(textureStart, textureEnd);

  assert.doesNotMatch(textureBlock, /setBackground(?:Color|Drawable|Resource)?\s*\(/);
});

test('Android ImageReader skips CPU frame work while not recording', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const handlerStart = activity.indexOf('private fun handleNextImage');
  const handlerEnd = activity.indexOf('private fun perfLog', handlerStart);

  assert.notEqual(handlerStart, -1, 'handleNextImage should be present');
  assert.notEqual(handlerEnd, -1, 'handleNextImage should end before perfLog');
  const handlerBody = activity.slice(handlerStart, handlerEnd);
  const previewSnapshotReturn = handlerBody.indexOf('if (previewSnapshotEncoding) {');
  const idleReturn = handlerBody.indexOf('if (!recording) {');
  const frameThrottle = handlerBody.indexOf('shouldProcessFrame()');

  assert.notEqual(previewSnapshotReturn, -1, 'preview snapshot mode should consume ImageReader frames without CPU encoding');
  assert.notEqual(idleReturn, -1, 'inactive frame guard should be present');
  assert.notEqual(frameThrottle, -1, 'frame throttle should still be present');
  assert.ok(previewSnapshotReturn < frameThrottle, 'preview snapshot mode should return before CPU frame work');
  assert.ok(idleReturn < frameThrottle, 'inactive frame guard should run before CPU frame work');
});

test('Android recorder stop keeps recording active until camera thread finalizes', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const stopStart = activity.indexOf('private fun stopRecording');
  const finishStart = activity.indexOf('private fun finishRecordingOnCameraThread');
  const threadStart = activity.indexOf('private fun startCameraThread');

  assert.notEqual(stopStart, -1, 'stopRecording should be present');
  assert.notEqual(finishStart, -1, 'finishRecordingOnCameraThread should be present');
  assert.notEqual(threadStart, -1, 'finishRecordingOnCameraThread should end before startCameraThread');

  const stopBody = activity.slice(stopStart, finishStart);
  const finishBody = activity.slice(finishStart, threadStart);

  assert.match(activity, /FIRST_FRAME_STOP_GRACE_MS/);
  assert.match(stopBody, /stoppingRecording = true/);
  assert.doesNotMatch(stopBody, /recording = false/);
  assert.match(stopBody, /finishRecordingOnCameraThread\(deleteFile, stopRequestedAtMs\)/);
  assert.match(finishBody, /activeRecorder\.frameCount == 0/);
  assert.match(finishBody, /System\.currentTimeMillis\(\) - stopRequestedAtMs < FIRST_FRAME_STOP_GRACE_MS/);
  assert.match(finishBody, /cameraHandler\?\.postDelayed/);
  assert.match(finishBody, /recording = false/);
});

test('Android recorder captures TextureView frames continuously during recording', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const startStart = activity.indexOf('private fun startRecording');
  const stopStart = activity.indexOf('private fun stopRecording');
  const finishStart = activity.indexOf('private fun finishRecordingOnCameraThread');
  const threadStart = activity.indexOf('private fun startCameraThread');
  const loopRunnableStart = activity.indexOf('private val snapshotCaptureRunnable');
  const onCreateStart = activity.indexOf('override fun onCreate', loopRunnableStart);
  const loopStart = activity.indexOf('private fun startPreviewSnapshotLoop');
  const fallbackStart = activity.indexOf('private fun requestPreviewSnapshotFrame');
  const loopBodyEnd = activity.indexOf('private fun requestPreviewSnapshotFrame', loopStart);
  const perfStart = activity.indexOf('private fun perfLog', fallbackStart);

  assert.notEqual(startStart, -1, 'startRecording should be present');
  assert.notEqual(stopStart, -1, 'stopRecording should be present');
  assert.notEqual(finishStart, -1, 'finishRecordingOnCameraThread should be present');
  assert.notEqual(threadStart, -1, 'finishRecordingOnCameraThread should end before startCameraThread');
  assert.notEqual(loopRunnableStart, -1, 'snapshot capture runnable should be present');
  assert.notEqual(onCreateStart, -1, 'snapshot capture runnable should end before onCreate');
  assert.notEqual(loopStart, -1, 'startPreviewSnapshotLoop should be present');
  assert.notEqual(loopBodyEnd, -1, 'startPreviewSnapshotLoop should end before requestPreviewSnapshotFrame');
  assert.notEqual(fallbackStart, -1, 'requestPreviewSnapshotFrame should be present');
  assert.notEqual(perfStart, -1, 'fallback helpers should end before perfLog');

  const startBody = activity.slice(startStart, stopStart);
  const stopBody = activity.slice(stopStart, finishStart);
  const finishBody = activity.slice(finishStart, threadStart);
  const loopRunnableBody = activity.slice(loopRunnableStart, onCreateStart);
  const loopBody = activity.slice(loopStart, loopBodyEnd);
  const fallbackBody = activity.slice(fallbackStart, perfStart);

  assert.match(activity, /private val previewSnapshotEncoding = true/);
  assert.match(activity, /snapshotFramePending = AtomicBoolean\(false\)/);
  assert.match(startBody, /snapshotFramePending\.set\(false\)/);
  assert.match(startBody, /recording = true[\s\S]*startPreviewSnapshotLoop\(\)/);
  assert.match(stopBody, /stopPreviewSnapshotLoop\(\)/);
  assert.match(loopRunnableBody, /requestPreviewSnapshotFrame\(\)/);
  assert.doesNotMatch(loopRunnableBody, /previewView\.postDelayed\(this, max\(1L, 1000L \/ targetFps\)\)/);
  assert.match(loopBody, /previewView\.post\(snapshotCaptureRunnable\)/);
  assert.match(loopBody, /previewView\.removeCallbacks\(snapshotCaptureRunnable\)/);
  assert.match(finishBody, /activeRecorder\.frameCount == 0[\s\S]*requestPreviewSnapshotFrame\(\)/);
  assert.match(fallbackBody, /snapshotFramePending\.compareAndSet\(false, true\)/);
  assert.match(fallbackBody, /recordFrameStats\.droppedBusy \+= 1/);
  assert.match(activity, /reusableSnapshotBitmap/);
  assert.match(fallbackBody, /Bitmap\.createBitmap\(\s*recordingSize\.width,\s*recordingSize\.height,/s);
  assert.match(fallbackBody, /previewView\.getBitmap\(snapshotTarget\)/);
  assert.match(fallbackBody, /handler\.post/);
  assert.match(fallbackBody, /encodePreviewSnapshotFrame\(snapshot\)/);
  assert.match(fallbackBody, /snapshotFramePending\.set\(false\)/);
  assert.match(fallbackBody, /scheduleNextPreviewSnapshotFrame\(snapshotStartedAtMs\)/);
  assert.match(fallbackBody, /private fun scheduleNextPreviewSnapshotFrame\(snapshotStartedAtMs: Long\)/);
  assert.match(fallbackBody, /val delayMs = max\(0L, targetIntervalMs - elapsedMs\)/);
  assert.match(fallbackBody, /previewView\.postDelayed\(snapshotCaptureRunnable, delayMs\)/);
  assert.match(fallbackBody, /private fun encodePreviewSnapshotFrame\(sourceBitmap: Bitmap\)/);
  assert.match(fallbackBody, /recordFrameStats\.encoded \+= 1/);
  assert.doesNotMatch(fallbackBody, /sourceBitmap\.recycle\(\)/);
});

test('Android recorder does not report cancellation while finishing normally', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const fieldsStart = activity.indexOf('@Volatile private var recording = false');
  const fieldsEnd = activity.indexOf('private val autoStopRunnable', fieldsStart);
  const backStart = activity.indexOf('override fun onBackPressed');
  const destroyStart = activity.indexOf('override fun onDestroy');
  const buildUiStart = activity.indexOf('private fun buildUi');
  const stopStart = activity.indexOf('private fun stopRecording');
  const finishStart = activity.indexOf('private fun finishRecordingOnCameraThread');
  const threadStart = activity.indexOf('private fun startCameraThread');

  assert.notEqual(fieldsStart, -1, 'recording field should be present');
  assert.notEqual(fieldsEnd, -1, 'recorder state fields should end before autoStopRunnable');
  assert.notEqual(backStart, -1, 'onBackPressed should be present');
  assert.notEqual(destroyStart, -1, 'onDestroy should be present');
  assert.notEqual(buildUiStart, -1, 'onDestroy should end before buildUi');
  assert.notEqual(stopStart, -1, 'stopRecording should be present');
  assert.notEqual(finishStart, -1, 'finishRecordingOnCameraThread should be present');
  assert.notEqual(threadStart, -1, 'finishRecordingOnCameraThread should end before startCameraThread');

  const fieldsBody = activity.slice(fieldsStart, fieldsEnd);
  const backBody = activity.slice(backStart, destroyStart);
  const destroyBody = activity.slice(destroyStart, buildUiStart);
  const stopBody = activity.slice(stopStart, finishStart);
  const finishBody = activity.slice(finishStart, threadStart);

  assert.match(fieldsBody, /@Volatile private var finishingRecording = false/);
  assert.match(stopBody, /finishingRecording = true/);
  assert.match(finishBody, /finishingRecording = false/);
  assert.match(backBody, /if \(recording && !finishingRecording\)/);
  assert.match(backBody, /if \(!completed && !finishingRecording\)/);
  assert.match(destroyBody, /if \(!completed && !finishingRecording\)/);
});

test('Android recorder returns frame statistics for APK diagnostics', async () => {
  const nativeBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoNative.kt'),
    'utf8',
  );
  const androidBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/index.uts'),
    'utf8',
  );
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');
  const roadmap = await readFile(path.join(root, 'docs/roadmap.md'), 'utf8');

  assert.match(nativeBridge, /framesReceived/);
  assert.match(androidBridge, /stats: \{/);
  assert.match(androidBridge, /droppedBusy: framesDroppedBusy/);
  assert.match(activity, /RecordingFrameStats/);
  assert.match(activity, /recordFrameStats\.received \+= 1/);
  assert.match(activity, /recordFrameStats\.droppedBusy \+= 1/);
  assert.match(activity, /recordFrameStats\.droppedFps \+= 1/);
  assert.match(activity, /recordFrameStats\.processed \+= 1/);
  assert.match(activity, /recordFrameStats\.encoded \+= 1/);
  assert.match(activity, /copy\(encoded = activeRecorder\.frameCount\)/);
  assert.match(page, /formatStats\(res\.stats, res\.durationMs\)/);
  assert.match(page, /Frames encoded/);
  assert.match(roadmap, /dropped-busy/);
  assert.match(roadmap, /dropped-FPS/);
});

test('Android CPU frame path reuses conversion buffers', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const recorderStart = activity.indexOf('private class CameraMp4Recorder');
  const companionStart = activity.indexOf('private companion object', recorderStart);
  const recorderBody = activity.slice(recorderStart, companionStart);

  assert.match(activity, /reusableArgb/);
  assert.match(activity, /toReusableBitmap/);
  assert.doesNotMatch(activity, /private fun Image\.toBitmap/);
  assert.match(activity, /drawWatermarkOnCanvas\(Canvas\(source\), source\.width, source\.height\)/);
  assert.doesNotMatch(activity, /source\.copy\(Bitmap\.Config\.ARGB_8888, true\)/);
  assert.match(recorderBody, /private val reusablePixels = IntArray\(frameSize\)/);
  assert.match(recorderBody, /private val reusableYuv = ByteArray\(frameSize \+ quarterFrameSize \* 2\)/);
  assert.match(recorderBody, /bitmap\.getPixels\(reusablePixels/);
  assert.match(recorderBody, /argbToYuv420\(reusablePixels, reusableYuv\)/);
  assert.doesNotMatch(recorderBody, /val pixels = IntArray\(frameSize\)/);
  assert.doesNotMatch(recorderBody, /val yuv = argbToYuv420/);
  assert.match(recorderBody, /private fun argbToYuv420\(pixels: IntArray, yuv: ByteArray\)/);
});

test('Android recorder release path is guarded by finally cleanup', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const finishStart = activity.indexOf('fun finish()');
  const drainVideoStart = activity.indexOf('private fun drainVideo', finishStart);

  assert.notEqual(finishStart, -1, 'finish body should be present');
  assert.notEqual(drainVideoStart, -1, 'drainVideo should follow finish');
  const finishBody = activity.slice(finishStart, drainVideoStart);
  assert.match(finishBody, /try \{/);
  assert.match(finishBody, /finally \{/);
  assert.match(finishBody, /activeEncoder\?\.release\(\)/);
  assert.match(finishBody, /muxer\?\.release\(\)/);
  assert.match(finishBody, /muxerStarted = false/);
  assert.match(finishBody, /videoTrackIndex = -1/);
  assert.match(finishBody, /audioTrackIndex = -1/);
});

test('Android recorder finish path uses bounded MediaCodec waits', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const recorderStart = activity.indexOf('private class CameraMp4Recorder');
  const companionStart = activity.indexOf('private companion object', recorderStart);

  assert.notEqual(recorderStart, -1, 'CameraMp4Recorder body should be present');
  assert.notEqual(companionStart, -1, 'CameraMp4Recorder should end before companion object');
  const recorderBody = activity.slice(recorderStart, companionStart);

  assert.match(activity, /FINISH_TIMEOUT_MS/);
  assert.match(recorderBody, /private fun queueVideoEndOfStream/);
  assert.match(recorderBody, /deadlineMs: Long/);
  assert.match(recorderBody, /System\.currentTimeMillis\(\) < deadlineMs/);
  assert.match(recorderBody, /drainVideo\(endOfStream = false, deadlineMs = deadlineMs, bufferInfo = bufferInfo\)/);
  assert.match(recorderBody, /drainVideo\(endOfStream = true, deadlineMs = deadlineMs\)/);
  assert.match(recorderBody, /drainAudio\(codec, bufferInfo, endOfStream = false, audioMimeForDebug = audioMimeForDebug, deadlineMs = deadlineMs\)/);
  assert.match(recorderBody, /drainAudio\(codec, bufferInfo, endOfStream = true, audioMimeForDebug = audioMimeForDebug, deadlineMs = deadlineMs\)/);
  assert.match(recorderBody, /Timed out waiting for video encoder input buffer/);
  assert.match(recorderBody, /Timed out waiting for video encoder end of stream/);
  assert.match(recorderBody, /Timed out waiting for audio encoder input buffer/);
  assert.match(recorderBody, /Timed out waiting for audio encoder end of stream/);
});

test('Android recorder timestamps video frames from real recording time', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const recorderStart = activity.indexOf('private class CameraMp4Recorder');
  const companionStart = activity.indexOf('private companion object', recorderStart);

  assert.notEqual(recorderStart, -1, 'CameraMp4Recorder body should be present');
  assert.notEqual(companionStart, -1, 'CameraMp4Recorder should end before companion object');
  const recorderBody = activity.slice(recorderStart, companionStart);

  assert.match(recorderBody, /videoStartedAtNs/);
  assert.match(recorderBody, /lastVideoPresentationTimeUs/);
  assert.match(recorderBody, /private fun nextVideoPresentationTimeUs\(\)/);
  assert.match(recorderBody, /System\.nanoTime\(\) - videoStartedAtNs/);
  assert.match(recorderBody, /max\(lastVideoPresentationTimeUs \+ 1L, elapsedUs\)/);
  assert.doesNotMatch(recorderBody, /frameIndex \* 1_000_000L \/ fps/);
});

test('Android recorder YUV conversion does not depend on an outer clamp helper', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const recorderStart = activity.indexOf('private class CameraMp4Recorder');
  const companionStart = activity.indexOf('private companion object', recorderStart);

  assert.notEqual(recorderStart, -1, 'CameraMp4Recorder body should be present');
  assert.notEqual(companionStart, -1, 'CameraMp4Recorder should end before companion object');
  const recorderBody = activity.slice(recorderStart, companionStart);
  assert.doesNotMatch(recorderBody, /val [yuv] = clamp\(/);
  assert.match(recorderBody, /val y = min\(255, max\(0,/);
  assert.match(recorderBody, /val u = min\(255, max\(0,/);
  assert.match(recorderBody, /val v = min\(255, max\(0,/);
});

test('iOS MVP uses AVFoundation for camera, audio, watermark, and writing', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );
  const iosBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'),
    'utf8',
  );

  assert.match(swift, /AVCaptureSession/);
  assert.match(swift, /AVCaptureAudioDataOutput/);
  assert.match(swift, /AVAssetWriter/);
  assert.match(swift, /watermark/);
  assert.doesNotMatch(iosBridge, /not implemented/i);
});

test('iOS recorder receives grouped video, camera, audio, and limit options', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /_ width: NSNumber/);
  assert.match(swift, /_ height: NSNumber/);
  assert.match(swift, /_ bitrate: NSNumber/);
  assert.match(swift, /_ includeAudio: Bool/);
  assert.match(swift, /_ facing: String/);
  assert.match(swift, /_ maxDurationMs: NSNumber/);
  assert.match(swift, /preferredWidth/);
  assert.match(swift, /AVVideoAverageBitRateKey/);
  assert.match(swift, /configureFrameRate/);
  assert.match(swift, /activeVideoMinFrameDuration/);
  assert.match(swift, /facing: facing == "front" \? \.front : \.back/);
  assert.match(swift, /requestPermissions\(includeAudio: includeAudio\)/);
  assert.match(swift, /if includeAudio \{/);
  assert.match(swift, /afterDelay: Double\(self\.maxDurationMs\) \/ 1000\.0/);
  assert.match(swift, /Recording is shorter than/);
});

test('native app declares camera and microphone privacy strings', async () => {
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

test('GitHub Actions workflow can request Android or iOS cloud packages', async () => {
  const workflow = await readFile(
    path.join(root, '.github/workflows/cloud-package.yml'),
    'utf8',
  );

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /DCLOUD_USERNAME/);
  assert.match(workflow, /DCLOUD_PASSWORD/);
  assert.match(workflow, /HBuilderX/);
  assert.match(workflow, /cli.*pack/s);
  assert.match(workflow, /platform/);
  assert.match(workflow, /android/);
  assert.match(workflow, /ios/);
  assert.match(workflow, /actions\/upload-artifact/);
});
