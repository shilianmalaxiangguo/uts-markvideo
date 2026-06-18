<template>
  <view class="page">
    <view class="header">
      <text class="eyebrow">宿主模拟页</text>
      <text class="title">内嵌水印相机</text>
      <text class="hint">维护默认模板并进入业务相机页</text>
    </view>

    <view class="templateList">
      <button
        v-for="template in templates"
        :key="template.templateId"
        class="templateCard"
        :class="{ isSelected: selectedTemplateId === template.templateId }"
        @click="selectedTemplateId = template.templateId"
      >
        <view class="templatePreview">
          <image
            v-if="template.templateType === 'image_title_subtitle'"
            class="templateImage"
            :src="template.imagePath"
            mode="aspectFit"
          />
          <view class="templateCopy">
            <text class="templateName">{{ template.templateName }}</text>
            <text class="templateText">{{ template.mainTitleText }}</text>
            <text v-if="template.subtitleText" class="templateSubtext">
              {{ template.subtitleText }}
            </text>
          </view>
        </view>
      </button>
    </view>

    <view class="editor">
      <text class="editorTitle">模拟模板编辑</text>
      <input
        class="input"
        v-model="draftMainTitle"
        maxlength="40"
        placeholder="主标题"
      />
      <input
        class="input"
        v-model="draftSubtitle"
        maxlength="80"
        placeholder="副标题"
      />
      <button class="secondaryButton" @click="applyDraft">更新当前模板</button>
    </view>

    <button class="primaryButton" @click="openCameraPage">进入业务相机页</button>
  </view>
</template>

<script>
import { DEFAULT_WATERMARK_TEMPLATES } from './cameraService'

export default {
  data() {
    return {
      templates: DEFAULT_WATERMARK_TEMPLATES.map((template) => ({ ...template })),
      selectedTemplateId: DEFAULT_WATERMARK_TEMPLATES[0].templateId,
      draftMainTitle: DEFAULT_WATERMARK_TEMPLATES[0].mainTitleText,
      draftSubtitle: DEFAULT_WATERMARK_TEMPLATES[0].subtitleText
    }
  },
  mounted() {
    this.syncCameraPayload()
  },
  watch: {
    selectedTemplateId() {
      const template = this.currentTemplate()
      this.draftMainTitle = template.mainTitleText
      this.draftSubtitle = template.subtitleText
      this.syncCameraPayload()
    }
  },
  methods: {
    currentTemplate() {
      return this.templates.find((template) => template.templateId === this.selectedTemplateId) || this.templates[0]
    },
    applyDraft() {
      const selected = this.currentTemplate()
      selected.mainTitleText = this.draftMainTitle || selected.mainTitleText
      if (selected.templateType !== 'title_text') {
        selected.subtitleText = this.draftSubtitle || selected.subtitleText
      }
      this.syncCameraPayload()
    },
    syncCameraPayload() {
      uni.setStorageSync('embedded-camera-payload', {
        templates: this.templates,
        selectedTemplateId: this.selectedTemplateId
      })
    },
    openCameraPage() {
      this.syncCameraPayload()
      uni.navigateTo({
        url: '/pages/camera/camera'
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 22px 18px 28px;
  box-sizing: border-box;
  background: #f5f8f6;
}

.header {
  display: grid;
  gap: 5px;
}

.eyebrow {
  color: #126fdb;
  font-size: 12px;
  font-weight: 700;
}

.title {
  color: #17212b;
  font-size: 24px;
  font-weight: 800;
  line-height: 32px;
}

.hint {
  color: #687789;
  font-size: 13px;
  line-height: 20px;
}

.templateList,
.editor {
  display: grid;
  gap: 10px;
}

.templateCard,
.editor {
  border: 1px solid #d8e2dc;
  border-radius: 8px;
  background: #ffffff;
}

.templateCard {
  width: 100%;
  margin: 0;
  padding: 12px;
  color: #17212b;
  text-align: left;
}

.templateCard.isSelected {
  border-color: #126fdb;
  background: #edf5ff;
}

.templatePreview {
  display: flex;
  align-items: center;
  gap: 12px;
}

.templateImage {
  width: 42px;
  height: 42px;
}

.templateCopy {
  min-width: 0;
}

.templateName,
.templateText,
.templateSubtext,
.editorTitle {
  display: block;
}

.templateName,
.editorTitle {
  color: #17212b;
  font-size: 15px;
  font-weight: 700;
  line-height: 22px;
}

.templateText {
  color: #26313b;
  font-size: 14px;
  line-height: 20px;
}

.templateSubtext {
  color: #687789;
  font-size: 12px;
  line-height: 18px;
}

.editor {
  padding: 14px;
}

.input {
  height: 42px;
  padding: 0 12px;
  border: 1px solid #ced9d3;
  border-radius: 8px;
  background: #fbfdfc;
  color: #17212b;
  font-size: 14px;
}

.primaryButton,
.secondaryButton {
  margin: 0;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
}

.primaryButton {
  min-height: 46px;
  background: #126fdb;
  color: #ffffff;
}

.secondaryButton {
  min-height: 42px;
  background: #e9f0ed;
  color: #17212b;
}
</style>
