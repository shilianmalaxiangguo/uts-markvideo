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
  'static/watermark/company-logo.svg',
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
  assert.match(iosBridge, /const photoTempFilePaths = decodePathList\(photoTempFilePathsText\)/);
  assert.match(iosBridge, /const photoSavedFilePaths = decodePathList\(photoSavedFilePathsText\)/);
  assert.match(iosBridge, /const isPhotoOnly = actualDurationMs == 0 && tempFilePath\.length > 0 && photoTempFilePaths\.length == 0/);
  assert.match(iosBridge, /kind: isPhotoOnly \? 'photo' : 'recording'/);
  assert.match(iosBridge, /savedFilePath: isPhotoOnly && photoSavedFilePaths\.length > 0 \? photoSavedFilePaths\[0\] : tempFilePath/);
  assert.match(iosBridge, /photoTempFilePaths: isPhotoOnly \? \[\] : photoTempFilePaths/);
  assert.match(iosBridge, /photoSavedFilePaths: isPhotoOnly \? \[\] : photoSavedFilePaths/);
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
  assert.match(swift, /private var photoSizes: \[CGSize\] = \[\]/);
  assert.match(swift, /self\.photoSizes\.append\(image\.size\)/);
  assert.match(swift, /private func latestPhotoResult\(\) -> \(tempPath: String, savedPath: String, size: CGSize\)\?/);
  assert.match(swift, /path: photo\.tempPath,[\s\S]*durationMs: 0,[\s\S]*width: Int\(photo\.size\.width\),[\s\S]*height: Int\(photo\.size\.height\),[\s\S]*photoTempFilePaths: \[\],[\s\S]*photoSavedFilePaths: \[photo\.savedPath\]/);
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

