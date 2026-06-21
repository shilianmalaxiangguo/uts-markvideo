package uts.xyc.markvideo.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.hardware.Camera
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaScannerConnection
import android.media.MediaRecorder
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.provider.MediaStore
import android.view.Gravity
import android.view.PixelCopy
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
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

class XycNativeCameraView(context: Context) : FrameLayout(context), SurfaceHolder.Callback {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioThread = HandlerThread("xyc-markvideo-io").apply { start() }
    private val ioHandler = Handler(ioThread.looper)
    private val previewView = SurfaceView(context)
    private val statusView = TextView(context)
    private var eventCallback: ((String, String) -> Unit)? = null

    private var camera: Camera? = null
    private var videoRecorder: CameraMp4Recorder? = null
    private var activeCameraId = -1
    private var holderReady = false
    private var currentMode = "photo"
    private var requestedFlashMode = UI_FLASH_OFF
    private var targetFps = DEFAULT_TARGET_FPS
    private var previewSize = XycSize(1280, 720)
    private var videoSize = XycSize(1280, 720)
    private var recording = false
    private var photoBusy = false
    private var recordingStartedAt = 0L
    private var outputFile: File? = null
    private var cameraPermissionRequested = false
    private var cameraPermissionRetryCount = 0
    private var activeWatermark: NativeWatermark? = null
    private var activeWatermarkBitmap: Bitmap? = null
    private var recordingWatermarkSnapshot: NativeWatermark? = null
    private var recordingWatermarkBitmap: Bitmap? = null
    private var recordingVideoBurnIn = false
    private var recordingFrameError = false
    private var videoFrameLoopRunning = false
    private val videoFramePending = AtomicBoolean(false)
    private var reusableVideoFrame: Bitmap? = null
    private val videoFrameRunnable = object : Runnable {
        override fun run() {
            requestNextVideoFrame()
        }
    }

    init {
        setBackgroundColor(Color.BLACK)
        previewView.holder.addCallback(this)
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
        closeCamera()
        ioThread.quitSafely()
        super.onDetachedFromWindow()
    }

    fun setStatus(text: String) {
        runOnMain {
            statusView.text = text
            statusView.visibility = if (shouldShowCenterStatus(text)) View.VISIBLE else View.GONE
        }
    }

