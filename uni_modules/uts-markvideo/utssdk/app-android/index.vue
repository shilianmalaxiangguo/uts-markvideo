<template>
  <view></view>
</template>

<script lang="uts">
import FrameLayout from 'android.widget.FrameLayout'
import { MarkVideoEmbeddedCameraView } from 'uts.markvideo.android'

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
  boxWidth?: number
  boxHeight?: number
  boxBackgroundColor?: string
  boxRadius?: number
  boxPadding?: number
  positionX?: number
  positionY?: number
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

function encode(value: any): string {
  return JSON.stringify(value ?? {})
}

function parseObject(text: string): any {
  try {
    return JSON.parse(text)
  } catch (_) {
    return {}
  }
}

function parseResult(text: string): EmbeddedCameraResult {
  const result = parseObject(text)
  if (result.success == true || result.success == false) {
    return result as EmbeddedCameraResult
  }
  return fail('9001', '原生返回结构无效', text)
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
      cameraView: null as MarkVideoEmbeddedCameraView | null
    }
  },
  NVLoad(): FrameLayout {
    const view = new MarkVideoEmbeddedCameraView(this.$androidContext!)
    view.setEventCallback((eventName: string, payloadText: string) => {
      this.emitNativeEvent(eventName, parseObject(payloadText))
    })
    this.cameraView = view
    return view
  },
  NVUnload() {
    this.cameraView?.destroyCamera()
    this.cameraView = null
  },
  methods: {
    emitNativeEvent(eventName: string, payload: any) {
      if (eventName == 'watermarkpositionchange') {
        this.$emit('watermarkpositionchange', payload)
        return
      }
      if (eventName == 'nativeerror') {
        this.$emit('nativeerror', payload)
        return
      }
      this.__$$emit(eventName, payload)
    },
    requireCameraView(): MarkVideoEmbeddedCameraView | null {
      if (this.cameraView != null) {
        return this.cameraView
      }
      if (this.$el != null) {
        this.cameraView = this.$el as MarkVideoEmbeddedCameraView
      }
      return this.cameraView
    },
    bridgeResult(nativeResultText: string): EmbeddedCameraResult {
      return parseResult(nativeResultText)
    },
    mountCamera(options: any): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.mountCamera(encode(options)))
    },
    setWatermark(template: WatermarkTemplate): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.setWatermark(encode(template)))
    },
    clearWatermark(): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.clearWatermark())
    },
    getWatermarkPosition(): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.getWatermarkPosition())
    },
    takePhoto(options: any = {}): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      try {
        return this.bridgeResult(view.takePhoto(encode(options)))
      } catch (error) {
        this.emitNativeEvent('nativeerror', {
          errorCode: '1301',
          errorMessage: '拍照失败',
          nativeMessage: `${error}`
        })
        return fail('1301', '拍照失败', `${error}`)
      }
    },
    startRecord(options: any = {}): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      try {
        return this.bridgeResult(view.startRecord(encode(options)))
      } catch (error) {
        this.emitNativeEvent('nativeerror', {
          errorCode: '1401',
          errorMessage: '录像开始失败',
          nativeMessage: `${error}`
        })
        return fail('1401', '录像开始失败', `${error}`)
      }
    },
    stopRecord(): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.stopRecord())
    },
    switchFlash(enabled: boolean): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.switchFlash(enabled))
    },
    setZoom(zoom: string): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.setZoom(zoom))
    },
    switchCamera(cameraFacing: string): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
      }
      return this.bridgeResult(view.switchCamera(cameraFacing))
    },
    destroyCamera(): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return ok({})
      }
      return this.bridgeResult(view.destroyCamera())
    }
  }
}
</script>

<style>
</style>