test('Page resolves watermark logo assets before opening the native recorder', async () => {
  const page = await readFile(path.join(root, 'pages/index/index.vue'), 'utf8');
  const apiDoc = await readFile(path.join(root, 'docs/api.md'), 'utf8');
  const prd = await readFile(path.join(root, 'docs/prd-watermark-camera-cross-platform.md'), 'utf8');
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  assert.match(apiDoc, /GET \/api\/watermark\/logo-assets/);
  assert.match(apiDoc, /local image\s+path or readable URI prepared by the Page layer/);
  assert.match(apiDoc, /imageUrl: 'https:\/\/example\.com\/assets\/company-logo\.png'/);
  assert.match(apiDoc, /\/static\/watermark\/company-logo\.svg/);
  assert.match(apiDoc, /watermark\.imagePath/);
  assert.match(prd, /GET \/api\/watermark\/logo-assets/);
  assert.match(prd, /Android 分支的契约/);
  assert.match(prd, /logos\[\]\.imageUrl/);
  assert.match(prd, /\/static\/watermark\/company-logo\.svg/);
  assert.match(page, /const WATERMARK_LOGO_API = ''/);
  assert.match(page, /const FALLBACK_LOGO_ASSETS = \[/);
  assert.match(page, /imagePath: '\/static\/watermark\/company-logo\.svg'/);
  assert.match(page, /watermarkImagePath: FALLBACK_LOGO_ASSETS\[0\]\.imagePath/);
  assert.match(page, /mounted\(\) \{[\s\S]*this\.loadWatermarkLogoAssets\(\)/);
  assert.match(page, /uni\.request\(\{[\s\S]*url: WATERMARK_LOGO_API/);
  assert.match(page, /normalizeLogoAssets\(res\.data\)/);
  assert.match(page, /const imagePath = `\$\{item\.imagePath \|\| item\.localPath \|\| ''\}`/);
  assert.match(page, /if \(logo\.imagePath\) \{[\s\S]*this\.watermarkImagePath = logo\.imagePath/);
  assert.match(page, /uni\.downloadFile\(\{[\s\S]*url: logo\.imageUrl/);
  assert.match(page, /this\.watermarkImagePath = res\.tempFilePath/);
  assert.match(page, /uni\.chooseImage\(\{[\s\S]*this\.watermarkImagePath = imagePath/);
  assert.match(page, /imagePath: this\.watermarkImagePath/);
  assert.match(page, /imageWidth: this\.selectedLogoWidth/);
  assert.match(page, /imageHeight: this\.selectedLogoHeight/);
  assert.match(page, /<image[\s\S]*class="logoImage"[\s\S]*:src="logoPreviewPath"/);
  assert.match(page, /class="watermarkPreviewText"/);
  assert.match(swift, /let bundlePath = path\.hasPrefix\("\/"\) \? String\(path\.dropFirst\(\)\) : path/);
  assert.match(swift, /UIImage\(named: bundlePath\)/);
  assert.match(swift, /Bundle\.main\.path\(forResource: resourceName, ofType: resourceExtension\)/);
});

test('iOS recorder shows a blinking red recording indicator and elapsed timer', async () => {
  const swift = await readFile(
    path.join(root, 'uni_modules/uts-markvideo/utssdk/app-ios/MarkVideoRecorder.swift'),
    'utf8',
  );

  const buildUIBody = /private func buildUI\(\) \{([\s\S]*?)\n    private func layoutWatermarkPreview/.exec(swift)?.[1] ?? '';
  const startRecordingBody = /@objc private func startRecording\(\) \{([\s\S]*?)\n    @objc private func takePhoto/.exec(swift)?.[1] ?? '';
  const appendSuccessBlock = /if adaptor\.append\(watermarkedBuffer, withPresentationTime: timestamp\) \{([\s\S]*?)\n        \}/.exec(swift)?.[1] ?? '';
  const handleFinishedWritingBody = /private func handleFinishedWriting\(outputURL: URL, writer: AVAssetWriter\) \{([\s\S]*?)\n    private func finishRecordingOnWriterQueue/.exec(swift)?.[1] ?? '';

  assert.match(swift, /private var recordingStatusView = UIView\(\)/);
  assert.match(swift, /private var recordingDotView = UIView\(\)/);
  assert.match(swift, /private var recordingTimeLabel = UILabel\(\)/);
  assert.match(swift, /private var recordingTimer: Timer\?/);
  assert.match(swift, /private func startRecordingIndicator\(\)/);
  assert.match(swift, /private func stopRecordingIndicator\(\)/);
  assert.match(swift, /guard Thread\.isMainThread else \{[\s\S]*DispatchQueue\.main\.async \{[\s\S]*self\.startRecordingIndicator\(\)/);
  assert.match(swift, /guard Thread\.isMainThread else \{[\s\S]*DispatchQueue\.main\.async \{[\s\S]*self\.stopRecordingIndicator\(\)/);
  assert.match(swift, /Timer\.scheduledTimer\(\s*timeInterval: 1\.0,[\s\S]*selector: #selector\(updateRecordingTimer\)/);
  assert.match(swift, /@objc private func updateRecordingTimer\(\)/);
  assert.doesNotMatch(swift, /Timer\.scheduledTimer\(withTimeInterval: 1\.0, repeats: true/);
  assert.match(swift, /recordingTimeLabel\.text = Self\.formatRecordingTime\(elapsed: 0\)/);
  assert.match(swift, /UIView\.animate\(\s*withDuration: 0\.8,[\s\S]*recordingDotView\.alpha = 0\.25/);
  assert.match(buildUIBody, /view\.addSubview\(recordingStatusView\)/);
  assert.match(buildUIBody, /let recordingStatusTopAnchor: NSLayoutYAxisAnchor/);
  assert.match(buildUIBody, /recordingStatusTopAnchor = view\.safeAreaLayoutGuide\.topAnchor/);
  assert.match(buildUIBody, /recordingStatusTopAnchor = topLayoutGuide\.bottomAnchor/);
  assert.match(buildUIBody, /recordingStatusView\.topAnchor\.constraint\(equalTo: recordingStatusTopAnchor/);
  assert.doesNotMatch(buildUIBody, /controlPanel\.addArrangedSubview\(recordingIndicatorRow\)/);
  assert.doesNotMatch(startRecordingBody, /self\.startRecordingIndicator\(\)/);
  assert.match(appendSuccessBlock, /if firstVideoTime == nil \{[\s\S]*DispatchQueue\.main\.async \{[\s\S]*self\.startRecordingIndicator\(\)/);
  assert.doesNotMatch(handleFinishedWritingBody, /(?<!self\.)stopRecordingIndicator\(\)/);
});

test('iOS watermark preview supports whole-block drag and pinch zoom burned into output', async () => {
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

  const drawWatermarkBody = /private func drawWatermark\(into buffer: CVPixelBuffer\) \{([\s\S]*?)\n    override func viewDidDisappear/.exec(swift)?.[1] ?? '';
  const layoutBody = /private func watermarkDrawLayout\(canvasSize: CGSize, state: WatermarkLayoutState\) -> WatermarkDrawLayout \{([\s\S]*?)\n    private func startRecordingIndicator/.exec(swift)?.[1] ?? '';

  assert.match(interfaceText, /imagePath\?: string/);
  assert.match(interfaceText, /textColor\?: string/);
  assert.match(interfaceText, /fontSize\?: number/);
  assert.match(interfaceText, /imageWidth\?: number/);
  assert.match(interfaceText, /backgroundColor\?: string/);
  assert.match(iosBridge, /const imagePath = options\.watermark\?\.imagePath \?\? ''/);
  assert.match(iosBridge, /const textColor = options\.watermark\?\.textColor \?\? '#FFFFFF'/);
  assert.match(iosBridge, /const imageWidth = options\.watermark\?\.imageWidth \?\? 0/);
  assert.match(iosBridge, /const imageHeight = options\.watermark\?\.imageHeight \?\? 0/);
  assert.match(iosBridge, /const backgroundColor = options\.watermark\?\.backgroundColor \?\? '#00000099'/);
  assert.match(iosBridge, /imagePath,[\s\S]*watermarkX,[\s\S]*watermarkY,[\s\S]*textColor,[\s\S]*fontSize,[\s\S]*textBold,[\s\S]*imageWidth,[\s\S]*imageHeight/);
  assert.match(swift, /private struct WatermarkRenderOptions/);
  assert.match(swift, /let imagePath: String/);
  assert.match(swift, /private var watermarkImageView = UIImageView\(\)/);
  assert.match(swift, /private var watermarkImage: UIImage\?/);
  assert.match(swift, /watermarkImage = loadWatermarkImage\(from: watermarkOptions\.imagePath\)/);
  assert.match(swift, /private func loadWatermarkImage\(from rawPath: String\) -> UIImage\?/);
  assert.match(swift, /UIImage\(contentsOfFile:/);
  assert.match(swift, /watermarkImageView\.image = watermarkImage/);
  assert.match(swift, /watermarkContainer\.addSubview\(watermarkImageView\)/);
  assert.match(swift, /UIGestureRecognizerDelegate/);
  assert.match(swift, /private var watermarkContainer = UIView\(\)/);
  assert.match(swift, /private var watermarkLabelLeadingConstraint: NSLayoutConstraint\?/);
  assert.match(swift, /watermarkLabel\.numberOfLines = 0/);
  assert.match(swift, /watermarkLabel\.lineBreakMode = \.byCharWrapping/);
  assert.match(swift, /private let watermarkStateLock = NSLock\(\)/);
  assert.match(swift, /private var watermarkCenterRatio = CGPoint\(x: 0\.5, y: 0\.78\)/);
  assert.match(swift, /private var watermarkScale: CGFloat = 1/);
  assert.match(swift, /UILongPressGestureRecognizer\(target: self, action: #selector\(handleWatermarkLongPress\(_:?\)\)\)/);
  assert.match(swift, /UIPinchGestureRecognizer\(target: self, action: #selector\(handleWatermarkPinch\(_:?\)\)\)/);
  assert.match(swift, /shouldRecognizeSimultaneouslyWith otherGestureRecognizer/);
  assert.match(swift, /private func updateWatermarkLayout\(center: CGPoint, scale: CGFloat\)/);
  assert.match(swift, /private func storeWatermarkLayout\(center: CGPoint, canvasSize: CGSize, scale: CGFloat\)/);
  assert.match(swift, /watermarkStateLock\.lock\(\)[\s\S]*watermarkCenterRatio = nextRatio[\s\S]*watermarkScale = scale[\s\S]*watermarkStateLock\.unlock\(\)/);
  assert.match(swift, /let clampedCenter = clampedWatermarkPreviewCenter\(targetCenter, size: size\)[\s\S]*storeWatermarkLayout\(center: clampedCenter, canvasSize: view\.bounds\.size, scale: state\.scale\)/);
  assert.match(drawWatermarkBody, /let state = currentWatermarkLayoutState\(\)/);
  assert.match(drawWatermarkBody, /watermarkDrawLayout\(/);
  assert.match(drawWatermarkBody, /state: state/);
  assert.match(swift, /private func watermarkBoxSize\(canvasSize: CGSize, scale: CGFloat\) -> CGSize/);
  assert.match(swift, /self\.imageWidth = CGFloat\(imageWidth > 0 \? imageWidth : 0\)/);
  assert.match(swift, /self\.imageHeight = CGFloat\(imageHeight > 0 \? imageHeight : 0\)/);
  assert.match(swift, /let imageAspectRatio = max\(0\.01,/);
  assert.match(swift, /else if optionWidth > 0 \{[\s\S]*requestedHeight = optionWidth \/ imageAspectRatio/);
  assert.match(swift, /else if optionHeight > 0 \{[\s\S]*requestedWidth = optionHeight \* imageAspectRatio/);
  assert.match(swift, /private func measuredWatermarkTextHeight\(maxWidth: CGFloat, font: UIFont\) -> CGFloat/);
  assert.match(swift, /private func clampedWatermarkCenter\([\s\S]*canvasSize: CGSize,[\s\S]*topInset: CGFloat,[\s\S]*bottomInset: CGFloat,[\s\S]*margin: CGFloat/);
  assert.match(layoutBody, /let clampedCenter = clampedWatermarkCenter\([\s\S]*canvasSize: canvasSize,[\s\S]*topInset: 0,[\s\S]*bottomInset: 0,[\s\S]*margin: 0/);
  assert.match(swift, /let contentHeight = padding \* 2 \+ imageSize\.height \+ gap \+ textHeight/);
  assert.match(swift, /height: max\(1, ceil\(max\(baseHeight, contentHeight\)\)\)/);
  assert.match(swift, /private func watermarkPreviewLayout\(size: CGSize, scale: CGFloat\) -> WatermarkDrawLayout/);
  assert.match(swift, /private func watermarkContentLayout\(rect: CGRect, scale: CGFloat\) -> WatermarkDrawLayout/);
  assert.match(swift, /let previewLayout = watermarkPreviewLayout\(size: size, scale: state\.scale\)/);
  assert.doesNotMatch(swift, /watermarkDrawLayout\(\s*canvasSize: size,[\s\S]*WatermarkLayoutState\(centerRatio: CGPoint\(x: 0\.5, y: 0\.5\), scale: 1\)/);
  assert.match(layoutBody, /canvasSize\.width \* state\.centerRatio\.x/);
  assert.match(layoutBody, /canvasSize\.height \* state\.centerRatio\.y/);
  assert.match(layoutBody, /state\.scale/);
  assert.match(drawWatermarkBody, /watermarkOptions\.backgroundColor\.cgColor/);
  assert.match(drawWatermarkBody, /UIBezierPath\(\s*roundedRect: layout\.rect/);
  assert.match(drawWatermarkBody, /if let imageRect = layout\.imageRect, let cgImage = watermarkImage\?\.cgImage/);
  assert.match(drawWatermarkBody, /context\.draw\(cgImage, in: imageRect\)/);
  assert.match(drawWatermarkBody, /watermarkOptions\.textBold/);
  assert.match(drawWatermarkBody, /watermarkOptions\.textColor/);
  assert.match(drawWatermarkBody, /\.byCharWrapping/);
  assert.match(drawWatermarkBody, /NSAttributedString\(string: watermark, attributes: attributes\)\.draw\([\s\S]*\.usesLineFragmentOrigin/);
  assert.doesNotMatch(layoutBody, /boxHeight \* 0\.46/);
  assert.doesNotMatch(drawWatermarkBody, /byTruncatingTail/);
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
