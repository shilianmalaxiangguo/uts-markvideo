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

function nativeViewUnavailable(): EmbeddedCameraResult {
  return fail('9001', '原生相机组件不可用', 'MarkVideoEmbeddedCameraView is not loaded.')
}

function encode(value: any): string {
  return JSON.stringify(value ?? {})
}

function parseObject(text: string): any {
  try {
    return JSON.parse(text) ?? {}
  } catch (_) {
    return {}
  }
}

function parseResult(text: string): EmbeddedCameraResult {
  try {
    return JSON.parse(text) as EmbeddedCameraResult
  } catch (error) {
    return fail('9001', '原生返回结构无效', `${error}`)
  }
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
    'cameraready',
    'nativeviewready'
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
    'destroyCamera',
    'isNativeViewLoaded'
  ],
  props: {
    templateId: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      cameraView: null as MarkVideoEmbeddedCameraView | null,
      cameraViewLoaded: false
    }
  },
  NVLoad(): FrameLayout {
    const view = new MarkVideoEmbeddedCameraView(this.$androidContext!)
    view.setEventCallback((eventName: string, payloadText: string) => {
      this.emitNativeEvent(eventName, parseObject(payloadText))
    })
    this.cameraView = view
    this.cameraViewLoaded = true
    setTimeout(() => {
      this.$emit('nativeviewready', {})
    }, 0)
    return view
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
      if (eventName == 'photodone') {
        this.$emit('photodone', payload)
        return
      }
      if (eventName == 'recordstart') {
        this.$emit('recordstart', payload)
        return
      }
      if (eventName == 'recorddone') {
        this.$emit('recorddone', payload)
        return
      }
      if (eventName == 'flashchange') {
        this.$emit('flashchange', payload)
        return
      }
      if (eventName == 'zoomchange') {
        this.$emit('zoomchange', payload)
        return
      }
      if (eventName == 'camerafacingchange') {
        this.$emit('camerafacingchange', payload)
        return
      }
      if (eventName == 'cameraready') {
        this.$emit('cameraready', payload)
      }
    },
    resolveCameraView(): MarkVideoEmbeddedCameraView | null {
      if (this.cameraView != null) {
        return this.cameraView
      }
      return null
    },
    isNativeViewLoaded(): boolean {
      return this.cameraViewLoaded == true && this.cameraView != null
    },
    requireCameraView(): MarkVideoEmbeddedCameraView | null {
      const view = this.resolveCameraView()
      if (view != null) {
        return view
      }
      this.emitNativeEvent('nativeerror', {
        errorCode: '9001',
        errorMessage: '原生相机组件不可用',
        nativeMessage: 'MarkVideoEmbeddedCameraView is not loaded.'
      })
      return null
    },
    bridgeResult(nativeResultText: string): EmbeddedCameraResult {
      return parseResult(nativeResultText)
    },
    mountCamera(options: any): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.mountCamera(encode(options)))
    },
    setWatermark(template: WatermarkTemplate): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.setWatermark(encode(template)))
    },
    clearWatermark(): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.clearWatermark())
    },
    getWatermarkPosition(): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.getWatermarkPosition())
    },
    takePhoto(options: any = {}): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
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
        return nativeViewUnavailable()
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
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.stopRecord())
    },
    switchFlash(enabled: boolean): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.switchFlash(enabled))
    },
    setZoom(zoom: string): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.setZoom(zoom))
    },
    switchCamera(cameraFacing: string): EmbeddedCameraResult {
      const view = this.requireCameraView()
      if (view == null) {
        return nativeViewUnavailable()
      }
      return this.bridgeResult(view.switchCamera(cameraFacing))
    },
    destroyCamera(): EmbeddedCameraResult {
      const view = this.resolveCameraView()
      if (view == null) {
        this.cameraViewLoaded = false
        return ok({})
      }
      const result = this.bridgeResult(view.destroyCamera())
      this.cameraViewLoaded = false
      this.cameraView = null
      return result
    }
  }
}
</script>

<style>
</style>
