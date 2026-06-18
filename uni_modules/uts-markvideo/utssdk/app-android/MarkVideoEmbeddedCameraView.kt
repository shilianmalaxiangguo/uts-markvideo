package uts.markvideo.android

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
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.util.Range
import android.util.Size
import android.view.MotionEvent
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt
import org.json.JSONObject

class MarkVideoEmbeddedCameraView(context: Context) : FrameLayout(context) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val previewView = TextureView(context)
    private val overlayView = WatermarkOverlayView(context)
    private var eventCallback: ((String, String) -> Unit)? = null

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var recorderThread: HandlerThread? = null
    private var recorderHandler: Handler? = null
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var previewSurface: Surface? = null
    private var previewSize: Size = Size(720, 1280)
    private var activeCameraId: String = ""
    private var activeCharacteristics: CameraCharacteristics? = null

    @Volatile private var ready = false
    @Volatile private var openingCamera = false
    @Volatile private var recording = false
    @Volatile private var stoppingRecording = false
    private var readyWaitLatch: CountDownLatch? = null
    private var readyWaitError: String? = null
    private var currentFacing = "back"
    private var currentZoom = "1x"
    private var requestedFlashEnabled = false
    private var flashEnabled = false
    private var flashAvailable = false
    private var previewWidth = 0
    private var previewHeight = 0
    private var currentTemplate: WatermarkTemplate? = null
    private var recordingTemplate: WatermarkTemplate? = null
    private var loadedImagePath = ""
    private var watermarkImage: Bitmap? = null
    private var scaledWatermarkImage: Bitmap? = null

    private var recorder: CameraMp4Recorder? = null
    private var outputFile: File? = null
    private var recordingSize: Size = Size(720, 1280)
    private var recordingStartedAt = 0L
    private val frameStats = RecordingFrameStats()
    private var framePending = false
    private val recordFrameRunnable = object : Runnable {
        override fun run() {
            requestRecordFrame()
        }
    }
    private var dragging = false
    private var dragArmed = false
    private val longPressRunnable = Runnable {
        if (!recording && currentTemplate != null) {
            dragArmed = true
        }
    }

    init {
        setBackgroundColor(Color.BLACK)
        previewView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                previewSurface = Surface(surface)
                openCameraWhenPossible()
            }

            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
                previewWidth = width
                previewHeight = height
            }

            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                releasePreviewSurface()
                return true
            }

            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
            }
        }
        addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        overlayView.setOnTouchListener { _, event ->
            handleWatermarkTouch(event)
        }
        addView(overlayView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun setEventCallback(callback: (String, String) -> Unit) {
        eventCallback = callback
    }

    fun mountCamera(optionsJson: String): String {
        val options = parseObject(optionsJson)
        val setup = runOnMainSync {
            currentFacing = if (options.optString("cameraFacing") == "front") "front" else "back"
            currentZoom = when (options.optString("zoom")) {
                "wide", "2x" -> options.optString("zoom")
                else -> "1x"
            }
            requestedFlashEnabled = options.optBoolean("flashEnabled", false)
            previewWidth = options.optInt("previewWidth", width)
            previewHeight = options.optInt("previewHeight", height)

            if (!hasPermission(Manifest.permission.CAMERA)) {
                requestPermission(Manifest.permission.CAMERA, REQUEST_CAMERA_PERMISSION)
                CameraOpenSetup(fail("1001", "相机权限被拒绝", "Camera permission is not granted."), null)
            } else {
                startCameraThread()
                val readyLatch = beginCameraReadyWait()
                openCameraWhenPossible()
                CameraOpenSetup(null, readyLatch)
            }
        }
        setup.failure?.let { return it }
        val readyLatch = setup.readyLatch
        val waitResult = waitForCameraReady(readyLatch)
        if (waitResult != null) {
            return fail("1101", "相机设备不可用", waitResult)
        }
        return runOnMainSync { ok(cameraReadyPayload()) }
    }

    fun setWatermark(templateJson: String): String {
        if (recording) {
            return failAndEmit("1403", "当前状态不允许执行该操作", "setWatermark while recording")
        }
        val parsed = parseTemplate(templateJson)
        if (!parsed.success) {
            return failAndEmit(parsed.errorCode, parsed.errorMessage, parsed.nativeMessage)
        }
        return runOnMainSync {
            if (recording) {
                failAndEmit("1403", "当前状态不允许执行该操作", "setWatermark while recording")
            } else {
                currentTemplate = parsed.template
                releaseWatermarkImages()
                overlayView.invalidate()
                emit("watermarkpositionchange", watermarkPositionPayload(currentTemplate))
                ok()
            }
        }
    }

    fun clearWatermark(): String {
        return runOnMainSync {
            if (recording) {
                failAndEmit("1403", "当前状态不允许执行该操作", "clearWatermark while recording")
            } else {
                currentTemplate = null
                releaseWatermarkImages()
                overlayView.invalidate()
                ok()
            }
        }
    }

    fun getWatermarkPosition(): String {
        return runOnMainSync {
            if (!ready) {
                failAndEmit("1104", "相机未挂载或未就绪", "Camera session is not ready.")
            } else {
                ok(watermarkPositionPayload(currentTemplate))
            }
        }
    }

    fun takePhoto(optionsJson: String): String {
        val capture = runOnMainSync {
            if (!ready || !previewView.isAvailable) {
                SnapshotCapture(failAndEmit("1104", "相机未挂载或未就绪", "Preview texture is not ready."), null, null, null)
            } else if (recording) {
                SnapshotCapture(failAndEmit("1403", "当前状态不允许执行该操作", "takePhoto while recording"), null, null, null)
            } else {
                val template = mediaTemplate(optionsJson, currentTemplate)
                val size = chooseOutputSizeFromPreview()
                val snapshot = previewView.getBitmap(size.width, size.height)
                if (snapshot == null) {
                    SnapshotCapture(failAndEmit("1301", "拍照失败", "TextureView.getBitmap returned null."), null, null, null)
                } else {
                    SnapshotCapture(null, size, template, snapshot)
                }
            }
        }
        capture.failure?.let { return it }
        val size = capture.size ?: return failAndEmit("1301", "拍照失败", "Output size was not created.")
        val snapshot = capture.snapshot ?: return failAndEmit("1301", "拍照失败", "TextureView.getBitmap returned null.")
        val template = capture.template
        val file = File(context.cacheDir, "uts-markvideo-photo-${System.currentTimeMillis()}.jpg")

        try {
            drawWatermark(snapshot, template)
            FileOutputStream(file).use { output ->
                if (!snapshot.compress(Bitmap.CompressFormat.JPEG, 92, output)) {
                    throw IllegalStateException("JPEG encode failed.")
                }
            }
        } catch (throwable: Throwable) {
            file.delete()
            return failAndEmit("1301", "拍照失败", throwable.message ?: throwable.javaClass.simpleName)
        } finally {
            snapshot.recycle()
        }

        val albumPath = try {
            publishPhotoToGallery(file)
        } catch (throwable: Throwable) {
            emitError("1501", "文件保存失败", throwable.message ?: throwable.javaClass.simpleName)
            ""
        }
        val data = mediaResultPayload(
            tempFilePath = file.absolutePath,
            albumFilePath = albumPath,
            durationMs = null,
            width = size.width,
            height = size.height,
            template = template
        )
        emit("photodone", data)
        return ok(data)
    }

    fun startRecord(optionsJson: String): String {
        val setup = runOnMainSync {
            if (!ready || !previewView.isAvailable) {
                RecordStartSetup(failAndEmit("1104", "相机未挂载或未就绪", "Preview texture is not ready."), null, null)
            } else if (recording) {
                RecordStartSetup(failAndEmit("1403", "当前状态不允许执行该操作", "duplicate startRecord"), null, null)
            } else if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
                requestPermission(Manifest.permission.RECORD_AUDIO, REQUEST_AUDIO_PERMISSION)
                RecordStartSetup(failAndEmit("1002", "麦克风权限被拒绝", "Record audio permission is not granted."), null, null)
            } else {
                recordingTemplate = mediaTemplate(optionsJson, currentTemplate)
                recordingSize = chooseOutputSizeFromPreview()
                outputFile = File(context.cacheDir, "uts-markvideo-${System.currentTimeMillis()}.mp4")
                startRecorderThread()
                RecordStartSetup(null, recordingSize, outputFile)
            }
        }
        setup.failure?.let { return it }
        val size = setup.size ?: return failAndEmit("1401", "录像开始失败", "Recording size was not created.")
        val file = setup.file ?: return failAndEmit("1401", "录像开始失败", "Output file was not created.")

        return try {
            val nextRecorder = CameraMp4Recorder(
                output = file,
                width = size.width,
                height = size.height,
                fps = DEFAULT_FPS,
                bitrate = 0,
                includeAudio = true
            )
            nextRecorder.start()
            runOnMainSync {
                recorder = nextRecorder
                frameStats.reset()
                recordingStartedAt = System.currentTimeMillis()
                framePending = false
                stoppingRecording = false
                recording = true
                overlayView.invalidate()
                requestRecordFrame()
                emit("recordstart", recordStartPayload())
                ok()
            }
        } catch (throwable: Throwable) {
            runOnMainSync {
                recording = false
                recorder = null
                outputFile?.delete()
                outputFile = null
                recordingTemplate = null
                failAndEmit("1401", "录像开始失败", throwable.message ?: throwable.javaClass.simpleName)
            }
        }
    }

    fun stopRecord(): String {
        val setup = runOnMainSync {
            if (!recording) {
                RecordStopSetup(failAndEmit("1403", "当前状态不允许执行该操作", "stopRecord while not recording"), null, null, null)
            } else {
                recording = false
                stoppingRecording = true
                previewView.removeCallbacks(recordFrameRunnable)

                val activeRecorder = recorder
                val file = outputFile
                if (activeRecorder == null || file == null) {
                    cleanupRecorderState()
                    RecordStopSetup(failAndEmit("1402", "录像停止失败", "Recorder is not active."), null, null, null)
                } else {
                    RecordStopSetup(null, activeRecorder, file, recordingTemplate)
                }
            }
        }
        setup.failure?.let { return it }
        val activeRecorder = setup.recorder ?: return failAndEmit("1402", "录像停止失败", "Recorder is not active.")
        val file = setup.file ?: return failAndEmit("1402", "录像停止失败", "Output file is not active.")

        val waitUntil = System.currentTimeMillis() + FIRST_FRAME_GRACE_MS
        while (activeRecorder.frameCount == 0 && System.currentTimeMillis() < waitUntil) {
            Thread.sleep(40L)
        }

        val finishError = finishRecorder(activeRecorder)
        val durationMs = max(1L, System.currentTimeMillis() - recordingStartedAt)
        val frameCount = activeRecorder.frameCount
        runOnMainSync { cleanupRecorderState() }

        if (finishError != null) {
            file.delete()
            return failAndEmit("1402", "录像停止失败", finishError)
        }
        if (frameCount <= 0) {
            file.delete()
            return failAndEmit("1402", "录像停止失败", "No frames were recorded.")
        }

        val albumPath = try {
            publishVideoToGallery(file)
        } catch (throwable: Throwable) {
            emitError("1501", "文件保存失败", throwable.message ?: throwable.javaClass.simpleName)
            ""
        }
        val data = mediaResultPayload(
            tempFilePath = file.absolutePath,
            albumFilePath = albumPath,
            durationMs = durationMs,
            width = activeRecorder.width,
            height = activeRecorder.height,
            template = setup.template
        )
        emit("recorddone", data)
        runOnMainSync { recordingTemplate = null }
        return ok(data)
    }

    fun switchFlash(enabled: Boolean): String {
        return runOnMainSync {
            if (!ready) {
                failAndEmit("1104", "相机未挂载或未就绪", "Camera session is not ready.")
            } else if (!flashAvailable) {
                failAndEmit("1102", "闪光灯不可用", "FLASH_INFO_AVAILABLE is false.")
            } else {
                requestedFlashEnabled = enabled
                flashEnabled = enabled
                try {
                    updateRepeatingRequest()
                    emit("flashchange", JSONObject().put("enabled", flashEnabled).put("flashAvailable", flashAvailable))
                    ok(JSONObject().put("enabled", flashEnabled))
                } catch (throwable: Throwable) {
                    failAndEmit("1102", "闪光灯不可用", throwable.message ?: throwable.javaClass.simpleName)
                }
            }
        }
    }

    fun setZoom(zoom: String): String {
        return runOnMainSync {
            if (!ready) {
                failAndEmit("1104", "相机未挂载或未就绪", "Camera session is not ready.")
            } else if (!availableZooms().contains(zoom)) {
                failAndEmit("1103", "焦段不可用", "Unsupported zoom: $zoom")
            } else {
                currentZoom = zoom
                try {
                    updateRepeatingRequest()
                    emit("zoomchange", JSONObject().put("zoom", currentZoom).put("availableZooms", availableZoomsJson()))
                    ok(JSONObject().put("zoom", currentZoom))
                } catch (throwable: Throwable) {
                    failAndEmit("1103", "焦段不可用", throwable.message ?: throwable.javaClass.simpleName)
                }
            }
        }
    }

    fun switchCamera(cameraFacing: String): String {
        val nextFacing = if (cameraFacing == "front") "front" else "back"
        val setup = runOnMainSync {
            if (recording) {
                CameraOpenSetup(failAndEmit("1403", "当前状态不允许执行该操作", "switchCamera while recording"), null)
            } else if (nextFacing == currentFacing && ready) {
                CameraOpenSetup(ok(JSONObject().put("cameraFacing", currentFacing)), null)
            } else if (!cameraFacingAvailable(nextFacing)) {
                CameraOpenSetup(failAndEmit("1101", "相机设备不可用", "No $nextFacing camera id available."), null)
            } else {
                currentFacing = nextFacing
                ready = false
                closeCamera()
                startCameraThread()
                val readyLatch = beginCameraReadyWait()
                openCameraWhenPossible()
                CameraOpenSetup(null, readyLatch)
            }
        }
        setup.failure?.let { return it }
        val waitResult = waitForCameraReady(setup.readyLatch)
        if (waitResult != null) {
            return fail("1101", "相机设备不可用", waitResult)
        }
        return runOnMainSync {
            emit("camerafacingchange", JSONObject().put("cameraFacing", currentFacing))
            ok(JSONObject().put("cameraFacing", currentFacing))
        }
    }

    fun destroyCamera(): String {
        val activeRecorder = runOnMainSync {
            previewView.removeCallbacks(recordFrameRunnable)
            val currentRecorder = if (recording) recorder else null
            recording = false
            cleanupRecorderState()
            recordingTemplate = null
            currentTemplate = null
            releaseWatermarkImages()
            closeCamera()
            ready = false
            currentRecorder
        }
        finishRecorder(activeRecorder)
        stopCameraThread()
        stopRecorderThread()
        return ok()
    }

    override fun onDetachedFromWindow() {
        destroyCamera()
        eventCallback = null
        super.onDetachedFromWindow()
    }

    private fun openCameraWhenPossible() {
        if (cameraHandler == null || openingCamera || cameraDevice != null) return
        if (!hasPermission(Manifest.permission.CAMERA)) return
        if (!previewView.isAvailable && previewSurface == null) return
        ensurePreviewSurface() ?: return
        openCamera()
    }

    @SuppressLint("MissingPermission")
    private fun openCamera() {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val handler = cameraHandler ?: return

        try {
            val cameraId = selectCamera(manager, currentFacing)
            val characteristics = manager.getCameraCharacteristics(cameraId)
            activeCameraId = cameraId
            activeCharacteristics = characteristics
            flashAvailable = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            flashEnabled = requestedFlashEnabled && flashAvailable
            previewSize = choosePreviewSize(characteristics)
            previewView.surfaceTexture?.setDefaultBufferSize(previewSize.width, previewSize.height)
            openingCamera = true
            manager.openCamera(cameraId, cameraStateCallback, handler)
        } catch (throwable: Throwable) {
            openingCamera = false
            emitError("1101", "相机设备不可用", throwable.message ?: throwable.javaClass.simpleName)
        }
    }

    private val cameraStateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            openingCamera = false
            cameraDevice = camera
            createPreviewSession()
        }

        override fun onDisconnected(camera: CameraDevice) {
            openingCamera = false
            camera.close()
            cameraDevice = null
            ready = false
            emitError("1101", "相机设备不可用", "Camera disconnected.")
        }

        override fun onError(camera: CameraDevice, error: Int) {
            openingCamera = false
            camera.close()
            cameraDevice = null
            ready = false
            emitError("1101", "相机设备不可用", "Camera error: $error")
        }
    }

    private fun createPreviewSession() {
        val camera = cameraDevice ?: return
        val surface = ensurePreviewSurface() ?: run {
            emitError("1101", "相机设备不可用", "Preview surface is unavailable.")
            return
        }
        val handler = cameraHandler ?: return

        try {
            camera.createCaptureSession(
                listOf(surface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        captureSession = session
                        try {
                            updateRepeatingRequest()
                            ready = true
                            notifyCameraReady()
                            emit("cameraready", cameraReadyPayload())
                        } catch (throwable: Throwable) {
                            emitError("1101", "相机设备不可用", throwable.message ?: throwable.javaClass.simpleName)
                        }
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        ready = false
                        emitError("1101", "相机设备不可用", "Camera session configure failed.")
                    }
                },
                handler
            )
        } catch (throwable: Throwable) {
            ready = false
            emitError("1101", "相机设备不可用", throwable.message ?: throwable.javaClass.simpleName)
        }
    }

    private fun updateRepeatingRequest() {
        val camera = cameraDevice ?: return
        val session = captureSession ?: return
        val surface = ensurePreviewSurface() ?: return
        val handler = cameraHandler ?: return
        val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
            addTarget(surface)
            set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
            selectFpsRange()?.let { range ->
                set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
            }
            if (flashAvailable) {
                set(CaptureRequest.FLASH_MODE, if (flashEnabled) CaptureRequest.FLASH_MODE_TORCH else CaptureRequest.FLASH_MODE_OFF)
            }
            applyZoom(this)
        }.build()
        session.setRepeatingRequest(request, null, handler)
    }

    private fun beginCameraReadyWait(): CountDownLatch? {
        if (ready) return null
        val latch = CountDownLatch(1)
        readyWaitError = null
        readyWaitLatch = latch
        return latch
    }

    private fun waitForCameraReady(latch: CountDownLatch?): String? {
        if (latch == null || ready) return null
        if (ready) {
            readyWaitLatch = null
            return null
        }
        return if (latch.await(CAMERA_READY_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            val error = readyWaitError
            readyWaitError = null
            if (ready) null else error ?: "Camera session is not ready."
        } else {
            readyWaitLatch = null
            readyWaitError = null
            "Timed out waiting for camera session."
        }
    }

    private fun notifyCameraReady() {
        readyWaitLatch?.countDown()
        readyWaitLatch = null
    }

    private fun notifyCameraReadyFailed(message: String) {
        readyWaitError = message
        readyWaitLatch?.countDown()
        readyWaitLatch = null
    }

    private fun ensurePreviewSurface(): Surface? {
        previewSurface?.let { return it }
        if (Looper.myLooper() != Looper.getMainLooper()) {
            return runOnMainSync { ensurePreviewSurface() }
        }
        val texture = previewView.surfaceTexture ?: return null
        texture.setDefaultBufferSize(previewSize.width, previewSize.height)
        return Surface(texture).also { previewSurface = it }
    }

    private fun closeCamera() {
        ready = false
        try {
            captureSession?.close()
        } catch (_: Throwable) {
        }
        captureSession = null
        try {
            cameraDevice?.close()
        } catch (_: Throwable) {
        }
        cameraDevice = null
        releasePreviewSurface()
        openingCamera = false
    }

    private fun releasePreviewSurface() {
        try {
            previewSurface?.release()
        } catch (_: Throwable) {
        }
        previewSurface = null
    }

    private fun startCameraThread() {
        if (cameraThread != null) return
        cameraThread = HandlerThread("uts-markvideo-embedded-camera").also {
            it.start()
            cameraHandler = Handler(it.looper)
        }
    }

    private fun stopCameraThread() {
        val thread = cameraThread
        cameraThread = null
        cameraHandler = null
        thread?.quitSafely()
    }

    private fun startRecorderThread() {
        if (recorderThread != null) return
        recorderThread = HandlerThread("uts-markvideo-embedded-recorder").also {
            it.start()
            recorderHandler = Handler(it.looper)
        }
    }

    private fun stopRecorderThread() {
        val thread = recorderThread
        recorderThread = null
        recorderHandler = null
        thread?.quitSafely()
    }

    private fun <T> runOnMainSync(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return block()
        }
        var result: T? = null
        var error: Throwable? = null
        val latch = CountDownLatch(1)
        mainHandler.post {
            try {
                result = block()
            } catch (throwable: Throwable) {
                error = throwable
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(MAIN_THREAD_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            throw IllegalStateException("Timed out waiting for Android main thread.")
        }
        error?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun requestRecordFrame() {
        if (!recording || stoppingRecording || framePending) return
        if (!previewView.isAvailable) {
            scheduleNextRecordFrame(System.currentTimeMillis())
            return
        }
        framePending = true
        val startedAt = System.currentTimeMillis()
        val snapshot = previewView.getBitmap(recordingSize.width, recordingSize.height)
        if (snapshot == null) {
            framePending = false
            scheduleNextRecordFrame(startedAt)
            return
        }
        recorderHandler?.post {
            try {
                frameStats.received += 1
                frameStats.processed += 1
                drawWatermark(snapshot, recordingTemplate)
                if (recorder?.encodeFrame(snapshot) == true) {
                    frameStats.encoded += 1
                }
            } catch (_: Throwable) {
                frameStats.droppedBusy += 1
            } finally {
                snapshot.recycle()
                mainHandler.post {
                    framePending = false
                    scheduleNextRecordFrame(startedAt)
                }
            }
        } ?: run {
            snapshot.recycle()
            framePending = false
        }
    }

    private fun scheduleNextRecordFrame(startedAt: Long) {
        if (!recording || stoppingRecording) return
        val intervalMs = max(1L, 1000L / DEFAULT_FPS)
        val delayMs = max(0L, intervalMs - (System.currentTimeMillis() - startedAt))
        previewView.postDelayed(recordFrameRunnable, delayMs)
    }

    private fun finishRecorder(activeRecorder: CameraMp4Recorder?): String? {
        if (activeRecorder == null) return null
        val handler = recorderHandler
        if (handler == null) {
            return try {
                activeRecorder.finish()
                null
            } catch (throwable: Throwable) {
                throwable.message ?: throwable.javaClass.simpleName
            }
        }

        var error: String? = null
        val latch = CountDownLatch(1)
        handler.post {
            try {
                activeRecorder.finish()
            } catch (throwable: Throwable) {
                error = throwable.message ?: throwable.javaClass.simpleName
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(FINISH_TIMEOUT_MS + 1500L, TimeUnit.MILLISECONDS)) {
            return "Timed out waiting for recorder finish."
        }
        return error
    }

    private fun cleanupRecorderState() {
        recorder = null
        outputFile = null
        stoppingRecording = false
        framePending = false
    }

    private fun handleWatermarkTouch(event: MotionEvent): Boolean {
        val template = currentTemplate ?: return false
        if (recording) return true
        return when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragArmed = false
                dragging = false
                overlayView.postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
                true
            }
            MotionEvent.ACTION_MOVE -> {
                if (dragArmed) {
                    dragging = true
                    updateWatermarkPosition(template, event.x, event.y)
                }
                true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                overlayView.removeCallbacks(longPressRunnable)
                if (dragging) {
                    emit("watermarkpositionchange", watermarkPositionPayload(currentTemplate))
                }
                dragArmed = false
                dragging = false
                true
            }
            else -> true
        }
    }

    private fun updateWatermarkPosition(template: WatermarkTemplate, x: Float, y: Float) {
        val viewWidth = overlayView.width.takeIf { it > 0 } ?: return
        val viewHeight = overlayView.height.takeIf { it > 0 } ?: return
        val nextX = (x / viewWidth - template.boxWidth / 2f).coerceIn(0f, max(0f, 1f - template.boxWidth))
        val nextY = (y / viewHeight - template.boxHeight / 2f).coerceIn(0f, max(0f, 1f - template.boxHeight))
        currentTemplate = template.copy(positionX = nextX, positionY = nextY)
        overlayView.invalidate()
    }

    private fun drawWatermark(bitmap: Bitmap, template: WatermarkTemplate?) {
        drawWatermarkOnCanvas(Canvas(bitmap), bitmap.width, bitmap.height, template)
    }

    private fun drawWatermarkOnCanvas(canvas: Canvas, width: Int, height: Int, template: WatermarkTemplate?) {
        val watermark = template ?: return
        val boxWidthPx = max(1f, width * watermark.boxWidth)
        val boxHeightPx = max(1f, height * watermark.boxHeight)
        val left = (width * watermark.positionX).coerceIn(0f, max(0f, width - boxWidthPx))
        val top = (height * watermark.positionY).coerceIn(0f, max(0f, height - boxHeightPx))
        val rect = RectF(left, top, left + boxWidthPx, top + boxHeightPx)
        val radius = logicalPx(watermark.boxRadius)
        val padding = logicalPx(watermark.boxPadding)
        val imageGap = logicalPx(watermark.imageTextGap)

        val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = watermark.boxBackgroundColor
        }
        canvas.drawRoundRect(rect, radius, radius, backgroundPaint)

        val contentLeft = rect.left + padding
        val contentRight = rect.right - padding
        val contentTop = rect.top + padding
        val contentBottom = rect.bottom - padding
        if (contentRight <= contentLeft || contentBottom <= contentTop) return

        val image = if (watermark.templateType == TYPE_IMAGE_TITLE_SUBTITLE) {
            getScaledWatermarkImage(watermark)
        } else {
            null
        }
        val imageWidth = image?.width?.toFloat() ?: 0f
        val imageHeight = image?.height?.toFloat() ?: 0f
        var textLeft = contentLeft
        if (image != null) {
            val imageTop = contentTop + max(0f, (contentBottom - contentTop - imageHeight) / 2f)
            canvas.drawBitmap(image, contentLeft, imageTop, Paint(Paint.ANTI_ALIAS_FLAG))
            textLeft += imageWidth + imageGap
        }
        val textWidth = max(1, (contentRight - textLeft).roundToInt())
        val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = watermark.mainTitleColor
            textSize = logicalPx(watermark.mainTitleFontSize)
            isFakeBoldText = watermark.mainTitleBold
            typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL)
        }
        val subtitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = watermark.subtitleColor
            textSize = logicalPx(watermark.subtitleFontSize)
            isFakeBoldText = watermark.subtitleBold
            typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL)
        }

        val titleText = ellipsizeSingleLine(watermark.mainTitleText, titlePaint, textWidth)
        val titleBaseline = contentTop - titlePaint.ascent()
        canvas.drawText(titleText, textLeft, titleBaseline, titlePaint)

        if (watermark.templateType != TYPE_TITLE_TEXT && watermark.subtitleText.isNotBlank()) {
            val subtitleTop = titleBaseline + titlePaint.descent() + logicalPx(2f)
            canvas.save()
            canvas.translate(textLeft, subtitleTop)
            createTextLayout(watermark.subtitleText, subtitlePaint, textWidth, 2).draw(canvas)
            canvas.restore()
        }
    }

    private fun createTextLayout(text: String, paint: TextPaint, width: Int, maxLines: Int): StaticLayout {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            StaticLayout.Builder
                .obtain(text, 0, text.length, paint, width)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setIncludePad(false)
                .setMaxLines(maxLines)
                .setEllipsize(TextUtils.TruncateAt.END)
                .build()
        } else {
            @Suppress("DEPRECATION")
            StaticLayout(text, paint, width, Layout.Alignment.ALIGN_NORMAL, 1f, 0f, false)
        }
    }

    private fun ellipsizeSingleLine(text: String, paint: TextPaint, width: Int): String {
        return TextUtils.ellipsize(text, paint, width.toFloat(), TextUtils.TruncateAt.END).toString()
    }

    private fun getScaledWatermarkImage(template: WatermarkTemplate): Bitmap? {
        val source = loadWatermarkImage(template.imagePath) ?: return null
        val targetWidth = max(1, logicalPx(template.imageWidth).roundToInt())
        val targetHeight = max(1, logicalPx(template.imageHeight).roundToInt())
        val existing = scaledWatermarkImage
        if (existing != null && existing.width == targetWidth && existing.height == targetHeight) {
            return existing
        }
        existing?.recycle()
        return Bitmap.createScaledBitmap(source, targetWidth, targetHeight, true).also {
            scaledWatermarkImage = it
        }
    }

    private fun loadWatermarkImage(path: String): Bitmap? {
        if (path.isBlank()) return null
        if (path == loadedImagePath && watermarkImage != null) return watermarkImage
        releaseWatermarkImages()
        loadedImagePath = path
        val decoded = decodeImagePath(path)
        watermarkImage = decoded
        return decoded
    }

    private fun decodeImagePath(path: String): Bitmap? {
        return try {
            val uri = Uri.parse(path)
            if (uri.scheme == "content" || uri.scheme == "file") {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    BitmapFactory.decodeStream(input)
                }
            } else {
                val file = File(path)
                if (file.exists()) {
                    BitmapFactory.decodeFile(file.absolutePath)
                } else {
                    decodeAssetPath(path)
                }
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun decodeAssetPath(path: String): Bitmap? {
        val normalized = path.removePrefix("/").removePrefix("_www/")
        val candidates = listOf(
            normalized,
            "www/$normalized",
            "assets/$normalized",
            "apps/__UNI__12069F3/www/$normalized"
        ).distinct()
        for (candidate in candidates) {
            try {
                context.assets.open(candidate).use { input ->
                    return BitmapFactory.decodeStream(input)
                }
            } catch (_: Throwable) {
            }
        }
        return null
    }

    private fun releaseWatermarkImages() {
        scaledWatermarkImage?.recycle()
        scaledWatermarkImage = null
        watermarkImage?.recycle()
        watermarkImage = null
        loadedImagePath = ""
    }

    private fun parseTemplate(json: String): TemplateParseResult {
        val obj = parseObject(json)
        val type = obj.optString("templateType")
        if (obj.optString("templateId").isBlank()) return TemplateParseResult.invalid("templateId is blank.")
        if (obj.optString("templateName").isBlank()) return TemplateParseResult.invalid("templateName is blank.")
        if (type !in VALID_TEMPLATE_TYPES) return TemplateParseResult.invalid("templateType is invalid.")
        val mainTitleColor = parseColorStrict(obj.optString("mainTitleColor", DEFAULT_MAIN_TITLE_COLOR))
            ?: return TemplateParseResult.invalid("mainTitleColor is invalid.")
        val subtitleColor = parseColorStrict(obj.optString("subtitleColor", DEFAULT_SUBTITLE_COLOR))
            ?: return TemplateParseResult.invalid("subtitleColor is invalid.")
        val backgroundColor = parseColorStrict(obj.optString("boxBackgroundColor", DEFAULT_BOX_BACKGROUND_COLOR))
            ?: return TemplateParseResult.invalid("boxBackgroundColor is invalid.")
        val template = WatermarkTemplate(
            templateId = obj.optString("templateId"),
            templateName = obj.optString("templateName"),
            templateType = type,
            mainTitleText = obj.optString("mainTitleText", ""),
            subtitleText = obj.optString("subtitleText", ""),
            mainTitleColor = mainTitleColor,
            subtitleColor = subtitleColor,
            mainTitleFontSize = obj.optDouble("mainTitleFontSize", 16.0).toFloat(),
            subtitleFontSize = obj.optDouble("subtitleFontSize", 12.0).toFloat(),
            mainTitleBold = obj.optBoolean("mainTitleBold", true),
            subtitleBold = obj.optBoolean("subtitleBold", false),
            imagePath = obj.optString("imagePath", ""),
            imageMimeType = obj.optString("imageMimeType", ""),
            imageWidth = obj.optDouble("imageWidth", 0.0).toFloat(),
            imageHeight = obj.optDouble("imageHeight", 0.0).toFloat(),
            imageTextGap = obj.optDouble("imageTextGap", 8.0).toFloat(),
            boxWidth = obj.optDouble("boxWidth", 0.64).toFloat(),
            boxHeight = obj.optDouble("boxHeight", 0.16).toFloat(),
            boxBackgroundColor = backgroundColor,
            boxRadius = obj.optDouble("boxRadius", 8.0).toFloat(),
            boxPadding = obj.optDouble("boxPadding", 10.0).toFloat(),
            positionX = obj.optDouble("positionX", 0.18).toFloat(),
            positionY = obj.optDouble("positionY", 0.25).toFloat(),
            raw = cloneJson(obj)
        ).clamped()

        val invalidReason = validateTemplate(template)
        if (invalidReason != null) return TemplateParseResult.invalid(invalidReason)
        if (template.templateType == TYPE_IMAGE_TITLE_SUBTITLE && decodeImagePath(template.imagePath) == null) {
            return TemplateParseResult.imageUnreadable("Unable to decode imagePath: ${template.imagePath}")
        }
        return TemplateParseResult.success(template)
    }

    private fun validateTemplate(template: WatermarkTemplate): String? {
        if (!inRange(template.mainTitleFontSize, 8f, 72f)) return "mainTitleFontSize out of range."
        if (!inRange(template.subtitleFontSize, 8f, 48f)) return "subtitleFontSize out of range."
        if (!inRange(template.imageWidth, 0f, 512f)) return "imageWidth out of range."
        if (!inRange(template.imageHeight, 0f, 512f)) return "imageHeight out of range."
        if (!inRange(template.imageTextGap, 0f, 64f)) return "imageTextGap out of range."
        if (!inRange(template.boxWidth, 0.1f, 1f)) return "boxWidth out of range."
        if (!inRange(template.boxHeight, 0.05f, 1f)) return "boxHeight out of range."
        if (!inRange(template.boxRadius, 0f, 80f)) return "boxRadius out of range."
        if (!inRange(template.boxPadding, 0f, 80f)) return "boxPadding out of range."
        if (!inRange(template.positionX, 0f, 1f)) return "positionX out of range."
        if (!inRange(template.positionY, 0f, 1f)) return "positionY out of range."

        return when (template.templateType) {
            TYPE_TITLE_TEXT -> if (template.mainTitleText.isBlank()) "title_text requires mainTitleText." else null
            TYPE_TITLE_SUBTITLE_TEXT -> if (template.mainTitleText.isBlank() || template.subtitleText.isBlank()) {
                "title_subtitle_text requires mainTitleText and subtitleText."
            } else {
                null
            }
            TYPE_IMAGE_TITLE_SUBTITLE -> if (
                template.mainTitleText.isBlank() ||
                template.subtitleText.isBlank() ||
                template.imagePath.isBlank() ||
                template.imageMimeType != "image/png" ||
                template.imageWidth <= 0f ||
                template.imageHeight <= 0f
            ) {
                "image_title_subtitle image fields are invalid."
            } else {
                null
            }
            else -> "templateType is invalid."
        }
    }

    private fun mediaTemplate(optionsJson: String, fallback: WatermarkTemplate?): WatermarkTemplate? {
        val options = parseObject(optionsJson)
        val templateObj = options.optJSONObject("watermarkTemplate") ?: return fallback
        val parsed = parseTemplate(templateObj.toString())
        return if (parsed.success) parsed.template else fallback
    }

    private fun cameraReadyPayload(): JSONObject {
        return JSONObject()
            .put("availableZooms", availableZoomsJson())
            .put("zoom", if (availableZooms().contains(currentZoom)) currentZoom else "1x")
            .put("flashAvailable", flashAvailable)
            .put("flashEnabled", flashEnabled)
            .put("cameraFacing", currentFacing)
            .put("previewWidth", previewWidth)
            .put("previewHeight", previewHeight)
    }

    private fun recordStartPayload(): JSONObject {
        val template = recordingTemplate
        return JSONObject()
            .put("watermarkTemplateId", template?.templateId ?: "")
            .put("watermarkPositionX", template?.positionX ?: 0f)
            .put("watermarkPositionY", template?.positionY ?: 0f)
            .put("zoom", currentZoom)
            .put("cameraFacing", currentFacing)
    }

    private fun watermarkPositionPayload(template: WatermarkTemplate?): JSONObject {
        return JSONObject()
            .put("x", template?.positionX ?: 0f)
            .put("y", template?.positionY ?: 0f)
            .put("width", template?.boxWidth ?: 0f)
            .put("height", template?.boxHeight ?: 0f)
            .put("watermarkTemplateId", template?.templateId ?: "")
    }

    private fun mediaResultPayload(
        tempFilePath: String,
        albumFilePath: String,
        durationMs: Long?,
        width: Int,
        height: Int,
        template: WatermarkTemplate?
    ): JSONObject {
        val payload = JSONObject()
            .put("tempFilePath", tempFilePath)
            .put("albumFilePath", albumFilePath)
            .put("width", width)
            .put("height", height)
            .put("watermarkTemplateId", template?.templateId ?: "")
            .put("watermarkPositionX", template?.positionX ?: 0f)
            .put("watermarkPositionY", template?.positionY ?: 0f)
            .put("watermarkBoxWidth", template?.boxWidth ?: 0f)
            .put("watermarkBoxHeight", template?.boxHeight ?: 0f)
            .put("watermarkTemplateSnapshot", template?.toJson() ?: JSONObject())
        if (durationMs != null) {
            payload.put("durationMs", durationMs)
        }
        return payload
    }

    private fun ok(data: JSONObject = JSONObject()): String {
        return JSONObject()
            .put("success", true)
            .put("errorCode", "")
            .put("errorMessage", "")
            .put("nativeMessage", "")
            .put("data", data)
            .toString()
    }

    private fun fail(errorCode: String, errorMessage: String, nativeMessage: String = ""): String {
        return JSONObject()
            .put("success", false)
            .put("errorCode", errorCode)
            .put("errorMessage", errorMessage)
            .put("nativeMessage", nativeMessage)
            .put("data", JSONObject())
            .toString()
    }

    private fun failAndEmit(errorCode: String, errorMessage: String, nativeMessage: String = ""): String {
        emitError(errorCode, errorMessage, nativeMessage)
        return fail(errorCode, errorMessage, nativeMessage)
    }

    private fun emitError(errorCode: String, errorMessage: String, nativeMessage: String) {
        if (errorCode == "1101") {
            notifyCameraReadyFailed(nativeMessage)
        }
        emit(
            "nativeerror",
            JSONObject()
                .put("errorCode", errorCode)
                .put("errorMessage", errorMessage)
                .put("nativeMessage", nativeMessage)
        )
    }

    private fun emit(event: String, payload: JSONObject) {
        val callback = eventCallback ?: return
        mainHandler.post {
            callback.invoke(event, payload.toString())
        }
    }

    private fun chooseOutputSizeFromPreview(): Size {
        val sourceWidth = previewView.width.takeIf { it > 0 } ?: previewSize.width
        val sourceHeight = previewView.height.takeIf { it > 0 } ?: previewSize.height
        val longEdgeScale = MAX_RECORDING_LONG_EDGE.toDouble() / max(sourceWidth, sourceHeight).toDouble()
        val pixelScale = sqrt(MAX_RECORDING_PIXELS.toDouble() / (sourceWidth * sourceHeight).toDouble())
        val scale = min(1.0, min(longEdgeScale, pixelScale))
        return Size(evenDimension((sourceWidth * scale).toInt()), evenDimension((sourceHeight * scale).toInt()))
    }

    private fun choosePreviewSize(characteristics: CameraCharacteristics): Size {
        val sizes = characteristics
            .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(SurfaceTexture::class.java)
            ?: return Size(720, 1280)
        return sizes
            .filter { it.width <= 1920 && it.height <= 1920 && it.width % 2 == 0 && it.height % 2 == 0 }
            .maxByOrNull { it.width * it.height }
            ?: Size(720, 1280)
    }

    private fun evenDimension(value: Int): Int {
        val safe = max(2, value)
        return if (safe % 2 == 0) safe else safe - 1
    }

    private fun selectCamera(manager: CameraManager, facing: String): String {
        val preferred = if (facing == "front") {
            CameraCharacteristics.LENS_FACING_FRONT
        } else {
            CameraCharacteristics.LENS_FACING_BACK
        }
        return manager.cameraIdList.firstOrNull { id ->
            manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == preferred
        } ?: error("No $facing camera id available.")
    }

    private fun cameraFacingAvailable(facing: String): Boolean {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        return try {
            selectCamera(manager, facing).isNotBlank()
        } catch (_: Throwable) {
            false
        }
    }

    private fun selectFpsRange(): Range<Int>? {
        val ranges = activeCharacteristics?.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?: return null
        return ranges
            .filter { range -> range.upper >= DEFAULT_FPS }
            .minWithOrNull(
                compareBy<Range<Int>>(
                    { range -> range.upper - DEFAULT_FPS },
                    { range -> if (range.lower <= DEFAULT_FPS) 0 else range.lower - DEFAULT_FPS },
                    { range -> range.upper - range.lower }
                )
            )
            ?: ranges.maxByOrNull { range -> range.upper }
    }

    private fun applyZoom(builder: CaptureRequest.Builder) {
        val characteristics = activeCharacteristics ?: return
        val zoomRatio = when (currentZoom) {
            "2x" -> 2f
            "wide" -> wideZoomRatio()
            else -> 1f
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val range = characteristics.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
            if (range != null && zoomRatio in range.lower..range.upper) {
                builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, zoomRatio)
                return
            }
        }
        if (zoomRatio >= 1f) {
            val sensorRect = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE) ?: return
            val maxZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f
            val safeZoom = zoomRatio.coerceIn(1f, maxZoom)
            builder.set(CaptureRequest.SCALER_CROP_REGION, cropRect(sensorRect, safeZoom))
        }
    }

    private fun cropRect(sensorRect: Rect, zoom: Float): Rect {
        val cropWidth = (sensorRect.width() / zoom).roundToInt()
        val cropHeight = (sensorRect.height() / zoom).roundToInt()
        val left = sensorRect.left + (sensorRect.width() - cropWidth) / 2
        val top = sensorRect.top + (sensorRect.height() - cropHeight) / 2
        return Rect(left, top, left + cropWidth, top + cropHeight)
    }

    private fun availableZooms(): List<String> {
        val characteristics = activeCharacteristics ?: return listOf("1x")
        val maxZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f
        val zooms = mutableListOf("1x")
        val hasWide = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val range = characteristics.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
            range != null && range.lower < 1f
        } else {
            false
        }
        if (hasWide) zooms.add(0, "wide")
        if (maxZoom >= 2f) zooms.add("2x")
        return zooms
    }

    private fun availableZoomsJson(): org.json.JSONArray {
        val array = org.json.JSONArray()
        availableZooms().forEach { array.put(it) }
        return array
    }

    private fun wideZoomRatio(): Float {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val range = activeCharacteristics?.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
            if (range != null && range.lower < 1f) return range.lower
        }
        return 1f
    }

    private fun publishPhotoToGallery(source: File): String {
        val displayName = "uts-markvideo-${System.currentTimeMillis()}.jpg"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, displayName)
                put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/uts-markvideo")
                put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Unable to create gallery photo entry.")
            try {
                resolver.openOutputStream(uri)?.use { output ->
                    FileInputStream(source).use { input ->
                        input.copyTo(output)
                    }
                } ?: throw IllegalStateException("Unable to write gallery photo.")
                values.clear()
                values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                return uri.toString()
            } catch (throwable: Throwable) {
                resolver.delete(uri, null, null)
                throw throwable
            }
        }

        val outputDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "uts-markvideo").apply {
            if (!exists()) mkdirs()
        }
        val outputFile = File(outputDir, displayName)
        FileInputStream(source).use { input ->
            FileOutputStream(outputFile).use { output ->
                input.copyTo(output)
            }
        }
        MediaScannerConnection.scanFile(context, arrayOf(outputFile.absolutePath), arrayOf("image/jpeg"), null)
        return Uri.fromFile(outputFile).toString()
    }

    private fun publishVideoToGallery(source: File): String {
        val displayName = "uts-markvideo-${System.currentTimeMillis()}.mp4"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, displayName)
                put(android.provider.MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, "Movies/uts-markvideo")
                put(android.provider.MediaStore.Video.Media.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Unable to create gallery video entry.")
            try {
                resolver.openOutputStream(uri)?.use { output ->
                    FileInputStream(source).use { input ->
                        input.copyTo(output)
                    }
                } ?: throw IllegalStateException("Unable to write gallery video.")
                values.clear()
                values.put(android.provider.MediaStore.Video.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                return uri.toString()
            } catch (throwable: Throwable) {
                resolver.delete(uri, null, null)
                throw throwable
            }
        }

        val outputDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "uts-markvideo").apply {
            if (!exists()) mkdirs()
        }
        val outputFile = File(outputDir, displayName)
        FileInputStream(source).use { input ->
            FileOutputStream(outputFile).use { output ->
                input.copyTo(output)
            }
        }
        MediaScannerConnection.scanFile(context, arrayOf(outputFile.absolutePath), arrayOf("video/mp4"), null)
        return Uri.fromFile(outputFile).toString()
    }

    private fun hasPermission(permission: String): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestPermission(permission: String, requestCode: Int) {
        val activity = context.findActivity() ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            activity.requestPermissions(arrayOf(permission), requestCode)
        }
    }

    private fun Context.findActivity(): Activity? {
        var current: Context? = this
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return null
    }

    private fun parseObject(json: String): JSONObject {
        return try {
            if (json.isBlank()) JSONObject() else JSONObject(json)
        } catch (_: Throwable) {
            JSONObject()
        }
    }

    private fun cloneJson(source: JSONObject): JSONObject {
        return JSONObject(source.toString())
    }

    private fun inRange(value: Float, minValue: Float, maxValue: Float): Boolean {
        return value >= minValue && value <= maxValue
    }

    private fun logicalPx(value: Float): Float {
        return value * resources.displayMetrics.density
    }

    private fun logicalPx(value: Number): Float {
        return logicalPx(value.toFloat())
    }

    private fun parseColorStrict(value: String): Int? {
        val raw = value.trim()
        return when {
            raw.matches(Regex("^#[0-9a-fA-F]{6}$")) -> {
                Color.rgb(
                    raw.substring(1, 3).toInt(16),
                    raw.substring(3, 5).toInt(16),
                    raw.substring(5, 7).toInt(16)
                )
            }
            raw.matches(Regex("^#[0-9a-fA-F]{8}$")) -> {
                Color.argb(
                    raw.substring(1, 3).toInt(16),
                    raw.substring(3, 5).toInt(16),
                    raw.substring(5, 7).toInt(16),
                    raw.substring(7, 9).toInt(16)
                )
            }
            raw.startsWith("rgba", ignoreCase = true) -> parseRgba(raw)
            else -> null
        }
    }

    private fun parseRgba(value: String): Int? {
        val match = Regex("""rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)""")
            .matchEntire(value)
            ?: return null
        val red = match.groupValues[1].toInt()
        val green = match.groupValues[2].toInt()
        val blue = match.groupValues[3].toInt()
        val alpha = match.groupValues[4].toFloat()
        if (red !in 0..255 || green !in 0..255 || blue !in 0..255 || alpha < 0f || alpha > 1f) {
            return null
        }
        return Color.argb((alpha * 255f).roundToInt().coerceIn(0, 255), red, green, blue)
    }

    private inner class WatermarkOverlayView(context: Context) : View(context) {
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            drawWatermarkOnCanvas(canvas, width, height, currentTemplate)
        }
    }

    private data class WatermarkTemplate(
        val templateId: String,
        val templateName: String,
        val templateType: String,
        val mainTitleText: String,
        val subtitleText: String,
        val mainTitleColor: Int,
        val subtitleColor: Int,
        val mainTitleFontSize: Float,
        val subtitleFontSize: Float,
        val mainTitleBold: Boolean,
        val subtitleBold: Boolean,
        val imagePath: String,
        val imageMimeType: String,
        val imageWidth: Float,
        val imageHeight: Float,
        val imageTextGap: Float,
        val boxWidth: Float,
        val boxHeight: Float,
        val boxBackgroundColor: Int,
        val boxRadius: Float,
        val boxPadding: Float,
        val positionX: Float,
        val positionY: Float,
        val raw: JSONObject
    ) {
        fun clamped(): WatermarkTemplate {
            val nextX = positionX.coerceIn(0f, max(0f, 1f - boxWidth))
            val nextY = positionY.coerceIn(0f, max(0f, 1f - boxHeight))
            raw.put("positionX", nextX)
            raw.put("positionY", nextY)
            raw.put("boxWidth", boxWidth)
            raw.put("boxHeight", boxHeight)
            return copy(positionX = nextX, positionY = nextY, raw = raw)
        }

        fun toJson(): JSONObject {
            return JSONObject(raw.toString())
        }
    }

    private data class TemplateParseResult(
        val success: Boolean,
        val template: WatermarkTemplate?,
        val errorCode: String,
        val errorMessage: String,
        val nativeMessage: String
    ) {
        companion object {
            fun success(template: WatermarkTemplate): TemplateParseResult {
                return TemplateParseResult(true, template, "", "", "")
            }

            fun invalid(nativeMessage: String): TemplateParseResult {
                return TemplateParseResult(false, null, "1201", "水印模板参数无效", nativeMessage)
            }

            fun imageUnreadable(nativeMessage: String): TemplateParseResult {
                return TemplateParseResult(false, null, "1202", "水印图片资源不可读或解码失败", nativeMessage)
            }
        }
    }

    private data class CameraOpenSetup(
        val failure: String?,
        val readyLatch: CountDownLatch?
    )

    private data class SnapshotCapture(
        val failure: String?,
        val size: Size?,
        val template: WatermarkTemplate?,
        val snapshot: Bitmap?
    )

    private data class RecordStartSetup(
        val failure: String?,
        val size: Size?,
        val file: File?
    )

    private data class RecordStopSetup(
        val failure: String?,
        val recorder: CameraMp4Recorder?,
        val file: File?,
        val template: WatermarkTemplate?
    )

    private data class RecordingFrameStats(
        var received: Int = 0,
        var droppedBusy: Int = 0,
        var processed: Int = 0,
        var encoded: Int = 0
    ) {
        fun reset() {
            received = 0
            droppedBusy = 0
            processed = 0
            encoded = 0
        }
    }

    private class CameraMp4Recorder(
        private val output: File,
        val width: Int,
        val height: Int,
        private val fps: Int,
        private val bitrate: Int,
        private val includeAudio: Boolean
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
        private var muxer: MediaMuxer? = null
        private var colorFormat: Int = 0
        private var videoTrackIndex = -1
        private var audioTrackIndex = -1
        private var muxerStarted = false
        private val reusablePixels = IntArray(frameSize)
        private val reusableYuv = ByteArray(frameSize + quarterFrameSize * 2)
        var frameCount: Int = 0
            private set

        fun start() {
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
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
                setInteger(MediaFormat.KEY_BIT_RATE, if (bitrate > 0) bitrate else width * height * 3)
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
            }, "uts-markvideo-embedded-audio").apply {
                start()
            }
        }

        fun encodeFrame(bitmap: Bitmap): Boolean {
            val activeEncoder = videoEncoder ?: return false
            val inputIndex = activeEncoder.dequeueInputBuffer(TIMEOUT_US)
            if (inputIndex < 0) {
                drainVideo(endOfStream = false)
                return false
            }
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
            drainVideo(endOfStream = false)
            return true
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
                            codec.queueInputBuffer(
                                inputIndex,
                                0,
                                bytesRead,
                                audioPresentationTimeUs(),
                                0
                            )
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

        private fun queueAudioEndOfStream(
            codec: MediaCodec,
            bufferInfo: MediaCodec.BufferInfo,
            deadlineMs: Long
        ) {
            while (System.currentTimeMillis() < deadlineMs) {
                val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    codec.queueInputBuffer(
                        inputIndex,
                        0,
                        0,
                        audioPresentationTimeUs(),
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM
                    )
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

        private fun addMuxerTrack(activeMuxer: MediaMuxer, format: MediaFormat, isAudio: Boolean): Int {
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
            activeMuxer: MediaMuxer,
            trackIndex: Int,
            encodedData: ByteBuffer,
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

        private fun isPlanar(activeColorFormat: Int): Boolean {
            return activeColorFormat == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar ||
                activeColorFormat == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedPlanar
        }
    }

    private companion object {
        const val TYPE_TITLE_TEXT = "title_text"
        const val TYPE_TITLE_SUBTITLE_TEXT = "title_subtitle_text"
        const val TYPE_IMAGE_TITLE_SUBTITLE = "image_title_subtitle"
        val VALID_TEMPLATE_TYPES = setOf(TYPE_TITLE_TEXT, TYPE_TITLE_SUBTITLE_TEXT, TYPE_IMAGE_TITLE_SUBTITLE)
        const val DEFAULT_MAIN_TITLE_COLOR = "#26313B"
        const val DEFAULT_SUBTITLE_COLOR = "#56616D"
        const val DEFAULT_BOX_BACKGROUND_COLOR = "rgba(255,255,255,0.78)"
        const val REQUEST_CAMERA_PERMISSION = 6201
        const val REQUEST_AUDIO_PERMISSION = 6202
        const val DEFAULT_FPS = 24
        const val MAX_RECORDING_LONG_EDGE = 960
        const val MAX_RECORDING_PIXELS = 720 * 960
        const val MAIN_THREAD_TIMEOUT_MS = 4_000L
        const val CAMERA_READY_TIMEOUT_MS = 4_000L
        const val FIRST_FRAME_GRACE_MS = 800L
        const val FINISH_TIMEOUT_MS = 4_000L
        const val MIME_TYPE = "video/avc"
        const val TIMEOUT_US = 10_000L
        const val AUDIO_SAMPLE_RATE = 44_100
        const val AUDIO_CHANNEL_COUNT = 1
        const val AUDIO_BIT_RATE = 64_000
        const val AUDIO_CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_PCM_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }
}
