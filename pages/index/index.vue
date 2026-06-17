<template>
  <view class="page">
    <view class="panel">
      <text class="title">UTS MarkVideo MVP</text>
      <text class="hint">Android native camera recorder</text>

      <input
        class="input"
        v-model="watermarkText"
        maxlength="40"
        placeholder="Watermark text"
      />

      <view class="logoRow">
        <button class="secondaryButton" size="mini" @click="chooseWatermarkImage">
          Choose logo
        </button>
        <button
          v-if="watermarkImagePath"
          class="secondaryButton"
          size="mini"
          @click="clearWatermarkImage"
        >
          Clear logo
        </button>
        <text v-if="watermarkImagePath" class="logoPath">{{ watermarkImagePath }}</text>
      </view>

      <view class="grid">
        <view class="field">
          <text class="label">FPS</text>
          <input class="smallInput" v-model.number="fps" type="number" />
        </view>
        <view class="field">
          <text class="label">Bitrate</text>
          <input class="smallInput" v-model.number="bitrate" type="number" />
        </view>
      </view>

      <view class="toggles">
        <label class="checkRow">
          <checkbox :checked="includeAudio" @click="includeAudio = !includeAudio" />
          <text class="checkText">Audio</text>
        </label>
        <label class="checkRow">
          <checkbox :checked="perfLogging" @click="perfLogging = !perfLogging" />
          <text class="checkText">Perf logs</text>
        </label>
      </view>

      <view class="toggles">
        <label class="checkRow">
          <radio value="back" :checked="facing === 'back'" @click="facing = 'back'" />
          <text class="checkText">Back</text>
        </label>
        <label class="checkRow">
          <radio value="front" :checked="facing === 'front'" @click="facing = 'front'" />
          <text class="checkText">Front</text>
        </label>
      </view>

      <view class="grid">
        <view class="field">
          <text class="label">Max ms</text>
          <input class="smallInput" v-model.number="maxDurationMs" type="number" />
        </view>
        <view class="field">
          <text class="label">Min ms</text>
          <input class="smallInput" v-model.number="minDurationMs" type="number" />
        </view>
      </view>

      <button class="button" :disabled="busy" @click="openRecorder">
        {{ busy ? 'Waiting for recorder...' : 'Open camera recorder' }}
      </button>

      <text class="status">{{ status }}</text>
    </view>

    <video
      v-if="videoPath"
      class="video"
      :src="videoPath"
      controls
      object-fit="contain"
    />

    <view v-if="savedFilePath" class="pathBox">
      <text class="pathLabel">Saved video</text>
      <text class="path">{{ savedFilePath }}</text>
    </view>

    <view v-if="tempFilePath" class="pathBox">
      <text class="pathLabel">Temp file</text>
      <text class="path">{{ tempFilePath }}</text>
    </view>
  </view>
</template>

<script>
import { recordWatermarkVideo } from '@/uni_modules/uts-markvideo'

