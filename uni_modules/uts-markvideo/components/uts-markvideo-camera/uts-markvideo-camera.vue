<template>
  <view class="cameraProxy">
    <NativeCamera
      ref="nativeCamera"
      :template-id="templateId"
      @nativeviewready="forwardEvent('nativeviewready', $event)"
      @watermarkpositionchange="forwardEvent('watermarkpositionchange', $event)"
      @nativeerror="forwardEvent('nativeerror', $event)"
      @photodone="forwardEvent('photodone', $event)"
      @recordstart="forwardEvent('recordstart', $event)"
      @recorddone="forwardEvent('recorddone', $event)"
      @flashchange="forwardEvent('flashchange', $event)"
      @zoomchange="forwardEvent('zoomchange', $event)"
      @camerafacingchange="forwardEvent('camerafacingchange', $event)"
      @cameraready="forwardEvent('cameraready', $event)"
    />
  </view>
</template>

<script>
// #ifdef APP-IOS
import NativeCamera from '@/uni_modules/uts-markvideo/utssdk/app-ios/index.vue'
// #endif
// #ifdef APP-ANDROID
import NativeCamera from '@/uni_modules/uts-markvideo/utssdk/app-android/index.vue'
// #endif

export default {
  name: 'uts-markvideo-camera',
  components: {
    NativeCamera
  },
  props: {
    templateId: {
      type: String,
      default: ''
    }
  },
  methods: {
    forwardEvent(name, payload) {
      this.$emit(name, payload)
    },
    isNativeViewLoaded() {
      const nativeCamera = this.$refs.nativeCamera
      return !!nativeCamera &&
        typeof nativeCamera.isNativeViewLoaded === 'function' &&
        nativeCamera.isNativeViewLoaded()
    },
    mountCamera(options = {}) {
      return this.$refs.nativeCamera?.mountCamera?.(options)
    },
    setWatermark(template) {
      return this.$refs.nativeCamera?.setWatermark?.(template)
    },
    clearWatermark() {
      return this.$refs.nativeCamera?.clearWatermark?.()
    },
    getWatermarkPosition() {
      return this.$refs.nativeCamera?.getWatermarkPosition?.()
    },
    takePhoto(options = {}) {
      return this.$refs.nativeCamera?.takePhoto?.(options)
    },
    startRecord(options = {}) {
      return this.$refs.nativeCamera?.startRecord?.(options)
    },
    stopRecord() {
      return this.$refs.nativeCamera?.stopRecord?.()
    },
    switchFlash(enabled) {
      return this.$refs.nativeCamera?.switchFlash?.(enabled)
    },
    setZoom(zoom) {
      return this.$refs.nativeCamera?.setZoom?.(zoom)
    },
    switchCamera(cameraFacing) {
      return this.$refs.nativeCamera?.switchCamera?.(cameraFacing)
    },
    destroyCamera() {
      return this.$refs.nativeCamera?.destroyCamera?.()
    }
  }
}
</script>

<style>
.cameraProxy {
  width: 100%;
  height: 100%;
}
</style>
