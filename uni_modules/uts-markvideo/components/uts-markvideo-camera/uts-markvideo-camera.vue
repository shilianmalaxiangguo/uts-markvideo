<template>
  <view
    class="cameraHost"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchEnd"
  >
    <view class="cameraGlass">
      <view class="focusRing"></view>
    </view>
    <view
      v-if="currentTemplate"
      class="watermarkBox"
      :style="watermarkBoxStyle"
    >
      <image
        v-if="currentTemplate.templateType === 'image_title_subtitle'"
        class="watermarkImage"
        :src="currentTemplate.imagePath"
        mode="aspectFit"
      />
      <view class="watermarkTextGroup">
        <text class="watermarkTitle">{{ currentTemplate.mainTitleText }}</text>
        <text
          v-if="currentTemplate.templateType !== 'title_text'"
          class="watermarkSubtitle"
        >
          {{ currentTemplate.subtitleText }}
        </text>
      </view>
    </view>
  </view>
</template>

<script>
function createResult(success, data, errorCode, errorMessage, nativeMessage) {
  return {
    success,
    errorCode: success ? '' : errorCode,
    errorMessage: success ? '' : errorMessage,
    nativeMessage: success ? '' : nativeMessage,
    data: success ? (data || {}) : {}
  }
}

function ok(data = {}) {
  return createResult(true, data, '', '', '')
}

function fail(errorCode, errorMessage, nativeMessage = '') {
  return createResult(false, {}, errorCode, errorMessage, nativeMessage)
}

