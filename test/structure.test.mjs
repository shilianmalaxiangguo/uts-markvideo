import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');

const requiredFiles = [
  'README.md',
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

test('Android camera preview does not CPU-convert frames while idle', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /import android\.view\.TextureView/);
  assert.match(activity, /CameraDevice\.TEMPLATE_RECORD[\s\S]*addTarget\(activePreviewSurface\)[\s\S]*addTarget\(reader\.surface\)/);
  assert.match(activity, /if \(!recording\) \{[\s\S]*return[\s\S]*if \(!shouldEncodeFrame/);
  assert.doesNotMatch(activity, /setImageBitmap/);
});

test('Android recorder reuses frame buffers during encoding', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );
  const recorderStart = activity.indexOf('private class CameraMp4Recorder');
  const companionStart = activity.indexOf('private companion object', recorderStart);

  assert.notEqual(recorderStart, -1, 'CameraMp4Recorder body should be present');
  assert.notEqual(companionStart, -1, 'CameraMp4Recorder should end before companion object');
  const recorderBody = activity.slice(recorderStart, companionStart);
  assert.match(recorderBody, /private val pixelBuffer = IntArray\(frameSize\)/);
  assert.match(recorderBody, /private val yuvBuffer = ByteArray\(frameSize \+ quarterFrameSize \* 2\)/);
  assert.doesNotMatch(recorderBody, /val pixels = IntArray\(frameSize\)/);
  assert.doesNotMatch(recorderBody, /val yuv = ByteArray\(frameSize \+ quarterFrameSize \* 2\)/);
});

test('Android camera recorder samples frames at the requested fps', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /private val frameIntervalNs: Long by lazy \{ 1_000_000_000L \/ targetFps \}/);
  assert.match(activity, /private var lastEncodedFrameNs = 0L/);
  assert.match(activity, /if \(!shouldEncodeFrame\(System\.nanoTime\(\)\)\) \{[\s\S]*return[\s\S]*val bitmap = drawWatermark/);
  assert.match(activity, /private fun shouldEncodeFrame\(nowNs: Long\): Boolean/);
});

test('Android frame conversion runs off the camera callback thread', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /private var processingThread: HandlerThread\? = null/);
  assert.match(activity, /private var processingHandler: Handler\? = null/);
  assert.match(activity, /HandlerThread\("uts-markvideo-processing"\)/);
  assert.match(activity, /setOnImageAvailableListener\(\{ reader ->[\s\S]*handleNextImage\(reader\)[\s\S]*\}, frameHandler\)/);
});

test('Android recorder operations are serialized on a dedicated recorder thread', async () => {
  const activity = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-android/MarkVideoCameraActivity.kt'),
    'utf8',
  );

  assert.match(activity, /private var recorderThread: HandlerThread\? = null/);
  assert.match(activity, /private var recorderHandler: Handler\? = null/);
  assert.match(activity, /HandlerThread\("uts-markvideo-recorder"\)/);
  assert.match(activity, /private fun startRecorderThread\(\)/);
  assert.match(activity, /private fun stopRecorderThread\(\)/);
  assert.match(activity, /val handler = recorderHandler[\s\S]*handler\.post \{[\s\S]*nextRecorder\.start\(\)[\s\S]*recording = true[\s\S]*\}/);
  assert.match(activity, /val handler = recorderHandler[\s\S]*handler\.post \{[\s\S]*activeRecorder\.encodeFrame\(bitmap\)[\s\S]*bitmap\.recycle\(\)[\s\S]*\}/);
  assert.match(activity, /val handler = recorderHandler[\s\S]*handler\.post \{[\s\S]*activeRecorder\?\.finish\(\)[\s\S]*\}/);
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

test('iOS recorder stays compatible with older deployment targets', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /if #available\(iOS 10\.0, \*\)/);
  assert.match(swift, /NSTemporaryDirectory\(\)/);
  assert.match(swift, /AVVideoCodecH264/);
  assert.doesNotMatch(swift, /FileManager\.default\.temporaryDirectory/);
  assert.doesNotMatch(swift, /AVVideoCodecType\.h264/);
});

test('iOS watermark rendering is upright and not mirrored', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /automaticallyAdjustsVideoMirroring = false/);
  assert.match(swift, /isVideoMirrored = false/);
  assert.match(swift, /context\.translateBy\(x: 0, y: CGFloat\(height\)\)/);
  assert.match(swift, /context\.scaleBy\(x: 1, y: -1\)/);
});

test('iOS camera recorder samples frames at the requested fps', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /private var frameInterval: CMTime/);
  assert.match(swift, /private var lastEncodedFrameTime: CMTime\?/);
  assert.match(swift, /private func shouldEncodeFrame\(at timestamp: CMTime\) -> Bool/);
  assert.match(swift, /guard shouldEncodeFrame\(at: timestamp\) else \{ return \}/);
});

test('iOS recorder validates frame output and cleans temporary files', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /private var videoFrameCount = 0/);
  assert.match(swift, /guard videoFrameCount > 0 else/);
  assert.match(swift, /private func failNoFrames\(outputURL: URL\)/);
  assert.match(swift, /private func failWriter\(outputURL: URL, message: String\)/);
  assert.match(swift, /guard writer\.status == \.completed else/);
  assert.match(swift, /private func finishWithError\(_ message: String\)/);
  assert.match(swift, /No frames were recorded\./);
  assert.match(swift, /try\? FileManager\.default\.removeItem\(at: outputURL\)/);
});

