<template>
  <view class="page">
    <view class="panel">
      <view class="heading">
        <view>
          <text class="title">UTS MarkVideo</text>
          <text class="hint">Watermark camera</text>
        </view>
        <button class="smallButton" :disabled="logoLoading || busy" @click="loadWatermarkLogoAssets">
          {{ logoLoading ? 'Loading' : 'Refresh' }}
        </button>
      </view>

      <view class="watermarkPreview">
        <image
          v-if="logoPreviewPath"
          class="logoImage"
          :src="logoPreviewPath"
          mode="aspectFit"
        />
        <view v-else class="logoFallback">
          <text class="logoFallbackText">LOGO</text>
        </view>
        <text class="watermarkPreviewText">{{ watermarkText }}</text>
      </view>

      <view class="logoRow">
        <view class="logoMeta">
          <text class="logoName">{{ selectedLogoName }}</text>
          <text class="logoStatus">{{ logoStatus }}</text>
        </view>
        <button class="secondaryButton" :disabled="busy" @click="chooseWatermarkLogo">
          Replace
        </button>
      </view>

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

const WATERMARK_LOGO_API = ''
const FALLBACK_LOGO_ASSETS = [
  {
    id: 'company-logo',
    name: '企业 Logo',
    imageUrl: 'https://dummyimage.com/240x240/17212b/ffffff.png&text=LOGO',
    width: 72,
    height: 72
  }
]

export default {
  data() {
    return {
      busy: false,
      logoLoading: false,
      videoPath: '',
      photoSavedFilePaths: [],
      watermarkText: 'UTS 即拍即有水印',
      watermarkImagePath: '',
      logoPreviewPath: '',
      selectedLogoName: '企业 Logo',
      selectedLogoWidth: 72,
      selectedLogoHeight: 72,
      enablePhoto: true,
      logoStatus: 'Preset logo will be used when available.',
      status: 'Ready'
    }
  },
  mounted() {
    this.loadWatermarkLogoAssets()
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
          text: this.watermarkText,
          imagePath: this.watermarkImagePath,
          imageWidth: this.selectedLogoWidth,
          imageHeight: this.selectedLogoHeight,
          imageGap: 18,
          boxWidth: 0.88,
          boxHeight: 0.16,
          backgroundColor: '#00000099',
          borderRadius: 18,
          padding: 28
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
    async loadWatermarkLogoAssets() {
      if (this.logoLoading) return

      this.logoLoading = true
      this.logoStatus = 'Loading logo asset...'
      try {
        const assets = await this.requestWatermarkLogoAssets()
        const logo = assets[0]
        if (!logo || !logo.imageUrl) {
          throw new Error('Logo API returned no image.')
        }
        await this.applyRemoteWatermarkLogo(logo)
      } catch (error) {
        this.logoStatus = `Logo unavailable: ${error.message || error}`
      } finally {
        this.logoLoading = false
      }
    },
    requestWatermarkLogoAssets() {
      if (!WATERMARK_LOGO_API) {
        return Promise.resolve(FALLBACK_LOGO_ASSETS)
      }

      return new Promise((resolve, reject) => {
        uni.request({
          url: WATERMARK_LOGO_API,
          method: 'GET',
          success: (res) => {
            const assets = this.normalizeLogoAssets(res.data)
            resolve(assets.length > 0 ? assets : FALLBACK_LOGO_ASSETS)
          },
          fail: (err) => {
            reject(new Error(err.errMsg || 'Logo API request failed.'))
          }
        })
      })
    },
    normalizeLogoAssets(data) {
      const list = Array.isArray(data?.logos)
        ? data.logos
        : (Array.isArray(data?.data?.logos) ? data.data.logos : [])

      return list
        .map((item) => {
          const imageUrl = `${item.imageUrl || item.url || ''}`
          return {
            id: `${item.id || imageUrl}`,
            name: `${item.name || '企业 Logo'}`,
            imageUrl,
            width: Number(item.width || 72),
            height: Number(item.height || 72)
          }
        })
        .filter((item) => item.imageUrl.length > 0)
    },
    applyRemoteWatermarkLogo(logo) {
      this.selectedLogoName = logo.name
      this.selectedLogoWidth = logo.width || 72
      this.selectedLogoHeight = logo.height || 72

      return new Promise((resolve, reject) => {
        uni.downloadFile({
          url: logo.imageUrl,
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
              this.watermarkImagePath = res.tempFilePath
              this.logoPreviewPath = res.tempFilePath
              this.logoStatus = 'Preset logo ready.'
              resolve()
            } else {
              reject(new Error(`Logo download failed: ${res.statusCode}`))
            }
          },
          fail: (err) => {
            reject(new Error(err.errMsg || 'Logo download failed.'))
          }
        })
      })
    },
    chooseWatermarkLogo() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album'],
        success: (res) => {
          const imagePath = res.tempFilePaths && res.tempFilePaths[0]
          if (!imagePath) return

          this.watermarkImagePath = imagePath
          this.logoPreviewPath = imagePath
          this.selectedLogoName = '本地替换 Logo'
          this.logoStatus = 'Local logo selected.'
        },
        fail: (err) => {
          if (err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
          this.logoStatus = err.errMsg || 'Logo selection failed.'
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
  background: #f4f6f8;
}

.panel {
  padding: 18px;
  border: 1px solid #d7e0e8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 2px 5px rgba(25, 38, 52, 0.06), 0 10px 22px rgba(25, 38, 52, 0.08);
}

.heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.watermarkPreview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 128px;
  margin-top: 18px;
  padding: 18px;
  border-radius: 8px;
  background: #17212b;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.logoImage,
.logoFallback {
  width: 72px;
  height: 72px;
}

.logoFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
}

.logoFallbackText {
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
}

.watermarkPreviewText {
  display: block;
  max-width: 100%;
  margin-top: 12px;
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
  line-height: 24px;
  text-align: center;
  word-break: break-word;
}

.logoRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.logoMeta {
  flex: 1;
  min-width: 0;
}

.logoName,
.logoStatus {
  display: block;
}

.logoName {
  color: #17212b;
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
}

.logoStatus {
  margin-top: 2px;
  color: #687789;
  font-size: 12px;
  line-height: 18px;
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

.smallButton,
.secondaryButton {
  height: 34px;
  margin: 0;
  padding: 0 12px;
  border: 1px solid #c8d3dd;
  border-radius: 6px;
  background: #ffffff;
  color: #17212b;
  font-size: 13px;
  line-height: 34px;
}

.secondaryButton {
  flex: 0 0 auto;
}

.button[disabled] {
  background: #9ba9b8;
}

.smallButton[disabled],
.secondaryButton[disabled] {
  color: #8a98a8;
  background: #eef2f5;
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
