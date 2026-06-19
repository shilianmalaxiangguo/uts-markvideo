<template>
  <view class="cameraPage">
    <view class="topBar">
      <view class="templateSummary">
        <text class="summaryLabel">当前模板</text>
        <text class="summaryTitle">{{ currentTemplate.templateName }}</text>
      </view>
      <button class="flashButton" :class="{ isActive: flashEnabled }" @click="toggleFlash">
        {{ flashEnabled ? '闪光开' : '闪光关' }}
      </button>
    </view>

    <view class="cameraStage">
      <uts-markvideo-camera
        id="embeddedCamera"
        ref="embeddedCamera"
        class="nativePreview"
        :template-id="currentTemplate.templateId"
        @watermarkpositionchange="handleNativeWatermarkPositionChange"
        @nativeerror="handleNativeError"
      />

      <view class="zoomRail">
        <button
          v-for="item in zoomOptions"
          :key="item.value"
          class="zoomButton"
          :class="{ isSelected: zoom === item.value }"
          @click="selectZoom(item.value)"
        >
          {{ item.label }}
        </button>
      </view>
    </view>

    <view class="bottomPanel">
      <view class="modeTabs">
        <button
          class="modeButton"
          :class="{ isSelected: mode === 'video' }"
          @click="mode = 'video'"
        >
          视频
        </button>
        <button
          class="modeButton"
          :class="{ isSelected: mode === 'photo' }"
          @click="mode = 'photo'"
        >
          照片
        </button>
      </view>

      <view class="controls">
        <view class="thumb">
          <text class="thumbText">{{ lastResultLabel }}</text>
        </view>
        <button
          class="shutter"
          :class="shutterClass"
          @click="pressShutter"
        >
          <view class="shutterCore"></view>
        </button>
        <button class="templateButton" @click="templateSheetOpen = true">印</button>
      </view>
      <text class="statusText">{{ status }}</text>
    </view>

    <view v-if="templateSheetOpen" class="sheetMask" @click="templateSheetOpen = false">
      <view class="templateSheet" @click.stop>
        <view class="sheetHeader">
          <text class="sheetTitle">选择水印模板</text>
          <button class="sheetClose" @click="templateSheetOpen = false">关闭</button>
        </view>
        <button
          v-for="template in templates"
          :key="template.templateId"
          class="templateOption"
          :class="{ isSelected: currentTemplate.templateId === template.templateId }"
          @click="applyTemplate(template)"
        >
          <text class="optionTitle">{{ template.templateName }}</text>
          <text class="optionText">{{ template.mainTitleText }}</text>
        </button>
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
    this.bootstrapCamera()
  },
  beforeUnmount() {
    this.service?.destroyCamera()
  },
  methods: {
    async bootstrapCamera() {
      await this.service.mountCamera({
        nativeCamera: this.$refs.embeddedCamera,
        containerId: 'embeddedCamera',
        previewWidth: 390,
        previewHeight: 560,
        cameraFacing: 'back',
        zoom: '1x',
        flashEnabled: false
      })
      await this.service.setWatermark(this.currentTemplate)
    },
    async applyTemplate(template) {
      const result = await this.service.setWatermark(template)
      if (result.success) {
        this.currentTemplate = template
        this.templateSheetOpen = false
        this.status = '水印模板已更新'
      }
    },
    async toggleFlash() {
      await this.service.switchFlash(!this.flashEnabled)
    },
    async selectZoom(value) {
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
  padding: calc(var(--status-bar-height) + 8px) 16px 12px;
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

.flashButton,
.modeButton,
.zoomButton,
.templateButton,
.sheetClose,
.templateOption {
  margin: 0;
  border-radius: 8px;
}

.flashButton {
  min-width: 78px;
  min-height: 40px;
  padding: 0 12px;
  background: #e9f0ed;
  color: #16211d;
  font-size: 13px;
}

.flashButton.isActive {
  background: #126fdb;
  color: #ffffff;
}

.cameraStage {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: linear-gradient(180deg, #15211c, #0d1210);
}

.nativePreview {
  width: 100%;
  height: 100%;
  min-height: 520px;
}

.zoomRail {
  position: absolute;
  z-index: 3;
  right: 14px;
  top: 50%;
  display: grid;
  gap: 10px;
  transform: translateY(-50%);
}

.zoomButton {
  width: 52px;
  min-height: 40px;
  background: rgba(12, 18, 16, 0.64);
  color: #f7faf8;
  font-size: 13px;
}

.zoomButton.isSelected {
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
  background: transparent;
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
  background: #f7faf8;
  color: #101715;
  font-size: 24px;
  font-weight: 900;
}

.statusText {
  display: block;
  margin-top: 12px;
  text-align: center;
}

.sheetMask {
  position: fixed;
  z-index: 20;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(7, 10, 9, 0.48);
}

.templateSheet {
  width: 100%;
  padding: 18px;
  border-radius: 8px 8px 0 0;
  background: #ffffff;
  color: #16211d;
}

.sheetHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sheetTitle {
  font-size: 17px;
  font-weight: 700;
}

.sheetClose {
  background: #e9f0ed;
  color: #16211d;
  font-size: 13px;
}

.templateOption {
  width: 100%;
  display: grid;
  gap: 3px;
  margin-top: 10px;
  padding: 12px;
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
