<template>
  <view class="cameraPage">
    <view class="topBar">
      <view class="templateSummary">
        <text class="summaryLabel">当前模板</text>
        <text class="summaryTitle">{{ currentTemplate.templateName }}</text>
      </view>
      <view class="flashButton" :class="{ isActive: flashEnabled }" @tap="toggleFlash">
        <text class="flashText">{{ flashEnabled ? '闪光开' : '闪光关' }}</text>
      </view>
    </view>

    <view class="cameraStage">
      <uts-markvideo-camera
        id="embeddedCamera"
        ref="embeddedCamera"
        class="nativePreview"
        :template-id="currentTemplate.templateId"
        @nativeviewready="handleNativeViewReady"
        @watermarkpositionchange="handleNativeWatermarkPositionChange"
        @nativeerror="handleNativeError"
      />
    </view>

    <view class="bottomPanel">
      <view class="zoomRail">
        <view
          v-for="item in zoomOptions"
          :key="item.value"
          class="zoomButton"
          :class="{ isSelected: zoom === item.value }"
          @tap="selectZoom(item.value)"
        >
          <text class="zoomText">{{ item.label }}</text>
        </view>
      </view>

      <view class="modeTabs">
        <view
          class="modeButton"
          :class="{ isSelected: mode === 'video' }"
          @tap="mode = 'video'"
        >
          <text>视频</text>
        </view>
        <view
          class="modeButton"
          :class="{ isSelected: mode === 'photo' }"
          @tap="mode = 'photo'"
        >
          <text>照片</text>
        </view>
      </view>

      <view class="controls">
        <view class="thumb">
          <text class="thumbText">{{ lastResultLabel }}</text>
        </view>
        <view
          class="shutter"
          :class="shutterClass"
          @tap="pressShutter"
        >
          <view class="shutterCore"></view>
        </view>
        <view class="templateButton" @tap="openTemplateSheet">
          <text class="templateButtonText">印</text>
        </view>
      </view>
      <text class="statusText">{{ status }}</text>

      <view v-if="templateSheetOpen" class="templatePanel">
        <view class="sheetHeader">
          <text class="sheetTitle">选择水印模板</text>
          <view class="sheetClose" @tap="closeTemplateSheet">
            <text class="sheetCloseText">关闭</text>
          </view>
        </view>
        <view class="templateList">
          <view
            v-for="template in templates"
            :key="template.templateId"
            class="templateOption"
            :class="{ isSelected: currentTemplate.templateId === template.templateId }"
            @tap="applyTemplate(template)"
          >
            <text class="optionTitle">{{ template.templateName }}</text>
            <text class="optionText">{{ template.mainTitleText }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { createCameraService, DEFAULT_WATERMARK_TEMPLATES } from '../index/cameraService'

export default {
  data() {
    return {
      service: null,
      templates: DEFAULT_WATERMARK_TEMPLATES,
      currentTemplate: DEFAULT_WATERMARK_TEMPLATES[0],
      mode: 'photo',
      zoom: '1x',
      flashEnabled: false,
      recording: false,
      cameraReady: false,
      nativeViewReady: false,
      mountingCamera: false,
      cameraDestroyed: false,
      templateSheetOpen: false,
      lastResultLabel: '暂无',
      status: '相机准备中',
      zoomOptions: [
        { value: '2x', label: '2x' },
        { value: '1x', label: '1x' },
        { value: 'wide', label: '广角' }
      ]
    }
  },
  computed: {
    shutterClass() {
      return {
        isVideo: this.mode === 'video',
        isRecording: this.recording
      }
    }
  },
  mounted() {
    const payload = uni.getStorageSync('embedded-camera-payload') || {}
    if (Array.isArray(payload.templates) && payload.templates.length > 0) {
      this.templates = payload.templates
    }
    const selected = this.templates.find((template) => template.templateId === payload.selectedTemplateId) || this.templates[0]
    this.currentTemplate = selected
    this.service = createCameraService({
      onCameraReady: (payload) => {
        this.zoom = payload.zoom
        this.flashEnabled = payload.flashEnabled
        this.status = '相机已就绪'
      },
      onPhotoDone: (payload) => {
        this.lastResultLabel = '照片'
        this.status = payload.albumFilePath ? '照片已保存到相册' : '照片已生成，保存相册失败'
      },
      onRecordStart: () => {
        this.recording = true
        this.status = '录像中，水印已冻结'
      },
      onRecordDone: (payload) => {
        this.recording = false
        this.lastResultLabel = '视频'
        this.status = payload.albumFilePath ? '视频已保存到相册' : '视频已生成，保存相册失败'
      },
      onZoomChange: (payload) => {
        this.zoom = payload.zoom
      },
      onFlashChange: (payload) => {
        this.flashEnabled = payload.enabled
      },
      onError: (payload) => {
        this.status = `${payload.errorCode}: ${payload.errorMessage}`
      }
    })
    this.$nextTick(() => {
      this.bootstrapCamera()
    })
  },
  beforeUnmount() {
    this.cameraDestroyed = true
    this.service?.destroyCamera()
  },
  methods: {
    async bootstrapCamera() {
      if (this.mountingCamera || this.cameraReady || this.cameraDestroyed) {
        return
      }
      this.mountingCamera = true
      this.cameraReady = false
      try {
        const maxNativeViewAttempts = 18
        const maxPermissionAttempts = 120
        let nativeViewAttempts = 0
        let permissionAttempts = 0
        while (!this.cameraDestroyed) {
          if (this.cameraDestroyed) {
            return
          }
          const nativeCamera = await this.waitForNativeCamera()
          if (this.cameraDestroyed) {
            return
          }
          if (!nativeCamera) {
            this.status = '9001: 原生相机组件不可用'
            return
          }
          const mountResult = await this.service.mountCamera({
            nativeCamera,
            containerId: 'embeddedCamera',
            previewWidth: 390,
            previewHeight: 560,
            cameraFacing: 'back',
            zoom: '1x',
            flashEnabled: false
          })
          if (this.cameraDestroyed) {
            return
          }
          if (mountResult.success) {
            this.cameraReady = true
            await this.service.setWatermark(this.currentTemplate)
            if (this.cameraDestroyed) {
              return
            }
            return
          }
          if (this.isPermissionPending(mountResult) && permissionAttempts < maxPermissionAttempts) {
            permissionAttempts += 1
            this.status = '等待相机权限授权'
            await this.wait(600)
            if (this.cameraDestroyed) {
              return
            }
            continue
          }
          if (this.isNativeViewLoading(mountResult) && nativeViewAttempts < maxNativeViewAttempts - 1) {
            nativeViewAttempts += 1
            await this.wait(160)
            if (this.cameraDestroyed) {
              return
            }
            continue
          }
          return
        }
      } finally {
        this.mountingCamera = false
      }
    },
    isPermissionPending(result) {
      return result &&
        result.errorCode === '1104' &&
        typeof result.nativeMessage === 'string' &&
        result.nativeMessage.includes('permission request is pending')
    },
    isNativeViewLoading(result) {
      return result &&
        result.errorCode === '9001' &&
        typeof result.nativeMessage === 'string' &&
        result.nativeMessage.includes('MarkVideoEmbeddedCameraView is not loaded')
    },
    wait(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms)
      })
    },
    hasNativeCameraMethods(nativeCamera) {
      return !!nativeCamera &&
        typeof nativeCamera.mountCamera === 'function' &&
        typeof nativeCamera.isNativeViewLoaded === 'function'
    },
    resolveNativeCamera() {
      const refCamera = this.$refs.embeddedCamera
      if (this.hasNativeCameraMethods(refCamera) && refCamera.isNativeViewLoaded()) {
        this.nativeViewReady = true
        return refCamera
      }
      return null
    },
    waitForNativeCamera() {
      const maxAttempts = 30
      let attempts = 0
      return new Promise((resolve) => {
        const poll = () => {
          const nativeCamera = this.resolveNativeCamera()
          if (this.hasNativeCameraMethods(nativeCamera) && nativeCamera.isNativeViewLoaded()) {
            resolve(nativeCamera)
            return
          }
          attempts += 1
          if (attempts >= maxAttempts) {
            resolve(null)
            return
          }
          setTimeout(poll, 100)
        }
        poll()
      })
    },
    openTemplateSheet() {
      this.templateSheetOpen = true
      this.scrollToTemplatePanel()
    },
    closeTemplateSheet() {
      this.templateSheetOpen = false
    },
    scrollToTemplatePanel() {
      this.$nextTick(() => {
        uni.pageScrollTo({
          selector: '.templatePanel',
          duration: 160
        })
      })
    },
    handleNativeViewReady() {
      this.nativeViewReady = true
      if (!this.cameraReady && !this.mountingCamera && !this.cameraDestroyed) {
        this.$nextTick(() => {
          this.bootstrapCamera()
        })
      }
    },
    ensureCameraReady() {
      if (this.cameraReady) {
        return true
      }
      if (!/^\d{4}:/.test(this.status)) {
        this.status = '相机未就绪，请稍候'
      }
      return false
    },
    async applyTemplate(template) {
      const previousTemplate = this.currentTemplate
      this.currentTemplate = template
      this.templateSheetOpen = false
      if (!this.cameraReady) {
        this.status = '水印模板已更新'
        return
      }
      const result = await this.service.setWatermark(template)
      this.status = result.success
        ? '水印模板已更新'
        : `${result.errorCode}: ${result.errorMessage}`
      if (!result.success) {
        this.currentTemplate = previousTemplate
        return
      }
    },
    async toggleFlash() {
      if (!this.ensureCameraReady()) {
        return
      }
      await this.service.switchFlash(!this.flashEnabled)
    },
    async selectZoom(value) {
      if (!this.ensureCameraReady()) {
        return
      }
      await this.service.setZoom(value)
    },
    handleNativeWatermarkPositionChange(payload) {
      if (!payload || !this.currentTemplate) return
      this.currentTemplate = {
        ...this.currentTemplate,
        positionX: payload.x,
        positionY: payload.y,
        boxWidth: payload.width,
        boxHeight: payload.height
      }
    },
    handleNativeError(payload) {
      if (!payload) return
      this.status = `${payload.errorCode}: ${payload.errorMessage}`
    },
    async pressShutter() {
      if (!this.ensureCameraReady()) {
        return
      }
      if (this.mode === 'photo') {
        await this.service.takePhoto()
        return
      }
      if (this.recording) {
        await this.service.stopRecord()
      } else {
        await this.service.startRecord()
      }
    }
  }
}
</script>

