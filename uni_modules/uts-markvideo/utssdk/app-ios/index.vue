<template>
  <view class="defaultStyles"></view>
</template>

<script lang="uts">
import { UIView } from 'UIKit'

type EmbeddedCameraResult = {
  success: boolean
  errorCode: string
  errorMessage: string
  nativeMessage: string
  data: any
}

type EmbeddedCameraMountOptions = {
  containerId?: string
  previewWidth?: number
  previewHeight?: number
  cameraFacing?: string
  zoom?: string
  flashEnabled?: boolean
}

type EmbeddedCameraMediaOptions = {
  watermarkTemplate?: WatermarkTemplate
}

type WatermarkTemplate = {
  templateId: string
  templateName: string
  templateType: string
  mainTitleText?: string
  subtitleText?: string
  mainTitleColor?: string
  subtitleColor?: string
  mainTitleFontSize?: number
  subtitleFontSize?: number
  mainTitleBold?: boolean
  subtitleBold?: boolean
  imagePath?: string
  imageMimeType?: string
  imageWidth?: number
  imageHeight?: number
  imageTextGap?: number
  positionX?: number
  positionY?: number
  boxWidth?: number
  boxHeight?: number
  boxBackgroundColor?: string
  boxRadius?: number
  boxPadding?: number
}

function ok(data: any = {}): EmbeddedCameraResult {
  return {
    success: true,
    errorCode: '',
    errorMessage: '',
    nativeMessage: '',
    data: data
  }
}

function fail(errorCode: string, errorMessage: string, nativeMessage: string = ''): EmbeddedCameraResult {
  return {
    success: false,
    errorCode: errorCode,
    errorMessage: errorMessage,
    nativeMessage: nativeMessage,
    data: {}
  }
}

function nativeViewUnavailable(): EmbeddedCameraResult {
  return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
}

function cloneTemplate(template: WatermarkTemplate | null): WatermarkTemplate | null {
  if (template == null) {
    return null
  }
  return {
    templateId: template.templateId,
    templateName: template.templateName,
    templateType: template.templateType,
    mainTitleText: template.mainTitleText,
    subtitleText: template.subtitleText,
    mainTitleColor: template.mainTitleColor,
    subtitleColor: template.subtitleColor,
    mainTitleFontSize: template.mainTitleFontSize,
    subtitleFontSize: template.subtitleFontSize,
    mainTitleBold: template.mainTitleBold,
    subtitleBold: template.subtitleBold,
    imagePath: template.imagePath,
    imageMimeType: template.imageMimeType,
    imageWidth: template.imageWidth,
    imageHeight: template.imageHeight,
    imageTextGap: template.imageTextGap,
    positionX: template.positionX,
    positionY: template.positionY,
    boxWidth: template.boxWidth,
    boxHeight: template.boxHeight,
    boxBackgroundColor: template.boxBackgroundColor,
    boxRadius: template.boxRadius,
    boxPadding: template.boxPadding
  }
}

function parseResult(text: string): EmbeddedCameraResult {
  try {
    const result = JSON.parse(text) as EmbeddedCameraResult
    if (result.success == true || result.success == false) {
      return result
    }
    return fail('9001', '原生返回结构无效', text)
  } catch (error) {
    return fail('9001', '原生返回结构无效', `${error}`)
  }
}

function parsePayload(text: string): any {
  try {
    const payload = JSON.parse(text)
    return payload == null ? {} : payload
  } catch (_error) {
    return {}
  }
}

function stringify(value: any): string {
  const text = JSON.stringify(value == null ? {} : value)
  return text != null ? text : '{}'
}

function optionNumber(value: number | null, fallback: number): number {
  return value == null ? fallback : value
}

function optionZoom(value: string | null): string {
  return value == 'wide' || value == '2x' ? value : '1x'
}

function optionFacing(value: string | null): string {
  return value == 'front' ? 'front' : 'back'
}

