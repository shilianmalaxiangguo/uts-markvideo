<template>
  <view class="cameraPage">
    <cover-view class="topBar">
      <cover-view class="templateSummary">
        <text class="summaryLabel">当前模板</text>
        <text class="summaryTitle">{{ currentTemplate.templateName }}</text>
      </cover-view>
      <cover-view class="flashButton" :class="{ isActive: flashEnabled }" @tap="toggleFlash">
        <text class="flashText">{{ flashEnabled ? '闪光开' : '闪光关' }}</text>
      </cover-view>
    </cover-view>

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

      <cover-view class="zoomRail">
        <cover-view
          v-for="item in zoomOptions"
          :key="item.value"
          class="zoomButton"
          :class="{ isSelected: zoom === item.value }"
          @tap="selectZoom(item.value)"
        >
          <cover-view class="zoomText">{{ item.label }}</cover-view>
        </cover-view>
      </cover-view>
    </view>

    <cover-view class="bottomPanel">
      <cover-view class="modeTabs">
        <cover-view class="modeButton" :class="{ isSelected: mode === 'video' }" @tap="mode = 'video'">
          <text>视频</text>
        </cover-view>
        <cover-view class="modeButton" :class="{ isSelected: mode === 'photo' }" @tap="mode = 'photo'">
          <text>照片</text>
        </cover-view>
      </cover-view>

      <cover-view class="controls">
        <cover-view class="thumb">
          <text class="thumbText">{{ lastResultLabel }}</text>
        </cover-view>
        <cover-view class="shutter" :class="shutterClass" @tap="pressShutter">
          <cover-view class="shutterCore"></cover-view>
        </cover-view>
        <cover-view class="templateButton" @tap="openTemplateSheet">
          <text class="templateButtonText">印</text>
        </cover-view>
      </cover-view>
      <text class="statusText">{{ status }}</text>
    </cover-view>

    <cover-view v-if="templateSheetOpen" class="sheetMask" @tap="closeTemplateSheet">
      <cover-view class="templatePanel">
        <cover-view class="sheetHeader">
          <text class="sheetTitle">选择水印模板</text>
          <cover-view class="sheetClose" @tap="closeTemplateSheet">
            <text class="sheetCloseText">×</text>
          </cover-view>
        </cover-view>
        <cover-view class="templateList">
          <cover-view
            v-for="template in templates"
            :key="template.templateId"
            class="templateOption"
            :class="{ isSelected: currentTemplate.templateId === template.templateId }"
            @tap="selectTemplate(template)"
          >
            <cover-view class="templatePreview">
              <cover-image
                v-if="template.imagePath"
                class="templatePreviewImage"
                :src="template.imagePath"
                mode="aspectFit"
              />
              <cover-view v-else class="templatePreviewText">{{ templatePreviewInitial(template) }}</cover-view>
            </cover-view>
            <cover-view class="templateCopy">
              <text class="optionTitle">{{ template.templateName }}</text>
              <text class="optionText">{{ template.mainTitleText }}</text>
              <text v-if="template.subtitleText" class="optionSubtext">{{ template.subtitleText }}</text>
            </cover-view>
            <cover-view class="templateCheck" :class="{ isSelected: currentTemplate.templateId === template.templateId }">
              <text class="templateCheckText">✓</text>
            </cover-view>
          </cover-view>
        </cover-view>
      </cover-view>
    </cover-view>
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
      pendingNativeViewRetry: false,
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
      this.pendingNativeViewRetry = false
      try {
        const maxNativeViewAttempts = 18
        const maxPermissionAttempts = 120
        let nativeViewAttempts = 0
        let permissionAttempts = 0
        while (!this.cameraDestroyed) {
          if (this.cameraDestroyed) {
            return
          }
          this.status = '等待原生相机组件加载'
          const nativeCamera = await this.waitForNativeCamera()
          if (!nativeCamera) {
            this.status = '9001: 原生相机组件不可用'
            return
          }
          this.status = '正在请求相机权限'
          const mountResult = await this.mountNativeCamera(nativeCamera)
          if (this.cameraDestroyed) {
            return
          }
          if (mountResult.success) {
            await this.completeCameraMount()
            return
          }
          if (await this.waitForPermission(mountResult, permissionAttempts)) {
            permissionAttempts += 1
            continue
          }
          if (this.isNativeViewLoading(mountResult) && nativeViewAttempts < maxNativeViewAttempts - 1) {
            nativeViewAttempts += 1
            await this.wait(160)
            continue
          }
          return
        }
      } finally {
        this.mountingCamera = false
        if (this.pendingNativeViewRetry && !this.cameraReady && !this.cameraDestroyed) {
          this.pendingNativeViewRetry = false
          this.$nextTick(() => {
            this.bootstrapCamera()
          })
        }
      }
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
      if (this.hasNativeCameraMethods(refCamera)) {
        if (typeof refCamera.isNativeViewLoaded === 'function' && refCamera.isNativeViewLoaded()) {
          this.nativeViewReady = true
        }
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
    },
    closeTemplateSheet() {
      this.templateSheetOpen = false
    },
    async selectTemplate(template) {
      await this.applyTemplate(template)
    },
    templatePreviewInitial(template) {
      const text = template.mainTitleText || template.templateName || '印'
      return text.slice(0, 1)
    },
    isPermissionPending(result) {
      return result &&
        result.errorCode === '1104' &&
        typeof result.nativeMessage === 'string' &&
        result.nativeMessage.includes('permission request is pending')
    },
    async waitForPermission(result, attempts) {
      if (this.isPermissionPending(result) && attempts < 120) {
        this.status = '等待相机权限授权'
        await this.wait(600)
        return true
      }
      return false
    },
    async startRecordingWithPermission() {
      const maxPermissionAttempts = 120
      for (let attempt = 0; attempt < maxPermissionAttempts; attempt += 1) {
        const result = await this.service.startRecord()
        if (result.success) {
          return
        }
        if (this.isPermissionPending(result)) {
          this.status = '等待麦克风权限授权'
          await this.wait(600)
          continue
        }
        return
      }
    },
    async mountNativeCamera(nativeCamera) {
      return this.service.mountCamera({
        nativeCamera,
        containerId: 'embeddedCamera',
        previewWidth: 390,
        previewHeight: 560,
        cameraFacing: 'back',
        zoom: '1x',
        flashEnabled: false
      })
    },
    async completeCameraMount() {
      this.cameraReady = true
      await this.service.setWatermark(this.currentTemplate)
    },
    async retryBootstrapAfterNativeViewLoad() {
      if (this.cameraReady || this.cameraDestroyed) {
        return
      }
      if (this.mountingCamera) {
        this.pendingNativeViewRetry = true
        return
      }
      if (!this.mountingCamera) {
        this.$nextTick(() => {
          this.bootstrapCamera()
        })
      }
    },
    handleNativeViewReady() {
      this.nativeViewReady = true
      this.retryBootstrapAfterNativeViewLoad()
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
        await this.startRecordingWithPermission()
      }
    }
  }
}
</script>