test('iOS recorder operations stay serialized on the writer queue', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /private let writerQueue = DispatchQueue\(label: "uts\.markvideo\.writer"\)/);
  assert.match(swift, /writerQueue\.async \{[\s\S]*try self\.prepareWriter\(\)[\s\S]*self\.recording = true[\s\S]*\}/);
  assert.match(swift, /writerQueue\.async \{[\s\S]*self\.recording = false[\s\S]*writer\.finishWriting/);
  assert.match(swift, /func captureOutput[\s\S]*guard recording else \{ return \}/);
});

test('iOS recorder rejects duplicate start taps before preparing a new writer', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /@objc private func startRecording\(\) \{[\s\S]*startButton\.isEnabled = false[\s\S]*writerQueue\.async/);
  assert.match(swift, /guard !self\.recording && self\.assetWriter == nil else/);
  assert.match(swift, /guard !self\.recording && self\.assetWriter == nil else[\s\S]*return[\s\S]*do \{[\s\S]*try self\.prepareWriter\(\)/);
});

test('iOS recorder reports writer preparation failures through the fail callback', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /catch \{[\s\S]*self\.recording = false[\s\S]*self\.resetWriter\(\)[\s\S]*self\.finishWithError\(error\.localizedDescription\)/);
});

test('iOS recorder fails immediately when required capture inputs or outputs cannot be added', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /guard session\.canAddInput\(videoInput\) else/);
  assert.match(swift, /guard session\.canAddInput\(micInput\) else/);
  assert.match(swift, /guard session\.canAddOutput\(videoOutput\) else/);
  assert.match(swift, /guard session\.canAddOutput\(audioOutput\) else/);
  assert.doesNotMatch(swift, /if session\.canAddInput\(videoInput\) \{/);
  assert.doesNotMatch(swift, /if session\.canAddOutput\(audioOutput\) \{/);
});

test('iOS recorder rejects duplicate API calls without replacing callbacks', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(swift, /guard success == nil && failure == nil else \{[\s\S]*onFail\("Recorder is already running\."\)[\s\S]*return[\s\S]*\}[\s\S]*success = onSuccess[\s\S]*failure = onFail/);
});

test('iOS recorder duration only advances after a frame is appended', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  const appendSuccessBlock = /if adaptor\.append\(watermarkedBuffer, withPresentationTime: timestamp\) \{([\s\S]*?)\n        \}/.exec(swift)?.[1] ?? '';
  assert.match(appendSuccessBlock, /lastVideoTime = timestamp/);
  assert.match(appendSuccessBlock, /videoFrameCount \+= 1/);
  assert.doesNotMatch(swift, /lastVideoTime = timestamp[\s\S]*guard writer\.status == \.writing/);
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

test('iOS recorder can optionally capture watermarked photos', async () => {
  const interfaceText = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/interface.uts'),
    'utf8',
  );
  const iosBridge = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/index.uts'),
    'utf8',
  );
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );
  const manifest = await readFile(path.join(root, 'manifest.json'), 'utf8');
  const iosPlist = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/Info.plist'),
    'utf8',
  );
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');

  assert.match(interfaceText, /enablePhoto\?: boolean/);
  assert.match(interfaceText, /photoTempFilePaths\?: string\[\]/);
  assert.match(interfaceText, /photoSavedFilePaths\?: string\[\]/);
  assert.match(iosBridge, /const enablePhoto = options\.camera\?\.enablePhoto \?\? false/);
  assert.match(iosBridge, /photoTempFilePaths: decodePathList\(photoTempFilePathsText\)/);
  assert.match(iosBridge, /photoSavedFilePaths: decodePathList\(photoSavedFilePathsText\)/);
  assert.match(swift, /import Photos/);
  assert.match(swift, /_ enablePhoto: Bool/);
  assert.match(swift, /requestPermissions\(includeAudio: includeAudio\) \{ videoGranted, audioGranted in/);
  assert.match(swift, /guard !includeAudio \|\| audioGranted \|\| enablePhoto else/);
  assert.match(swift, /let effectiveIncludeAudio = includeAudio && audioGranted/);
  assert.match(swift, /private var photoButton = UIButton\(type: \.system\)/);
  assert.match(swift, /photoButton\.isEnabled = false/);
  assert.match(swift, /_ onSuccess: @escaping \(String, NSNumber, NSNumber, NSNumber, String, String, String\) -> Void/);
  assert.match(swift, /private func takePhoto\(\)/);
  assert.match(swift, /guard !self\.recording && self\.assetWriter == nil else/);
  assert.match(swift, /Camera preview is warming up/);
  assert.match(swift, /self\.enablePhoto && self\.startButton\.isEnabled && !self\.completed/);
  assert.match(swift, /private func savePhotoToGallery/);
  assert.match(swift, /photoTempFilePaths/);
  assert.match(swift, /photoSavedFilePaths/);
  assert.match(swift, /self\.stopButton\.isEnabled = false[\s\S]*self\.photoButton\.isEnabled = true/);
  assert.match(manifest, /NSPhotoLibraryAddUsageDescription/);
  assert.match(manifest, /NSPhotoLibraryUsageDescription/);
  assert.match(iosPlist, /NSPhotoLibraryAddUsageDescription/);
  assert.match(iosPlist, /NSPhotoLibraryUsageDescription/);
  assert.match(page, /enablePhoto/);
  assert.match(page, /enablePhoto: true/);
  assert.match(page, /<switch :checked="enablePhoto" @change="onPhotoToggle" \/>/);
  assert.match(page, /onPhotoToggle\(event\)[\s\S]*this\.enablePhoto = !!event\.detail\.value/);
  assert.match(page, /camera:\s*\{[\s\S]*enablePhoto: this\.enablePhoto/);
  assert.match(page, /Saved photos/);
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