export default {
  name: 'uts-markvideo-camera',
  emits: [
    'watermarkpositionchange',
    'nativeerror',
    'photodone',
    'recordstart',
    'recorddone',
    'flashchange',
    'zoomchange',
    'camerafacingchange',
    'cameraready'
  ],
  expose: [
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
    'destroyCamera'
  ],
  props: {
    templateId: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      ready: false,
      recording: false,
      zoom: '1x',
      flashEnabled: false,
      cameraFacing: 'back',
      currentTemplate: null as WatermarkTemplate | null,
      frozenTemplate: null as WatermarkTemplate | null,
      previewWidth: 0,
      previewHeight: 0,
      nativeView: null as MarkVideoEmbeddedCameraView | null
    }
  },
  NVLoad(): UIView {
    const view = new MarkVideoEmbeddedCameraView()
    view.setEventHandlers(
      (payload: string) => {
        this.$emit('watermarkpositionchange', parsePayload(payload))
      },
      (payload: string) => {
        this.$emit('nativeerror', parsePayload(payload))
      }
    )
    this.nativeView = view
    return view
  },
  methods: {
    requireNativeView(): MarkVideoEmbeddedCameraView | null {
      if (this.nativeView != null) {
        return this.nativeView
      }
      const result = nativeViewUnavailable()
      this.$emit('nativeerror', {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        nativeMessage: result.nativeMessage
      })
      return null
    },
    emitIfFailed(result: EmbeddedCameraResult) {
      if (!result.success) {
        this.$emit('nativeerror', {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          nativeMessage: result.nativeMessage
        })
      }
    },
    mountCamera(options: EmbeddedCameraMountOptions): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      const nextZoom = optionZoom(options.zoom)
      const nextFacing = optionFacing(options.cameraFacing)
      const nextPreviewWidth = optionNumber(options.previewWidth, 0)
      const nextPreviewHeight = optionNumber(options.previewHeight, 0)
      const result = parseResult(view!.mountCamera(
        nextPreviewWidth,
        nextPreviewHeight,
        nextFacing,
        nextZoom,
        options.flashEnabled == true
      ))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.recording = false
      this.ready = true
      this.zoom = nextZoom
      this.cameraFacing = nextFacing
      this.flashEnabled = options.flashEnabled == true
      this.previewWidth = nextPreviewWidth
      this.previewHeight = nextPreviewHeight
      return result
    },
    setWatermark(template: WatermarkTemplate): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'setWatermark while recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.setWatermark(stringify(template)))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.currentTemplate = cloneTemplate(template)
      return ok({})
    },
    clearWatermark(): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'clearWatermark while recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.clearWatermark())
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.currentTemplate = null
      return ok({})
    },
    getWatermarkPosition(): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.getWatermarkPosition())
      this.emitIfFailed(result)
      return result
    },
    takePhoto(options: EmbeddedCameraMediaOptions = {}): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.takePhoto(stringify(options)))
      this.emitIfFailed(result)
      return result
    },
    startRecord(options: EmbeddedCameraMediaOptions = {}): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'duplicate startRecord')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.startRecord(stringify(options)))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.frozenTemplate = cloneTemplate(this.currentTemplate)
      this.recording = true
      return ok({})
    },
    stopRecord(): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (!this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'stopRecord while not recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.stopRecord())
      this.emitIfFailed(result)
      if (!result.success) {
        if (result.errorCode == '1402') {
          this.recording = false
          this.frozenTemplate = null
        }
        return result
      }
      this.recording = false
      this.frozenTemplate = null
      return result
    },
    switchFlash(enabled: boolean): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.switchFlash(enabled))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.flashEnabled = enabled
      return result
    },
    setZoom(zoom: string): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      if (!(zoom == 'wide' || zoom == '1x' || zoom == '2x')) {
        const blocked = fail('1103', '焦段不可用', zoom)
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.setZoom(zoom))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.zoom = zoom
      return result
    },
    switchCamera(cameraFacing: string): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'switchCamera while recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view!.switchCamera(cameraFacing))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.cameraFacing = optionFacing(cameraFacing)
      this.zoom = '1x'
      this.flashEnabled = false
      return result
    },
    destroyCamera(): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        this.ready = false
        this.recording = false
        this.currentTemplate = null
        this.frozenTemplate = null
        return ok({})
      }
      const result = parseResult(view!.destroyCamera())
      this.emitIfFailed(result)
      this.ready = false
      this.recording = false
      this.currentTemplate = null
      this.frozenTemplate = null
      return result.success ? ok({}) : result
    }
  }
}
</script>

<style>
</style>
