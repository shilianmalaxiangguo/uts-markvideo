package uts.xyc.markvideo.android

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.Camera
import android.media.MediaScannerConnection
import android.media.MediaRecorder
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.Gravity
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

class XycNativeCameraView(context: Context) : FrameLayout(context), SurfaceHolder.Callback {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val previewView = SurfaceView(context)
    private val statusView = TextView(context)
    private var eventCallback: ((String, String) -> Unit)? = null

    private var camera: Camera? = null
    private var mediaRecorder: MediaRecorder? = null
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
                try {
                    file.writeBytes(data)
                    val dataPayload = mediaPayload(
                        tempFilePath = file.absolutePath,
                        durationMs = 0L,
                        width = previewSize.width,
                        height = previewSize.height
                    )
                    try {
                        val albumResult = saveMediaToAlbum(file, "image/jpeg", false)
                        appendAlbumSuccess(dataPayload, albumResult, "照片已保存到相册")
                    } catch (throwable: Throwable) {
                        appendAlbumFailure(dataPayload, "照片已生成，相册保存失败")
                        emitError("1501", "照片已生成，相册保存失败", throwable.message ?: throwable.javaClass.simpleName)
                    }
                    emit("photodone", dataPayload)
                    setStatus(dataPayload.optString("message", "照片已生成"))
                } catch (throwable: Throwable) {
                    failAndEmit("1301", "拍照失败", throwable.message ?: throwable.javaClass.simpleName)
                } finally {
                    photoBusy = false
                    try {
                        callbackCamera.startPreview()
                    } catch (_: Throwable) {
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

            val fps = parseFps(optionsJson)
            targetFps = fps
            val file = File(context.cacheDir, "xyc-markvideo-video-${System.currentTimeMillis()}.mp4")

            try {
                activeCamera.stopPreview()
            } catch (_: Throwable) {
            }

            try {
                activeCamera.unlock()
                val recorder = MediaRecorder()
                mediaRecorder = recorder
                recorder.setCamera(activeCamera)
                recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                recorder.setVideoSource(MediaRecorder.VideoSource.CAMERA)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                recorder.setVideoSize(videoSize.width, videoSize.height)
                recorder.setVideoFrameRate(targetFps)
                recorder.setVideoEncodingBitRate(max(1_800_000, videoSize.width * videoSize.height * 4))
                recorder.setAudioEncodingBitRate(64_000)
                recorder.setAudioSamplingRate(44_100)
                recorder.setOrientationHint(resolveCameraRotationDegrees(activeCameraId))
                recorder.setPreviewDisplay(holder.surface)
                recorder.setOutputFile(file.absolutePath)
                recorder.prepare()
                recorder.start()

                outputFile = file
                recordingStartedAt = System.currentTimeMillis()
                recording = true
                setStatus("录像中")
                emit("recordstart", payload().put("message", "录像中").put("fps", targetFps))
                ok(payload().put("fps", targetFps))
            } catch (throwable: Throwable) {
                file.delete()
                releaseRecorder()
                try {
                    activeCamera.lock()
                    activeCamera.setPreviewDisplay(holder)
                    activeCamera.startPreview()
                } catch (_: Throwable) {
                }
                failAndEmit("1401", "录像开始失败", throwable.message ?: throwable.javaClass.simpleName)
            }
        }
    }

    fun stopRecord(): String {
        return runOnMainSync {
            if (!recording) {
                return@runOnMainSync failAndEmit("1403", "当前状态不允许执行该操作", "stopRecord while not recording")
            }
            val recorder = mediaRecorder ?: return@runOnMainSync failAndEmit(
                "1402",
                "录像停止失败",
                "MediaRecorder is null."
            )
            val file = outputFile ?: return@runOnMainSync failAndEmit(
                "1402",
                "录像停止失败",
                "Output file is null."
            )

            var stopError: String? = null
            try {
                recorder.stop()
            } catch (throwable: Throwable) {
                stopError = throwable.message ?: throwable.javaClass.simpleName
            }

            releaseRecorder()
            recording = false
            outputFile = null
            restartPreviewAfterRecord()

            if (stopError != null) {
                file.delete()
                return@runOnMainSync failAndEmit("1402", "录像停止失败", stopError)
            }

            val durationMs = max(1L, System.currentTimeMillis() - recordingStartedAt)
            val data = mediaPayload(
                tempFilePath = file.absolutePath,
                durationMs = durationMs,
                width = videoSize.width,
                height = videoSize.height
            )
                .put("fps", targetFps)
            try {
                val albumResult = saveMediaToAlbum(file, "video/mp4", true)
                appendAlbumSuccess(data, albumResult, "视频已保存到相册")
            } catch (throwable: Throwable) {
                appendAlbumFailure(data, "视频已生成，相册保存失败")
                emitError("1501", "视频已生成，相册保存失败", throwable.message ?: throwable.javaClass.simpleName)
            }
            setStatus(data.optString("message", "视频已生成"))
            emit("recorddone", data)
            ok(data)
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

    private fun restartPreviewAfterRecord() {
        val activeCamera = camera ?: return
        try {
            activeCamera.lock()
        } catch (_: Throwable) {
        }
        try {
            activeCamera.setPreviewDisplay(previewView.holder)
            activeCamera.startPreview()
        } catch (throwable: Throwable) {
            failAndEmit("1101", "相机设备不可用", throwable.message ?: throwable.javaClass.simpleName)
        }
    }

    private fun closeCamera() {
        if (recording) {
            try {
                mediaRecorder?.stop()
            } catch (_: Throwable) {
            }
        }
        releaseRecorder()
        outputFile = null
        recording = false
        photoBusy = false
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
        try {
            mediaRecorder?.reset()
        } catch (_: Throwable) {
        }
        try {
            mediaRecorder?.release()
        } catch (_: Throwable) {
        }
        mediaRecorder = null
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
        mainHandler.postDelayed({
            if (!holderReady || camera != null || !cameraPermissionRequested) {
                return@postDelayed
            }
            if (hasPermission(Manifest.permission.CAMERA)) {
                cameraPermissionRequested = false
                cameraPermissionRetryCount = 0
                openCameraIfReady()
                return@postDelayed
            }
            cameraPermissionRetryCount += 1
            if (cameraPermissionRetryCount < CAMERA_PERMISSION_RETRY_LIMIT) {
                scheduleCameraPermissionRetry()
            }
        }, CAMERA_PERMISSION_RETRY_DELAY_MS)
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

    private data class XycSize(val width: Int, val height: Int)

    private companion object {
        const val DEFAULT_TARGET_FPS = 30
        const val UI_FLASH_OFF = "off"
        const val UI_FLASH_ON = "on"
        const val UI_FLASH_AUTO = "auto"
        const val REQUEST_CAMERA_PERMISSION = 7201
        const val REQUEST_PREPARE_PERMISSIONS = 7204
        const val REQUEST_PREPARE_RECORD_PERMISSIONS = 7205
        const val MAIN_THREAD_TIMEOUT_MS = 4_000L
        const val CAMERA_PERMISSION_RETRY_DELAY_MS = 350L
        const val CAMERA_PERMISSION_RETRY_LIMIT = 240
        const val ALBUM_DIRECTORY_NAME = "xyc-markvideo"
    }

    private data class AlbumSaveResult(val albumPath: String, val albumUri: String)
}