<style>
.cameraPage {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: #101715;
  color: #f7faf8;
}

.topBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  background: #f8faf9;
  color: #16211d;
}

.templateSummary {
  min-width: 0;
}

.summaryLabel,
.statusText,
.optionText {
  color: #718078;
  font-size: 12px;
  line-height: 18px;
}

.summaryTitle {
  display: block;
  margin-top: 2px;
  color: #16211d;
  font-size: 17px;
  font-weight: 700;
  line-height: 24px;
}

.flashButton {
  width: 86px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid rgba(22, 33, 29, 0.24);
  border-radius: 19px;
  background: #e9f0ed;
  color: #16211d;
}

.flashText {
  font-size: 13px;
  line-height: 18px;
}

.flashButton.isActive {
  border-color: #126fdb;
  background: #126fdb;
  color: #ffffff;
}

.cameraStage {
  position: relative;
  height: 560px;
  min-height: 0;
  overflow: hidden;
  background: linear-gradient(180deg, #15211c, #0d1210);
}

.nativePreview {
  width: 100%;
  height: 560px;
  min-height: 560px;
}

.zoomRail {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 10px;
}

.zoomButton {
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid rgba(247, 250, 248, 0.26);
  border-radius: 50%;
  background: rgba(12, 18, 16, 0.64);
  color: #f7faf8;
}

.zoomText {
  font-size: 13px;
  line-height: 18px;
}

.zoomButton.isSelected {
  border-color: #f7faf8;
  background: #f7faf8;
  color: #101715;
}

.bottomPanel {
  padding: 12px 18px 18px;
  background: #101715;
}

.modeTabs {
  display: flex;
  justify-content: center;
  gap: 18px;
}

.modeButton {
  min-width: 58px;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca8a2;
  font-size: 15px;
}

.modeButton.isSelected {
  color: #ffffff;
  font-weight: 700;
}

.controls {
  display: grid;
  grid-template-columns: 64px 1fr 64px;
  align-items: center;
  margin-top: 16px;
}

.thumb {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #26313b;
}

.thumbText {
  color: #dce5df;
  font-size: 12px;
}

.shutter {
  justify-self: center;
  width: 78px;
  height: 78px;
  display: grid;
  place-items: center;
  padding: 0;
  box-sizing: border-box;
  border: 3px solid rgba(255, 255, 255, 0.86);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
}

.shutterCore {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #ffffff;
}

.shutter.isVideo .shutterCore {
  background: #e54848;
}

.shutter.isRecording .shutterCore {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #e54848;
}

.templateButton {
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid rgba(247, 250, 248, 0.18);
  border-radius: 50%;
  background: #f7faf8;
  color: #101715;
}

.templateButtonText {
  font-size: 24px;
  font-weight: 900;
  line-height: 30px;
}

.statusText {
  display: block;
  margin-top: 12px;
  text-align: center;
}

.templatePanel {
  width: 100%;
  margin-top: 16px;
  padding: 16px;
  box-sizing: border-box;
  border-radius: 8px;
  background: #ffffff;
  color: #16211d;
}

.sheetHeader {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.sheetTitle {
  flex: 1;
  min-width: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 24px;
}

.sheetClose {
  width: 68px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 17px;
  background: #e9f0ed;
  color: #16211d;
}

.sheetCloseText {
  font-size: 13px;
  line-height: 18px;
}

.templateList {
  display: grid;
  gap: 10px;
}

.templateOption {
  width: 100%;
  display: grid;
  gap: 3px;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #f5f8f6;
  color: #16211d;
  text-align: left;
}

.templateOption.isSelected {
  border: 1px solid #126fdb;
  background: #edf5ff;
}

.optionTitle {
  font-size: 15px;
  font-weight: 700;
}
</style>