export default {
  data() {
    return {
      busy: false,
      videoPath: '',
      savedFilePath: '',
      tempFilePath: '',
      watermarkText: 'UTS 即拍即有水印',
      watermarkImagePath: '',
      fps: 30,
      bitrate: 1200000,
      includeAudio: true,
      facing: 'back',
      maxDurationMs: 0,
      minDurationMs: 0,
      perfLogging: false,
      status: 'Ready'
    }
  },
  methods: {
    openRecorder() {
      if (this.busy) return

      this.busy = true
      this.videoPath = ''
      this.savedFilePath = ''
      this.tempFilePath = ''
      this.status = 'Open native camera, then start and stop recording.'

      recordWatermarkVideo({
        watermark: {
          text: this.watermarkText,
          imagePath: this.watermarkImagePath,
          x: 0.5,
          y: 0.78,
          textColor: '#ffffff',
          fontSize: 30,
          textBold: true,
          imageHeight: 58,
          imageGap: 18,
          boxWidth: 0.88,
          boxHeight: 0.16,
          backgroundColor: '#00000099',
          borderRadius: 18,
          padding: 28
        },
        video: {
          fps: this.safeNumber(this.fps, 30),
          bitrate: this.safeNumber(this.bitrate, 0),
          includeAudio: this.includeAudio
        },
        camera: {
          facing: this.facing
        },
        limits: {
          maxDurationMs: this.safeNumber(this.maxDurationMs, 0),
          minDurationMs: this.safeNumber(this.minDurationMs, 0)
        },
        diagnostics: {
          perfLogging: this.perfLogging
        },
        success: (res) => {
          this.videoPath = res.savedFilePath || res.tempFilePath
          this.savedFilePath = res.savedFilePath || ''
          this.tempFilePath = res.tempFilePath
          const statsText = this.formatStats(res.stats, res.durationMs)
          this.status = `Saved ${res.width}x${res.height}, ${res.durationMs}ms to gallery. ${statsText}`
        },
        fail: (err) => {
          this.status = `${this.errorLabel(err.errCode)} (${err.errCode}): ${err.errMsg}`
        },
        complete: () => {
          this.busy = false
        }
      })
    },
    chooseWatermarkImage() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed', 'original'],
        sourceType: ['album'],
        success: (res) => {
          this.watermarkImagePath = res.tempFilePaths[0] || ''
        },
        fail: (err) => {
          this.status = err.errMsg || 'Choose logo failed.'
        }
      })
    },
    clearWatermarkImage() {
      this.watermarkImagePath = ''
    },
    safeNumber(value, fallback) {
      const number = Number(value)
      return Number.isFinite(number) ? number : fallback
    },
    formatStats(stats, durationMs) {
      if (!stats) {
        return 'Play it to verify the burned-in watermark.'
      }
      const seconds = Math.max(0.001, this.safeNumber(durationMs, 0) / 1000)
      const actualFps = Math.round((stats.encoded / seconds) * 10) / 10
      return `Frames encoded ${stats.encoded}/${stats.processed}, actual ${actualFps}fps, dropped busy ${stats.droppedBusy}, dropped fps ${stats.droppedFps}, received ${stats.received}.`
    },
    errorLabel(code) {
      const labels = {
        1000: 'Environment unavailable',
        1001: 'Permission denied',
        1002: 'Recording cancelled',
        1003: 'Camera unavailable',
        1004: 'Recorder start failed',
        1005: 'Recorder stop failed',
        1006: 'No frames recorded',
        1007: 'Recording too short',
        1008: 'Encoder unavailable',
        1100: 'Sample generation failed',
        2100: 'iOS sample unavailable'
      }
      return labels[code] || 'Recording failed'
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 24px 18px;
  box-sizing: border-box;
}

.panel {
  padding: 18px;
  border: 1px solid #dfe5eb;
  border-radius: 8px;
  background: #ffffff;
}

.title {
  display: block;
  font-size: 22px;
  font-weight: 700;
  color: #17212b;
}

.hint {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  color: #697684;
}

.input {
  height: 44px;
  margin-top: 18px;
  padding: 0 12px;
  border: 1px solid #ccd6df;
  border-radius: 6px;
  background: #fbfcfd;
  color: #17212b;
  font-size: 15px;
}

.button {
  margin-top: 14px;
  border-radius: 6px;
  background: #1769e0;
  color: #ffffff;
  font-size: 15px;
}

.button[disabled] {
  background: #9ba9b8;
}

.secondaryButton {
  margin: 0;
  border-radius: 6px;
  background: #edf3f8;
  color: #243447;
  font-size: 13px;
}

.logoRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.logoPath {
  max-width: 100%;
  color: #697684;
  font-size: 11px;
  line-height: 16px;
  word-break: break-all;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 14px;
}

.field {
  min-width: 0;
}

.label {
  display: block;
  color: #697684;
  font-size: 12px;
}

.smallInput {
  height: 38px;
  margin-top: 6px;
  padding: 0 10px;
  border: 1px solid #ccd6df;
  border-radius: 6px;
  background: #fbfcfd;
  color: #17212b;
  font-size: 14px;
}

.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}

.checkRow {
  display: flex;
  align-items: center;
  min-height: 32px;
}

.checkText {
  margin-left: 4px;
  color: #344252;
  font-size: 13px;
}

.status {
  display: block;
  margin-top: 12px;
  color: #344252;
  font-size: 13px;
  line-height: 20px;
}

.video {
  width: 100%;
  height: 420px;
  margin-top: 16px;
  border-radius: 8px;
  background: #111820;
}

.pathBox {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #dfe5eb;
  border-radius: 8px;
  background: #ffffff;
}

.pathLabel {
  display: block;
  color: #697684;
  font-size: 12px;
}

.path {
  display: block;
  margin-top: 6px;
  color: #17212b;
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
}
</style>
