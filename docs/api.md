# uts-markvideo API

This document defines the shared Page and native plugin contract. iOS implements
this contract now; Android should align to it when the Android native camera is
updated. Native recorders only consume prepared watermark options; API requests
and image asset preparation belong to the Page layer.

## Watermark Image Source

`watermark.imagePath` follows the Android branch contract: it is a local image
path or readable URI prepared by the Page layer before opening the native camera.
The native recorder must not request remote image APIs directly.

The Page may request preset watermark logo assets before opening the native
camera:

```ts
GET /api/watermark/logo-assets
```

Expected response:

```ts
{
  logos: [
    {
      id: 'company-logo',
      name: '企业 Logo',
      imageUrl: 'https://example.com/assets/company-logo.png',
      width: 72,
      height: 72
    }
  ]
}
```

Field semantics:

- `id`: stable logo id for Page selection and caching.
- `name`: display name in the Page watermark settings UI.
- `imageUrl`: remote image URL. The Page downloads it and passes the resulting
  local temp path to native as `watermark.imagePath`.
- `width` / `height`: recommended rendered logo size in output pixels.

Fallback behavior:

- If the request fails or returns no usable `logos`, the Page uses the bundled
  `/static/watermark/company-logo.svg` preset.
- Users can replace the preset with a local image. The local temp path is passed
  through the same `watermark.imagePath` field.

## Primary Native API

```ts
recordWatermarkVideo({
  watermark: {
    text: 'Project A',
    imagePath: '<local path from bundled preset, Page download, or local picker>',
    x: 0.5,
    y: 0.78,
    textColor: '#ffffff',
    fontSize: 30,
    textBold: true,
    imageWidth: 72,
    imageHeight: 72,
    imageGap: 18,
    boxWidth: 0.88,
    boxHeight: 0.16,
    backgroundColor: '#00000099',
    borderRadius: 18,
    padding: 28
  },
  video: {
    fps: 30,
    bitrate: 2500000,
    includeAudio: true
  },
  camera: {
    facing: 'back',
    previewFit: 'cover',
    enablePhoto: true
  },
  limits: {
    maxDurationMs: 60000,
    minDurationMs: 1000
  },
  diagnostics: {
    perfLogging: false
  },
  success(res) {},
  fail(err) {}
})
```

Compatibility shape remains supported:

```ts
recordWatermarkVideo({
  text: 'Project A',
  fps: 30,
  success(res) {}
})
```

## Watermark Options

- `text`: text burned into each output frame.
- `imagePath`: local image path or readable URI. Page resolves remote API assets
  into this value.
- `x` / `y`: initial watermark center position as ratios from `0` to `1`.
- `textColor`: `#RRGGBB` or `#RRGGBBAA`.
- `fontSize`: text size in output pixels.
- `textBold`: whether text is drawn bold.
- `imageWidth` / `imageHeight`: logo size in output pixels.
- `imageGap`: vertical gap between logo and text in output pixels.
- `boxWidth` / `boxHeight`: watermark box width and preferred minimum height
  as ratios of output width and height. Mixed image + text watermarks may expand
  taller so the logo and text are not clipped.
- `backgroundColor`: watermark box background color.
- `borderRadius`: watermark box corner radius in output pixels.
- `padding`: watermark box inner padding in output pixels.

The default mixed watermark layout is logo above text. Drag and pinch operate on
the whole watermark block.

## Success Result

```ts
{
  kind?: 'recording' | 'photo',
  tempFilePath: string,
  savedFilePath?: string,
  photoTempFilePaths?: string[],
  photoSavedFilePaths?: string[],
  durationMs: number,
  width: number,
  height: number,
  watermarkText: string
}
```

For `kind: 'recording'`, `tempFilePath` is the MP4. When photos are captured
during that session, `photoTempFilePaths` and `photoSavedFilePaths` contain those
additional photos.

For `kind: 'photo'`, `tempFilePath` is the main photo path, `savedFilePath` is
the gallery/photo-library reference when available, and both photo arrays are
empty.
