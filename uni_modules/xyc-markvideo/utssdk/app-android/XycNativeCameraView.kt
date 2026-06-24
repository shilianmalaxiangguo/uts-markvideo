@file:Suppress("DEPRECATION")

package uts.xyc.markvideo.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.hardware.Camera
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.ExifInterface
import android.media.MediaActionSound
import android.media.MediaMetadataRetriever
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaScannerConnection
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.OrientationEventListener
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class XycNativeCameraView(context: Context) : FrameLayout(context), TextureView.SurfaceTextureListener {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioThread = HandlerThread("xyc-markvideo-io").apply { start() }
    private val ioHandler = Handler(ioThread.looper)
    private val previewView = TextureView(context)
    private val statusView = TextView(context)
    private val mediaActionSound = MediaActionSound().apply {
        load(MediaActionSound.SHUTTER_CLICK)
        load(MediaActionSound.START_VIDEO_RECORDING)
        load(MediaActionSound.STOP_VIDEO_RECORDING)
    }
    private var deviceOrientationDegrees = 0
    private val captureOrientationListener = object : OrientationEventListener(context.applicationContext) {
        override fun onOrientationChanged(orientation: Int) {
            if (orientation == OrientationEventListener.ORIENTATION_UNKNOWN) {
                return
            }
            deviceOrientationDegrees = roundDeviceOrientationDegrees(orientation)
        }
    }
    private var eventCallback: ((String, String) -> Unit)? = null

    private var camera: Camera? = null
    private var videoRecorder: CameraMp4Recorder? = null
    private var activeCameraId = -1
    private var previewReady = false
    private var currentMode = "photo"
    private var requestedFlashMode = UI_FLASH_OFF
    private var requestedZoomMode = UI_ZOOM_1X
    private var requestedCameraFacing = UI_CAMERA_BACK
    private var targetFps = DEFAULT_TARGET_FPS
    @Volatile private var cameraSoundEnabled = true
    private var previewSize = XycSize(1280, 720)
    private var pictureSize = XycSize(1920, 1080)
    private var videoSize = XycSize(1280, 720)
    private var recordingOutputSize = XycSize(1280, 720)
    private var recording = false
    @Volatile private var recordingStartPending = false
    @Volatile private var recordingStopRequested = false
    private var photoBusy = false
    private var recordingStartedAt = 0L
    private var videoOutputTarget: VideoOutputTarget? = null
    private var lastPublishedMediaUri = ""
    private var lastPublishedMediaKind = ""
    private var lastPublishedAlbumUri = ""
    private var cameraPermissionRequested = false
    private var cameraPermissionRetryCount = 0
    private var recordPermissionRequested = false
    private var recordPermissionRetryCount = 0
    private var activeWatermark: NativeWatermark? = null
    private var activeWatermarkBitmap: Bitmap? = null
    private var recordingWatermarkSnapshot: NativeWatermark? = null
    private var recordingWatermarkBitmap: Bitmap? = null
    private var recordingWatermarkOverlay: WatermarkOverlay? = null
    private var recordingVideoBurnIn = false
    private var recordingCameraFacing = UI_CAMERA_BACK
    private var recordingFramesCanWriteAt = 0L
    @Volatile private var recordingFrameError = false
    @Volatile private var recordingFrameErrorStage = ""
    @Volatile private var recordingFrameErrorDetail = ""
    @Volatile private var recordingFrameSkipStage = ""
    @Volatile private var recordingFrameSkipDetail = ""
    private var videoFrameLoopRunning = false
    private val videoFramePending = AtomicBoolean(false)
    private var reusableVideoFrame: Bitmap? = null
    private var reusableMirroredVideoFrame: Bitmap? = null
    @Volatile private var releaseReusableFrameAfterRecordStop = false
    @Volatile private var quitIoThreadAfterRecordStop = false
    private val videoFrameRunnable = object : Runnable {
        override fun run() {
            requestNextVideoFrame()
        }
    }

    init {
        lockHostActivityToPortrait()
        if (captureOrientationListener.canDetectOrientation()) {
            captureOrientationListener.enable()
        }
        setBackgroundColor(Color.BLACK)
        previewView.surfaceTextureListener = this
        addView(
            previewView,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        )

        statusView.setTextColor(Color.WHITE)
        statusView.textSize = 13f
        statusView.gravity = Gravity.CENTER
        statusView.setBackgroundColor(Color.argb(90, 0, 0, 0))
        statusView.setPadding(dp(14), 0, dp(14), 0)
        addView(
            statusView,
            LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36), Gravity.CENTER)
        )
        setStatus("相机初始化中")
    }

    fun setEventCallback(callback: (String, String) -> Unit) {
        eventCallback = callback
    }

    override fun onDetachedFromWindow() {
        captureOrientationListener.disable()
        closeCamera(true)
        releaseCameraActionSound()
        if (recordingStopRequested) {
            quitIoThreadAfterRecordStop = true
        } else {
            ioThread.quitSafely()
        }
        super.onDetachedFromWindow()
    }

    fun setStatus(text: String) {
        runOnMain {
            statusView.text = text
            statusView.visibility = if (shouldShowCenterStatus(text)) View.VISIBLE else View.GONE
        }
    }

    fun setMode(mode: String) {
        val nextMode = if (mode == "video") "video" else "photo"
        if (recording || recordingStartPending || recordingStopRequested) {
            return
        }
        if (nextMode == currentMode) {
            return
        }
        currentMode = nextMode
        runOnMain {
            applyFlashModeIfCameraOpen(false)
        }
    }

    fun setTargetFps(fps: Int) {
        targetFps = fps.coerceIn(15, DEFAULT_TARGET_FPS)
    }

    fun switchMode(mode: String): String {
        setMode(mode)
        return ok(payload().put("mode", currentMode))
    }

    fun setCameraSoundEnabled(enabled: Boolean): String {
        cameraSoundEnabled = enabled
        return ok(payload()
            .put("cameraSoundEnabled", cameraSoundEnabled)
            .put("message", if (cameraSoundEnabled) "提示音已开启" else "提示音已关闭"))
    }

    fun performHapticFeedback(type: String): String {
        return runOnMainSync {
            val normalizedType = normalizeHapticType(type)
            val feedbackType = when (normalizedType) {
                "medium", "heavy" -> HapticFeedbackConstants.LONG_PRESS
                else -> HapticFeedbackConstants.KEYBOARD_TAP
            }
            var applied = try {
                this@XycNativeCameraView.performHapticFeedback(feedbackType)
            } catch (_: Throwable) {
                false
            }
            if (!applied) {
                applied = try {
                    previewView.performHapticFeedback(feedbackType)
                } catch (_: Throwable) {
                    false
                }
            }
            ok(payload()
                .put("hapticType", normalizedType)
                .put("applied", applied))
        }
    }

    fun setFlashMode(mode: String): String {
        return runOnMainSync {
            val previousMode = requestedFlashMode
            val normalizedMode = normalizeFlashMode(mode)
            requestedFlashMode = normalizedMode
            val applied = applyFlashModeIfCameraOpen(false)
            if (!applied && requestedFlashMode != UI_FLASH_OFF) {
                requestedFlashMode = previousMode
                applyFlashModeIfCameraOpen(false)
            }
            val data = flashModePayload(normalizedMode, previousMode, applied)
            Log.i(
                LOG_TAG,
                "flash mode request requested=${normalizedMode} applied=${applied} ui=${requestedFlashMode} native=${data.optString("nativeFlashMode")} actual=${data.optString("actualFlashMode")} supported=${data.optJSONArray("supportedFlashModes")}"
            )
            emit("flashchange", data)
            ok(data)
        }
    }

    fun setZoomMode(mode: String): String {
        return runOnMainSync {
            val normalizedMode = normalizeZoomMode(mode)
            requestedZoomMode = normalizedMode
            val applied = applyZoomModeIfCameraOpen(false)
            if (!applied && requestedZoomMode != UI_ZOOM_1X) {
                requestedZoomMode = UI_ZOOM_1X
                if (camera == null && previewReady && hasPermission(Manifest.permission.CAMERA)) {
                    openCameraIfReady()
                } else {
                    applyZoomModeIfCameraOpen(false)
                }
            }
            val data = payload()
                .put("zoomMode", requestedZoomMode)
                .put("requestedZoomMode", normalizedMode)
                .put("availableZoomModes", zoomModesPayload(camera?.parameters))
                .put("applied", applied)
                .put("message", if (applied) zoomModeMessage(requestedZoomMode) else unsupportedZoomModeMessage(normalizedMode))
            emit("zoomchange", data)
            ok(data)
        }
    }

    fun switchCamera(): String {
        return runOnMainSync {
            if (recording || recordingStartPending || recordingStopRequested || photoBusy) {
                return@runOnMainSync failAndEmit("1105", "拍摄或保存中不能切换摄像头", "switchCamera while busy")
            }
            if (!previewReady) {
                return@runOnMainSync failAndEmit("1104", "相机未就绪", "Preview surface is not ready.")
            }
            if (!hasPermission(Manifest.permission.CAMERA)) {
                requestCameraPermissionIfNeeded(REQUEST_CAMERA_PERMISSION)
                setStatus("请授权相机权限后重试")
                return@runOnMainSync failAndEmit("1001", "相机权限未授权", "CAMERA permission is not granted.")
            }

            val previousFacing = requestedCameraFacing
            val previousZoomMode = requestedZoomMode
            val previousFlashMode = requestedFlashMode
            val nextFacing = nextCameraFacing(previousFacing)
            val targetCameraId = resolveCameraIdForFacing(nextFacing)
            if (targetCameraId < 0) {
                val data = cameraSwitchPayload(nextFacing, false, unsupportedCameraFacingMessage(nextFacing))
                emit("camerachange", data)
                return@runOnMainSync ok(data)
            }

            requestedCameraFacing = nextFacing
            requestedZoomMode = UI_ZOOM_1X
            if (requestedCameraFacing == UI_CAMERA_FRONT) {
                requestedFlashMode = UI_FLASH_OFF
            }

            closeCamera()
            val applied = try {
                openCameraIfReady()
                camera != null && activeCameraId == targetCameraId
            } catch (_: Throwable) {
                false
            }
            if (!applied) {
                closeCamera()
                requestedCameraFacing = previousFacing
                requestedZoomMode = previousZoomMode
                requestedFlashMode = previousFlashMode
                if (previewReady && hasPermission(Manifest.permission.CAMERA)) {
                    openCameraIfReady()
                }
            }

            val message = if (applied) cameraFacingMessage(requestedCameraFacing) else "摄像头切换失败"
            val data = cameraSwitchPayload(nextFacing, applied, message)
            emit("camerachange", data)
            ok(data)
        }
    }

    fun setWatermark(optionsJson: String): String {
        return runOnMainSync {
            if (recording || recordingStartPending) {
                val message = if (recordingStartPending) "录像启动中不能编辑水印" else "录像中不能编辑水印"
                return@runOnMainSync failAndEmit("1403", message, "setWatermark while recording busy")
            }
            val nextWatermark = try {
                parseWatermark(optionsJson)
            } catch (throwable: Throwable) {
                return@runOnMainSync failAndEmit("1201", "水印模板参数无效", throwable.message ?: throwable.javaClass.simpleName)
            }
            val nextBitmap = try {
                decodeRequiredWatermarkBitmap(nextWatermark)
            } catch (throwable: Throwable) {
                val message = throwable.message ?: "水印图片资源不可读"
                return@runOnMainSync failAndEmit("1202", message, message)
            }
            recycleBitmap(activeWatermarkBitmap)
            activeWatermarkBitmap = nextBitmap
            activeWatermark = nextWatermark
            ok(watermarkResultPayload(nextWatermark)
                .put("message", "水印已更新")
                .put("watermarkPhotoBurnIn", true)
                .put("watermarkVideoBurnIn", true))
        }
    }

    fun clearWatermark(): String {
        return runOnMainSync {
            if (recording || recordingStartPending) {
                val message = if (recordingStartPending) "录像启动中不能编辑水印" else "录像中不能编辑水印"
                return@runOnMainSync failAndEmit("1403", message, "clearWatermark while recording busy")
            }
            recycleBitmap(activeWatermarkBitmap)
            activeWatermarkBitmap = null
            activeWatermark = null
            ok(payload().put("message", "水印已清除"))
        }
    }

    fun restartCamera(): String {
        return runOnMainSync {
            closeCamera()
            openCameraIfReady()
        }
    }

    fun preparePermissions(): String {
        return runOnMainSync {
            if (!hasPermission(Manifest.permission.CAMERA)) {
                requestCameraPermissionIfNeeded(REQUEST_PREPARE_PERMISSIONS)
                return@runOnMainSync failAndEmit(
                    "1001",
                    "请授权相机权限",
                    "CAMERA permission is not granted."
                )
            }

            if (previewReady && camera == null) {
                openCameraIfReady()
            } else {
                ok(payload().put("message", "权限已准备"))
            }
        }
    }

    fun prepareRecordPermissions(): String {
        return runOnMainSync {
            val missingPermissions = recordMissingPermissions()
            if (missingPermissions.isNotEmpty()) {
                if (missingPermissions.contains(Manifest.permission.CAMERA)) {
                    cameraPermissionRequested = true
                    cameraPermissionRetryCount = 0
                    scheduleCameraPermissionRetry()
                }
                requestRecordPermissionsIfNeeded(missingPermissions)
                return@runOnMainSync failAndEmit(
                    "1003",
                    recordPermissionMessage(missingPermissions),
                    "Missing permissions: ${missingPermissions.joinToString(",")}"
                )
            }
            recordPermissionRequested = false
            recordPermissionRetryCount = 0
            if (previewReady && camera == null && hasPermission(Manifest.permission.CAMERA)) {
                openCameraIfReady()
            }
            ok(payload().put("message", "录像权限已准备"))
        }
    }

    fun destroyCamera(): String {
        return runOnMainSync {
            closeCamera(true)
            ok(payload())
        }
    }

    fun takePhoto(): String {
        return runOnMainSync {
            val activeCamera = camera ?: return@runOnMainSync failAndEmit(
                "1104",
                "相机未就绪",
                "Camera is not open."
            )
            if (recording || recordingStartPending) {
                val message = if (recordingStartPending) "录像启动中不能拍照" else "录像中不能拍照"
                return@runOnMainSync failAndEmit("1403", message, "takePhoto while recording busy")
            }
            if (photoBusy) {
                return@runOnMainSync failAndEmit("1302", "拍照处理中", "takePhoto while photoBusy")
            }
            val missingPermissions = photoMissingPermissions()
            if (missingPermissions.isNotEmpty()) {
                requestPermissions(missingPermissions.toTypedArray(), REQUEST_PREPARE_PHOTO_PERMISSIONS)
                return@runOnMainSync failAndEmit(
                    "1004",
                    photoPermissionMessage(missingPermissions),
                    "Missing permissions: ${missingPermissions.joinToString(",")}"
                )
            }

            photoBusy = true
            setStatus("拍照中")
            val photoRequestedAt = System.currentTimeMillis()
            try {
                applyCaptureOrientation(activeCamera)
                applyCaptureFlashMode(activeCamera)
            } catch (throwable: Throwable) {
                photoBusy = false
                return@runOnMainSync failAndEmit(
                    "1301",
                    "拍照失败",
                    throwable.message ?: throwable.javaClass.simpleName
                )
            }
            val defaultShutterSoundDisabled = disableDefaultShutterSound(activeCamera)
            activeCamera.takePicture(Camera.ShutterCallback {
                if (defaultShutterSoundDisabled) {
                    playCameraActionSound(MediaActionSound.SHUTTER_CLICK)
                } else if (!cameraSoundEnabled) {
                    Log.w(LOG_TAG, "default shutter sound could not be disabled; device may still play system shutter sound.")
                }
            }, null) { data, callbackCamera ->
                val captureCallbackMs = System.currentTimeMillis() - photoRequestedAt
                val file = File(context.cacheDir, "xyc-markvideo-photo-${System.currentTimeMillis()}.jpg")
                val frozenWatermark = activeWatermark
                val frozenWatermarkBitmap = copyWatermarkBitmap(activeWatermarkBitmap)
                val frozenCameraFacing = activeCameraFacing()
                try {
                    callbackCamera.startPreview()
                } catch (_: Throwable) {
                }
                ioHandler.post {
                    try {
                        val writeStartedAt = System.currentTimeMillis()
                        val photoResult = writePhotoWithWatermark(file, data, frozenWatermark, frozenWatermarkBitmap, frozenCameraFacing)
                        val watermarkWriteMs = System.currentTimeMillis() - writeStartedAt
                        val dataPayload = mediaPayload(
                            tempFilePath = file.absolutePath,
                            durationMs = 0L,
                            width = photoResult.size.width,
                            height = photoResult.size.height
                        )
                        appendWatermarkResult(dataPayload, frozenWatermark, photoResult.watermarkBurnedIn, false)
                        var albumError: String? = null
                        var albumSaveMs = 0L
                        try {
                            val albumStartedAt = System.currentTimeMillis()
                            val albumResult = saveMediaToAlbum(file, "image/jpeg", false)
                            albumSaveMs = System.currentTimeMillis() - albumStartedAt
                            appendAlbumSuccess(dataPayload, albumResult, "照片已保存到相册", "photo")
                        } catch (throwable: Throwable) {
                            albumSaveMs = System.currentTimeMillis() - writeStartedAt - watermarkWriteMs
                            albumError = throwable.message ?: throwable.javaClass.simpleName
                            appendAlbumFailure(dataPayload, "照片已生成，相册保存失败")
                        }
                        val totalSaveMs = System.currentTimeMillis() - photoRequestedAt
                        appendPhotoTiming(
                            data = dataPayload,
                            captureCallbackMs = captureCallbackMs,
                            watermarkWriteMs = watermarkWriteMs,
                            albumSaveMs = albumSaveMs,
                            totalSaveMs = totalSaveMs,
                            fileBytes = file.length()
                        )
                        Log.i(
                            LOG_TAG,
                            "photo timing total=${totalSaveMs}ms capture=${captureCallbackMs}ms watermark=${watermarkWriteMs}ms album=${albumSaveMs}ms bytes=${file.length()}"
                        )
                        runOnMain {
                            albumError?.let { nativeMessage ->
                                emitError("1501", "照片已生成，相册保存失败", nativeMessage)
                            }
                            emit("photodone", dataPayload)
                            setStatus(dataPayload.optString("message", "照片已生成"))
                        }
                    } catch (throwable: Throwable) {
                        runOnMain {
                            failAndEmit("1301", "拍照失败", throwable.message ?: throwable.javaClass.simpleName)
                        }
                    } finally {
                        recycleBitmap(frozenWatermarkBitmap)
                        runOnMain {
                            photoBusy = false
                        }
                    }
                }
            }
            ok(payload().put("message", "拍照请求已受理"))
        }
    }

    fun startRecord(optionsJson: String): String {
        return runOnMainSync {
            if (recording || recordingStartPending || recordingStopRequested) {
                val message = when {
                    recordingStopRequested -> "请等待视频保存完成"
                    recordingStartPending -> "录像启动中"
                    else -> "当前状态不允许执行该操作"
                }
                val nativeMessage = when {
                    recordingStopRequested -> "startRecord while stop pending"
                    recordingStartPending -> "startRecord while start pending"
                    else -> "duplicate startRecord"
                }
                return@runOnMainSync failAndEmit("1403", message, nativeMessage)
            }
            val missingPermissions = recordMissingPermissions()
            if (missingPermissions.isNotEmpty()) {
                requestRecordPermissionsIfNeeded(missingPermissions)
                return@runOnMainSync failAndEmit(
                    "1003",
                    recordPermissionMessage(missingPermissions),
                    "Missing permissions: ${missingPermissions.joinToString(",")}"
                )
            }
            val activeCamera = camera ?: return@runOnMainSync failAndEmit(
                "1104",
                "相机未就绪",
                "Camera is not open."
            )
            val recordingFlashError = validateRecordingFlashMode(activeCamera)
            if (recordingFlashError != null) {
                return@runOnMainSync failAndEmit("1102", recordingFlashError, recordingFlashError)
            }
            if (!applyFlashModeIfCameraOpen(false)) {
                return@runOnMainSync failAndEmit("1102", "录像闪光灯设置失败", "录像闪光灯设置失败")
            }
            val fps = parseFps(optionsJson)
            targetFps = fps
            val frozenWatermark = activeWatermark
            val frozenWatermarkBitmapSource = activeWatermarkBitmap
            val recordingSize = chooseRecordingOutputSize()
            val frozenCameraFacing = activeCameraFacing()

            recordingStartPending = true
            recordingStopRequested = false
            recordingFrameError = false
            recordingFrameErrorStage = ""
            recordingFrameErrorDetail = ""
            recordingFrameSkipStage = ""
            recordingFrameSkipDetail = ""
            setStatus("录像启动中")
            playCameraActionSound(MediaActionSound.START_VIDEO_RECORDING)
            ioHandler.postDelayed({
                startRecordOnIo(
                    recordingSize = recordingSize,
                    fps = fps,
                    frozenWatermark = frozenWatermark,
                    frozenWatermarkBitmapSource = frozenWatermarkBitmapSource,
                    frozenCameraFacing = frozenCameraFacing
                )
            }, RECORD_START_SOUND_GUARD_MS)
            ""
        }
    }

    private fun startRecordOnIo(
        recordingSize: XycSize,
        fps: Int,
        frozenWatermark: NativeWatermark?,
        frozenWatermarkBitmapSource: Bitmap?,
        frozenCameraFacing: String
    ) {
        var frozenWatermarkBitmap: Bitmap? = null
        var frozenWatermarkOverlay: WatermarkOverlay? = null
        var outputTarget: VideoOutputTarget? = null
        var recorder: CameraMp4Recorder? = null
        var transferredToRecording = false

        try {
            if (!recordingStartPending) {
                return
            }

            val recordTarget = createVideoOutputTarget()
            outputTarget = recordTarget
            frozenWatermarkBitmap = copyOrDecodeWatermarkBitmap(frozenWatermark, frozenWatermarkBitmapSource)
            frozenWatermarkOverlay = createVideoWatermarkOverlay(recordingSize, frozenWatermark, frozenWatermarkBitmap)
            val nextRecorder = CameraMp4Recorder(
                outputFile = recordTarget.file,
                outputFileDescriptor = recordTarget.fileDescriptor,
                width = recordingSize.width,
                height = recordingSize.height,
                fps = fps,
                bitrate = chooseVideoBitrate(recordingSize, fps),
                includeAudio = RECORD_AUDIO_ENABLED
            )
            recorder = nextRecorder
            nextRecorder.start()

            transferredToRecording = runOnMainSync {
                if (!recordingStartPending || recordingStopRequested || recording || camera == null || !previewReady) {
                    return@runOnMainSync false
                }

                videoRecorder = nextRecorder
                recordingOutputSize = recordingSize
                videoOutputTarget = recordTarget
                recordingStartedAt = System.currentTimeMillis()
                recordingFramesCanWriteAt = recordingStartedAt + RECORD_START_WARMUP_MS
                recording = true
                recordingStartPending = false
                recordingStopRequested = false
                recordingWatermarkSnapshot = frozenWatermark
                recordingWatermarkBitmap = frozenWatermarkBitmap
                recordingWatermarkOverlay = frozenWatermarkOverlay
                recordingVideoBurnIn = frozenWatermark != null
                recordingCameraFacing = frozenCameraFacing
                recordingFrameError = false
                recordingFrameErrorStage = ""
                recordingFrameErrorDetail = ""
                recordingFrameSkipStage = ""
                recordingFrameSkipDetail = ""
                startVideoFrameLoop()
                setStatus("录像中")
                val startPayload = payload().put("message", "录像中").put("fps", fps)
                appendWatermarkResult(startPayload, frozenWatermark, false, recordingVideoBurnIn)
                emit("recordstart", startPayload)
                true
            }

            if (transferredToRecording) {
                recorder = null
                outputTarget = null
                frozenWatermarkBitmap = null
                frozenWatermarkOverlay = null
            } else {
                runOnMain {
                    if (recordingStartPending) {
                        recordingStartPending = false
                        recordingFramesCanWriteAt = 0L
                        failAndEmit("1401", "录像开始失败", "record start state changed before activation.")
                    }
                }
            }
        } catch (throwable: Throwable) {
            val detail = throwable.message ?: throwable.javaClass.simpleName
            runOnMain {
                if (recordingStartPending) {
                    recordingStartPending = false
                    recording = false
                    recordingStopRequested = false
                    recordingFramesCanWriteAt = 0L
                    recordingWatermarkSnapshot = null
                    recordingWatermarkBitmap = null
                    recordingWatermarkOverlay = null
                    recordingVideoBurnIn = false
                    recordingFrameError = false
                    recordingFrameErrorStage = ""
                    recordingFrameErrorDetail = ""
                    recordingFrameSkipStage = ""
                    recordingFrameSkipDetail = ""
                    failAndEmit("1401", "录像开始失败", detail)
                }
            }
        } finally {
            if (!transferredToRecording) {
                try {
                    recorder?.finish()
                } catch (_: Throwable) {
                }
                outputTarget?.discard(context)
                recycleBitmap(frozenWatermarkBitmap)
                recycleWatermarkOverlay(frozenWatermarkOverlay)
            }
        }
    }

    fun stopRecord(): String {
        return runOnMainSync {
            if (recordingStartPending) {
                return@runOnMainSync ok(payload().put("message", "录像启动中"))
            }
            if (!recording && recordingStopRequested) {
                return@runOnMainSync ok(payload().put("message", "视频保存中"))
            }
            if (!recording) {
                return@runOnMainSync failAndEmit("1403", "当前状态不允许执行该操作", "stopRecord while not recording")
            }
            val recorder = videoRecorder ?: return@runOnMainSync failAndEmit(
                "1402",
                "录像停止失败",
                "CameraMp4Recorder is null."
            )
            val outputTarget = videoOutputTarget ?: return@runOnMainSync failAndEmit(
                "1402",
                "录像停止失败",
                "Video output target is null."
            )
            val stopRequestedAt = System.currentTimeMillis()

            stopVideoFrameLoop(cancelPending = false)
            recording = false
            recordingStopRequested = true
            videoOutputTarget = null

            val durationMs = max(1L, System.currentTimeMillis() - recordingStartedAt)
            val frozenWatermark = recordingWatermarkSnapshot
            val frozenWatermarkBitmap = recordingWatermarkBitmap
            val frozenWatermarkOverlay = recordingWatermarkOverlay
            val requestedVideoBurnIn = recordingVideoBurnIn
            val frozenCameraFacing = recordingCameraFacing
            val data = mediaPayload(
                tempFilePath = outputTarget.resultPath(),
                durationMs = durationMs,
                width = recordingOutputSize.width,
                height = recordingOutputSize.height
            )
                .put("fps", targetFps)
            appendWatermarkResult(data, frozenWatermark, false, requestedVideoBurnIn)
            recordingWatermarkSnapshot = null
            recordingWatermarkBitmap = null
            recordingWatermarkOverlay = null
            recordingVideoBurnIn = false
            releaseRecorder()
            val pendingData = org.json.JSONObject(data.toString())
                .put("savedToAlbum", false)
                .put("albumPath", "")
                .put("albumUri", "")
                .put("message", "视频保存中")
            ioHandler.post {
                finishRecordWhenFramesIdle(
                    recorder = recorder,
                    outputTarget = outputTarget,
                    stopRequestedAt = stopRequestedAt,
                    data = data,
                    frozenWatermark = frozenWatermark,
                    frozenWatermarkBitmap = frozenWatermarkBitmap,
                    frozenWatermarkOverlay = frozenWatermarkOverlay,
                    requestedVideoBurnIn = requestedVideoBurnIn,
                    cameraFacing = frozenCameraFacing
                )
            }
            setStatus("视频保存中")
            ok(pendingData)
        }
    }

    fun openSystemAlbum(mediaUri: String): String {
        return runOnMainSync {
            val targetUri = albumOpenUri(mediaUri)
            val intent = Intent(Intent.ACTION_VIEW, targetUri)
                .setDataAndType(targetUri, albumOpenMimeType(mediaUri))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            try {
                context.startActivity(intent)
                ok(payload()
                    .put("message", "已打开系统相册")
                    .put("albumUri", targetUri.toString())
                    .put("mediaKind", if (lastPublishedMediaKind.isBlank()) "album" else lastPublishedMediaKind))
            } catch (throwable: Throwable) {
                failAndEmit("1601", "打开系统相册失败", throwable.message ?: throwable.javaClass.simpleName)
            }
        }
    }

    override fun onSurfaceTextureAvailable(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {
        previewReady = true
        openCameraIfReady()
    }

    override fun onSurfaceTextureSizeChanged(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {
        previewReady = true
    }

    override fun onSurfaceTextureDestroyed(surface: android.graphics.SurfaceTexture): Boolean {
        previewReady = false
        closeCamera()
        return true
    }

    override fun onSurfaceTextureUpdated(surface: android.graphics.SurfaceTexture) {
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (hasWindowFocus) {
            lockHostActivityToPortrait()
        }
        if (hasWindowFocus && recordPermissionRequested && recordMissingPermissions().isEmpty()) {
            recordPermissionRequested = false
            recordPermissionRetryCount = 0
            if (camera != null) {
                closeCamera()
            }
            if (previewReady && hasPermission(Manifest.permission.CAMERA)) {
                openCameraIfReady()
            } else {
                setStatus("录像权限已准备")
            }
            return
        }
        if (hasWindowFocus && previewReady && camera == null && hasPermission(Manifest.permission.CAMERA)) {
            cameraPermissionRequested = false
            openCameraIfReady()
        }
    }

    private fun openCameraIfReady(): String {
        if (!previewReady) {
            return failAndEmit("1104", "相机未就绪", "Preview surface is not ready.")
        }
        if (!hasPermission(Manifest.permission.CAMERA)) {
            requestCameraPermissionIfNeeded(REQUEST_CAMERA_PERMISSION)
            setStatus("请授权相机权限后重试")
            return failAndEmit("1001", "相机权限未授权", "CAMERA permission is not granted.")
        }
        cameraPermissionRequested = false
        cameraPermissionRetryCount = 0
        if (camera != null) {
            return ok(cameraReadyPayload())
        }

        return try {
            val targetCameraId = resolveCameraIdForZoomMode(requestedZoomMode)
            if (targetCameraId < 0) {
                return failAndEmit("1106", unsupportedCameraFacingMessage(requestedCameraFacing), "No camera for facing=$requestedCameraFacing")
            }
            activeCameraId = targetCameraId
            val activeCamera = Camera.open(activeCameraId)
            activeCamera.setDisplayOrientation(resolveCameraDisplayOrientationDegrees(activeCameraId))
            applyCameraParameters(activeCamera)
            val previewTexture = previewView.surfaceTexture
                ?: return failAndEmit("1104", "相机未就绪", "Preview texture is null.")
            activeCamera.setPreviewTexture(previewTexture)
            activeCamera.startPreview()
            camera = activeCamera
            if (requestedFlashMode != UI_FLASH_OFF) {
                applyFlashModeIfCameraOpen(false)
            }
            setStatus("相机已准备")
            emit("cameraready", cameraReadyPayload())
            ok(cameraReadyPayload())
        } catch (throwable: Throwable) {
            closeCamera(false)
            failAndEmit("1101", "相机设备不可用", throwable.message ?: throwable.javaClass.simpleName)
        }
    }

    private fun applyCameraParameters(activeCamera: Camera) {
        val parameters = activeCamera.parameters
        pictureSize = choosePhotoSize(parameters.supportedPictureSizes)
        val selectedPreviewSize = chooseCameraSize(parameters.supportedPreviewSizes, pictureSize)
        previewSize = XycSize(selectedPreviewSize.width, selectedPreviewSize.height)
        videoSize = chooseVideoSize(parameters, pictureSize)

        parameters.setPreviewSize(previewSize.width, previewSize.height)
        parameters.setPictureSize(pictureSize.width, pictureSize.height)
        parameters.jpegQuality = PHOTO_JPEG_QUALITY
        parameters.supportedFocusModes?.let { modes ->
            when {
                modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO) ->
                    parameters.focusMode = Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO
                modes.contains(Camera.Parameters.FOCUS_MODE_AUTO) ->
                    parameters.focusMode = Camera.Parameters.FOCUS_MODE_AUTO
            }
        }
        chooseFpsRange(parameters.supportedPreviewFpsRange)?.let { range ->
            parameters.setPreviewFpsRange(range[0], range[1])
        }
        try {
            parameters.setRecordingHint(true)
        } catch (_: Throwable) {
        }
        applyZoomModeToParameters(parameters, false)
        applyFlashModeToParameters(parameters, false)
        activeCamera.parameters = parameters
    }

    private fun applyZoomModeIfCameraOpen(failIfUnsupported: Boolean): Boolean {
        val activeCamera = camera ?: return requestedZoomMode == UI_ZOOM_1X
        return try {
            val targetCameraId = resolveCameraIdForZoomMode(requestedZoomMode)
            if (targetCameraId < 0) {
                return false
            }
            if (targetCameraId != activeCameraId) {
                if (recording || recordingStartPending || photoBusy) {
                    if (failIfUnsupported) {
                        throw IllegalStateException("Cannot switch physical camera while busy.")
                    }
                    return false
                }
                closeCamera()
                openCameraIfReady()
                return camera != null && activeCameraId == targetCameraId
            }
            val parameters = activeCamera.parameters
            if (applyZoomModeToParameters(parameters, failIfUnsupported)) {
                activeCamera.parameters = parameters
                true
            } else {
                false
            }
        } catch (throwable: Throwable) {
            if (failIfUnsupported) {
                throw throwable
            }
            false
        }
    }

    private fun applyZoomModeToParameters(parameters: Camera.Parameters, failIfUnsupported: Boolean): Boolean {
        if (requestedZoomMode == UI_ZOOM_WIDE) {
            if (requestedCameraFacing == UI_CAMERA_BACK && resolveWideBackCameraId() >= 0) {
                return applyDigitalZoom(parameters, 100, failIfUnsupported)
            }
            if (failIfUnsupported) {
                throw IllegalStateException("Wide camera is not exposed by Camera1.")
            }
            return false
        }
        val targetRatio = if (requestedZoomMode == UI_ZOOM_2X) 200 else 100
        return applyDigitalZoom(parameters, targetRatio, failIfUnsupported)
    }

    private fun applyDigitalZoom(parameters: Camera.Parameters, targetRatio: Int, failIfUnsupported: Boolean): Boolean {
        if (targetRatio == 100) {
            if (parameters.isZoomSupported) {
                parameters.zoom = 0
            }
            return true
        }
        if (!parameters.isZoomSupported) {
            if (failIfUnsupported) {
                throw IllegalStateException("Digital zoom is not supported.")
            }
            return false
        }
        val ratios = parameters.zoomRatios
        val maxZoom = parameters.maxZoom
        if (ratios == null || ratios.isEmpty() || maxZoom <= 0) {
            if (failIfUnsupported) {
                throw IllegalStateException("Zoom ratios are not available.")
            }
            return false
        }
        val maxIndex = min(maxZoom, ratios.size - 1)
        var bestIndex = 0
        var bestScore = Int.MAX_VALUE
        for (index in 0..maxIndex) {
            val ratio = ratios[index]
            val score = abs(ratio - targetRatio)
            if (score < bestScore) {
                bestScore = score
                bestIndex = index
            }
        }
        if (ratios[bestIndex] < 190) {
            if (failIfUnsupported) {
                throw IllegalStateException("2x zoom is not supported.")
            }
            return false
        }
        parameters.zoom = bestIndex
        return true
    }

    private fun applyFlashModeIfCameraOpen(failIfUnsupported: Boolean): Boolean {
        val activeCamera = camera ?: return requestedFlashMode == UI_FLASH_OFF
        return try {
            val parameters = activeCamera.parameters
            val previousFlashMode = parameters.flashMode
            if (applyFlashModeToParameters(parameters, failIfUnsupported)) {
                if (parameters.flashMode != previousFlashMode) {
                    activeCamera.parameters = parameters
                    refreshPreviewForFlash(activeCamera)
                }
                true
            } else {
                false
            }
        } catch (throwable: Throwable) {
            if (failIfUnsupported) {
                throw throwable
            }
            false
        }
    }

    private fun applyFlashModeToParameters(parameters: Camera.Parameters, failIfUnsupported: Boolean): Boolean {
        val supportedModes = parameters.supportedFlashModes
        if (supportedModes.isNullOrEmpty()) {
            if (requestedFlashMode != UI_FLASH_OFF && failIfUnsupported) {
                throw IllegalStateException("Flash modes are not supported by this camera.")
            }
            return requestedFlashMode == UI_FLASH_OFF
        }

        val nativeMode = resolveNativeFlashMode(supportedModes)
        if (nativeMode == null) {
            if (requestedFlashMode != UI_FLASH_OFF && failIfUnsupported) {
                throw IllegalStateException(
                    "Flash mode $requestedFlashMode is not supported. Supported: ${supportedModes.joinToString(",")}"
                )
            }
            return requestedFlashMode == UI_FLASH_OFF
        }
        parameters.flashMode = nativeMode
        return true
    }

    private fun resolveNativeFlashMode(supportedModes: List<String>): String? {
        return resolveNativeFlashModeForMode(requestedFlashMode, supportedModes)
    }

    private fun resolveNativeFlashModeForMode(mode: String, supportedModes: List<String>): String? {
        return when (mode) {
            UI_FLASH_ON -> {
                if (supportedModes.contains(Camera.Parameters.FLASH_MODE_TORCH)) {
                    Camera.Parameters.FLASH_MODE_TORCH
                } else if (currentMode == "photo" && supportedModes.contains(Camera.Parameters.FLASH_MODE_ON)) {
                    Camera.Parameters.FLASH_MODE_ON
                } else {
                    null
                }
            }
            UI_FLASH_AUTO -> {
                if (supportedModes.contains(Camera.Parameters.FLASH_MODE_AUTO)) {
                    Camera.Parameters.FLASH_MODE_AUTO
                } else {
                    null
                }
            }
            else -> {
                if (supportedModes.contains(Camera.Parameters.FLASH_MODE_OFF)) {
                    Camera.Parameters.FLASH_MODE_OFF
                } else {
                    null
                }
            }
        }
    }

    private fun normalizeFlashMode(mode: String): String {
        return when (mode) {
            UI_FLASH_ON -> UI_FLASH_ON
            UI_FLASH_AUTO -> UI_FLASH_AUTO
            else -> UI_FLASH_OFF
        }
    }

    private fun normalizeZoomMode(mode: String): String {
        return when (mode) {
            UI_ZOOM_WIDE -> UI_ZOOM_WIDE
            UI_ZOOM_2X -> UI_ZOOM_2X
            else -> UI_ZOOM_1X
        }
    }

    private fun nextCameraFacing(currentFacing: String): String {
        return if (currentFacing == UI_CAMERA_FRONT) UI_CAMERA_BACK else UI_CAMERA_FRONT
    }

    private fun flashModeMessage(mode: String): String {
        return when (mode) {
            UI_FLASH_ON -> "闪光灯：开"
            UI_FLASH_AUTO -> "闪光灯：自动"
            else -> "闪光灯：关"
        }
    }

    private fun zoomModeMessage(mode: String): String {
        return when (mode) {
            UI_ZOOM_WIDE -> "焦段：广角"
            UI_ZOOM_2X -> "焦段：2x"
            else -> "焦段：1x"
        }
    }

    private fun cameraFacingMessage(facing: String): String {
        return if (facing == UI_CAMERA_FRONT) "前置摄像头" else "后置摄像头"
    }

    private fun unsupportedFlashModeMessage(mode: String): String {
        return when (mode) {
            UI_FLASH_ON -> "当前设备不支持闪光灯常亮"
            UI_FLASH_AUTO -> "当前设备不支持自动闪光灯"
            else -> "闪光灯：关"
        }
    }

    private fun unsupportedZoomModeMessage(mode: String): String {
        return when (mode) {
            UI_ZOOM_WIDE -> "当前设备未暴露广角镜头"
            UI_ZOOM_2X -> "当前设备不支持 2x 焦段"
            else -> "焦段：1x"
        }
    }

    private fun unsupportedCameraFacingMessage(facing: String): String {
        return if (facing == UI_CAMERA_FRONT) "当前设备不支持前置摄像头" else "当前设备不支持后置摄像头"
    }

    private fun cameraSwitchPayload(requestedFacing: String, applied: Boolean, message: String): org.json.JSONObject {
        return payload()
            .put("message", message)
            .put("cameraFacing", activeCameraFacing())
            .put("requestedCameraFacing", requestedFacing)
            .put("flashMode", requestedFlashMode)
            .put("zoomMode", requestedZoomMode)
            .put("availableCameraFacings", cameraFacingsPayload())
            .put("availableZoomModes", zoomModesPayload(camera?.parameters))
            .put("applied", applied)
    }

    private fun flashModePayload(requestedMode: String, previousMode: String, applied: Boolean): org.json.JSONObject {
        val parameters = camera?.parameters
        val supportedModes = parameters?.supportedFlashModes
        val resolvedNativeMode = if (supportedModes.isNullOrEmpty()) null else resolveNativeFlashModeForMode(requestedMode, supportedModes)
        val actualFlashMode = parameters?.flashMode ?: ""
        return payload()
            .put("flashMode", requestedFlashMode)
            .put("requestedFlashMode", requestedMode)
            .put("previousFlashMode", previousMode)
            .put("nativeFlashMode", resolvedNativeMode ?: "")
            .put("actualFlashMode", actualFlashMode)
            .put("supportedFlashModes", flashModesPayload(supportedModes))
            .put("currentMode", currentMode)
            .put("cameraId", activeCameraId)
            .put("cameraFacing", activeCameraFacing())
            .put("applied", applied)
            .put("message", if (applied) flashModeMessage(requestedFlashMode) else unsupportedFlashModeMessage(requestedMode))
    }

    private fun validateRecordingFlashMode(activeCamera: Camera): String? {
        if (requestedFlashMode == UI_FLASH_OFF) {
            return null
        }
        if (requestedFlashMode == UI_FLASH_AUTO) {
            val supportedModes = activeCamera.parameters.supportedFlashModes ?: return "当前设备不支持录像自动闪光"
            if (!supportedModes.contains(Camera.Parameters.FLASH_MODE_AUTO)) {
                return "当前设备不支持录像自动闪光"
            }
            return null
        }
        val supportedModes = activeCamera.parameters.supportedFlashModes ?: return "当前设备不支持录像闪光灯"
        if (!supportedModes.contains(Camera.Parameters.FLASH_MODE_TORCH)) {
            return "当前设备不支持录像闪光灯常亮"
        }
        if (!applyFlashModeIfCameraOpen(false)) {
            return "录像闪光灯设置失败"
        }
        return null
    }

    private fun refreshPreviewForFlash(activeCamera: Camera) {
        try {
            activeCamera.stopPreview()
            activeCamera.startPreview()
        } catch (_: Throwable) {
        }
    }

    private fun applyCaptureOrientation(activeCamera: Camera) {
        val parameters = activeCamera.parameters
        parameters.setRotation(resolveCameraCaptureRotationDegrees(activeCameraId))
        activeCamera.parameters = parameters
    }

    private fun applyCaptureFlashMode(activeCamera: Camera) {
        val parameters = activeCamera.parameters
        if (applyFlashModeToParameters(parameters, false)) {
            activeCamera.parameters = parameters
        }
    }

    private fun resolveCameraDisplayOrientationDegrees(cameraId: Int): Int {
        val info = Camera.CameraInfo()
        Camera.getCameraInfo(cameraId, info)
        val displayRotationDegrees = currentDisplayRotationDegrees()
        return if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            val mirroredResult = (info.orientation + displayRotationDegrees) % 360
            (360 - mirroredResult) % 360
        } else {
            (info.orientation - displayRotationDegrees + 360) % 360
        }
    }

    private fun resolveCameraCaptureRotationDegrees(cameraId: Int): Int {
        val info = Camera.CameraInfo()
        Camera.getCameraInfo(cameraId, info)
        val captureOrientationDegrees = currentCaptureOrientationDegrees()
        return if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            (info.orientation - captureOrientationDegrees + 360) % 360
        } else {
            (info.orientation + captureOrientationDegrees) % 360
        }
    }

    private fun currentCaptureOrientationDegrees(): Int {
        return deviceOrientationDegrees
    }

    private fun roundDeviceOrientationDegrees(orientation: Int): Int {
        return (((orientation + 45) / 90) * 90) % 360
    }

    private fun currentDisplayRotationDegrees(): Int {
        val rotation = findActivity(context)?.windowManager?.defaultDisplay?.rotation ?: Surface.ROTATION_0
        return when (rotation) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }
    }

    private fun startVideoFrameLoop() {
        videoFrameLoopRunning = true
        videoFramePending.set(false)
        mainHandler.removeCallbacks(videoFrameRunnable)
        mainHandler.post(videoFrameRunnable)
    }

    private fun stopVideoFrameLoop(cancelPending: Boolean = true) {
        videoFrameLoopRunning = false
        if (cancelPending) {
            videoFramePending.set(false)
        }
        mainHandler.removeCallbacks(videoFrameRunnable)
    }

    private fun requestNextVideoFrame() {
        val recorder = videoRecorder ?: return
        if (!recording || !videoFrameLoopRunning) {
            return
        }
        if (!videoFramePending.compareAndSet(false, true)) {
            return
        }

        val frameStartedAt = System.currentTimeMillis()
        if (frameStartedAt < recordingFramesCanWriteAt) {
            videoFramePending.set(false)
            scheduleNextVideoFrame(frameStartedAt)
            return
        }
        val frameWatermark = recordingWatermarkSnapshot
        val frameWatermarkBitmap = recordingWatermarkBitmap
        val frameWatermarkOverlay = recordingWatermarkOverlay
        val frameCameraFacing = recordingCameraFacing
        val targetBitmap = reusableVideoFrame?.takeIf {
            !it.isRecycled && it.width == recorder.width && it.height == recorder.height
        } ?: Bitmap.createBitmap(recorder.width, recorder.height, Bitmap.Config.ARGB_8888).also {
            reusableVideoFrame?.recycle()
            reusableVideoFrame = it
        }

        try {
            if (!copyPreviewFrameInto(targetBitmap)) {
                markRecordingFrameSkip(RECORD_STAGE_PREVIEW_COPY, "copied=false")
                Log.w(LOG_TAG, "record frame preview copy failed: stage=${RECORD_STAGE_PREVIEW_COPY}")
                videoFramePending.set(false)
                scheduleNextVideoFrame(frameStartedAt)
                return
            }
            if ((!recording && !recordingStopRequested) || (!videoFrameLoopRunning && !recordingStopRequested)) {
                videoFramePending.set(false)
                return
            }
            ioHandler.post {
                try {
                    var watermarkReady = true
                    applyFrontCameraFrameMirrorIfNeeded(targetBitmap, frameCameraFacing)
                    if (frameWatermarkOverlay != null) {
                        try {
                            drawWatermarkOverlay(targetBitmap, frameWatermarkOverlay)
                        } catch (throwable: Throwable) {
                            watermarkReady = false
                            markRecordingFrameError(RECORD_STAGE_WATERMARK_DRAW, throwable)
                            Log.w(
                                LOG_TAG,
                                "record frame watermark overlay failed: ${frameErrorDiagnostics()}",
                                throwable
                            )
                        }
                    } else if (frameWatermark != null) {
                        try {
                            val burnedIn = drawWatermarkOnPhoto(
                                Canvas(targetBitmap),
                                targetBitmap.width,
                                targetBitmap.height,
                                frameWatermark,
                                frameWatermarkBitmap
                            )
                            if (!burnedIn) {
                                throw IllegalStateException("水印内容不可绘制")
                            }
                        } catch (throwable: Throwable) {
                            watermarkReady = false
                            markRecordingFrameError(RECORD_STAGE_WATERMARK_DRAW, throwable)
                            Log.w(
                                LOG_TAG,
                                "record frame watermark failed: ${frameErrorDiagnostics()}",
                                throwable
                            )
                        }
                    }
                    if (watermarkReady) {
                        try {
                            if (!recorder.encodeFrame(targetBitmap)) {
                                markRecordingFrameSkip(RECORD_STAGE_VIDEO_INPUT_BUFFER, recorder.diagnostics(RECORD_STAGE_VIDEO_INPUT_BUFFER))
                                Log.d(
                                    LOG_TAG,
                                    "record frame skipped because encoder input buffer was not ready: ${recorder.diagnostics(RECORD_STAGE_VIDEO_INPUT_BUFFER)}"
                                )
                            }
                        } catch (throwable: Throwable) {
                            markRecordingFrameError(recorder.currentStage(), throwable)
                            Log.w(
                                LOG_TAG,
                                "record frame encode failed: ${recorder.diagnostics()}",
                                throwable
                            )
                        }
                    }
                } catch (throwable: Throwable) {
                    markRecordingFrameError(RECORD_STAGE_FRAME_UNHANDLED, throwable)
                    Log.w(LOG_TAG, "record frame failed: ${frameErrorDiagnostics()}", throwable)
                } finally {
                    videoFramePending.set(false)
                    scheduleNextVideoFrame(frameStartedAt)
                }
            }
        } catch (throwable: Throwable) {
            videoFramePending.set(false)
            val detail = "stage=${RECORD_STAGE_PREVIEW_COPY}; error=${errorSummary(throwable)}"
            failAndEmit("1402", "录像帧复制失败", detail)
            scheduleNextVideoFrame(frameStartedAt)
        }
    }

    private fun copyPreviewFrameInto(targetBitmap: Bitmap): Boolean {
        if (!previewReady || !previewView.isAvailable) {
            return false
        }
        return try {
            previewView.getBitmap(targetBitmap)
            true
        } catch (throwable: Throwable) {
            Log.w(LOG_TAG, "preview frame copy failed: ${errorSummary(throwable)}", throwable)
            false
        }
    }

    private fun scheduleNextVideoFrame(frameStartedAt: Long) {
        if (!recording || !videoFrameLoopRunning) {
            return
        }
        val frameIntervalMs = max(1L, 1000L / targetFps)
        val elapsedMs = System.currentTimeMillis() - frameStartedAt
        val delayMs = max(0L, frameIntervalMs - elapsedMs)
        mainHandler.postDelayed(videoFrameRunnable, delayMs)
    }

    private fun finishRecordWhenFramesIdle(
        recorder: CameraMp4Recorder,
        outputTarget: VideoOutputTarget,
        stopRequestedAt: Long,
        data: org.json.JSONObject,
        frozenWatermark: NativeWatermark?,
        frozenWatermarkBitmap: Bitmap?,
        frozenWatermarkOverlay: WatermarkOverlay?,
        requestedVideoBurnIn: Boolean,
        cameraFacing: String,
        frameWaitStartedAt: Long = System.currentTimeMillis()
    ) {
        try {
            if (videoFramePending.get()) {
                if (System.currentTimeMillis() - frameWaitStartedAt < FRAME_IDLE_TIMEOUT_MS) {
                    ioHandler.postDelayed({
                        finishRecordWhenFramesIdle(
                            recorder = recorder,
                            outputTarget = outputTarget,
                            stopRequestedAt = stopRequestedAt,
                            data = data,
                            frozenWatermark = frozenWatermark,
                            frozenWatermarkBitmap = frozenWatermarkBitmap,
                            frozenWatermarkOverlay = frozenWatermarkOverlay,
                            requestedVideoBurnIn = requestedVideoBurnIn,
                            cameraFacing = cameraFacing,
                            frameWaitStartedAt = frameWaitStartedAt
                        )
                    }, FRAME_IDLE_POLL_MS)
                    return
                }
                videoFramePending.set(false)
            }
            if (recorder.videoSampleCount <= 0) {
                ensureVideoFrameBeforeFinish(recorder, frozenWatermark, frozenWatermarkBitmap, frozenWatermarkOverlay, cameraFacing)
            }

            val hadFrameError = recordingFrameError
            var albumError: String? = null
            var stopThrowable: Throwable? = null
            var finishMs = 0L
            var albumSaveMs = 0L
            try {
                val finishStartedAt = System.currentTimeMillis()
                recorder.finish()
                playCameraActionSound(MediaActionSound.STOP_VIDEO_RECORDING)
                finishMs = System.currentTimeMillis() - finishStartedAt
            } catch (throwable: Throwable) {
                finishMs = System.currentTimeMillis() - stopRequestedAt
                stopThrowable = throwable
            }
            if (stopThrowable != null) {
                val stopErrorMessage = if (recorder.videoSampleCount <= 0) "录像没有写入有效视频帧" else "录像停止失败"
                val diagnostics = recordStopDiagnostics(
                    stage = recorder.currentStage(),
                    recorder = recorder,
                    stopRequestedAt = stopRequestedAt,
                    finishMs = finishMs,
                    throwable = stopThrowable
                )
                Log.e(
                    LOG_TAG,
                    "record stop failed during finish: ${diagnostics}",
                    stopThrowable
                )
                discardVideoOutput(outputTarget, RECORD_STAGE_RECORD_FINISH)
                recycleBitmap(frozenWatermarkBitmap)
                recycleWatermarkOverlay(frozenWatermarkOverlay)
                runOnMain {
                    resetRecordStopState()
                    failAndEmit("1402", stopErrorMessage, diagnostics)
                }
            } else {
                val recordedDurationMs = data.optLong("durationMs", 0L)
                val invalidVideoReason = when {
                    recorder.videoSampleCount <= 0 -> "录像没有写入有效视频帧"
                    recorder.includeAudio && recorder.audioSampleCount <= 0 && recordedDurationMs >= RECORD_AUDIO_REQUIRED_AFTER_MS -> "录像没有写入有效音频"
                    else -> null
                }
                if (invalidVideoReason != null) {
                    val validationStage = recordValidationStage()
                    val diagnostics = recordStopDiagnostics(
                        stage = validationStage,
                        recorder = recorder,
                        stopRequestedAt = stopRequestedAt,
                        finishMs = finishMs,
                        throwable = null
                    )
                    Log.e(LOG_TAG, "record stop failed validation: reason=${invalidVideoReason}; ${diagnostics}")
                    discardVideoOutput(outputTarget, validationStage)
                    recycleBitmap(frozenWatermarkBitmap)
                    recycleWatermarkOverlay(frozenWatermarkOverlay)
                    runOnMain {
                        resetRecordStopState()
                        failAndEmit("1402", invalidVideoReason, diagnostics)
                    }
                } else {
                    val finalVideoBurnIn = requestedVideoBurnIn && !hadFrameError && recorder.videoSampleCount > 0
                    data.put("watermarkVideoBurnIn", finalVideoBurnIn)
                    try {
                        val albumStartedAt = System.currentTimeMillis()
                        val albumResult = publishVideoOutput(outputTarget)
                        albumSaveMs = System.currentTimeMillis() - albumStartedAt
                        appendAlbumSuccess(data, albumResult, "视频已保存到相册", "video")
                        val thumbnailPath = createVideoThumbnail(outputTarget)
                        if (thumbnailPath.isNotBlank()) {
                            data.put("thumbnailPath", thumbnailPath)
                        }
                    } catch (throwable: Throwable) {
                        albumSaveMs = System.currentTimeMillis() - stopRequestedAt - finishMs
                        albumError = "stage=${RECORD_STAGE_PUBLISH_ALBUM}; error=${errorSummary(throwable)}"
                        appendAlbumFailure(data, "视频已生成，相册保存失败")
                        Log.w(LOG_TAG, "record publish album failed: ${albumError}", throwable)
                    }
                    val totalSaveMs = System.currentTimeMillis() - stopRequestedAt
                    appendRecordTiming(
                        data = data,
                        recorder = recorder,
                        fileBytes = outputTarget.length(context),
                        finishMs = finishMs,
                        albumSaveMs = albumSaveMs,
                        totalSaveMs = totalSaveMs,
                        hadFrameError = hadFrameError
                    )
                    Log.i(
                        LOG_TAG,
                        "record stop timing total=${totalSaveMs}ms finish=${finishMs}ms album=${albumSaveMs}ms bytes=${outputTarget.length(context)}; ${recorder.diagnostics(RECORD_STAGE_RECORD_DONE)}; frameError=${frameErrorDiagnostics()}"
                    )
                    runOnMain {
                        resetRecordStopState()
                        albumError?.let { nativeMessage ->
                            emitError("1501", "视频已生成，相册保存失败", nativeMessage)
                        }
                        setStatus(data.optString("message", "视频已生成"))
                        emit("recorddone", data)
                    }
                    recycleBitmap(frozenWatermarkBitmap)
                    recycleWatermarkOverlay(frozenWatermarkOverlay)
                }
            }
        } catch (throwable: Throwable) {
            val diagnostics = recordStopDiagnostics(
                stage = RECORD_STAGE_RECORD_FINISH_UNHANDLED,
                recorder = recorder,
                stopRequestedAt = stopRequestedAt,
                finishMs = System.currentTimeMillis() - stopRequestedAt,
                throwable = throwable
            )
            Log.e(LOG_TAG, "record stop failed unexpectedly: ${diagnostics}", throwable)
            discardVideoOutput(outputTarget, RECORD_STAGE_RECORD_FINISH_UNHANDLED)
            recycleBitmap(frozenWatermarkBitmap)
            recycleWatermarkOverlay(frozenWatermarkOverlay)
            runOnMain {
                resetRecordStopState()
                failAndEmit("1402", "录像停止失败", diagnostics)
            }
        }
    }

    private fun ensureVideoFrameBeforeFinish(
        recorder: CameraMp4Recorder,
        frozenWatermark: NativeWatermark?,
        frozenWatermarkBitmap: Bitmap?,
        frozenWatermarkOverlay: WatermarkOverlay?,
        cameraFacing: String
    ): Boolean {
        if (recorder.videoSampleCount > 0) {
            return true
        }
        val targetBitmap = Bitmap.createBitmap(recorder.width, recorder.height, Bitmap.Config.ARGB_8888)
        val latch = CountDownLatch(1)
        val copyResult = BooleanArray(1) { false }
        mainHandler.post {
            try {
                copyResult[0] = copyPreviewFrameInto(targetBitmap)
            } catch (throwable: Throwable) {
                Log.w(LOG_TAG, "record final frame copy failed: stage=${RECORD_STAGE_FINAL_PREVIEW_COPY}; error=${errorSummary(throwable)}", throwable)
            } finally {
                latch.countDown()
            }
        }
        val copied = try {
            latch.await(FRAME_IDLE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (throwable: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
        if (!copied || !copyResult[0]) {
            markRecordingFrameSkip(RECORD_STAGE_FINAL_PREVIEW_COPY, "copied=${copied}; success=${copyResult[0]}")
            Log.w(LOG_TAG, "record final frame preview copy failed: stage=${RECORD_STAGE_FINAL_PREVIEW_COPY}; copied=${copied}; success=${copyResult[0]}")
            targetBitmap.recycle()
            return false
        }
        var watermarkReady = true
        applyFrontCameraFrameMirrorIfNeeded(targetBitmap, cameraFacing)
        if (frozenWatermarkOverlay != null) {
            try {
                drawWatermarkOverlay(targetBitmap, frozenWatermarkOverlay)
            } catch (throwable: Throwable) {
                watermarkReady = false
                markRecordingFrameError(RECORD_STAGE_FINAL_WATERMARK_DRAW, throwable)
                Log.w(LOG_TAG, "record final frame watermark overlay failed: ${frameErrorDiagnostics()}", throwable)
            }
        } else if (frozenWatermark != null) {
            try {
                val burnedIn = drawWatermarkOnPhoto(
                    Canvas(targetBitmap),
                    targetBitmap.width,
                    targetBitmap.height,
                    frozenWatermark,
                    frozenWatermarkBitmap
                )
                if (!burnedIn) {
                    throw IllegalStateException("水印内容不可绘制")
                }
            } catch (throwable: Throwable) {
                watermarkReady = false
                markRecordingFrameError(RECORD_STAGE_FINAL_WATERMARK_DRAW, throwable)
                Log.w(LOG_TAG, "record final frame watermark failed: ${frameErrorDiagnostics()}", throwable)
            }
        }
        if (!watermarkReady) {
            targetBitmap.recycle()
            return false
        }
        return try {
            if (!recorder.encodeFrame(targetBitmap)) {
                markRecordingFrameSkip(RECORD_STAGE_VIDEO_INPUT_BUFFER, recorder.diagnostics(RECORD_STAGE_VIDEO_INPUT_BUFFER))
                Log.d(LOG_TAG, "record final frame skipped because encoder input buffer was not ready: ${recorder.diagnostics(RECORD_STAGE_VIDEO_INPUT_BUFFER)}")
                false
            } else {
                true
            }
        } catch (throwable: Throwable) {
            markRecordingFrameError(recorder.currentStage(), throwable)
            Log.w(LOG_TAG, "record final frame encode failed: ${recorder.diagnostics()}", throwable)
            false
        } finally {
            targetBitmap.recycle()
        }
    }

    private fun closeCamera() {
        closeCamera(false)
    }

    private fun closeCamera(releaseWatermark: Boolean) {
        recordingStartPending = false
        if (recording) {
            stopVideoFrameLoop()
            try {
                videoRecorder?.finish()
            } catch (_: Throwable) {
            }
        }
        releaseRecorder()
        releaseVideoOutputTarget(true)
        recording = false
        photoBusy = false
        recordingFramesCanWriteAt = 0L
        recordingWatermarkSnapshot = null
        recycleBitmap(recordingWatermarkBitmap)
        recordingWatermarkBitmap = null
        recycleWatermarkOverlay(recordingWatermarkOverlay)
        recordingWatermarkOverlay = null
        recordingVideoBurnIn = false
        recordingCameraFacing = UI_CAMERA_BACK
        if (recordingStopRequested) {
            releaseReusableFrameAfterRecordStop = true
        } else {
            resetRecordStopState()
        }
        if (releaseWatermark) {
            recycleBitmap(activeWatermarkBitmap)
            activeWatermarkBitmap = null
            activeWatermark = null
        }
        if (!recordingStopRequested) {
            recycleReusableVideoFrame()
        }
        try {
            camera?.stopPreview()
        } catch (_: Throwable) {
        }
        try {
            camera?.release()
        } catch (_: Throwable) {
        }
        camera = null
        activeCameraId = -1
    }

    private fun releaseRecorder() {
        videoRecorder = null
        if (!recordingStopRequested) {
            videoFramePending.set(false)
        }
    }

    private fun resetRecordStopState() {
        recordingStopRequested = false
        recordingFrameError = false
        recordingFrameErrorStage = ""
        recordingFrameErrorDetail = ""
        recordingFrameSkipStage = ""
        recordingFrameSkipDetail = ""
        videoFramePending.set(false)
        if (releaseReusableFrameAfterRecordStop) {
            releaseReusableFrameAfterRecordStop = false
            recycleReusableVideoFrame()
        }
        if (quitIoThreadAfterRecordStop) {
            quitIoThreadAfterRecordStop = false
            ioThread.quitSafely()
        }
    }

    private fun recycleReusableVideoFrame() {
        reusableVideoFrame?.recycle()
        reusableVideoFrame = null
        recycleBitmap(reusableMirroredVideoFrame)
        reusableMirroredVideoFrame = null
    }

    private fun playCameraActionSound(soundName: Int) {
        if (!cameraSoundEnabled) {
            return
        }
        try {
            mediaActionSound.play(soundName)
        } catch (throwable: Throwable) {
            Log.w(LOG_TAG, "camera action sound failed: ${throwable.message}")
        }
    }

    private fun disableDefaultShutterSound(activeCamera: Camera): Boolean {
        return try {
            activeCamera.enableShutterSound(false)
        } catch (throwable: Throwable) {
            Log.w(LOG_TAG, "disable default shutter sound failed: ${throwable.message}")
            false
        }
    }

    private fun releaseCameraActionSound() {
        try {
            mediaActionSound.release()
        } catch (_: Throwable) {
        }
    }

    private fun markRecordingFrameError(stage: String, throwable: Throwable) {
        recordingFrameError = true
        recordingFrameErrorStage = stage
        recordingFrameErrorDetail = errorSummary(throwable)
    }

    private fun markRecordingFrameSkip(stage: String, detail: String) {
        recordingFrameSkipStage = stage
        recordingFrameSkipDetail = detail
    }

    private fun frameErrorDiagnostics(): String {
        if (!recordingFrameError) {
            return "none"
        }
        val stage = if (recordingFrameErrorStage.isBlank()) RECORD_STAGE_UNKNOWN else recordingFrameErrorStage
        val detail = if (recordingFrameErrorDetail.isBlank()) "unknown" else recordingFrameErrorDetail
        return "stage=${stage}; error=${detail}"
    }

    private fun frameSkipDiagnostics(): String {
        if (recordingFrameSkipStage.isBlank()) {
            return "none"
        }
        val detail = if (recordingFrameSkipDetail.isBlank()) "unknown" else recordingFrameSkipDetail
        return "stage=${recordingFrameSkipStage}; detail=${detail}"
    }

    private fun recordValidationStage(): String {
        return if (recordingFrameSkipStage.isBlank()) RECORD_STAGE_VIDEO_VALIDATE else recordingFrameSkipStage
    }

    private fun recordStopDiagnostics(
        stage: String,
        recorder: CameraMp4Recorder,
        stopRequestedAt: Long,
        finishMs: Long,
        throwable: Throwable?
    ): String {
        val error = throwable?.let { errorSummary(it) } ?: "none"
        val totalMs = max(0L, System.currentTimeMillis() - stopRequestedAt)
        return "${recorder.diagnostics(stage)}; frameError=${frameErrorDiagnostics()}; frameSkip=${frameSkipDiagnostics()}; finishMs=${max(0L, finishMs)}; totalMs=${totalMs}; error=${error}"
    }

    private fun discardVideoOutput(outputTarget: VideoOutputTarget, stage: String) {
        try {
            outputTarget.discard(context)
        } catch (throwable: Throwable) {
            Log.w(LOG_TAG, "record output discard failed: stage=${stage}; error=${errorSummary(throwable)}", throwable)
        }
    }

    private fun errorSummary(throwable: Throwable): String {
        return throwable.message ?: throwable.javaClass.simpleName
    }

    private fun releaseVideoOutputTarget(discard: Boolean) {
        val target = videoOutputTarget
        videoOutputTarget = null
        if (discard) {
            target?.discard(context)
        } else {
            target?.closeDescriptor()
        }
    }

    private fun findBackCameraId(): Int {
        return findCameraIdByFacing(Camera.CameraInfo.CAMERA_FACING_BACK)
    }

    private fun findFrontCameraId(): Int {
        return findCameraIdByFacing(Camera.CameraInfo.CAMERA_FACING_FRONT)
    }

    private fun findCameraIdByFacing(facing: Int): Int {
        val info = Camera.CameraInfo()
        for (cameraIndex in 0 until Camera.getNumberOfCameras()) {
            Camera.getCameraInfo(cameraIndex, info)
            if (info.facing == facing) {
                return cameraIndex
            }
        }
        return -1
    }

    private fun findPrimaryBackCameraId(): Int {
        val backCameraId = findBackCameraId()
        if (backCameraId >= 0) {
            return backCameraId
        }
        return if (Camera.getNumberOfCameras() > 0) 0 else -1
    }

    private fun resolveCameraIdForFacing(facing: String): Int {
        return if (facing == UI_CAMERA_FRONT) findFrontCameraId() else findPrimaryBackCameraId()
    }

    private fun activeCameraFacing(): String {
        if (activeCameraId < 0) {
            return requestedCameraFacing
        }
        return try {
            val info = Camera.CameraInfo()
            Camera.getCameraInfo(activeCameraId, info)
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) UI_CAMERA_FRONT else UI_CAMERA_BACK
        } catch (_: Throwable) {
            requestedCameraFacing
        }
    }

    private fun resolveCameraIdForZoomMode(zoomMode: String): Int {
        if (requestedCameraFacing == UI_CAMERA_FRONT) {
            return findFrontCameraId()
        }
        if (zoomMode == UI_ZOOM_WIDE) {
            val wideCameraId = resolveWideBackCameraId()
            if (wideCameraId >= 0) {
                return wideCameraId
            }
        }
        return findPrimaryBackCameraId()
    }

    private fun resolveWideBackCameraId(): Int {
        return -1
    }

    private fun chooseCameraSize(sizes: List<Camera.Size>?, targetSize: XycSize? = null): Camera.Size {
        val available = sizes ?: emptyList()
        val targetAspect = targetSize?.let { aspectRatioForMatch(it.width, it.height) }
        return available
            .minWithOrNull(
                compareBy<Camera.Size> { aspectDelta(it.width, it.height, targetAspect) }
                    .thenByDescending { sizeFitsQualityCap(it.width, it.height) }
                    .thenByDescending { it.width * it.height }
            )
            ?: error("No camera size is available.")
    }

    private fun chooseVideoSize(parameters: Camera.Parameters, targetSize: XycSize): XycSize {
        val videoSizes = parameters.supportedVideoSizes ?: parameters.supportedPreviewSizes
        val selected = chooseCameraSize(videoSizes, targetSize)
        return XycSize(selected.width, selected.height)
    }

    private fun choosePhotoSize(sizes: List<Camera.Size>?): XycSize {
        val available = sizes ?: emptyList()
        val targetAspect = targetCameraFrameAspect()
        val selected = available
            .minWithOrNull(
                compareBy<Camera.Size> { aspectDelta(it.width, it.height, targetAspect) }
                    .thenByDescending { photoSizeFitsQualityCap(it.width, it.height) }
                    .thenByDescending { it.width * it.height }
            )
            ?: return previewSize
        return XycSize(selected.width, selected.height)
    }

    private fun chooseRecordingOutputSize(): XycSize {
        val fallbackWidth = if (shouldRotateRecordingOutput()) videoSize.height else videoSize.width
        val fallbackHeight = if (shouldRotateRecordingOutput()) videoSize.width else videoSize.height
        val sourceWidth = previewView.width.takeIf { it > 0 } ?: fallbackWidth
        val sourceHeight = previewView.height.takeIf { it > 0 } ?: fallbackHeight
        val longEdgeScale = MAX_RECORDING_LONG_EDGE.toDouble() / max(sourceWidth, sourceHeight).toDouble()
        val pixelScale = sqrt(MAX_RECORDING_PIXELS.toDouble() / (sourceWidth * sourceHeight).toDouble())
        val scale = min(1.0, min(longEdgeScale, pixelScale))
        return XycSize(
            width = evenDimension((sourceWidth * scale).toInt()),
            height = evenDimension((sourceHeight * scale).toInt())
        )
    }

    private fun shouldRotateRecordingOutput(): Boolean {
        val rotationDegrees = activeCameraId.takeIf { it >= 0 }?.let { resolveCameraCaptureRotationDegrees(it) } ?: 0
        return rotationDegrees == 90 || rotationDegrees == 270
    }

    private fun sizeFitsQualityCap(width: Int, height: Int): Boolean {
        return max(width, height) <= MAX_CAMERA_SIZE_LONG_EDGE && width * height <= MAX_CAMERA_SIZE_PIXELS
    }

    private fun photoSizeFitsQualityCap(width: Int, height: Int): Boolean {
        return max(width, height) <= MAX_PHOTO_SIZE_LONG_EDGE && width * height <= MAX_PHOTO_SIZE_PIXELS
    }

    private fun aspectRatioForMatch(width: Int, height: Int): Float {
        val longEdge = max(1, max(width, height))
        val shortEdge = max(1, min(width, height))
        return shortEdge.toFloat() / longEdge.toFloat()
    }

    private fun aspectDelta(width: Int, height: Int, targetAspect: Float?): Float {
        if (targetAspect == null) {
            return 0f
        }
        return abs(aspectRatioForMatch(width, height) - targetAspect)
    }

    private fun targetCameraFrameAspect(): Float {
        return CAMERA_FRAME_ASPECT_SHORT_EDGE / CAMERA_FRAME_ASPECT_LONG_EDGE
    }

    private fun chooseVideoBitrate(size: XycSize, fps: Int): Int {
        val qualityBitrate = size.width * size.height * fps / VIDEO_BITRATE_PIXEL_DIVISOR
        return qualityBitrate.coerceIn(MIN_VIDEO_BITRATE, MAX_VIDEO_BITRATE)
    }

    private fun evenDimension(value: Int): Int {
        val safeValue = max(2, value)
        return if (safeValue % 2 == 0) safeValue else safeValue - 1
    }

    private fun chooseFpsRange(ranges: List<IntArray>?): IntArray? {
        val target = targetFps * 1000
        return ranges
            ?.filter { it[0] <= target && it[1] >= target }
            ?.minByOrNull { abs(it[0] - target) + abs(it[1] - target) }
            ?: ranges?.maxByOrNull { it[1] }
    }

    private fun parseFps(optionsJson: String): Int {
        val match = Regex("\"fps\"\\s*:\\s*(\\d+)").find(optionsJson)
        return (match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: targetFps).coerceIn(15, DEFAULT_TARGET_FPS)
    }

    private fun createVideoOutputTarget(): VideoOutputTarget {
        val fileName = "xyc-markvideo-video-${System.currentTimeMillis()}.mp4"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val uri = resolver.insert(
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                scopedMediaValues(fileName, "video/mp4", true, true)
            ) ?: throw IllegalStateException("Failed to create MediaStore video item.")
            try {
                val descriptor = resolver.openFileDescriptor(uri, "w")
                    ?: throw IllegalStateException("Failed to open MediaStore video descriptor.")
                return VideoOutputTarget(
                    file = null,
                    uri = uri,
                    fileDescriptor = descriptor,
                    mimeType = "video/mp4",
                    isPendingMediaStore = true
                )
            } catch (throwable: Throwable) {
                resolver.delete(uri, null, null)
                throw throwable
            }
        }
        val publicDirectory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
        val targetDirectory = File(publicDirectory, ALBUM_DIRECTORY_NAME)
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            throw IllegalStateException("Failed to create album directory.")
        }
        return VideoOutputTarget(
            file = File(targetDirectory, fileName),
            uri = null,
            fileDescriptor = null,
            mimeType = "video/mp4",
            isPendingMediaStore = false
        )
    }

    private fun parseWatermark(optionsJson: String): NativeWatermark {
        val json = org.json.JSONObject(optionsJson)
        val templateId = json.optString("templateId", "")
        if (templateId.isBlank()) {
            throw IllegalArgumentException("templateId is required.")
        }
        val imagePath = json.optString("nativeImagePath", json.optString("imagePath", ""))
        return NativeWatermark(
            templateId = templateId,
            templateName = json.optString("templateName", ""),
            templateType = json.optString("templateType", "text"),
            mainTitleText = json.optString("mainTitleText", ""),
            subtitleText = json.optString("subtitleText", ""),
            mainTitleColor = json.optString("mainTitleColor", "#FFFFFF"),
            subtitleColor = json.optString("subtitleColor", "#E8FFFFFF"),
            mainTitleFontSize = json.optDouble("mainTitleFontSize", 18.0).toFloat().coerceIn(8f, 72f),
            subtitleFontSize = json.optDouble("subtitleFontSize", 12.0).toFloat().coerceIn(8f, 48f),
            mainTitleBold = json.optBoolean("mainTitleBold", true),
            subtitleBold = json.optBoolean("subtitleBold", false),
            imagePath = imagePath,
            imageWidth = json.optDouble("imageWidth", 0.0).toFloat().coerceAtLeast(0f),
            imageHeight = json.optDouble("imageHeight", 0.0).toFloat().coerceAtLeast(0f),
            imageTextGap = json.optDouble("imageTextGap", 8.0).toFloat().coerceAtLeast(0f),
            boxWidth = json.optDouble("boxWidth", 0.58).toFloat().coerceIn(0.05f, 1f),
            boxHeight = json.optDouble("boxHeight", 0.14).toFloat().coerceIn(0.04f, 1f),
            boxBackgroundColor = json.optString("boxBackgroundColor", "rgba(22,24,26,0.58)"),
            boxRadius = json.optDouble("boxRadius", 10.0).toFloat().coerceAtLeast(0f),
            boxPadding = json.optDouble("boxPadding", 12.0).toFloat().coerceAtLeast(0f),
            opacity = json.optDouble("opacity", 1.0).toFloat().coerceIn(0f, 1f),
            positionX = json.optDouble("positionX", 0.12).toFloat().coerceIn(0f, 1f),
            positionY = json.optDouble("positionY", 0.16).toFloat().coerceIn(0f, 1f),
            scale = json.optDouble("scale", 1.0).toFloat().coerceIn(0.3f, 3f),
            rotation = json.optDouble("rotation", 0.0).toFloat(),
            previewWidth = json.optDouble("previewWidth", 375.0).toFloat().coerceAtLeast(1f),
            previewHeight = json.optDouble("previewHeight", 812.0).toFloat().coerceAtLeast(1f)
        )
    }

    private fun validateWatermarkImage(watermark: NativeWatermark): String? {
        if (!watermarkRequiresImage(watermark)) {
            return null
        }
        val bitmap = decodeWatermarkBitmap(watermark.imagePath)
            ?: return "水印图片资源不可读"
        bitmap.recycle()
        return null
    }

    private fun watermarkRequiresImage(watermark: NativeWatermark): Boolean {
        return watermark.templateType == "image" || watermark.templateType == "mixed" || watermark.imagePath.isNotBlank()
    }

    private fun decodeRequiredWatermarkBitmap(watermark: NativeWatermark): Bitmap? {
        if (!watermarkRequiresImage(watermark)) {
            return null
        }
        return decodeWatermarkBitmap(watermark.imagePath, false)
            ?: throw IllegalStateException("水印图片资源不可读")
    }

    private fun copyOrDecodeWatermarkBitmap(watermark: NativeWatermark?, sourceBitmap: Bitmap?): Bitmap? {
        if (watermark == null) {
            return null
        }
        val copiedBitmap = copyWatermarkBitmap(sourceBitmap)
        if (copiedBitmap != null) {
            return copiedBitmap
        }
        return decodeRequiredWatermarkBitmap(watermark)
    }

    private fun copyWatermarkBitmap(sourceBitmap: Bitmap?): Bitmap? {
        if (sourceBitmap == null || sourceBitmap.isRecycled) {
            return null
        }
        return try {
            sourceBitmap.copy(Bitmap.Config.ARGB_8888, false)
        } catch (_: Throwable) {
            null
        }
    }

    private fun recycleBitmap(bitmap: Bitmap?) {
        try {
            if (bitmap != null && !bitmap.isRecycled) {
                bitmap.recycle()
            }
        } catch (_: Throwable) {
        }
    }

    private fun recycleWatermarkOverlay(overlay: WatermarkOverlay?) {
        recycleBitmap(overlay?.bitmap)
    }

    private fun createVideoWatermarkOverlay(
        size: XycSize,
        watermark: NativeWatermark?,
        watermarkBitmap: Bitmap?
    ): WatermarkOverlay? {
        if (watermark == null) {
            return null
        }
        val dirtyRect = watermarkDirtyRect(size.width, size.height, watermark)
        if (dirtyRect.isEmpty()) {
            return null
        }
        val overlayBitmap = Bitmap.createBitmap(dirtyRect.width(), dirtyRect.height(), Bitmap.Config.ARGB_8888)
        overlayBitmap.eraseColor(Color.TRANSPARENT)
        val burnedIn = try {
            val overlayCanvas = Canvas(overlayBitmap)
            overlayCanvas.translate(-dirtyRect.left.toFloat(), -dirtyRect.top.toFloat())
            drawWatermarkOnPhoto(
                overlayCanvas,
                size.width,
                size.height,
                watermark,
                watermarkBitmap
            )
        } catch (throwable: Throwable) {
            overlayBitmap.recycle()
            throw throwable
        }
        if (!burnedIn) {
            overlayBitmap.recycle()
            throw IllegalStateException("水印内容不可绘制")
        }
        return WatermarkOverlay(
            bitmap = overlayBitmap,
            dirtyRect = dirtyRect
        )
    }

    private fun drawWatermarkOverlay(targetBitmap: Bitmap, overlay: WatermarkOverlay) {
        if (overlay.bitmap.isRecycled || overlay.dirtyRect.isEmpty()) {
            return
        }
        Canvas(targetBitmap).drawBitmap(overlay.bitmap, overlay.dirtyRect.left.toFloat(), overlay.dirtyRect.top.toFloat(), null)
    }

    private fun writePhotoWithWatermark(
        file: File,
        data: ByteArray,
        watermark: NativeWatermark?,
        watermarkBitmap: Bitmap?,
        cameraFacing: String
    ): PhotoWriteResult {
        val needsFrontCameraUnmirror = cameraFacing == UI_CAMERA_FRONT
        if (watermark == null && !needsFrontCameraUnmirror) {
            file.writeBytes(data)
            val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
            val size = PhotoWriteResult(
                size = XycSize(bitmap?.width ?: previewSize.width, bitmap?.height ?: previewSize.height),
                watermarkBurnedIn = false
            )
            bitmap?.recycle()
            return size
        }

        file.writeBytes(data)
        val decodeOptions = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inMutable = true
        }
        val sourceBitmap = BitmapFactory.decodeByteArray(data, 0, data.size, decodeOptions)
            ?: throw IllegalStateException("Unable to decode captured JPEG.")
        val orientedBitmap = applyExifOrientation(sourceBitmap, readExifRotationDegrees(file))
        if (orientedBitmap != sourceBitmap) {
            sourceBitmap.recycle()
        }
        val cameraAlignedBitmap = applyFrontCameraOutputMirror(orientedBitmap, cameraFacing)
        if (cameraAlignedBitmap != orientedBitmap) {
            orientedBitmap.recycle()
        }
        val outputBitmap = ensureMutableBitmap(cameraAlignedBitmap)
        if (outputBitmap != cameraAlignedBitmap) {
            cameraAlignedBitmap.recycle()
        }
        var burnedIn = false
        if (watermark != null) {
            burnedIn = drawWatermarkOnPhoto(Canvas(outputBitmap), outputBitmap.width, outputBitmap.height, watermark, watermarkBitmap)
            if (!burnedIn) {
                outputBitmap.recycle()
                throw IllegalStateException("水印内容不可绘制")
            }
        }
        FileOutputStream(file).use { output ->
            outputBitmap.compress(Bitmap.CompressFormat.JPEG, PHOTO_JPEG_QUALITY, output)
        }
        val resultSize = XycSize(outputBitmap.width, outputBitmap.height)
        outputBitmap.recycle()
        return PhotoWriteResult(
            size = resultSize,
            watermarkBurnedIn = burnedIn
        )
    }

    private fun applyFrontCameraOutputMirror(source: Bitmap, cameraFacing: String): Bitmap {
        if (cameraFacing != UI_CAMERA_FRONT) {
            return source
        }
        return Bitmap.createBitmap(source, 0, 0, source.width, source.height, frontCameraMirrorMatrix(source.width), true)
    }

    private fun applyFrontCameraFrameMirrorIfNeeded(target: Bitmap, cameraFacing: String) {
        if (cameraFacing != UI_CAMERA_FRONT) {
            return
        }
        val mirrorFrame = reusableMirroredVideoFrame?.takeIf {
            !it.isRecycled && it.width == target.width && it.height == target.height
        } ?: Bitmap.createBitmap(target.width, target.height, Bitmap.Config.ARGB_8888).also {
            recycleBitmap(reusableMirroredVideoFrame)
            reusableMirroredVideoFrame = it
        }
        Canvas(mirrorFrame).drawBitmap(target, frontCameraMirrorMatrix(target.width), null)
        Canvas(target).drawBitmap(mirrorFrame, 0f, 0f, null)
    }

    private fun frontCameraMirrorMatrix(width: Int): Matrix {
        val matrix = Matrix()
        matrix.postScale(-1f, 1f)
        matrix.postTranslate(width.toFloat(), 0f)
        return matrix
    }

    private fun drawWatermarkOnPhoto(
        canvas: Canvas,
        outputWidth: Int,
        outputHeight: Int,
        watermark: NativeWatermark,
        cachedImageBitmap: Bitmap?
    ): Boolean {
        val transform = watermarkOutputTransform(outputWidth, outputHeight, watermark)
        val rect = watermarkOutputRect(outputWidth, outputHeight, watermark, transform)
        val centerX = rect.centerX()
        val centerY = rect.centerY()

        canvas.save()
        canvas.rotate(watermark.rotation, centerX, centerY)

        val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        backgroundPaint.color = parseWatermarkColor(watermark.boxBackgroundColor, Color.argb(150, 22, 24, 26), watermark.opacity)
        canvas.drawRoundRect(rect, watermark.boxRadius * transform.previewToOutputScale, watermark.boxRadius * transform.previewToOutputScale, backgroundPaint)

        val padding = watermark.boxPadding * transform.previewToOutputScale
        val imageWidth = watermark.imageWidth * transform.previewToOutputScale
        val imageHeight = watermark.imageHeight * transform.previewToOutputScale
        val gap = watermark.imageTextGap * transform.previewToOutputScale
        var contentLeft = rect.left + padding
        val contentTop = rect.top + padding
        val contentBottom = rect.bottom - padding
        val hasTitle = watermark.mainTitleText.isNotBlank()
        val hasSubtitle = watermark.subtitleText.isNotBlank()
        val contentRight = rect.right - padding
        val imageBitmap = cachedImageBitmap ?: decodeWatermarkBitmap(watermark.imagePath, true)
        val shouldRecycleImageBitmap = cachedImageBitmap == null
        var drewContent = false
        if (watermarkRequiresImage(watermark) && imageBitmap == null) {
            canvas.restore()
            return false
        }

        if (imageBitmap != null && imageWidth > 0f && imageHeight > 0f) {
            val imageTop = contentTop + max(0f, (contentBottom - contentTop - imageHeight) / 2f)
            val imageLeft = if (!hasTitle && !hasSubtitle) {
                contentLeft + max(0f, (contentRight - contentLeft - imageWidth) / 2f)
            } else {
                contentLeft
            }
            val imageRect = RectF(imageLeft, imageTop, imageLeft + imageWidth, imageTop + imageHeight)
            val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                isFilterBitmap = true
                isDither = true
            }
            canvas.drawBitmap(imageBitmap, null, imageRect, imagePaint)
            contentLeft += imageWidth + gap
            drewContent = true
            if (shouldRecycleImageBitmap) {
                imageBitmap.recycle()
            }
        }

        val textMaxWidth = rect.right - padding - contentLeft
        if (textMaxWidth > 0f && (hasTitle || hasSubtitle)) {
            val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
            titlePaint.color = parseWatermarkColor(watermark.mainTitleColor, Color.WHITE, 1f)
            titlePaint.textSize = watermark.mainTitleFontSize * transform.previewToOutputScale
            titlePaint.typeface = if (watermark.mainTitleBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT

            val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
            subtitlePaint.color = parseWatermarkColor(watermark.subtitleColor, Color.argb(220, 255, 255, 255), 1f)
            subtitlePaint.textSize = watermark.subtitleFontSize * transform.previewToOutputScale
            subtitlePaint.typeface = if (watermark.subtitleBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT

            val titleHeight = if (hasTitle) titlePaint.fontMetrics.let { it.descent - it.ascent } else 0f
            val subtitleHeight = if (hasSubtitle) subtitlePaint.fontMetrics.let { it.descent - it.ascent } else 0f
            val textGap = if (hasTitle && hasSubtitle) 5f * transform.previewToOutputScale else 0f
            val totalHeight = titleHeight + subtitleHeight + textGap
            var baseline = contentTop + max(0f, (contentBottom - contentTop - totalHeight) / 2f)

            if (hasTitle) {
                baseline -= titlePaint.fontMetrics.ascent
                canvas.drawText(ellipsizeText(watermark.mainTitleText, titlePaint, textMaxWidth), contentLeft, baseline, titlePaint)
                baseline += titlePaint.fontMetrics.descent + textGap
                drewContent = true
            }
            if (hasSubtitle) {
                baseline -= subtitlePaint.fontMetrics.ascent
                canvas.drawText(ellipsizeText(watermark.subtitleText, subtitlePaint, textMaxWidth), contentLeft, baseline, subtitlePaint)
                drewContent = true
            }
        }

        if (shouldRecycleImageBitmap) {
            imageBitmap?.let {
                if (!it.isRecycled) {
                    it.recycle()
                }
            }
        }
        canvas.restore()
        return drewContent
    }

    private fun watermarkOutputRect(
        outputWidth: Int,
        outputHeight: Int,
        watermark: NativeWatermark,
        transform: WatermarkOutputTransform
    ): RectF {
        val boxWidth = transform.previewWidth * watermark.boxWidth * watermark.scale * transform.previewToOutputScale
        val boxHeight = transform.previewHeight * watermark.boxHeight * watermark.scale * transform.previewToOutputScale
        val left = ((transform.previewWidth * watermark.positionX + transform.previewOffsetX) * transform.previewToOutputScale)
            .coerceIn(0f, max(0f, outputWidth - boxWidth))
        val top = ((transform.previewHeight * watermark.positionY + transform.previewOffsetY) * transform.previewToOutputScale)
            .coerceIn(0f, max(0f, outputHeight - boxHeight))
        return RectF(left, top, left + boxWidth, top + boxHeight)
    }

    private fun watermarkDirtyRect(outputWidth: Int, outputHeight: Int, watermark: NativeWatermark): Rect {
        val transform = watermarkOutputTransform(outputWidth, outputHeight, watermark)
        val rect = watermarkOutputRect(outputWidth, outputHeight, watermark, transform)
        val rotation = watermark.rotation % 360f
        val bounds = if (abs(rotation) < 0.01f) {
            rect
        } else {
            val radians = Math.toRadians(rotation.toDouble())
            val cosValue = abs(kotlin.math.cos(radians)).toFloat()
            val sinValue = abs(kotlin.math.sin(radians)).toFloat()
            val halfWidth = rect.width() / 2f
            val halfHeight = rect.height() / 2f
            val rotatedHalfWidth = halfWidth * cosValue + halfHeight * sinValue
            val rotatedHalfHeight = halfWidth * sinValue + halfHeight * cosValue
            RectF(
                rect.centerX() - rotatedHalfWidth,
                rect.centerY() - rotatedHalfHeight,
                rect.centerX() + rotatedHalfWidth,
                rect.centerY() + rotatedHalfHeight
            )
        }
        val padding = WATERMARK_OVERLAY_DIRTY_PADDING_PX
        return Rect(
            max(0, Math.floor((bounds.left - padding).toDouble()).toInt()),
            max(0, Math.floor((bounds.top - padding).toDouble()).toInt()),
            min(outputWidth, Math.ceil((bounds.right + padding).toDouble()).toInt()),
            min(outputHeight, Math.ceil((bounds.bottom + padding).toDouble()).toInt())
        )
    }

    private fun readExifRotationDegrees(file: File): Int {
        return try {
            val orientation = ExifInterface(file.absolutePath).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        } catch (_: Throwable) {
            0
        }
    }

    private fun applyExifOrientation(source: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) {
            return source
        }
        val matrix = Matrix()
        matrix.postRotate(degrees.toFloat())
        return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    }

    private fun ensureMutableBitmap(source: Bitmap): Bitmap {
        if (source.isMutable && source.config == Bitmap.Config.ARGB_8888) {
            return source
        }
        return source.copy(Bitmap.Config.ARGB_8888, true)
    }

    private fun watermarkOutputTransform(outputWidth: Int, outputHeight: Int, watermark: NativeWatermark): WatermarkOutputTransform {
        val previewWidth = max(1f, watermark.previewWidth)
        val previewHeight = max(1f, watermark.previewHeight)
        val outputToPreviewScale = max(previewWidth / max(1f, outputWidth.toFloat()), previewHeight / max(1f, outputHeight.toFloat()))
        val previewToOutputScale = 1f / max(0.0001f, outputToPreviewScale)
        return WatermarkOutputTransform(
            previewWidth = previewWidth,
            previewHeight = previewHeight,
            previewToOutputScale = previewToOutputScale,
            previewOffsetX = max(0f, (outputWidth * outputToPreviewScale - previewWidth) / 2f),
            previewOffsetY = max(0f, (outputHeight * outputToPreviewScale - previewHeight) / 2f)
        )
    }

    private fun decodeWatermarkBitmap(path: String, allowSearch: Boolean = true): Bitmap? {
        if (path.isBlank()) {
            return null
        }
        val normalizedPath = path.removePrefix("file://")
        val assetPrefix = "android_asset/"
        val assetIndex = normalizedPath.indexOf(assetPrefix)
        if (assetIndex >= 0) {
            val assetPath = normalizedPath.substring(assetIndex + assetPrefix.length)
            decodeWatermarkAsset(assetPath)?.let { return it }
        }
        val candidatePaths = arrayListOf(normalizedPath)
        if (normalizedPath.startsWith("_www/")) {
            candidatePaths.add(normalizedPath.removePrefix("_www/"))
        }
        if (normalizedPath.startsWith("/_www/")) {
            candidatePaths.add(normalizedPath.removePrefix("/_www/"))
        }
        for (candidatePath in candidatePaths) {
            val directFile = File(candidatePath)
            if (directFile.exists() && directFile.isFile) {
                return BitmapFactory.decodeFile(directFile.absolutePath)
            }
        }
        val relativePath = resolveWatermarkRelativePath(normalizedPath)
        if (relativePath.isNotBlank()) {
            decodeWatermarkAsset(relativePath)?.let { return it }
            if (!allowSearch) {
                return null
            }
            val roots = arrayListOf<File>()
            roots.add(File(context.applicationInfo.dataDir, "apps"))
            roots.add(File(context.applicationInfo.dataDir, "www"))
            roots.add(File(context.applicationInfo.dataDir))
            context.cacheDir.parentFile?.let { roots.add(File(it, "apps")) }
            context.cacheDir.parentFile?.let { roots.add(it) }
            for (root in roots) {
                if (!root.exists()) {
                    continue
                }
                val matchedFile = root.walkTopDown()
                    .maxDepth(8)
                    .firstOrNull { it.isFile && it.path.endsWith(relativePath) }
                if (matchedFile != null) {
                    return BitmapFactory.decodeFile(matchedFile.absolutePath)
                }
            }
        }
        return null
    }

    private fun resolveWatermarkRelativePath(path: String): String {
        val trimmedPath = path.trim()
        if (trimmedPath.startsWith("/static/")) {
            return trimmedPath.removePrefix("/")
        }
        if (trimmedPath.startsWith("static/")) {
            return trimmedPath
        }
        val staticIndex = trimmedPath.indexOf("/static/")
        if (staticIndex >= 0) {
            return trimmedPath.substring(staticIndex + 1)
        }
        return ""
    }

    private fun decodeWatermarkAsset(relativePath: String): Bitmap? {
        return try {
            context.assets.open(relativePath).use { input ->
                BitmapFactory.decodeStream(input)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun ellipsizeText(text: String, paint: Paint, maxWidth: Float): String {
        if (paint.measureText(text) <= maxWidth) {
            return text
        }
        val ellipsis = "…"
        var end = text.length
        while (end > 0) {
            val candidate = text.substring(0, end) + ellipsis
            if (paint.measureText(candidate) <= maxWidth) {
                return candidate
            }
            end -= 1
        }
        return ellipsis
    }

    private fun parseWatermarkColor(value: String, fallback: Int, opacity: Float): Int {
        val trimmed = value.trim()
        val color = try {
            when {
                trimmed.startsWith("rgba(") && trimmed.endsWith(")") -> parseRgbaColor(trimmed)
                trimmed.startsWith("#") -> {
                    if (trimmed.length == 9) {
                        Color.parseColor(trimmed)
                    } else {
                        Color.parseColor(trimmed)
                    }
                }
                else -> fallback
            }
        } catch (_: Throwable) {
            fallback
        }
        val alpha = (Color.alpha(color) * opacity).toInt().coerceIn(0, 255)
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }

    private fun parseRgbaColor(value: String): Int {
        val parts = value.removePrefix("rgba(").removeSuffix(")").split(",")
        if (parts.size != 4) {
            throw IllegalArgumentException("Invalid rgba color.")
        }
        val red = parts[0].trim().toInt().coerceIn(0, 255)
        val green = parts[1].trim().toInt().coerceIn(0, 255)
        val blue = parts[2].trim().toInt().coerceIn(0, 255)
        val alphaPart = parts[3].trim().toFloat().coerceIn(0f, 1f)
        return Color.argb((alphaPart * 255).toInt(), red, green, blue)
    }

    private fun cameraReadyPayload(): org.json.JSONObject {
        return payload()
            .put("message", "相机已准备")
            .put("mode", currentMode)
            .put("flashMode", requestedFlashMode)
            .put("zoomMode", requestedZoomMode)
            .put("cameraFacing", activeCameraFacing())
            .put("availableCameraFacings", cameraFacingsPayload())
            .put("availableZoomModes", zoomModesPayload(camera?.parameters))
            .put("fps", targetFps)
            .put("previewWidth", previewSize.width)
            .put("previewHeight", previewSize.height)
            .put("pictureWidth", pictureSize.width)
            .put("pictureHeight", pictureSize.height)
            .put("videoWidth", videoSize.width)
            .put("videoHeight", videoSize.height)
    }

    private fun zoomModesPayload(parameters: Camera.Parameters?): org.json.JSONArray {
        val modes = org.json.JSONArray()
        modes.put(UI_ZOOM_1X)
        if (requestedCameraFacing == UI_CAMERA_BACK && resolveWideBackCameraId() >= 0) {
            modes.put(UI_ZOOM_WIDE)
        }
        if (parameters != null && parameters.isZoomSupported) {
            val ratios = parameters.zoomRatios ?: emptyList()
            val maxZoom = parameters.maxZoom
            val maxIndex = min(maxZoom, ratios.size - 1)
            if (maxIndex > 0) {
                var bestIndex = 0
                var bestScore = Int.MAX_VALUE
                for (index in 0..maxIndex) {
                    val score = abs(ratios[index] - 200)
                    if (score < bestScore) {
                        bestScore = score
                        bestIndex = index
                    }
                }
                if (ratios[bestIndex] >= 190) {
                    modes.put(UI_ZOOM_2X)
                }
            }
        }
        return modes
    }

    private fun flashModesPayload(supportedModes: List<String>?): org.json.JSONArray {
        val modes = org.json.JSONArray()
        supportedModes?.forEach { mode ->
            modes.put(mode)
        }
        return modes
    }

    private fun cameraFacingsPayload(): org.json.JSONArray {
        val facings = org.json.JSONArray()
        if (findBackCameraId() >= 0) {
            facings.put(UI_CAMERA_BACK)
        }
        if (findFrontCameraId() >= 0) {
            facings.put(UI_CAMERA_FRONT)
        }
        return facings
    }

    private fun mediaPayload(tempFilePath: String, durationMs: Long, width: Int, height: Int): org.json.JSONObject {
        return payload()
            .put("tempFilePath", tempFilePath)
            .put("path", tempFilePath)
            .put("durationMs", durationMs)
            .put("width", width)
            .put("height", height)
    }

    private fun albumOpenUri(mediaUri: String): Uri {
        val preferredUri = mediaUri.takeIf { it.isNotBlank() } ?: lastPublishedAlbumUri
        if (preferredUri.isNotBlank()) {
            if (preferredUri.startsWith("content://") || preferredUri.startsWith("file://")) {
                return Uri.parse(preferredUri)
            } else {
                return mediaCollectionUri()
            }
        }
        return mediaCollectionUri()
    }

    private fun mediaCollectionUri(): Uri {
        return if (lastPublishedMediaKind == "video") {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
    }

    private fun albumOpenMimeType(mediaUri: String): String {
        val target = mediaUri.takeIf { it.isNotBlank() } ?: lastPublishedMediaUri
        if (lastPublishedMediaKind == "video" || target.endsWith(".mp4", ignoreCase = true)) {
            return "video/*"
        }
        if (lastPublishedMediaKind == "photo" || target.endsWith(".jpg", ignoreCase = true) || target.endsWith(".jpeg", ignoreCase = true)) {
            return "image/*"
        }
        return "*/*"
    }

    private fun appendWatermarkResult(
        data: org.json.JSONObject,
        watermark: NativeWatermark?,
        photoBurnIn: Boolean,
        videoBurnIn: Boolean
    ): org.json.JSONObject {
        if (watermark == null) {
            return data
                .put("watermarkTemplateId", "")
                .put("watermarkPositionX", 0)
                .put("watermarkPositionY", 0)
                .put("watermarkBoxWidth", 0)
                .put("watermarkBoxHeight", 0)
                .put("watermarkTemplateSnapshot", payload())
                .put("watermarkPhotoBurnIn", false)
                .put("watermarkVideoBurnIn", false)
        }
        return data
            .put("watermarkTemplateId", watermark.templateId)
            .put("watermarkPositionX", watermark.positionX)
            .put("watermarkPositionY", watermark.positionY)
            .put("watermarkBoxWidth", watermark.boxWidth)
            .put("watermarkBoxHeight", watermark.boxHeight)
            .put("watermarkTemplateSnapshot", watermarkResultPayload(watermark))
            .put("watermarkPhotoBurnIn", photoBurnIn)
            .put("watermarkVideoBurnIn", videoBurnIn)
    }

    private fun watermarkResultPayload(watermark: NativeWatermark): org.json.JSONObject {
        return payload()
            .put("templateId", watermark.templateId)
            .put("templateName", watermark.templateName)
            .put("templateType", watermark.templateType)
            .put("mainTitleText", watermark.mainTitleText)
            .put("subtitleText", watermark.subtitleText)
            .put("mainTitleColor", watermark.mainTitleColor)
            .put("subtitleColor", watermark.subtitleColor)
            .put("mainTitleFontSize", watermark.mainTitleFontSize)
            .put("subtitleFontSize", watermark.subtitleFontSize)
            .put("mainTitleBold", watermark.mainTitleBold)
            .put("subtitleBold", watermark.subtitleBold)
            .put("imagePath", watermark.imagePath)
            .put("imageWidth", watermark.imageWidth)
            .put("imageHeight", watermark.imageHeight)
            .put("imageTextGap", watermark.imageTextGap)
            .put("boxWidth", watermark.boxWidth)
            .put("boxHeight", watermark.boxHeight)
            .put("boxBackgroundColor", watermark.boxBackgroundColor)
            .put("boxRadius", watermark.boxRadius)
            .put("boxPadding", watermark.boxPadding)
            .put("opacity", watermark.opacity)
            .put("positionX", watermark.positionX)
            .put("positionY", watermark.positionY)
            .put("scale", watermark.scale)
            .put("rotation", watermark.rotation)
    }

    private fun appendAlbumSuccess(data: org.json.JSONObject, albumResult: AlbumSaveResult, message: String, kind: String): org.json.JSONObject {
        rememberPublishedMedia(albumResult, kind)
        return data
            .put("savedToAlbum", true)
            .put("albumPath", albumResult.albumPath)
            .put("albumUri", albumResult.albumUri)
            .put("mediaKind", kind)
            .put("thumbnailPath", albumResult.thumbnailPath)
            .put("message", message)
    }

    private fun appendAlbumFailure(data: org.json.JSONObject, message: String): org.json.JSONObject {
        return data
            .put("savedToAlbum", false)
            .put("albumPath", "")
            .put("albumUri", "")
            .put("mediaKind", "")
            .put("thumbnailPath", "")
            .put("message", message)
    }

    private fun rememberPublishedMedia(albumResult: AlbumSaveResult, kind: String) {
        lastPublishedMediaUri = albumResult.albumUri
        lastPublishedMediaKind = kind
        lastPublishedAlbumUri = if (albumResult.albumUri.isNotBlank()) albumResult.albumUri else albumResult.albumPath
    }

    private fun appendRecordTiming(
        data: org.json.JSONObject,
        recorder: CameraMp4Recorder,
        fileBytes: Long,
        finishMs: Long,
        albumSaveMs: Long,
        totalSaveMs: Long,
        hadFrameError: Boolean
    ): org.json.JSONObject {
        return data
            .put("recordFinishMs", max(0L, finishMs))
            .put("recordAlbumSaveMs", max(0L, albumSaveMs))
            .put("recordTotalSaveMs", max(0L, totalSaveMs))
            .put("recordFrameCount", recorder.frameCount)
            .put("recordVideoSampleCount", recorder.videoSampleCount)
            .put("recordVideoBitrate", recorder.bitrate)
            .put("recordAudioEnabled", recorder.includeAudio)
            .put("recordAudioSampleCount", recorder.audioSampleCount)
            .put("recordAudioPcmPeakAbs", recorder.audioPcmPeakAbs)
            .put("recordAudioReadErrorCount", recorder.audioReadErrorCount)
            .put("recordAudioDiscardedReadCount", recorder.audioDiscardedReadCount)
            .put("recordStartWarmupMs", RECORD_START_WARMUP_MS)
            .put("recordFileBytes", max(0L, fileBytes))
            .put("recordHadFrameError", hadFrameError)
    }

    private fun appendPhotoTiming(
        data: org.json.JSONObject,
        captureCallbackMs: Long,
        watermarkWriteMs: Long,
        albumSaveMs: Long,
        totalSaveMs: Long,
        fileBytes: Long
    ): org.json.JSONObject {
        return data
            .put("photoCaptureCallbackMs", max(0L, captureCallbackMs))
            .put("photoWatermarkWriteMs", max(0L, watermarkWriteMs))
            .put("photoAlbumSaveMs", max(0L, albumSaveMs))
            .put("photoTotalSaveMs", max(0L, totalSaveMs))
            .put("photoFileBytes", max(0L, fileBytes))
    }

    private fun publishVideoOutput(target: VideoOutputTarget): AlbumSaveResult {
        return if (target.isPendingMediaStore) {
            target.closeDescriptor()
            val uri = target.uri ?: throw IllegalStateException("MediaStore uri is null.")
            try {
                publishPendingMediaStoreItem(uri)
                AlbumSaveResult(uri.toString(), uri.toString())
            } catch (throwable: Throwable) {
                target.discard(context)
                throw throwable
            }
        } else {
            val file = target.file ?: throw IllegalStateException("Video output file is null.")
            saveMediaToLegacyAlbum(file, target.mimeType, true)
        }
    }

    private fun saveMediaToAlbum(source: File, mimeType: String, isVideo: Boolean): AlbumSaveResult {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveMediaToScopedAlbum(source, mimeType, isVideo)
        } else {
            saveMediaToLegacyAlbum(source, mimeType, isVideo)
        }
    }

    private fun saveMediaToScopedAlbum(source: File, mimeType: String, isVideo: Boolean): AlbumSaveResult {
        val resolver = context.contentResolver
        val uri = resolver.insert(scopedMediaCollection(isVideo), scopedMediaValues(source.name, mimeType, isVideo, true))
            ?: throw IllegalStateException("Failed to create MediaStore item.")

        try {
            resolver.openOutputStream(uri)?.use { output ->
                source.inputStream().use { input ->
                    input.copyTo(output)
                }
            } ?: throw IllegalStateException("Failed to open MediaStore output stream.")
        } catch (throwable: Throwable) {
            resolver.delete(uri, null, null)
            throw throwable
        }

        publishPendingMediaStoreItem(uri)
        return AlbumSaveResult(uri.toString(), uri.toString())
    }

    private fun scopedMediaCollection(isVideo: Boolean): Uri {
        return if (isVideo) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }
    }

    private fun scopedMediaValues(fileName: String, mimeType: String, isVideo: Boolean, isPending: Boolean): ContentValues {
        val relativePath = if (isVideo) {
            "${Environment.DIRECTORY_MOVIES}/$ALBUM_DIRECTORY_NAME"
        } else {
            "${Environment.DIRECTORY_PICTURES}/$ALBUM_DIRECTORY_NAME"
        }
        return ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
            put(MediaStore.MediaColumns.IS_PENDING, if (isPending) 1 else 0)
        }
    }

    private fun publishPendingMediaStoreItem(uri: Uri) {
        val publishValues = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
        }
        val updatedRows = context.contentResolver.update(uri, publishValues, null, null)
        if (updatedRows <= 0) {
            throw IllegalStateException("Failed to publish MediaStore item.")
        }
    }

    private fun saveMediaToLegacyAlbum(source: File, mimeType: String, isVideo: Boolean): AlbumSaveResult {
        if (needsLegacyAlbumPermission() && !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            throw SecurityException("WRITE_EXTERNAL_STORAGE permission is not granted.")
        }
        val publicDirectory = Environment.getExternalStoragePublicDirectory(
            if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
        )
        val targetDirectory = File(publicDirectory, ALBUM_DIRECTORY_NAME)
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            throw IllegalStateException("Failed to create album directory.")
        }
        val targetFile = File(targetDirectory, source.name)
        if (source.absolutePath != targetFile.absolutePath) {
            source.copyTo(targetFile, overwrite = true)
        }
        MediaScannerConnection.scanFile(context, arrayOf(targetFile.absolutePath), arrayOf(mimeType), null)
        return AlbumSaveResult(targetFile.absolutePath, targetFile.absolutePath)
    }

    private fun createVideoThumbnail(target: VideoOutputTarget): String {
        return try {
            val retriever = MediaMetadataRetriever()
            try {
                target.uri?.let { uri ->
                    retriever.setDataSource(context, uri)
                } ?: target.file?.let { file ->
                    retriever.setDataSource(file.absolutePath)
                } ?: return ""
                val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return ""
                try {
                    val thumbnailFile = File(context.cacheDir, "xyc-markvideo-thumb-${System.currentTimeMillis()}.jpg")
                    FileOutputStream(thumbnailFile).use { output ->
                        frame.compress(Bitmap.CompressFormat.JPEG, 82, output)
                    }
                    thumbnailFile.absolutePath
                } finally {
                    frame.recycle()
                }
            } finally {
                try {
                    retriever.release()
                } catch (_: Throwable) {
                }
            }
        } catch (throwable: Throwable) {
            Log.w(LOG_TAG, "Failed to create video thumbnail.", throwable)
            ""
        }
    }

    private fun shouldShowCenterStatus(text: String): Boolean {
        return text.isNotBlank() &&
            !text.startsWith("焦段：") &&
            !text.startsWith("闪光灯：") &&
            !text.startsWith("提示音已") &&
            text != "闪光灯切换中" &&
            text != "摄像头切换中" &&
            text != "当前设备未暴露广角镜头" &&
            text != "当前设备不支持 2x 焦段" &&
            text != "当前设备不支持该焦段" &&
            text != "当前设备不支持该闪光灯模式" &&
            text != "当前设备不支持闪光灯常亮" &&
            text != "当前设备不支持自动闪光灯" &&
            text != "当前设备不支持切换摄像头" &&
            text != "当前设备不支持前置摄像头" &&
            text != "当前设备不支持后置摄像头" &&
            text != "焦段切换失败" &&
            text != "原生焦段接口不可用" &&
            text != "闪光灯设置失败" &&
            text != "原生闪光灯接口不可用" &&
            text != "前置摄像头" &&
            text != "后置摄像头" &&
            text != "摄像头切换失败" &&
            text != "原生摄像头切换接口不可用" &&
            text != "相机已准备" &&
            text != "拍照完成" &&
            text != "录像完成" &&
            text != "照片已保存到相册" &&
            text != "视频已保存到相册" &&
            text != "照片已生成，相册保存失败" &&
            text != "视频已生成，相册保存失败" &&
            text != "录像中"
    }

    private fun normalizeHapticType(type: String): String {
        return when (type) {
            "medium", "heavy" -> type
            else -> "light"
        }
    }

    private fun ok(data: org.json.JSONObject): String {
        return payload()
            .put("success", true)
            .put("errorCode", "")
            .put("errorMessage", "")
            .put("nativeMessage", "")
            .put("data", data)
            .toString()
    }

    private fun failAndEmit(errorCode: String, errorMessage: String, nativeMessage: String): String {
        emitError(errorCode, errorMessage, nativeMessage)
        return payload()
            .put("success", false)
            .put("errorCode", errorCode)
            .put("errorMessage", errorMessage)
            .put("nativeMessage", nativeMessage)
            .put("data", payload())
            .toString()
    }

    private fun emitError(errorCode: String, errorMessage: String, nativeMessage: String) {
        val data = payload()
            .put("errorCode", errorCode)
            .put("errorMessage", errorMessage)
            .put("nativeMessage", nativeMessage)
        emit("nativeerror", data)
        setStatus(errorMessage)
    }

    private fun payload(): org.json.JSONObject {
        return org.json.JSONObject()
    }

    private fun emit(eventName: String, data: org.json.JSONObject) {
        eventCallback?.invoke(eventName, data.toString())
    }

    private fun requestCameraPermissionIfNeeded(requestCode: Int) {
        if (cameraPermissionRequested) return
        cameraPermissionRequested = true
        cameraPermissionRetryCount = 0
        requestPermissions(arrayOf(Manifest.permission.CAMERA), requestCode)
        scheduleCameraPermissionRetry()
    }

    private fun requestRecordPermissionsIfNeeded(missingPermissions: ArrayList<String>) {
        if (recordPermissionRequested) return
        recordPermissionRequested = true
        recordPermissionRetryCount = 0
        requestPermissions(missingPermissions.toTypedArray(), REQUEST_PREPARE_RECORD_PERMISSIONS)
        scheduleRecordPermissionRetry()
    }

    private fun requestPermissions(permissions: Array<String>, requestCode: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || permissions.isEmpty()) return
        val activity = findActivity(context) ?: return
        activity.requestPermissions(permissions, requestCode)
    }

    private fun scheduleCameraPermissionRetry() {
        val retryRunnable = object : Runnable {
            override fun run() {
                if (!previewReady || camera != null || !cameraPermissionRequested) {
                    return
                }
                if (hasPermission(Manifest.permission.CAMERA)) {
                    cameraPermissionRequested = false
                    cameraPermissionRetryCount = 0
                    openCameraIfReady()
                    return
                }
                cameraPermissionRetryCount += 1
                if (cameraPermissionRetryCount < CAMERA_PERMISSION_RETRY_LIMIT) {
                    scheduleCameraPermissionRetry()
                }
            }
        }
        mainHandler.postDelayed(retryRunnable, CAMERA_PERMISSION_RETRY_DELAY_MS)
    }

    private fun scheduleRecordPermissionRetry() {
        val retryRunnable = object : Runnable {
            override fun run() {
                if (!recordPermissionRequested) {
                    return
                }
                if (recordMissingPermissions().isEmpty()) {
                    recordPermissionRequested = false
                    recordPermissionRetryCount = 0
                    if (previewReady && camera == null && hasPermission(Manifest.permission.CAMERA)) {
                        openCameraIfReady()
                    } else {
                        setStatus("录像权限已准备")
                    }
                    return
                }
                recordPermissionRetryCount += 1
                if (recordPermissionRetryCount < CAMERA_PERMISSION_RETRY_LIMIT) {
                    scheduleRecordPermissionRetry()
                }
            }
        }
        mainHandler.postDelayed(retryRunnable, CAMERA_PERMISSION_RETRY_DELAY_MS)
    }

    private fun hasPermission(permission: String): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun needsLegacyAlbumPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
    }

    private fun recordMissingPermissions(): ArrayList<String> {
        val missingPermissions = ArrayList<String>()
        if (!hasPermission(Manifest.permission.CAMERA)) {
            missingPermissions.add(Manifest.permission.CAMERA)
        }
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            missingPermissions.add(Manifest.permission.RECORD_AUDIO)
        }
        if (needsLegacyAlbumPermission() && !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            missingPermissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        return missingPermissions
    }

    private fun photoMissingPermissions(): ArrayList<String> {
        val missingPermissions = ArrayList<String>()
        if (needsLegacyAlbumPermission() && !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            missingPermissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        return missingPermissions
    }

    private fun recordPermissionMessage(missingPermissions: ArrayList<String>): String {
        val labels = ArrayList<String>()
        if (missingPermissions.contains(Manifest.permission.CAMERA)) {
            labels.add("相机")
        }
        if (missingPermissions.contains(Manifest.permission.RECORD_AUDIO)) {
            labels.add("麦克风")
        }
        if (missingPermissions.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            labels.add("相册")
        }
        return "请授权${labels.joinToString("、")}权限"
    }

    private fun photoPermissionMessage(missingPermissions: ArrayList<String>): String {
        if (missingPermissions.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            return "请授权相册权限"
        }
        return "请完成照片权限授权"
    }

    private fun findActivity(startContext: Context): Activity? {
        var current: Context? = startContext
        while (current is ContextWrapper) {
            if (current is Activity) {
                return current
            }
            current = current.baseContext
        }
        return null
    }

    private fun lockHostActivityToPortrait() {
        val activity = findActivity(context) ?: return
        try {
            if (activity.requestedOrientation != ActivityInfo.SCREEN_ORIENTATION_PORTRAIT) {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
        } catch (throwable: Throwable) {
            Log.w(LOG_TAG, "Failed to lock host activity to portrait.", throwable)
        }
    }

    private fun runOnMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action()
        } else {
            mainHandler.post(action)
        }
    }

    private fun <T> runOnMainSync(action: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return action()
        }

        var result: T? = null
        var error: Throwable? = null
        val latch = CountDownLatch(1)
        mainHandler.post {
            try {
                result = action()
            } catch (throwable: Throwable) {
                error = throwable
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(MAIN_THREAD_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            throw IllegalStateException("Timed out waiting for main thread.")
        }
        error?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private class CameraMp4Recorder(
        private val outputFile: File?,
        private val outputFileDescriptor: ParcelFileDescriptor?,
        val width: Int,
        val height: Int,
        private val fps: Int,
        val bitrate: Int,
        val includeAudio: Boolean = true
    ) {
        private val frameSize = width * height
        private val quarterFrameSize = frameSize / 4
        private val muxerLock = Object()
        private var videoEncoder: MediaCodec? = null
        private var audioEncoder: MediaCodec? = null
        private var audioRecord: AudioRecord? = null
        private var audioThread: Thread? = null
        @Volatile private var audioRunning = false
        private var videoStartedAtNs = 0L
        private var lastVideoPresentationTimeUs = -1L
        private var audioStartedAtNs = 0L
        private var audioCaptureStartedAtNs = 0L
        private var muxer: android.media.MediaMuxer? = null
        private var colorFormat = 0
        private var videoTrackIndex = -1
        private var audioTrackIndex = -1
        private var muxerStarted = false
        private var videoPresentationOffsetUs = -1L
        private var audioPresentationOffsetUs = -1L
        private val reusablePixels = IntArray(frameSize)
        private val reusableYuv = ByteArray(frameSize + quarterFrameSize * 2)
        @Volatile private var lastStage = RECORD_STAGE_RECORDER_IDLE
        @Volatile private var lastFailureStage = ""
        @Volatile private var lastStageError = ""
        var frameCount: Int = 0
            private set
        var videoSampleCount: Int = 0
            private set
        var audioSampleCount: Int = 0
            private set
        var audioPcmPeakAbs: Int = 0
            private set
        var audioReadErrorCount: Int = 0
            private set
        var audioDiscardedReadCount: Int = 0
            private set

        fun start() {
            markStage(RECORD_STAGE_RECORDER_START)
            lastFailureStage = ""
            lastStageError = ""
            muxer = atStage(RECORD_STAGE_MUXER_CREATE) {
                if (outputFileDescriptor != null) {
                    android.media.MediaMuxer(outputFileDescriptor.fileDescriptor, android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                } else {
                    val file = outputFile ?: error("Video output file is null.")
                    android.media.MediaMuxer(file.absolutePath, android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                }
            }
            startVideoEncoder()
            if (includeAudio) {
                startAudioEncoder()
            }
        }

        private fun startVideoEncoder() {
            val codecInfo = atStage(RECORD_STAGE_VIDEO_ENCODER_SELECT) { selectEncoder() }
            colorFormat = atStage(RECORD_STAGE_VIDEO_COLOR_FORMAT) { selectColorFormat(codecInfo) }
            val format = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, colorFormat)
                setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            applyVideoBitrateMode(format, codecInfo)
            videoEncoder = atStage(RECORD_STAGE_VIDEO_ENCODER_START) {
                MediaCodec.createByCodecName(codecInfo.name).apply {
                    configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                    start()
                }
            }
            videoStartedAtNs = 0L
            lastVideoPresentationTimeUs = -1L
        }

        @SuppressLint("MissingPermission")
        private fun startAudioEncoder() {
            markStage(RECORD_STAGE_AUDIO_ENCODER_START)
            val minBufferSize = AudioRecord.getMinBufferSize(
                AUDIO_SAMPLE_RATE,
                AUDIO_CHANNEL_CONFIG,
                AUDIO_PCM_FORMAT
            )
            val recordBufferSize = max(minBufferSize, AUDIO_SAMPLE_RATE / 5)
            val audioFormat = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_AAC,
                AUDIO_SAMPLE_RATE,
                AUDIO_CHANNEL_COUNT
            ).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BIT_RATE)
            }
            audioEncoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply {
                configure(audioFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                AUDIO_SAMPLE_RATE,
                AUDIO_CHANNEL_CONFIG,
                AUDIO_PCM_FORMAT,
                recordBufferSize
            )
            check(audioRecord?.state == AudioRecord.STATE_INITIALIZED) {
                "AudioRecord failed to initialize."
            }
            audioRunning = true
            audioStartedAtNs = System.nanoTime()
            audioThread = Thread({
                encodeAudioLoop(recordBufferSize)
            }, "xyc-markvideo-audio").apply {
                start()
            }
        }

        fun encodeFrame(bitmap: Bitmap): Boolean {
            val activeEncoder = videoEncoder ?: return false
            var encoded = false
            val inputIndex = atStage(RECORD_STAGE_VIDEO_INPUT_BUFFER) {
                activeEncoder.dequeueInputBuffer(TIMEOUT_US)
            }
            if (inputIndex >= 0) {
                val inputBuffer = atStage(RECORD_STAGE_VIDEO_INPUT_BUFFER) {
                    activeEncoder.getInputBuffer(inputIndex)
                } ?: run {
                    lastStageError = "encoder input buffer is null"
                    return false
                }
                atStage(RECORD_STAGE_BITMAP_TO_YUV) {
                    bitmap.getPixels(reusablePixels, 0, width, 0, 0, width, height)
                    argbToYuv420(reusablePixels, reusableYuv)
                }
                atStage(RECORD_STAGE_VIDEO_QUEUE_INPUT) {
                    inputBuffer.clear()
                    inputBuffer.put(reusableYuv)
                    activeEncoder.queueInputBuffer(
                        inputIndex,
                        0,
                        reusableYuv.size,
                        nextVideoPresentationTimeUs(),
                        0
                    )
                }
                frameCount += 1
                encoded = true
            }
            drainVideo(endOfStream = false, stage = RECORD_STAGE_VIDEO_DRAIN)
            return encoded
        }

        fun finish() {
            val deadlineMs = System.currentTimeMillis() + FINISH_TIMEOUT_MS
            markStage(RECORD_STAGE_RECORD_FINISH)
            audioRunning = false
            try {
                audioRecord?.stop()
            } catch (_: Throwable) {
            }
            audioThread?.join(max(1L, deadlineMs - System.currentTimeMillis()))
            if (audioThread?.isAlive == true) {
                throw stageFailure(RECORD_STAGE_AUDIO_THREAD_JOIN, IllegalStateException("Timed out waiting for audio encoder thread."))
            }
            audioThread = null

            val activeEncoder = videoEncoder
            var finishFailure: Throwable? = null
            var stopFailure: Throwable? = null
            try {
                if (activeEncoder != null) {
                    queueVideoEndOfStream(activeEncoder, deadlineMs)
                    drainVideo(endOfStream = true, deadlineMs = deadlineMs, stage = RECORD_STAGE_VIDEO_DRAIN_EOS)
                }
            } catch (throwable: Throwable) {
                finishFailure = throwable
            } finally {
                try {
                    atStage(RECORD_STAGE_VIDEO_ENCODER_STOP) {
                        activeEncoder?.stop()
                    }
                } catch (throwable: Throwable) {
                    stopFailure = throwable
                }
                try {
                    activeEncoder?.release()
                } catch (throwable: Throwable) {
                    if (stopFailure == null) {
                        stopFailure = stageFailure(RECORD_STAGE_VIDEO_ENCODER_RELEASE, throwable)
                    }
                }
                videoEncoder = null
                synchronized(muxerLock) {
                    try {
                        if (muxerStarted && videoSampleCount > 0) {
                            atStage(RECORD_STAGE_MUXER_STOP) {
                                muxer?.stop()
                            }
                        }
                    } catch (throwable: Throwable) {
                        if (stopFailure == null) {
                            stopFailure = throwable
                        }
                    }
                    try {
                        atStage(RECORD_STAGE_MUXER_RELEASE) {
                            muxer?.release()
                        }
                    } catch (throwable: Throwable) {
                        if (stopFailure == null) {
                            stopFailure = throwable
                        }
                    }
                    muxer = null
                    muxerStarted = false
                    videoTrackIndex = -1
                    audioTrackIndex = -1
                }
                finishFailure?.let { throw it }
                stopFailure?.let { throw it }
            }
        }

        private fun queueVideoEndOfStream(activeEncoder: MediaCodec, deadlineMs: Long) {
            val bufferInfo = MediaCodec.BufferInfo()
            while (System.currentTimeMillis() < deadlineMs) {
                val inputIndex = atStage(RECORD_STAGE_VIDEO_EOS) {
                    activeEncoder.dequeueInputBuffer(TIMEOUT_US)
                }
                if (inputIndex >= 0) {
                    atStage(RECORD_STAGE_VIDEO_EOS) {
                        activeEncoder.queueInputBuffer(
                            inputIndex,
                            0,
                            0,
                            lastVideoPresentationTimeUs + 1_000_000L / fps,
                            MediaCodec.BUFFER_FLAG_END_OF_STREAM
                        )
                    }
                    return
                }
                drainVideo(endOfStream = false, deadlineMs = deadlineMs, bufferInfo = bufferInfo, stage = RECORD_STAGE_VIDEO_DRAIN_EOS)
            }
            throw stageFailure(RECORD_STAGE_VIDEO_EOS, IllegalStateException("Timed out waiting for video encoder input buffer."))
        }

        private fun drainVideo(
            endOfStream: Boolean,
            deadlineMs: Long = Long.MAX_VALUE,
            bufferInfo: MediaCodec.BufferInfo = MediaCodec.BufferInfo(),
            stage: String = RECORD_STAGE_VIDEO_DRAIN
        ) {
            val activeEncoder = videoEncoder ?: return
            val activeMuxer = muxer ?: return
            while (System.currentTimeMillis() < deadlineMs) {
                val outputIndex = atStage(stage) {
                    activeEncoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
                }
                when {
                    outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (!endOfStream) return
                    }
                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        videoTrackIndex = addMuxerTrack(activeMuxer, activeEncoder.outputFormat, isAudio = false)
                    }
                    outputIndex >= 0 -> {
                        try {
                            val encodedData = atStage(RECORD_STAGE_VIDEO_OUTPUT_BUFFER) {
                                activeEncoder.getOutputBuffer(outputIndex)
                            } ?: error("Encoder output buffer is null.")
                            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                                bufferInfo.size = 0
                            }
                            if (bufferInfo.size != 0) {
                                encodedData.position(bufferInfo.offset)
                                encodedData.limit(bufferInfo.offset + bufferInfo.size)
                                if (writeMuxerSample(activeMuxer, videoTrackIndex, encodedData, bufferInfo, isAudio = false, RECORD_STAGE_MUXER_WRITE_VIDEO_SAMPLE)) {
                                    videoSampleCount += 1
                                }
                            }
                        } finally {
                            activeEncoder.releaseOutputBuffer(outputIndex, false)
                        }
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            return
                        }
                    }
                }
            }
            if (endOfStream) {
                throw stageFailure(RECORD_STAGE_VIDEO_DRAIN_EOS, IllegalStateException("Timed out waiting for video encoder end of stream."))
            }
        }

        private fun encodeAudioLoop(recordBufferSize: Int) {
            val codec = audioEncoder ?: return
            val recorder = audioRecord ?: return
            val bufferInfo = MediaCodec.BufferInfo()
            val discardBuffer = ByteArray(recordBufferSize)
            try {
                recorder.startRecording()
                while (audioRunning) {
                    if (System.nanoTime() - audioStartedAtNs < RECORD_START_WARMUP_MS * 1_000_000L) {
                        val bytesRead = recorder.read(discardBuffer, 0, discardBuffer.size)
                        if (bytesRead > 0) {
                            audioDiscardedReadCount += 1
                        } else if (bytesRead < 0) {
                            audioReadErrorCount += 1
                        }
                        drainAudio(codec, bufferInfo, endOfStream = false)
                        continue
                    }
                    val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inputIndex >= 0) {
                        val inputBuffer = codec.getInputBuffer(inputIndex) ?: continue
                        inputBuffer.clear()
                        val bytesRead = recorder.read(inputBuffer, min(recordBufferSize, inputBuffer.remaining()))
                        if (bytesRead > 0) {
                            if (audioCaptureStartedAtNs == 0L) {
                                audioCaptureStartedAtNs = System.nanoTime()
                            }
                            updateAudioPeak(inputBuffer, bytesRead)
                            codec.queueInputBuffer(inputIndex, 0, bytesRead, audioPresentationTimeUs(), 0)
                        } else if (bytesRead < 0) {
                            audioReadErrorCount += 1
                        }
                    }
                    drainAudio(codec, bufferInfo, endOfStream = false)
                }
                val deadlineMs = System.currentTimeMillis() + FINISH_TIMEOUT_MS
                queueAudioEndOfStream(codec, bufferInfo, deadlineMs)
                drainAudio(codec, bufferInfo, endOfStream = true, deadlineMs = deadlineMs)
            } finally {
                try {
                    recorder.stop()
                } catch (_: Throwable) {
                }
                try {
                    recorder.release()
                } catch (_: Throwable) {
                }
                try {
                    codec.stop()
                } catch (_: Throwable) {
                }
                codec.release()
                audioRecord = null
                audioEncoder = null
            }
        }

        private fun queueAudioEndOfStream(codec: MediaCodec, bufferInfo: MediaCodec.BufferInfo, deadlineMs: Long) {
            while (System.currentTimeMillis() < deadlineMs) {
                val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    codec.queueInputBuffer(inputIndex, 0, 0, audioPresentationTimeUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    return
                }
                drainAudio(codec, bufferInfo, endOfStream = false, deadlineMs = deadlineMs)
            }
            throw IllegalStateException("Timed out waiting for audio encoder input buffer.")
        }

        private fun drainAudio(
            codec: MediaCodec,
            bufferInfo: MediaCodec.BufferInfo,
            endOfStream: Boolean,
            deadlineMs: Long = Long.MAX_VALUE
        ) {
            val activeMuxer = muxer ?: return
            while (System.currentTimeMillis() < deadlineMs) {
                val outputIndex = codec.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
                when {
                    outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (!endOfStream) return
                    }
                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        audioTrackIndex = addMuxerTrack(activeMuxer, codec.outputFormat, isAudio = true)
                    }
                    outputIndex >= 0 -> {
                        val encodedData = codec.getOutputBuffer(outputIndex)
                            ?: error("Audio encoder output buffer is null.")
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                            bufferInfo.size = 0
                        }
                        if (bufferInfo.size != 0) {
                            encodedData.position(bufferInfo.offset)
                            encodedData.limit(bufferInfo.offset + bufferInfo.size)
                            if (writeMuxerSample(activeMuxer, audioTrackIndex, encodedData, bufferInfo, isAudio = true, RECORD_STAGE_MUXER_WRITE_AUDIO_SAMPLE)) {
                                audioSampleCount += 1
                            }
                        }
                        codec.releaseOutputBuffer(outputIndex, false)
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            return
                        }
                    }
                }
            }
            if (endOfStream) {
                throw IllegalStateException("Timed out waiting for audio encoder end of stream.")
            }
        }

        private fun updateAudioPeak(inputBuffer: java.nio.ByteBuffer, bytesRead: Int) {
            var index = 0
            while (index + 1 < bytesRead) {
                val low = inputBuffer.get(index).toInt() and 0xff
                val high = inputBuffer.get(index + 1).toInt()
                val sample = (high shl 8) or low
                audioPcmPeakAbs = max(audioPcmPeakAbs, abs(sample))
                index += 2
            }
        }

        private fun addMuxerTrack(activeMuxer: android.media.MediaMuxer, format: MediaFormat, isAudio: Boolean): Int {
            synchronized(muxerLock) {
                val index = atStage(RECORD_STAGE_MUXER_ADD_TRACK) {
                    activeMuxer.addTrack(format)
                }
                if (isAudio) {
                    audioTrackIndex = index
                } else {
                    videoTrackIndex = index
                }
                if (!muxerStarted && videoTrackIndex >= 0 && (!includeAudio || audioTrackIndex >= 0)) {
                    atStage(RECORD_STAGE_MUXER_START) {
                        activeMuxer.start()
                    }
                    muxerStarted = true
                }
                return index
            }
        }

        private fun writeMuxerSample(
            activeMuxer: android.media.MediaMuxer,
            trackIndex: Int,
            encodedData: java.nio.ByteBuffer,
            bufferInfo: MediaCodec.BufferInfo,
            isAudio: Boolean,
            stage: String
        ): Boolean {
            synchronized(muxerLock) {
                if (!muxerStarted || trackIndex < 0) return false
                atStage(stage) {
                    val originalPresentationTimeUs = bufferInfo.presentationTimeUs
                    if (isAudio) {
                        if (audioPresentationOffsetUs < 0L) {
                            audioPresentationOffsetUs = originalPresentationTimeUs
                        }
                        bufferInfo.presentationTimeUs = max(0L, originalPresentationTimeUs - audioPresentationOffsetUs)
                    } else {
                        if (videoPresentationOffsetUs < 0L) {
                            videoPresentationOffsetUs = originalPresentationTimeUs
                        }
                        bufferInfo.presentationTimeUs = max(0L, originalPresentationTimeUs - videoPresentationOffsetUs)
                    }
                    try {
                        activeMuxer.writeSampleData(trackIndex, encodedData, bufferInfo)
                    } finally {
                        bufferInfo.presentationTimeUs = originalPresentationTimeUs
                    }
                }
                return true
            }
        }

        private fun argbToYuv420(pixels: IntArray, yuv: ByteArray) {
            val planar = isPlanar(colorFormat)
            var yIndex = 0
            for (row in 0 until height) {
                for (col in 0 until width) {
                    val pixel = pixels[row * width + col]
                    val red = (pixel shr 16) and 0xff
                    val green = (pixel shr 8) and 0xff
                    val blue = pixel and 0xff
                    val y = min(255, max(0, ((66 * red + 129 * green + 25 * blue + 128) shr 8) + 16))
                    val u = min(255, max(0, ((-38 * red - 74 * green + 112 * blue + 128) shr 8) + 128))
                    val v = min(255, max(0, ((112 * red - 94 * green - 18 * blue + 128) shr 8) + 128))
                    yuv[yIndex++] = y.toByte()
                    if (row % 2 == 0 && col % 2 == 0) {
                        val uvIndex = (row / 2) * (width / 2) + (col / 2)
                        if (planar) {
                            yuv[frameSize + uvIndex] = u.toByte()
                            yuv[frameSize + quarterFrameSize + uvIndex] = v.toByte()
                        } else {
                            val offset = frameSize + uvIndex * 2
                            yuv[offset] = u.toByte()
                            yuv[offset + 1] = v.toByte()
                        }
                    }
                }
            }
        }

        private fun nextVideoPresentationTimeUs(): Long {
            val nowNs = System.nanoTime()
            if (videoStartedAtNs == 0L) {
                videoStartedAtNs = nowNs
            }
            val elapsedUs = max(0L, (nowNs - videoStartedAtNs) / 1000L)
            val nextUs = if (lastVideoPresentationTimeUs < 0L) {
                0L
            } else {
                max(lastVideoPresentationTimeUs + 1L, elapsedUs)
            }
            lastVideoPresentationTimeUs = nextUs
            return nextUs
        }

        private fun audioPresentationTimeUs(): Long {
            val startedAtNs = if (audioCaptureStartedAtNs > 0L) audioCaptureStartedAtNs else audioStartedAtNs
            return max(0L, (System.nanoTime() - startedAtNs) / 1000L)
        }

        private fun applyVideoBitrateMode(format: MediaFormat, codecInfo: MediaCodecInfo) {
            try {
                val encoderCapabilities = codecInfo.getCapabilitiesForType(MIME_TYPE).encoderCapabilities
                if (encoderCapabilities.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)) {
                    format.setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
                }
            } catch (_: Throwable) {
            }
        }

        private fun selectEncoder(): MediaCodecInfo {
            return MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { codec ->
                codec.isEncoder && codec.supportedTypes.any { it.equals(MIME_TYPE, ignoreCase = true) }
            } ?: error("No AVC encoder found on this device.")
        }

        private fun selectColorFormat(codecInfo: MediaCodecInfo): Int {
            val supported = codecInfo.getCapabilitiesForType(MIME_TYPE).colorFormats.toSet()
            val preferred = listOf(
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedPlanar,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedSemiPlanar,
                MediaCodecInfo.CodecCapabilities.COLOR_TI_FormatYUV420PackedSemiPlanar
            )
            return preferred.firstOrNull { supported.contains(it) }
                ?: error("No supported YUV420 encoder color format. Formats: ${supported.joinToString()}")
        }

        private fun isPlanar(colorFormat: Int): Boolean {
            return colorFormat == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar ||
                colorFormat == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedPlanar
        }

        fun currentStage(): String {
            return if (lastFailureStage.isBlank()) lastStage else lastFailureStage
        }

        fun diagnostics(stage: String = currentStage()): String {
            val error = if (lastStageError.isBlank()) "none" else lastStageError
            val failureStage = if (lastFailureStage.isBlank()) "none" else lastFailureStage
            return "stage=${stage}; recorderStage=${lastStage}; failureStage=${failureStage}; recorderError=${error}; frames=${frameCount}; videoSamples=${videoSampleCount}; audioEnabled=${includeAudio}; audioSamples=${audioSampleCount}; audioPeak=${audioPcmPeakAbs}; audioReadErrors=${audioReadErrorCount}; audioDiscardReads=${audioDiscardedReadCount}; videoOffsetUs=${videoPresentationOffsetUs}; audioOffsetUs=${audioPresentationOffsetUs}; muxerStarted=${muxerStarted}; videoTrack=${videoTrackIndex}; audioTrack=${audioTrackIndex}; colorFormat=${colorFormat}"
        }

        private fun markStage(stage: String) {
            lastStage = stage
        }

        private inline fun <T> atStage(stage: String, block: () -> T): T {
            markStage(stage)
            return try {
                block()
            } catch (throwable: Throwable) {
                throw stageFailure(stage, throwable)
            }
        }

        private fun stageFailure(stage: String, throwable: Throwable): IllegalStateException {
            val summary = throwable.message ?: throwable.javaClass.simpleName
            lastStage = stage
            if (lastFailureStage.isBlank()) {
                lastFailureStage = stage
                lastStageError = summary
            }
            return IllegalStateException("stage=${stage}; error=${summary}", throwable)
        }
    }

    private data class XycSize(val width: Int, val height: Int)

    private data class PhotoWriteResult(val size: XycSize, val watermarkBurnedIn: Boolean)

    private data class WatermarkOverlay(val bitmap: Bitmap, val dirtyRect: Rect)

    private data class WatermarkOutputTransform(
        val previewWidth: Float,
        val previewHeight: Float,
        val previewToOutputScale: Float,
        val previewOffsetX: Float,
        val previewOffsetY: Float
    )

    private data class VideoOutputTarget(
        val file: File?,
        val uri: Uri?,
        val fileDescriptor: ParcelFileDescriptor?,
        val mimeType: String,
        val isPendingMediaStore: Boolean
    ) {
        fun closeDescriptor() {
            try {
                fileDescriptor?.close()
            } catch (_: Throwable) {
            }
        }

        fun resultPath(): String {
            return uri?.toString() ?: (file?.absolutePath ?: "")
        }

        fun length(context: Context): Long {
            file?.let { return it.length() }
            val targetUri = uri ?: return 0L
            return try {
                context.contentResolver.openFileDescriptor(targetUri, "r")?.use { descriptor ->
                    descriptor.statSize
                } ?: 0L
            } catch (_: Throwable) {
                0L
            }
        }

        fun discard(context: Context) {
            closeDescriptor()
            if (isPendingMediaStore) {
                uri?.let { context.contentResolver.delete(it, null, null) }
            } else {
                file?.delete()
            }
        }
    }

    private data class NativeWatermark(
        val templateId: String,
        val templateName: String,
        val templateType: String,
        val mainTitleText: String,
        val subtitleText: String,
        val mainTitleColor: String,
        val subtitleColor: String,
        val mainTitleFontSize: Float,
        val subtitleFontSize: Float,
        val mainTitleBold: Boolean,
        val subtitleBold: Boolean,
        val imagePath: String,
        val imageWidth: Float,
        val imageHeight: Float,
        val imageTextGap: Float,
        val boxWidth: Float,
        val boxHeight: Float,
        val boxBackgroundColor: String,
        val boxRadius: Float,
        val boxPadding: Float,
        val opacity: Float,
        val positionX: Float,
        val positionY: Float,
        val scale: Float,
        val rotation: Float,
        val previewWidth: Float,
        val previewHeight: Float
    )

    private companion object {
        const val DEFAULT_TARGET_FPS = 30
        const val MAX_CAMERA_SIZE_LONG_EDGE = 1920
        const val MAX_CAMERA_SIZE_PIXELS = 2_073_600
        const val MAX_PHOTO_SIZE_LONG_EDGE = 3000
        const val MAX_PHOTO_SIZE_PIXELS = 6_000_000
        const val CAMERA_FRAME_ASPECT_SHORT_EDGE = 3f
        const val CAMERA_FRAME_ASPECT_LONG_EDGE = 4f
        const val PHOTO_JPEG_QUALITY = 90
        const val MAX_RECORDING_LONG_EDGE = 960
        const val MAX_RECORDING_PIXELS = 691_200
        const val MIN_VIDEO_BITRATE = 12_000_000
        const val MAX_VIDEO_BITRATE = 30_000_000
        const val VIDEO_BITRATE_PIXEL_DIVISOR = 1
        const val RECORD_START_SOUND_GUARD_MS = 180L
        const val RECORD_START_WARMUP_MS = 700L
        const val RECORD_AUDIO_REQUIRED_AFTER_MS = RECORD_START_WARMUP_MS + 500L
        const val WATERMARK_OVERLAY_DIRTY_PADDING_PX = 4
        const val RECORD_AUDIO_ENABLED = true
        const val MIME_TYPE = "video/avc"
        const val AUDIO_SAMPLE_RATE = 44_100
        const val AUDIO_CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_PCM_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        const val AUDIO_CHANNEL_COUNT = 1
        const val AUDIO_BIT_RATE = 64_000
        const val TIMEOUT_US = 10_000L
        const val FINISH_TIMEOUT_MS = 5_000L
        const val FRAME_IDLE_TIMEOUT_MS = 900L
        const val FRAME_IDLE_POLL_MS = 16L
        const val RECORD_STAGE_UNKNOWN = "unknown"
        const val RECORD_STAGE_RECORDER_IDLE = "recorder_idle"
        const val RECORD_STAGE_RECORDER_START = "recorder_start"
        const val RECORD_STAGE_MUXER_CREATE = "muxer_create"
        const val RECORD_STAGE_VIDEO_ENCODER_SELECT = "video_encoder_select"
        const val RECORD_STAGE_VIDEO_COLOR_FORMAT = "video_color_format"
        const val RECORD_STAGE_VIDEO_ENCODER_START = "video_encoder_start"
        const val RECORD_STAGE_AUDIO_ENCODER_START = "audio_encoder_start"
        const val RECORD_STAGE_AUDIO_THREAD_JOIN = "audio_thread_join"
        const val RECORD_STAGE_PREVIEW_COPY = "preview_copy"
        const val RECORD_STAGE_FINAL_PREVIEW_COPY = "final_preview_copy"
        const val RECORD_STAGE_WATERMARK_DRAW = "watermark_draw"
        const val RECORD_STAGE_FINAL_WATERMARK_DRAW = "final_watermark_draw"
        const val RECORD_STAGE_FRAME_UNHANDLED = "frame_unhandled"
        const val RECORD_STAGE_BITMAP_TO_YUV = "bitmap_to_yuv"
        const val RECORD_STAGE_VIDEO_INPUT_BUFFER = "video_input_buffer"
        const val RECORD_STAGE_VIDEO_QUEUE_INPUT = "video_queue_input"
        const val RECORD_STAGE_VIDEO_DRAIN = "video_drain"
        const val RECORD_STAGE_VIDEO_DRAIN_EOS = "video_drain_eos"
        const val RECORD_STAGE_VIDEO_OUTPUT_BUFFER = "video_output_buffer"
        const val RECORD_STAGE_VIDEO_EOS = "video_eos"
        const val RECORD_STAGE_VIDEO_ENCODER_STOP = "video_encoder_stop"
        const val RECORD_STAGE_VIDEO_ENCODER_RELEASE = "video_encoder_release"
        const val RECORD_STAGE_MUXER_ADD_TRACK = "muxer_add_track"
        const val RECORD_STAGE_MUXER_START = "muxer_start"
        const val RECORD_STAGE_MUXER_WRITE_VIDEO_SAMPLE = "muxer_write_video_sample"
        const val RECORD_STAGE_MUXER_WRITE_AUDIO_SAMPLE = "muxer_write_audio_sample"
        const val RECORD_STAGE_MUXER_STOP = "muxer_stop"
        const val RECORD_STAGE_MUXER_RELEASE = "muxer_release"
        const val RECORD_STAGE_VIDEO_VALIDATE = "video_validate"
        const val RECORD_STAGE_RECORD_FINISH = "record_finish"
        const val RECORD_STAGE_RECORD_FINISH_UNHANDLED = "record_finish_unhandled"
        const val RECORD_STAGE_PUBLISH_ALBUM = "publish_album"
        const val RECORD_STAGE_RECORD_DONE = "record_done"
        const val UI_FLASH_OFF = "off"
        const val UI_FLASH_ON = "on"
        const val UI_FLASH_AUTO = "auto"
        const val UI_ZOOM_WIDE = "wide"
        const val UI_ZOOM_1X = "1x"
        const val UI_ZOOM_2X = "2x"
        const val UI_CAMERA_BACK = "back"
        const val UI_CAMERA_FRONT = "front"
        const val REQUEST_CAMERA_PERMISSION = 7201
        const val REQUEST_PREPARE_PHOTO_PERMISSIONS = 7203
        const val REQUEST_PREPARE_PERMISSIONS = 7204
        const val REQUEST_PREPARE_RECORD_PERMISSIONS = 7205
        const val MAIN_THREAD_TIMEOUT_MS = 4_000L
        const val CAMERA_PERMISSION_RETRY_DELAY_MS = 350L
        const val CAMERA_PERMISSION_RETRY_LIMIT = 240
        const val ALBUM_DIRECTORY_NAME = "xyc-markvideo"
        const val LOG_TAG = "XycMarkVideo"
    }

    private data class AlbumSaveResult(val albumPath: String, val albumUri: String, val thumbnailPath: String = "")
}