    fun setMode(mode: String) {
        currentMode = if (mode == "video") "video" else "photo"
        if (currentMode == "video" && requestedFlashMode == UI_FLASH_AUTO) {
            requestedFlashMode = UI_FLASH_OFF
        }
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

    fun setFlashMode(mode: String): String {
        return runOnMainSync {
            val previousMode = requestedFlashMode
            val normalizedMode = normalizeFlashMode(mode)
            if (currentMode == "video" && normalizedMode == UI_FLASH_AUTO) {
                val data = payload()
                    .put("flashMode", previousMode)
                    .put("requestedFlashMode", normalizedMode)
                    .put("applied", false)
                    .put("message", "视频录像不支持自动闪光")
                emit("flashchange", data)
                return@runOnMainSync ok(data)
            }
            requestedFlashMode = normalizedMode
            val applied = applyFlashModeIfCameraOpen(false)
            if (!applied && requestedFlashMode != UI_FLASH_OFF) {
                requestedFlashMode = previousMode
                applyFlashModeIfCameraOpen(false)
            }
            val data = payload()
                .put("flashMode", requestedFlashMode)
                .put("requestedFlashMode", normalizedMode)
                .put("applied", applied)
                .put("message", if (applied) flashModeMessage(requestedFlashMode) else unsupportedFlashModeMessage(normalizedMode))
            emit("flashchange", data)
            ok(data)
        }
    }

    fun setWatermark(optionsJson: String): String {
        return runOnMainSync {
            if (recording) {
                return@runOnMainSync failAndEmit("1403", "录像中不能编辑水印", "setWatermark while recording")
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
            if (recording) {
                return@runOnMainSync failAndEmit("1403", "录像中不能编辑水印", "clearWatermark while recording")
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

            if (holderReady && camera == null) {
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
                requestPermissions(missingPermissions.toTypedArray(), REQUEST_PREPARE_RECORD_PERMISSIONS)
                return@runOnMainSync failAndEmit(
                    "1003",
                    recordPermissionMessage(missingPermissions),
                    "Missing permissions: ${missingPermissions.joinToString(",")}"
                )
            }
            ok(payload().put("message", "录像权限已准备"))
        }
    }

    fun destroyCamera(): String {
        return runOnMainSync {
            closeCamera()
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
            if (recording) {
                return@runOnMainSync failAndEmit("1403", "录像中不能拍照", "takePhoto while recording")
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
            activeCamera.takePicture(null, null) { data, callbackCamera ->
                val file = File(context.cacheDir, "xyc-markvideo-photo-${System.currentTimeMillis()}.jpg")
                val frozenWatermark = activeWatermark
                val frozenWatermarkBitmap = copyWatermarkBitmap(activeWatermarkBitmap)
                try {
                    callbackCamera.startPreview()
                } catch (_: Throwable) {
                }
                ioHandler.post {
                    try {
                        val photoResult = writePhotoWithWatermark(file, data, frozenWatermark, frozenWatermarkBitmap)
                        val dataPayload = mediaPayload(
                            tempFilePath = file.absolutePath,
                            durationMs = 0L,
                            width = photoResult.size.width,
                            height = photoResult.size.height
                        )
                        appendWatermarkResult(dataPayload, frozenWatermark, photoResult.watermarkBurnedIn, false)
                        var albumError: String? = null
                        try {
                            val albumResult = saveMediaToAlbum(file, "image/jpeg", false)
                            appendAlbumSuccess(dataPayload, albumResult, "照片已保存到相册")
                        } catch (throwable: Throwable) {
                            albumError = throwable.message ?: throwable.javaClass.simpleName
                            appendAlbumFailure(dataPayload, "照片已生成，相册保存失败")
                        }
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
            if (recording) {
                return@runOnMainSync failAndEmit("1403", "当前状态不允许执行该操作", "duplicate startRecord")
            }
            val missingPermissions = recordMissingPermissions()
            if (missingPermissions.isNotEmpty()) {
                requestPermissions(missingPermissions.toTypedArray(), REQUEST_PREPARE_RECORD_PERMISSIONS)
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
            val holder = previewView.holder ?: return@runOnMainSync failAndEmit(
                "1104",
                "相机未就绪",
                "Preview holder is null."
            )
            val recordingFlashError = validateRecordingFlashMode(activeCamera)
            if (recordingFlashError != null) {
                return@runOnMainSync failAndEmit("1102", recordingFlashError, recordingFlashError)
            }
            if (!applyFlashModeIfCameraOpen(false)) {
                return@runOnMainSync failAndEmit("1102", "录像闪光灯设置失败", "录像闪光灯设置失败")
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                return@runOnMainSync failAndEmit("1401", "当前系统不支持水印录像", "PixelCopy requires Android O or newer.")
            }

            val fps = parseFps(optionsJson)
            targetFps = fps
            val file = File(context.cacheDir, "xyc-markvideo-video-${System.currentTimeMillis()}.mp4")
            val frozenWatermark = activeWatermark
            var frozenWatermarkBitmap: Bitmap? = null

            try {
                frozenWatermarkBitmap = copyOrDecodeWatermarkBitmap(frozenWatermark, activeWatermarkBitmap)
                val recordingSize = chooseRecordingOutputSize()
                val recorder = CameraMp4Recorder(
                    output = file,
                    width = recordingSize.width,
                    height = recordingSize.height,
                    fps = targetFps,
                    bitrate = max(1_800_000, recordingSize.width * recordingSize.height * 3)
                )
                recorder.start()
                videoRecorder = recorder
                videoSize = recordingSize

                outputFile = file
                recordingStartedAt = System.currentTimeMillis()
                recording = true
                recordingWatermarkSnapshot = frozenWatermark
                recordingWatermarkBitmap = frozenWatermarkBitmap
                recordingVideoBurnIn = frozenWatermark != null
                recordingFrameError = false
                startVideoFrameLoop()
                setStatus("录像中")
                val startPayload = payload().put("message", "录像中").put("fps", targetFps)
                appendWatermarkResult(startPayload, frozenWatermark, false, recordingVideoBurnIn)
                emit("recordstart", startPayload)
                ok(startPayload)
            } catch (throwable: Throwable) {
                file.delete()
                releaseRecorder()
                recycleBitmap(frozenWatermarkBitmap)
                recordingWatermarkSnapshot = null
                recordingWatermarkBitmap = null
                recordingVideoBurnIn = false
                recordingFrameError = false
                failAndEmit("1401", "录像开始失败", throwable.message ?: throwable.javaClass.simpleName)
            }
        }
    }

    fun stopRecord(): String {
        return runOnMainSync {
            if (!recording) {
                return@runOnMainSync failAndEmit("1403", "当前状态不允许执行该操作", "stopRecord while not recording")
            }
            val recorder = videoRecorder ?: return@runOnMainSync failAndEmit(
                "1402",
                "录像停止失败",
                "CameraMp4Recorder is null."
            )
            val file = outputFile ?: return@runOnMainSync failAndEmit(
                "1402",
                "录像停止失败",
                "Output file is null."
            )

            stopVideoFrameLoop()
            recording = false
            outputFile = null

            val durationMs = max(1L, System.currentTimeMillis() - recordingStartedAt)
            val frozenWatermark = recordingWatermarkSnapshot
            val frozenWatermarkBitmap = recordingWatermarkBitmap
            val requestedVideoBurnIn = recordingVideoBurnIn
            val hadFrameError = recordingFrameError
            val data = mediaPayload(
                tempFilePath = file.absolutePath,
                durationMs = durationMs,
                width = videoSize.width,
                height = videoSize.height
            )
                .put("fps", targetFps)
            appendWatermarkResult(data, frozenWatermark, false, requestedVideoBurnIn)
            recordingWatermarkSnapshot = null
            recordingWatermarkBitmap = null
            recordingVideoBurnIn = false
            recordingFrameError = false
            releaseRecorder()
            val pendingData = org.json.JSONObject(data.toString())
                .put("savedToAlbum", false)
                .put("albumPath", "")
                .put("albumUri", "")
                .put("message", "视频保存中")
            ioHandler.post {
                var albumError: String? = null
                var stopError: String? = null
                try {
                    recorder.finish()
                } catch (throwable: Throwable) {
                    stopError = throwable.message ?: throwable.javaClass.simpleName
                }
                if (stopError != null) {
                    file.delete()
                    recycleBitmap(frozenWatermarkBitmap)
                    runOnMain {
                        failAndEmit("1402", "录像停止失败", stopError ?: "finish failed")
                    }
                } else {
                    val finalVideoBurnIn = requestedVideoBurnIn && !hadFrameError && recorder.frameCount > 0
                    data.put("watermarkVideoBurnIn", finalVideoBurnIn)
                    try {
                        val albumResult = saveMediaToAlbum(file, "video/mp4", true)
                        appendAlbumSuccess(data, albumResult, "视频已保存到相册")
                    } catch (throwable: Throwable) {
                        albumError = throwable.message ?: throwable.javaClass.simpleName
                        appendAlbumFailure(data, "视频已生成，相册保存失败")
                    }
                    runOnMain {
                        albumError?.let { nativeMessage ->
                            emitError("1501", "视频已生成，相册保存失败", nativeMessage)
                        }
                        setStatus(data.optString("message", "视频已生成"))
                        emit("recorddone", data)
                    }
                    recycleBitmap(frozenWatermarkBitmap)
                }
            }
            setStatus("视频保存中")
            ok(pendingData)
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        holderReady = true
        openCameraIfReady()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        holderReady = true
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        holderReady = false
        closeCamera()
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (hasWindowFocus && holderReady && camera == null && hasPermission(Manifest.permission.CAMERA)) {
            cameraPermissionRequested = false
            openCameraIfReady()
        }
    }

    private fun openCameraIfReady(): String {
        if (!holderReady) {
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
            activeCameraId = findBackCameraId()
            val activeCamera = Camera.open(activeCameraId)
            activeCamera.setDisplayOrientation(resolveCameraRotationDegrees(activeCameraId))
            applyCameraParameters(activeCamera)
            activeCamera.setPreviewDisplay(previewView.holder)
            activeCamera.startPreview()
            camera = activeCamera
            setStatus("相机已准备")
            emit("cameraready", cameraReadyPayload())
            ok(cameraReadyPayload())
        } catch (throwable: Throwable) {
            closeCamera()
            failAndEmit("1101", "相机设备不可用", throwable.message ?: throwable.javaClass.simpleName)
        }
    }

    private fun applyCameraParameters(activeCamera: Camera) {
        val parameters = activeCamera.parameters
        val selectedPreviewSize = chooseSize(parameters.supportedPreviewSizes)
        previewSize = XycSize(selectedPreviewSize.width, selectedPreviewSize.height)
        videoSize = chooseVideoSize(parameters)

        parameters.setPreviewSize(previewSize.width, previewSize.height)
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
        applyFlashModeToParameters(parameters, false)
        activeCamera.parameters = parameters
    }

    private fun applyFlashModeIfCameraOpen(failIfUnsupported: Boolean): Boolean {
        val activeCamera = camera ?: return requestedFlashMode == UI_FLASH_OFF
        return try {
            val parameters = activeCamera.parameters
            if (applyFlashModeToParameters(parameters, failIfUnsupported)) {
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
        return when (requestedFlashMode) {
            UI_FLASH_ON -> {
                val preferredMode = if (currentMode == "video") {
                    Camera.Parameters.FLASH_MODE_TORCH
                } else {
                    Camera.Parameters.FLASH_MODE_ON
                }
                when {
                    supportedModes.contains(preferredMode) -> preferredMode
                    currentMode != "video" && supportedModes.contains(Camera.Parameters.FLASH_MODE_TORCH) ->
                        Camera.Parameters.FLASH_MODE_TORCH
                    else -> null
                }
            }
            UI_FLASH_AUTO -> {
                if (currentMode != "video" && supportedModes.contains(Camera.Parameters.FLASH_MODE_AUTO)) {
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

    private fun flashModeMessage(mode: String): String {
        return when (mode) {
            UI_FLASH_ON -> "闪光灯：开"
            UI_FLASH_AUTO -> "闪光灯：自动"
            else -> "闪光灯：关"
        }
    }

    private fun unsupportedFlashModeMessage(mode: String): String {
        return when (mode) {
            UI_FLASH_ON -> "当前设备不支持闪光灯常亮"
            UI_FLASH_AUTO -> "当前设备不支持自动闪光灯"
            else -> "闪光灯：关"
        }
    }

    private fun validateRecordingFlashMode(activeCamera: Camera): String? {
        if (requestedFlashMode == UI_FLASH_OFF) {
            return null
        }
        if (requestedFlashMode == UI_FLASH_AUTO) {
            return "视频录像不支持自动闪光"
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

    private fun applyCaptureOrientation(activeCamera: Camera) {
        val parameters = activeCamera.parameters
        parameters.setRotation(resolveCameraRotationDegrees(activeCameraId))
        activeCamera.parameters = parameters
    }

    private fun applyCaptureFlashMode(activeCamera: Camera) {
        val parameters = activeCamera.parameters
        if (applyFlashModeToParameters(parameters, false)) {
            activeCamera.parameters = parameters
        }
    }

    private fun resolveCameraRotationDegrees(cameraId: Int): Int {
        val info = Camera.CameraInfo()
        Camera.getCameraInfo(cameraId, info)
        val displayRotationDegrees = currentDisplayRotationDegrees()
        return if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            (info.orientation - displayRotationDegrees + 360) % 360
        } else {
            (info.orientation + displayRotationDegrees) % 360
        }
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

    private fun stopVideoFrameLoop() {
        videoFrameLoopRunning = false
        videoFramePending.set(false)
        mainHandler.removeCallbacks(videoFrameRunnable)
    }

    private fun requestNextVideoFrame() {
        val recorder = videoRecorder ?: return
        if (!recording || !videoFrameLoopRunning) {
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            failAndEmit("1401", "当前系统不支持水印录像", "PixelCopy requires Android O or newer.")
            return
        }
        if (!videoFramePending.compareAndSet(false, true)) {
            return
        }

        val frameStartedAt = System.currentTimeMillis()
        val targetBitmap = reusableVideoFrame?.takeIf {
            !it.isRecycled && it.width == recorder.width && it.height == recorder.height
        } ?: Bitmap.createBitmap(recorder.width, recorder.height, Bitmap.Config.ARGB_8888).also {
            reusableVideoFrame?.recycle()
            reusableVideoFrame = it
        }

        try {
            val copyListener = object : PixelCopy.OnPixelCopyFinishedListener {
                override fun onPixelCopyFinished(copyResult: Int) {
                    if (copyResult != PixelCopy.SUCCESS) {
                        videoFramePending.set(false)
                        scheduleNextVideoFrame(frameStartedAt)
                        return
                    }
                    if (!recording || !videoFrameLoopRunning) {
                        videoFramePending.set(false)
                        return
                    }
                    ioHandler.post {
                        try {
                            val watermark = recordingWatermarkSnapshot
                            if (watermark != null) {
                                val burnedIn = drawWatermarkOnPhoto(
                                    Canvas(targetBitmap),
                                    targetBitmap.width,
                                    targetBitmap.height,
                                    watermark,
                                    recordingWatermarkBitmap
                                )
                                if (!burnedIn) {
                                    throw IllegalStateException("水印内容不可绘制")
                                }
                            }
                            if (!recorder.encodeFrame(targetBitmap)) {
                                throw IllegalStateException("视频帧编码未写入")
                            }
                        } catch (throwable: Throwable) {
                            recordingFrameError = true
                            runOnMain {
                                emitError("1402", "录像帧编码失败", throwable.message ?: throwable.javaClass.simpleName)
                            }
                        } finally {
                            videoFramePending.set(false)
                            scheduleNextVideoFrame(frameStartedAt)
                        }
                    }
                }
            }
            PixelCopy.request(previewView, targetBitmap, copyListener, mainHandler)
        } catch (throwable: Throwable) {
            videoFramePending.set(false)
            failAndEmit("1402", "录像帧复制失败", throwable.message ?: throwable.javaClass.simpleName)
            scheduleNextVideoFrame(frameStartedAt)
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

    private fun closeCamera() {
        if (recording) {
            stopVideoFrameLoop()
            try {
                videoRecorder?.finish()
            } catch (_: Throwable) {
            }
        }
        releaseRecorder()
        outputFile = null
        recording = false
        photoBusy = false
        recordingWatermarkSnapshot = null
        recycleBitmap(recordingWatermarkBitmap)
        recordingWatermarkBitmap = null
        recordingVideoBurnIn = false
        recordingFrameError = false
        recycleBitmap(activeWatermarkBitmap)
        activeWatermarkBitmap = null
        reusableVideoFrame?.recycle()
        reusableVideoFrame = null
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
        videoFramePending.set(false)
    }

    private fun findBackCameraId(): Int {
        val info = Camera.CameraInfo()
        for (cameraIndex in 0 until Camera.getNumberOfCameras()) {
            Camera.getCameraInfo(cameraIndex, info)
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) {
                return cameraIndex
            }
        }
        return 0
    }

    private fun chooseSize(sizes: List<Camera.Size>?): Camera.Size {
        val available = sizes ?: emptyList()
        return available
            .filter { it.width <= 1280 && it.height <= 720 }
            .maxByOrNull { it.width * it.height }
            ?: available.maxByOrNull { it.width * it.height }
            ?: error("No camera size is available.")
    }

    private fun chooseVideoSize(parameters: Camera.Parameters): XycSize {
        val videoSizes = parameters.supportedVideoSizes ?: parameters.supportedPreviewSizes
        val selected = chooseSize(videoSizes)
        return XycSize(selected.width, selected.height)
    }

    private fun chooseRecordingOutputSize(): XycSize {
        val sourceWidth = previewView.width.takeIf { it > 0 } ?: previewSize.width
        val sourceHeight = previewView.height.takeIf { it > 0 } ?: previewSize.height
        val longEdgeScale = MAX_RECORDING_LONG_EDGE.toDouble() / max(sourceWidth, sourceHeight).toDouble()
        val pixelScale = sqrt(MAX_RECORDING_PIXELS.toDouble() / (sourceWidth * sourceHeight).toDouble())
        val scale = min(1.0, min(longEdgeScale, pixelScale))
        return XycSize(
            width = evenDimension((sourceWidth * scale).toInt()),
            height = evenDimension((sourceHeight * scale).toInt())
        )
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
        return decodeWatermarkBitmap(watermark.imagePath)
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

    private fun writePhotoWithWatermark(
        file: File,
        data: ByteArray,
        watermark: NativeWatermark?,
        watermarkBitmap: Bitmap?
    ): PhotoWriteResult {
        if (watermark == null) {
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
        val sourceBitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
            ?: throw IllegalStateException("Unable to decode captured JPEG.")
        val orientedBitmap = applyExifOrientation(sourceBitmap, readExifRotationDegrees(file))
        val outputBitmap = orientedBitmap.copy(Bitmap.Config.ARGB_8888, true)
        val burnedIn = drawWatermarkOnPhoto(Canvas(outputBitmap), outputBitmap.width, outputBitmap.height, watermark, watermarkBitmap)
        if (!burnedIn) {
            if (outputBitmap != orientedBitmap) {
                outputBitmap.recycle()
            }
            if (orientedBitmap != sourceBitmap) {
                orientedBitmap.recycle()
            }
            sourceBitmap.recycle()
            throw IllegalStateException("水印内容不可绘制")
        }
        FileOutputStream(file).use { output ->
            outputBitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)
        }
        val resultSize = XycSize(outputBitmap.width, outputBitmap.height)
        if (outputBitmap != orientedBitmap) {
            outputBitmap.recycle()
        }
        if (orientedBitmap != sourceBitmap) {
            orientedBitmap.recycle()
        }
        sourceBitmap.recycle()
        return PhotoWriteResult(
            size = resultSize,
            watermarkBurnedIn = burnedIn
        )
    }

    private fun drawWatermarkOnPhoto(
        canvas: Canvas,
        outputWidth: Int,
        outputHeight: Int,
        watermark: NativeWatermark,
        cachedImageBitmap: Bitmap?
    ): Boolean {
        val scale = min(outputWidth / watermark.previewWidth, outputHeight / watermark.previewHeight)
        val boxWidth = outputWidth * watermark.boxWidth * watermark.scale
        val boxHeight = outputHeight * watermark.boxHeight * watermark.scale
        val left = (outputWidth * watermark.positionX).coerceIn(0f, max(0f, outputWidth - boxWidth))
        val top = (outputHeight * watermark.positionY).coerceIn(0f, max(0f, outputHeight - boxHeight))
        val rect = RectF(left, top, left + boxWidth, top + boxHeight)
        val centerX = rect.centerX()
        val centerY = rect.centerY()

        canvas.save()
        canvas.rotate(watermark.rotation, centerX, centerY)

        val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        backgroundPaint.color = parseWatermarkColor(watermark.boxBackgroundColor, Color.argb(150, 22, 24, 26), watermark.opacity)
        canvas.drawRoundRect(rect, watermark.boxRadius * scale, watermark.boxRadius * scale, backgroundPaint)

        val padding = watermark.boxPadding * scale
        val imageWidth = watermark.imageWidth * scale
        val imageHeight = watermark.imageHeight * scale
        val gap = watermark.imageTextGap * scale
        var contentLeft = rect.left + padding
        val contentTop = rect.top + padding
        val contentBottom = rect.bottom - padding
        val imageBitmap = cachedImageBitmap ?: decodeWatermarkBitmap(watermark.imagePath)
        val shouldRecycleImageBitmap = cachedImageBitmap == null && imageBitmap != null
        var drewContent = false
        if (watermarkRequiresImage(watermark) && imageBitmap == null) {
            canvas.restore()
            return false
        }

        if (imageBitmap != null && imageWidth > 0f && imageHeight > 0f) {
            val imageTop = contentTop + max(0f, (contentBottom - contentTop - imageHeight) / 2f)
            val imageRect = RectF(contentLeft, imageTop, contentLeft + imageWidth, imageTop + imageHeight)
            canvas.drawBitmap(imageBitmap, null, imageRect, Paint(Paint.ANTI_ALIAS_FLAG))
            contentLeft += imageWidth + gap
            drewContent = true
            if (shouldRecycleImageBitmap) {
                imageBitmap.recycle()
            }
        }

        val textMaxWidth = rect.right - padding - contentLeft
        val hasTitle = watermark.mainTitleText.isNotBlank()
        val hasSubtitle = watermark.subtitleText.isNotBlank()
        if (textMaxWidth > 0f && (hasTitle || hasSubtitle)) {
            val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG)
            titlePaint.color = parseWatermarkColor(watermark.mainTitleColor, Color.WHITE, 1f)
            titlePaint.textSize = watermark.mainTitleFontSize * scale
            titlePaint.typeface = if (watermark.mainTitleBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT

            val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG)
            subtitlePaint.color = parseWatermarkColor(watermark.subtitleColor, Color.argb(220, 255, 255, 255), 1f)
            subtitlePaint.textSize = watermark.subtitleFontSize * scale
            subtitlePaint.typeface = if (watermark.subtitleBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT

            val titleHeight = if (hasTitle) titlePaint.fontMetrics.let { it.descent - it.ascent } else 0f
            val subtitleHeight = if (hasSubtitle) subtitlePaint.fontMetrics.let { it.descent - it.ascent } else 0f
            val textGap = if (hasTitle && hasSubtitle) 5f * scale else 0f
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

        if (shouldRecycleImageBitmap && imageBitmap != null && !imageBitmap.isRecycled) {
            imageBitmap.recycle()
        }
        canvas.restore()
        return drewContent
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

    private fun decodeWatermarkBitmap(path: String): Bitmap? {
        if (path.isBlank()) {
            return null
        }
        val normalizedPath = path.removePrefix("file://")
        val directFile = File(normalizedPath)
        if (directFile.exists() && directFile.isFile) {
            return BitmapFactory.decodeFile(directFile.absolutePath)
        }
        if (normalizedPath.startsWith("/static/")) {
            val relativePath = normalizedPath.removePrefix("/")
            val roots = arrayListOf<File>()
            roots.add(File(context.applicationInfo.dataDir, "apps"))
            roots.add(File(context.applicationInfo.dataDir, "www"))
            context.cacheDir.parentFile?.let { roots.add(File(it, "apps")) }
            for (root in roots) {
                if (!root.exists()) {
                    continue
                }
                val matchedFile = root.walkTopDown()
                    .maxDepth(5)
                    .firstOrNull { it.isFile && it.path.endsWith(relativePath) }
                if (matchedFile != null) {
                    return BitmapFactory.decodeFile(matchedFile.absolutePath)
                }
            }
        }
        return null
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
            .put("fps", targetFps)
            .put("previewWidth", previewSize.width)
            .put("previewHeight", previewSize.height)
            .put("videoWidth", videoSize.width)
            .put("videoHeight", videoSize.height)
    }

    private fun mediaPayload(tempFilePath: String, durationMs: Long, width: Int, height: Int): org.json.JSONObject {
        return payload()
            .put("tempFilePath", tempFilePath)
            .put("path", tempFilePath)
            .put("durationMs", durationMs)
            .put("width", width)
            .put("height", height)
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

    private fun appendAlbumSuccess(data: org.json.JSONObject, albumResult: AlbumSaveResult, message: String): org.json.JSONObject {
        return data
            .put("savedToAlbum", true)
            .put("albumPath", albumResult.albumPath)
            .put("albumUri", albumResult.albumUri)
            .put("message", message)
    }

    private fun appendAlbumFailure(data: org.json.JSONObject, message: String): org.json.JSONObject {
        return data
            .put("savedToAlbum", false)
            .put("albumPath", "")
            .put("albumUri", "")
            .put("message", message)
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
        val collection = if (isVideo) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }
        val relativePath = if (isVideo) {
            "${Environment.DIRECTORY_MOVIES}/$ALBUM_DIRECTORY_NAME"
        } else {
            "${Environment.DIRECTORY_PICTURES}/$ALBUM_DIRECTORY_NAME"
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, source.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values)
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

        val publishValues = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
        }
        resolver.update(uri, publishValues, null, null)
        return AlbumSaveResult(uri.toString(), uri.toString())
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
        source.copyTo(targetFile, overwrite = true)
        MediaScannerConnection.scanFile(context, arrayOf(targetFile.absolutePath), arrayOf(mimeType), null)
        return AlbumSaveResult(targetFile.absolutePath, targetFile.absolutePath)
    }

    private fun shouldShowCenterStatus(text: String): Boolean {
        return text != "相机已准备" &&
            text != "拍照完成" &&
            text != "录像完成" &&
            text != "照片已保存到相册" &&
            text != "视频已保存到相册" &&
            text != "照片已生成，相册保存失败" &&
            text != "视频已生成，相册保存失败" &&
            text != "录像中"
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

    private fun requestPermissions(permissions: Array<String>, requestCode: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || permissions.isEmpty()) return
        val activity = findActivity(context) ?: return
        activity.requestPermissions(permissions, requestCode)
    }

    private fun scheduleCameraPermissionRetry() {
        val retryRunnable = object : Runnable {
            override fun run() {
                if (!holderReady || camera != null || !cameraPermissionRequested) {
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
        private val output: File,
        val width: Int,
        val height: Int,
        private val fps: Int,
        private val bitrate: Int,
        private val includeAudio: Boolean = true
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
        private var lastVideoPresentationTimeUs = 0L
        private var audioStartedAtNs = 0L
        private var muxer: android.media.MediaMuxer? = null
        private var colorFormat = 0
        private var videoTrackIndex = -1
        private var audioTrackIndex = -1
        private var muxerStarted = false
        private val reusablePixels = IntArray(frameSize)
        private val reusableYuv = ByteArray(frameSize + quarterFrameSize * 2)
        var frameCount: Int = 0
            private set

        fun start() {
            muxer = android.media.MediaMuxer(output.absolutePath, android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            startVideoEncoder()
            if (includeAudio) {
                startAudioEncoder()
            }
        }

        private fun startVideoEncoder() {
            val codecInfo = selectEncoder()
            colorFormat = selectColorFormat(codecInfo)
            val format = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, colorFormat)
                setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            videoEncoder = MediaCodec.createByCodecName(codecInfo.name).apply {
                configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
            videoStartedAtNs = System.nanoTime()
            lastVideoPresentationTimeUs = 0L
        }

        @SuppressLint("MissingPermission")
        private fun startAudioEncoder() {
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
            val inputIndex = activeEncoder.dequeueInputBuffer(TIMEOUT_US)
            if (inputIndex >= 0) {
                val inputBuffer = activeEncoder.getInputBuffer(inputIndex) ?: return false
                bitmap.getPixels(reusablePixels, 0, width, 0, 0, width, height)
                argbToYuv420(reusablePixels, reusableYuv)
                inputBuffer.clear()
                inputBuffer.put(reusableYuv)
                activeEncoder.queueInputBuffer(
                    inputIndex,
                    0,
                    reusableYuv.size,
                    nextVideoPresentationTimeUs(),
                    0
                )
                frameCount += 1
                encoded = true
            }
            drainVideo(endOfStream = false)
            return encoded
        }

        fun finish() {
            val deadlineMs = System.currentTimeMillis() + FINISH_TIMEOUT_MS
            audioRunning = false
            try {
                audioRecord?.stop()
            } catch (_: Throwable) {
            }
            audioThread?.join(max(1L, min(1500L, deadlineMs - System.currentTimeMillis())))
            audioThread = null

            val activeEncoder = videoEncoder
            try {
                if (activeEncoder != null) {
                    queueVideoEndOfStream(activeEncoder, deadlineMs)
                    drainVideo(endOfStream = true, deadlineMs = deadlineMs)
                }
            } finally {
                try {
                    activeEncoder?.stop()
                } catch (_: Throwable) {
                }
                activeEncoder?.release()
                videoEncoder = null
                synchronized(muxerLock) {
                    try {
                        muxer?.release()
                    } catch (_: Throwable) {
                    }
                    muxer = null
                    muxerStarted = false
                    videoTrackIndex = -1
                    audioTrackIndex = -1
                }
            }
        }

        private fun queueVideoEndOfStream(activeEncoder: MediaCodec, deadlineMs: Long) {
            val bufferInfo = MediaCodec.BufferInfo()
            while (System.currentTimeMillis() < deadlineMs) {
                val inputIndex = activeEncoder.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    activeEncoder.queueInputBuffer(
                        inputIndex,
                        0,
                        0,
                        lastVideoPresentationTimeUs + 1_000_000L / fps,
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM
                    )
                    return
                }
                drainVideo(endOfStream = false, deadlineMs = deadlineMs, bufferInfo = bufferInfo)
            }
            throw IllegalStateException("Timed out waiting for video encoder input buffer.")
        }

        private fun drainVideo(
            endOfStream: Boolean,
            deadlineMs: Long = Long.MAX_VALUE,
            bufferInfo: MediaCodec.BufferInfo = MediaCodec.BufferInfo()
        ) {
            val activeEncoder = videoEncoder ?: return
            val activeMuxer = muxer ?: return
            while (System.currentTimeMillis() < deadlineMs) {
                val outputIndex = activeEncoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
                when {
                    outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (!endOfStream) return
                    }
                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        videoTrackIndex = addMuxerTrack(activeMuxer, activeEncoder.outputFormat, isAudio = false)
                    }
                    outputIndex >= 0 -> {
                        val encodedData = activeEncoder.getOutputBuffer(outputIndex)
                            ?: error("Encoder output buffer is null.")
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                            bufferInfo.size = 0
                        }
                        if (bufferInfo.size != 0) {
                            encodedData.position(bufferInfo.offset)
                            encodedData.limit(bufferInfo.offset + bufferInfo.size)
                            writeMuxerSample(activeMuxer, videoTrackIndex, encodedData, bufferInfo)
                        }
                        activeEncoder.releaseOutputBuffer(outputIndex, false)
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            return
                        }
                    }
                }
            }
            if (endOfStream) {
                throw IllegalStateException("Timed out waiting for video encoder end of stream.")
            }
        }

        private fun encodeAudioLoop(recordBufferSize: Int) {
            val codec = audioEncoder ?: return
            val recorder = audioRecord ?: return
            val bufferInfo = MediaCodec.BufferInfo()
            try {
                recorder.startRecording()
                while (audioRunning) {
                    val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inputIndex >= 0) {
                        val inputBuffer = codec.getInputBuffer(inputIndex) ?: continue
                        inputBuffer.clear()
                        val bytesRead = recorder.read(inputBuffer, min(recordBufferSize, inputBuffer.remaining()))
                        if (bytesRead > 0) {
                            codec.queueInputBuffer(inputIndex, 0, bytesRead, audioPresentationTimeUs(), 0)
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
                            writeMuxerSample(activeMuxer, audioTrackIndex, encodedData, bufferInfo)
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

        private fun addMuxerTrack(activeMuxer: android.media.MediaMuxer, format: MediaFormat, isAudio: Boolean): Int {
            synchronized(muxerLock) {
                val index = activeMuxer.addTrack(format)
                if (isAudio) {
                    audioTrackIndex = index
                } else {
                    videoTrackIndex = index
                }
                if (!muxerStarted && videoTrackIndex >= 0 && (!includeAudio || audioTrackIndex >= 0)) {
                    activeMuxer.start()
                    muxerStarted = true
                }
                return index
            }
        }

        private fun writeMuxerSample(
            activeMuxer: android.media.MediaMuxer,
            trackIndex: Int,
            encodedData: java.nio.ByteBuffer,
            bufferInfo: MediaCodec.BufferInfo
        ) {
            synchronized(muxerLock) {
                if (!muxerStarted || trackIndex < 0) return
                activeMuxer.writeSampleData(trackIndex, encodedData, bufferInfo)
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
            val elapsedUs = max(0L, (System.nanoTime() - videoStartedAtNs) / 1000L)
            val nextUs = max(lastVideoPresentationTimeUs + 1L, elapsedUs)
            lastVideoPresentationTimeUs = nextUs
            return nextUs
        }

        private fun audioPresentationTimeUs(): Long {
            return max(0L, (System.nanoTime() - audioStartedAtNs) / 1000L)
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
    }

    private data class XycSize(val width: Int, val height: Int)

    private data class PhotoWriteResult(val size: XycSize, val watermarkBurnedIn: Boolean)

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
        const val MAX_RECORDING_LONG_EDGE = 1280
        const val MAX_RECORDING_PIXELS = 921_600
        const val MIME_TYPE = "video/avc"
        const val AUDIO_SAMPLE_RATE = 44_100
        const val AUDIO_CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_PCM_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        const val AUDIO_CHANNEL_COUNT = 1
        const val AUDIO_BIT_RATE = 64_000
        const val TIMEOUT_US = 10_000L
        const val FINISH_TIMEOUT_MS = 5_000L
        const val UI_FLASH_OFF = "off"
        const val UI_FLASH_ON = "on"
        const val UI_FLASH_AUTO = "auto"
        const val REQUEST_CAMERA_PERMISSION = 7201
        const val REQUEST_PREPARE_PHOTO_PERMISSIONS = 7203
        const val REQUEST_PREPARE_PERMISSIONS = 7204
        const val REQUEST_PREPARE_RECORD_PERMISSIONS = 7205
        const val MAIN_THREAD_TIMEOUT_MS = 4_000L
        const val CAMERA_PERMISSION_RETRY_DELAY_MS = 350L
        const val CAMERA_PERMISSION_RETRY_LIMIT = 240
        const val ALBUM_DIRECTORY_NAME = "xyc-markvideo"
    }

    private data class AlbumSaveResult(val albumPath: String, val albumUri: String)
}
