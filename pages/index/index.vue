<template>
  <view class="page">
    <view class="panel">
      <text class="title">UTS MarkVideo MVP</text>
      <text class="hint">Android native MP4 watermark encoder</text>

      <input
        class="input"
        v-model="watermarkText"
        maxlength="40"
        placeholder="Watermark text"
      />

      <button class="button" :disabled="busy" @click="createSample">
        {{ busy ? 'Generating...' : 'Generate native sample' }}
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
      <text class="pathLabel">File</text>
      <text class="path">{{ videoPath }}</text>
    </view>
  </view>
</template>

<script>
import { createWatermarkSample } from '@/uni_modules/uts-markvideo'

export default {
  data() {
    return {
      busy: false,
      videoPath: '',
      watermarkText: 'UTS 即拍即有水印',
      status: 'Ready'
    }
  },
  methods: {
    createSample() {
      if (this.busy) return

      this.busy = true
      this.videoPath = ''
      this.status = 'Generating native MP4...'

      createWatermarkSample({
        text: this.watermarkText,
        durationMs: 3000,
        width: 720,
        height: 1280,
        fps: 24,
        success: (res) => {
          this.videoPath = res.tempFilePath
          this.status = `Created ${res.width}x${res.height}, ${res.durationMs}ms`
        },
        fail: (err) => {
          this.status = `${err.errCode}: ${err.errMsg}`
        },
        complete: () => {
          this.busy = false
        }
      })
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
