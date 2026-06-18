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

function ok(data: any): EmbeddedCameraResult {
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

function cloneTemplate(template: WatermarkTemplate | null): any {
  return template == null ? {} : JSON.parse(JSON.stringify(template))
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
    return JSON.parse(text)
  } catch (_error) {
    return {}
  }
}

function stringify(value: any): string {
  return JSON.stringify(value == null ? {} : value)
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
        this.__$$emit('watermarkpositionchange', parsePayload(payload))
      },
      (payload: string) => {
        this.__$$emit('nativeerror', parsePayload(payload))
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
      const result = fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      this.__$$emit('nativeerror', {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        nativeMessage: result.nativeMessage
      })
      return null
    },
    emitIfFailed(result: EmbeddedCameraResult) {
      if (!result.success) {
        this.__$$emit('nativeerror', {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          nativeMessage: result.nativeMessage
        })
      }
    },
    mountCamera(options: any): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      const nextZoom = options.zoom == 'wide' || options.zoom == '2x' ? options.zoom : '1x'
      const nextFacing = options.cameraFacing == 'front' ? 'front' : 'back'
      const result = parseResult(view.mountCamera(
        options.previewWidth ?? 0,
        options.previewHeight ?? 0,
        nextFacing,
        nextZoom,
        options.flashEnabled == true
      ))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      const data = result.data
      this.recording = false
      this.ready = true
      this.zoom = data.zoom ?? nextZoom
      this.cameraFacing = data.cameraFacing ?? nextFacing
      this.flashEnabled = data.flashEnabled == true
      this.previewWidth = data.previewWidth ?? 0
      this.previewHeight = data.previewHeight ?? 0
      return result
    },
    setWatermark(template: WatermarkTemplate): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'setWatermark while recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view.setWatermark(stringify(template)))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.currentTemplate = JSON.parse(JSON.stringify(template)) as WatermarkTemplate
      return ok({})
    },
    clearWatermark(): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'clearWatermark while recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view.clearWatermark())
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
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view.getWatermarkPosition())
      this.emitIfFailed(result)
      return result
    },
    takePhoto(_options: any): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view.takePhoto(stringify(_options)))
      this.emitIfFailed(result)
      return result
    },
    startRecord(_options: any): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
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
      const result = parseResult(view.startRecord(stringify(_options)))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.frozenTemplate = cloneTemplate(this.currentTemplate) as WatermarkTemplate
      this.recording = true
      return ok({})
    },
	    stopRecord(): EmbeddedCameraResult {
	      const view = this.requireNativeView()
	      if (view == null) {
	        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
	      }
	      if (!this.recording) {
	        const blocked = fail('1403', '当前状态不允许执行该操作', 'stopRecord while not recording')
	        this.emitIfFailed(blocked)
	        return blocked
	      }
	      const result = parseResult(view.stopRecord())
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
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      if (!this.ready) {
        const blocked = fail('1104', '相机未挂载或未就绪')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view.switchFlash(enabled))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.flashEnabled = result.data.enabled == true
      return result
    },
    setZoom(zoom: string): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
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
      const result = parseResult(view.setZoom(zoom))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.zoom = result.data.zoom ?? zoom
      return result
    },
    switchCamera(cameraFacing: string): EmbeddedCameraResult {
      const view = this.requireNativeView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      if (this.recording) {
        const blocked = fail('1403', '当前状态不允许执行该操作', 'switchCamera while recording')
        this.emitIfFailed(blocked)
        return blocked
      }
      const result = parseResult(view.switchCamera(cameraFacing))
      this.emitIfFailed(result)
      if (!result.success) {
        return result
      }
      this.cameraFacing = result.data.cameraFacing ?? (cameraFacing == 'front' ? 'front' : 'back')
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
      const result = parseResult(view.destroyCamera())
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