<style>
.cameraPage {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #101715;
  color: #f7faf8;
}

.topBar {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: calc(var(--status-bar-height) + 10px) 16px 14px;
  background: rgba(3, 5, 5, 0.72);
  color: #f7faf8;
}

.templateSummary {
  min-width: 0;
}

.summaryLabel,
.statusText,
.optionText,
.optionSubtext {
  color: rgba(247, 250, 248, 0.68);
  font-size: 12px;
  line-height: 18px;
}

.summaryTitle {
  display: block;
  margin-top: 2px;
  color: #ffffff;
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
  border: 1px solid rgba(247, 250, 248, 0.34);
  border-radius: 19px;
  background: rgba(247, 250, 248, 0.12);
  color: #f7faf8;
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
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, #15211c, #0d1210);
}

.nativePreview {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.zoomRail {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  z-index: 6;
}

.zoomButton {
  width: 48px;
  height: 48px;
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
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 12;
  padding: 14px 18px calc(18px + env(safe-area-inset-bottom));
  background: rgba(3, 5, 5, 0.78);
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
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
  padding: 0;
  box-sizing: border-box;
  border: 2px solid rgba(255, 255, 255, 0.82);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.16),
    inset 0 0 12px rgba(255, 255, 255, 0.12),
    0 6px 18px rgba(0, 0, 0, 0.22);
}

.shutterCore {
  width: 82px;
  height: 82px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.96);
}

.shutter.isVideo .shutterCore {
  background: #e54848;
}

.shutter.isRecording .shutterCore {
  width: 42px;
  height: 42px;
  border-radius: 12px;
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

.sheetMask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.34);
}

.templatePanel {
  width: 100%;
  max-height: 60vh;
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(247, 250, 248, 0.96);
  color: #101715;
}

.sheetHeader {
  min-height: 38px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sheetTitle {
  flex: 1;
  min-width: 0;
  color: #101715;
  font-size: 17px;
  font-weight: 700;
  line-height: 24px;
}

.sheetClose {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid rgba(16, 23, 21, 0.12);
  border-radius: 15px;
  background: rgba(16, 23, 21, 0.08);
  color: #101715;
}

.sheetCloseText {
  font-size: 18px;
  line-height: 18px;
  font-weight: 700;
}

.templateList {
  display: grid;
  gap: 10px;
}

.templateOption {
  width: 100%;
  min-height: 78px;
  display: grid;
  grid-template-columns: 54px 1fr 24px;
  align-items: center;
  gap: 12px;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #ffffff;
  color: #101715;
}

.templateOption.isSelected {
  border-color: #126fdb;
  background: #edf5ff;
}

.templatePreview {
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  background: #e9f0ed;
}

.templatePreviewImage {
  width: 40px;
  height: 40px;
}

.templatePreviewText {
  color: #101715;
  font-size: 22px;
  font-weight: 800;
}

.templateCopy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.optionTitle {
  color: #101715;
  font-size: 15px;
  font-weight: 700;
  line-height: 21px;
}

.optionText,
.optionSubtext {
  color: #56616d;
}

.templateCheck {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(16, 23, 21, 0.08);
  color: transparent;
}

.templateCheck.isSelected {
  background: #126fdb;
  color: #ffffff;
}

.templateCheckText {
  font-size: 14px;
  font-weight: 800;
  line-height: 20px;
}
</style>
