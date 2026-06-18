<template>
  <view class="page">
    <view class="panel">
      <text class="title">UTS MarkVideo MVP</text>
      <text class="hint">Native camera recorder</text>

      <input
        class="input"
        v-model="watermarkText"
        maxlength="40"
        placeholder="Watermark text"
      />

      <label class="checkRow">
        <switch :checked="enablePhoto" @change="onPhotoToggle" />
        <text class="checkText">Photo</text>
      </label>

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

    <view v-if="videoPath" class="pathBox">
      <text class="pathLabel">Video file</text>
      <text class="path">{{ videoPath }}</text>
    </view>

    <view v-if="photoSavedFilePaths.length > 0" class="pathBox">
      <text class="pathLabel">Saved photos</text>
      <text
        v-for="path in photoSavedFilePaths"
        :key="path"
        class="path"
      >
        {{ path }}
      </text>
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
      photoSavedFilePaths: [],
      watermarkText: 'UTS 即拍即有水印',
      enablePhoto: true,
      status: 'Ready'
    }
  },
  methods: {
    openRecorder() {
      if (this.busy) return

      this.busy = true
      this.videoPath = ''
      this.photoSavedFilePaths = []
      this.status = this.enablePhoto
        ? 'Open native camera, then record or take photos.'
        : 'Open native camera, then start and stop recording.'

      recordWatermarkVideo({
        watermark: {
          text: this.watermarkText
        },
        video: {
          fps: 15
        },
        camera: {
          enablePhoto: this.enablePhoto
        },
        success: (res) => {
          const kind = res.kind || 'recording'
          this.photoSavedFilePaths = this.normalizeStringArray(res.photoSavedFilePaths)
          this.videoPath = kind === 'photo' ? '' : (res.savedFilePath || res.tempFilePath)
          const photoCount = this.photoSavedFilePaths.length
          const photoText = photoCount > 0 ? ` Photos ${photoCount}.` : ''
          if (kind === 'photo') {
            this.status = `Saved photos ${photoCount}.`
          } else {
            this.status = `Created ${res.width}x${res.height}, ${res.durationMs}ms.${photoText} Play it to verify the burned-in watermark.`
          }
        },
        fail: (err) => {
          this.status = `${err.errCode}: ${err.errMsg}`
        },
        complete: () => {
          this.busy = false
        }
      })
    },
    onPhotoToggle(event) {
      this.enablePhoto = !!event.detail.value
    },
    normalizeStringArray(value) {
      if (Array.isArray(value)) {
        return value.map((item) => `${item}`).filter((item) => item.length > 0)
      }
      if (typeof value === 'string') {
        return value.split('\n').map((item) => item.trim()).filter((item) => item.length > 0)
      }
      if (value && typeof value.length === 'number') {
        const result = []
        for (let index = 0; index < value.length; index += 1) {
          const item = `${value[index]}`
          if (item.length > 0) {
            result.push(item)
          }
        }
        return result
      }
      return []
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

.checkRow {
  display: flex;
  align-items: center;
  margin-top: 14px;
}

.checkText {
  margin-left: 6px;
  color: #344252;
  font-size: 14px;
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