function cloneTemplate(template) {
  return template ? JSON.parse(JSON.stringify(template)) : null
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
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
      previewWidth: 390,
      previewHeight: 560,
      currentTemplate: null,
      frozenTemplate: null,
      dragStart: null
    }
  },
  computed: {
    watermarkBoxStyle() {
      const template = this.currentTemplate
      return {
        left: `${template.positionX * 100}%`,
        top: `${template.positionY * 100}%`,
        width: `${template.boxWidth * 100}%`,
        minHeight: `${template.boxHeight * 100}%`,
        backgroundColor: template.boxBackgroundColor,
        borderRadius: `${template.boxRadius}px`,
        padding: `${template.boxPadding}px`
      }
    }
  },
  methods: {
    emitError(result) {
      this.$emit('nativeerror', {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        nativeMessage: result.nativeMessage
      })
    },
    mountCamera(options = {}) {
      this.ready = true
      this.recording = false
      this.zoom = ['wide', '1x', '2x'].includes(options.zoom) ? options.zoom : '1x'
      this.cameraFacing = options.cameraFacing === 'front' ? 'front' : 'back'
      this.flashEnabled = !!options.flashEnabled
      this.previewWidth = options.previewWidth || 390
      this.previewHeight = options.previewHeight || 560
      return ok({
        availableZooms: ['wide', '1x', '2x'],
        zoom: this.zoom,
        flashAvailable: true,
        flashEnabled: this.flashEnabled,
        cameraFacing: this.cameraFacing,
        previewWidth: this.previewWidth,
        previewHeight: this.previewHeight
      })
    },
    setWatermark(template) {
      if (this.recording) {
        const result = fail('1403', '当前状态不允许执行该操作', 'setWatermark while recording')
        this.emitError(result)
        return result
      }
      this.currentTemplate = cloneTemplate(template)
      this.emitWatermarkPosition()
      return ok({})
    },
    clearWatermark() {
      if (this.recording) {
        const result = fail('1403', '当前状态不允许执行该操作', 'clearWatermark while recording')
        this.emitError(result)
        return result
      }
      this.currentTemplate = null
      return ok({})
    },
    getWatermarkPosition() {
      if (!this.ready) {
        const result = fail('1104', '相机未挂载或未就绪')
        this.emitError(result)
        return result
      }
      const template = this.currentTemplate || {}
      return ok({
        x: template.positionX || 0,
        y: template.positionY || 0,
        width: template.boxWidth || 0,
        height: template.boxHeight || 0
      })
    },
    takePhoto() {
      if (!this.ready) {
        const result = fail('1104', '相机未挂载或未就绪')
        this.emitError(result)
        return result
      }
      const result = fail('1301', '拍照失败', 'Embedded camera media pipeline is not bound in the Vue compatibility shell.')
      this.emitError(result)
      return result
    },
    startRecord() {
      if (!this.ready) {
        const result = fail('1104', '相机未挂载或未就绪')
        this.emitError(result)
        return result
      }
      if (this.recording) {
        const result = fail('1403', '当前状态不允许执行该操作', 'duplicate startRecord')
        this.emitError(result)
        return result
      }
      this.frozenTemplate = cloneTemplate(this.currentTemplate)
      const result = fail('1401', '录像开始失败', 'Embedded camera media pipeline is not bound in the Vue compatibility shell.')
      this.emitError(result)
      return result
    },
    stopRecord() {
      if (!this.recording) {
        const result = fail('1403', '当前状态不允许执行该操作', 'stopRecord while not recording')
        this.emitError(result)
        return result
      }
      this.recording = false
      const result = fail('1402', '录像停止失败', 'Embedded camera media pipeline is not bound in the Vue compatibility shell.')
      this.emitError(result)
      return result
    },
    switchFlash(enabled) {
      if (!this.ready) {
        const result = fail('1104', '相机未挂载或未就绪')
        this.emitError(result)
        return result
      }
      this.flashEnabled = !!enabled
      return ok({ enabled: this.flashEnabled })
    },
    setZoom(zoom) {
      if (!this.ready) {
        const result = fail('1104', '相机未挂载或未就绪')
        this.emitError(result)
        return result
      }
      if (!['wide', '1x', '2x'].includes(zoom)) {
        const result = fail('1103', '焦段不可用', zoom)
        this.emitError(result)
        return result
      }
      this.zoom = zoom
      return ok({ zoom })
    },
    switchCamera(cameraFacing) {
      if (this.recording) {
        const result = fail('1403', '当前状态不允许执行该操作', 'switchCamera while recording')
        this.emitError(result)
        return result
      }
      this.cameraFacing = cameraFacing === 'front' ? 'front' : 'back'
      return ok({ cameraFacing: this.cameraFacing })
    },
    destroyCamera() {
      this.ready = false
      this.recording = false
      this.currentTemplate = null
      this.frozenTemplate = null
      return ok({})
    },
    handleTouchStart(event) {
      if (this.recording || !this.currentTemplate) return
      const touch = event.touches && event.touches[0]
      if (!touch) return
      this.dragStart = {
        pageX: touch.pageX,
        pageY: touch.pageY,
        positionX: this.currentTemplate.positionX,
        positionY: this.currentTemplate.positionY
      }
    },
    handleTouchMove(event) {
      if (this.recording || !this.currentTemplate || !this.dragStart) return
      const touch = event.touches && event.touches[0]
      if (!touch) return
      const dx = (touch.pageX - this.dragStart.pageX) / this.previewWidth
      const dy = (touch.pageY - this.dragStart.pageY) / this.previewHeight
      const nextX = clamp(this.dragStart.positionX + dx, 0, 1 - this.currentTemplate.boxWidth)
      const nextY = clamp(this.dragStart.positionY + dy, 0, 1 - this.currentTemplate.boxHeight)
      this.currentTemplate = {
        ...this.currentTemplate,
        positionX: nextX,
        positionY: nextY
      }
    },
    handleTouchEnd() {
      if (this.recording || !this.currentTemplate) return
      this.dragStart = null
      this.emitWatermarkPosition()
    },
    emitWatermarkPosition() {
      if (!this.currentTemplate) return
      this.$emit('watermarkpositionchange', {
        x: this.currentTemplate.positionX,
        y: this.currentTemplate.positionY,
        width: this.currentTemplate.boxWidth,
        height: this.currentTemplate.boxHeight,
        watermarkTemplateId: this.currentTemplate.templateId
      })
    }
  }
}
</script>

<style>
.cameraHost {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  background: #0d1210;
}

.cameraGlass {
  width: 100%;
  height: 100%;
  min-height: 520px;
  display: grid;
  place-items: center;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0)),
    radial-gradient(circle at 40% 22%, rgba(71, 132, 102, 0.46), transparent 34%),
    linear-gradient(145deg, #1b2b23, #101715 58%, #0b0f0d);
}

.focusRing {
  width: 46%;
  aspect-ratio: 1;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
  box-shadow: inset 0 0 22px rgba(255, 255, 255, 0.08);
}

.watermarkBox {
  position: absolute;
  z-index: 2;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
}

.watermarkImage {
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  margin-right: 8px;
}

.watermarkTextGroup {
  min-width: 0;
}

.watermarkTitle,
.watermarkSubtitle {
  display: block;
  color: #26313b;
  word-break: break-word;
}

.watermarkTitle {
  font-size: 16px;
  font-weight: 700;
  line-height: 22px;
}

.watermarkSubtitle {
  margin-top: 2px;
  color: #56616d;
  font-size: 12px;
  line-height: 17px;
}
</style>
