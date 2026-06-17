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
