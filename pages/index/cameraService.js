export const WATERMARK_TEMPLATE_DEFAULTS = {
  mainTitleText: '',
  subtitleText: '',
  mainTitleColor: '#26313B',
  subtitleColor: '#56616D',
  mainTitleFontSize: 16,
  subtitleFontSize: 12,
  mainTitleBold: true,
  subtitleBold: false,
  imagePath: '',
  imageMimeType: '',
  imageWidth: 0,
  imageHeight: 0,
  imageTextGap: 8,
  boxWidth: 0.64,
  boxHeight: 0.16,
  boxBackgroundColor: 'rgba(255,255,255,0.78)',
  boxRadius: 8,
  boxPadding: 10,
  positionX: 0.18,
  positionY: 0.25
}

export const DEFAULT_WATERMARK_TEMPLATES = [
  {
    ...WATERMARK_TEMPLATE_DEFAULTS,
    templateId: 'title-only',
    templateName: '纯主标题',
    templateType: 'title_text',
    mainTitleText: '今日水印相机',
    boxHeight: 0.14
  },
  {
    ...WATERMARK_TEMPLATE_DEFAULTS,
    templateId: 'title-subtitle',
    templateName: '主副标题',
    templateType: 'title_subtitle_text',
    mainTitleText: '门店巡检',
    subtitleText: '照片和录像共用同一套水印'
  },
  {
    ...WATERMARK_TEMPLATE_DEFAULTS,
    templateId: 'png-title-subtitle',
    templateName: 'PNG 图文',
    templateType: 'image_title_subtitle',
    mainTitleText: '交付留档',
    subtitleText: 'PNG 图片 + 主副标题',
    imagePath: '/static/watermark/watermark-demo.png',
    imageMimeType: 'image/png',
    imageWidth: 42,
    imageHeight: 42,
    boxWidth: 0.7,
    boxHeight: 0.18,
    positionX: 0.15
  }
]

const VALID_TEMPLATE_TYPES = ['title_text', 'title_subtitle_text', 'image_title_subtitle']
const VALID_ZOOMS = ['wide', '1x', '2x']
const VALID_CAMERA_FACINGS = ['back', 'front']

function createResult(success, data, errorCode, errorMessage, nativeMessage) {
  return {
    success: success,
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
  return template ? JSON.parse(JSON.stringify(template)) : {}
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isColor(value) {
  if (typeof value !== 'string') return false
  return /^#[0-9a-fA-F]{6}$/.test(value) ||
    /^#[0-9a-fA-F]{8}$/.test(value) ||
    /^rgba\(\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(0|1|0?\.\d+)\s*\)$/.test(value)
}

function inRange(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max
}

function normalizePosition(template) {
  const next = cloneTemplate(template)
  next.positionX = Math.min(Math.max(next.positionX, 0), Math.max(0, 1 - next.boxWidth))
  next.positionY = Math.min(Math.max(next.positionY, 0), Math.max(0, 1 - next.boxHeight))
  return next
}

export function normalizeWatermarkTemplate(template) {
  if (!template || typeof template !== 'object') {
    return { template: null, reason: '模板不能为空' }
  }
  const normalized = normalizePosition({
    ...WATERMARK_TEMPLATE_DEFAULTS,
    ...template
  })

  if (normalized.templateType === 'title_text') {
    normalized.subtitleText = ''
    normalized.imagePath = ''
    normalized.imageMimeType = ''
    normalized.imageWidth = 0
    normalized.imageHeight = 0
  }
  if (normalized.templateType === 'title_subtitle_text') {
    normalized.imagePath = ''
    normalized.imageMimeType = ''
    normalized.imageWidth = 0
    normalized.imageHeight = 0
  }

  const reason = validateWatermarkTemplate(normalized)
  return { template: reason ? null : normalized, reason }
}

export function validateWatermarkTemplate(template) {
  if (!template || typeof template !== 'object') return '模板不能为空'
  if (!isNonEmptyString(template.templateId)) return 'templateId 不能为空'
  if (!isNonEmptyString(template.templateName)) return 'templateName 不能为空'
  if (!VALID_TEMPLATE_TYPES.includes(template.templateType)) return 'templateType 无效'
  if (!isColor(template.mainTitleColor)) return 'mainTitleColor 无效'
  if (!isColor(template.subtitleColor)) return 'subtitleColor 无效'
  if (!isColor(template.boxBackgroundColor)) return 'boxBackgroundColor 无效'
  if (!inRange(template.mainTitleFontSize, 8, 72)) return 'mainTitleFontSize 超出范围'
  if (!inRange(template.subtitleFontSize, 8, 48)) return 'subtitleFontSize 超出范围'
  if (!inRange(template.imageWidth, 0, 512)) return 'imageWidth 超出范围'
  if (!inRange(template.imageHeight, 0, 512)) return 'imageHeight 超出范围'
  if (!inRange(template.imageTextGap, 0, 64)) return 'imageTextGap 超出范围'
  if (!inRange(template.boxWidth, 0.1, 1)) return 'boxWidth 超出范围'
  if (!inRange(template.boxHeight, 0.05, 1)) return 'boxHeight 超出范围'
  if (!inRange(template.boxRadius, 0, 80)) return 'boxRadius 超出范围'
  if (!inRange(template.boxPadding, 0, 80)) return 'boxPadding 超出范围'
  if (!inRange(template.positionX, 0, 1)) return 'positionX 超出范围'
  if (!inRange(template.positionY, 0, 1)) return 'positionY 超出范围'
  if (template.templateType === 'title_text' && !isNonEmptyString(template.mainTitleText)) {
    return '纯主标题模板必须包含 mainTitleText'
  }
  if (template.templateType === 'title_subtitle_text' && (!isNonEmptyString(template.mainTitleText) || !isNonEmptyString(template.subtitleText))) {
    return '主副标题模板必须包含 mainTitleText 和 subtitleText'
  }
  if (template.templateType === 'image_title_subtitle') {
    if (!isNonEmptyString(template.mainTitleText) || !isNonEmptyString(template.subtitleText)) {
      return 'PNG 图文模板必须包含 mainTitleText 和 subtitleText'
    }
    if (!isNonEmptyString(template.imagePath) || template.imageMimeType !== 'image/png' || template.imageWidth <= 0 || template.imageHeight <= 0) {
      return 'PNG 图文模板图片字段无效'
    }
  }
  return ''
}

function emitMethodError(emit, result) {
  emit('onError', {
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    nativeMessage: result.nativeMessage
  })
}

async function callNative(nativeCamera, method, emit, ...args) {
  if (!nativeCamera || typeof nativeCamera[method] !== 'function') {
    const result = fail('9001', '原生相机组件不可用', `missing native method: ${method}`)
    emitMethodError(emit, result)
    return result
  }
  try {
    const result = await nativeCamera[method](...args)
    if (!result || typeof result !== 'object' || result.success !== true && result.success !== false) {
      const wrapped = fail('9001', '原生返回结构无效', `invalid result from ${method}`)
      emitMethodError(emit, wrapped)
      return wrapped
    }
    if (!result.success) emitMethodError(emit, result)
    return result
  } catch (error) {
    const result = fail('9001', '未知原生错误', error?.message || `${error}`)
    emitMethodError(emit, result)
    return result
  }
}

function resultData(result) {
  return result.data || {}
}

export function createCameraService(handlers = {}) {
  let nativeCamera = null
  let ready = false
  let recording = false
  let flashEnabled = false
  let zoom = '1x'
  let cameraFacing = 'back'
  let currentTemplate = null
  let frozenTemplate = null
  let lastResult = null

  const emit = (name, payload = {}) => {
    const handler = handlers[name]
    if (typeof handler === 'function') handler(payload)
  }

  return {
    get state() {
      return {
        ready,
        recording,
        flashEnabled,
        zoom,
        cameraFacing,
        currentTemplate: cloneTemplate(currentTemplate),
        lastResult
      }
    },
    async mountCamera(options) {
      nativeCamera = options.nativeCamera || handlers.nativeCamera || nativeCamera
      const result = await callNative(nativeCamera, 'mountCamera', emit, {
        containerId: options.containerId,
        previewWidth: options.previewWidth,
        previewHeight: options.previewHeight,
        cameraFacing: VALID_CAMERA_FACINGS.includes(options.cameraFacing) ? options.cameraFacing : 'back',
        zoom: VALID_ZOOMS.includes(options.zoom) ? options.zoom : '1x',
        flashEnabled: !!options.flashEnabled
      })
      if (!result.success) return result
      ready = true
      const data = resultData(result)
      zoom = data.zoom || '1x'
      flashEnabled = !!data.flashEnabled
      cameraFacing = data.cameraFacing || 'back'
      emit('onCameraReady', data)
      return ok({})
    },
    async setWatermark(template) {
      if (recording) {
        const result = fail('1403', '录像中不能切换水印模板')
        emitMethodError(emit, result)
        return result
      }
      const normalized = normalizeWatermarkTemplate(template)
      if (normalized.reason) {
        const result = fail('1201', '水印模板参数无效', normalized.reason)
        emitMethodError(emit, result)
        return result
      }
      const result = await callNative(nativeCamera, 'setWatermark', emit, normalized.template)
      if (!result.success) return result
      currentTemplate = normalized.template
      const payload = {
        x: currentTemplate.positionX,
        y: currentTemplate.positionY,
        width: currentTemplate.boxWidth,
        height: currentTemplate.boxHeight,
        watermarkTemplateId: currentTemplate.templateId
      }
      emit('onWatermarkPositionChange', payload)
      return ok({})
    },
    async clearWatermark() {
      if (recording) {
        const result = fail('1403', '录像中不能清除水印')
        emitMethodError(emit, result)
        return result
      }
      const result = await callNative(nativeCamera, 'clearWatermark', emit)
      if (!result.success) return result
      currentTemplate = null
      return ok({})
    },
    async getWatermarkPosition() {
      if (!ready) {
        const result = fail('1104', '相机未就绪')
        emitMethodError(emit, result)
        return result
      }
      return callNative(nativeCamera, 'getWatermarkPosition', emit)
    },
    async takePhoto() {
      if (!ready) {
        const result = fail('1104', '相机未就绪')
        emitMethodError(emit, result)
        return result
      }
      const snapshot = cloneTemplate(currentTemplate)
      const result = await callNative(nativeCamera, 'takePhoto', emit, {
        watermarkTemplate: snapshot
      })
      if (!result.success) return result
      const data = resultData(result)
      lastResult = {
        type: 'photo',
        ...data
      }
      emit('onPhotoDone', data)
      if (data.albumFilePath === '') {
        emit('onError', {
          errorCode: '1501',
          errorMessage: '文件保存失败',
          nativeMessage: 'Album path is empty.'
        })
      }
      return result
    },
    async startRecord() {
      if (!ready) {
        const result = fail('1104', '相机未就绪')
        emitMethodError(emit, result)
        return result
      }
      if (recording) {
        const result = fail('1403', '当前状态不允许重复开始录像')
        emitMethodError(emit, result)
        return result
      }
      frozenTemplate = cloneTemplate(currentTemplate)
      const result = await callNative(nativeCamera, 'startRecord', emit, {
        watermarkTemplate: frozenTemplate
      })
      if (!result.success) return result
      recording = true
      emit('onRecordStart', {
        watermarkTemplateId: frozenTemplate.templateId || '',
        watermarkPositionX: frozenTemplate.positionX || 0,
        watermarkPositionY: frozenTemplate.positionY || 0,
        zoom,
        cameraFacing
      })
      return ok({})
    },
    async stopRecord() {
      if (!recording) {
        const result = fail('1403', '当前未处于录像中')
        emitMethodError(emit, result)
        return result
      }
      const result = await callNative(nativeCamera, 'stopRecord', emit)
      if (!result.success) return result
      recording = false
      const data = resultData(result)
      lastResult = {
        type: 'video',
        ...data
      }
      emit('onRecordDone', data)
      if (data.albumFilePath === '') {
        emit('onError', {
          errorCode: '1501',
          errorMessage: '文件保存失败',
          nativeMessage: 'Album path is empty.'
        })
      }
      return result
    },
    async switchFlash(enabled) {
      const result = await callNative(nativeCamera, 'switchFlash', emit, !!enabled)
      if (!result.success) return result
      flashEnabled = !!resultData(result).enabled
      emit('onFlashChange', {
        enabled: flashEnabled,
        flashAvailable: true
      })
      return result
    },
    async setZoom(nextZoom) {
      const result = await callNative(nativeCamera, 'setZoom', emit, nextZoom)
      if (!result.success) return result
      zoom = resultData(result).zoom
      emit('onZoomChange', {
        zoom,
        availableZooms: ['wide', '1x', '2x']
      })
      return result
    },
    async switchCamera(nextFacing) {
      if (recording) {
        const result = fail('1403', '录像中不能切换摄像头')
        emitMethodError(emit, result)
        return result
      }
      const result = await callNative(nativeCamera, 'switchCamera', emit, nextFacing)
      if (!result.success) return result
      cameraFacing = resultData(result).cameraFacing
      emit('onCameraFacingChange', { cameraFacing })
      return result
    },
    async destroyCamera() {
      if (!nativeCamera) {
        ready = false
        recording = false
        return ok({})
      }
      const result = await callNative(nativeCamera, 'destroyCamera', emit)
      ready = false
      recording = false
      nativeCamera = null
      return result.success ? ok({}) : result
    }
  }
}
