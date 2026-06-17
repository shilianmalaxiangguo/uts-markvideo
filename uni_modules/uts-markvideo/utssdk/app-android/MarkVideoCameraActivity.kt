package uts.markvideo.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.Image
import android.media.ImageReader
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
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Gravity
import android.view.MotionEvent
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewConfiguration
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class MarkVideoCameraActivity : Activity() {
    private val watermarkText: String by lazy {
        intent.getStringExtra(MarkVideoNative.EXTRA_WATERMARK_TEXT) ?: "UTS 即拍即有水印"
    }
    private val watermarkImagePath: String by lazy {
        intent.getStringExtra(MarkVideoNative.EXTRA_WATERMARK_IMAGE_PATH) ?: ""
    }
    private val watermarkTextColor: Int by lazy {
        parseColorExtra(
            intent.getStringExtra(MarkVideoNative.EXTRA_WATERMARK_TEXT_COLOR),
            Color.WHITE
        )
    }
    private val watermarkTextFontSize: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_TEXT_FONT_SIZE, 0f).coerceAtLeast(0f)
    }
    private val watermarkTextBold: Boolean by lazy {
        intent.getBooleanExtra(MarkVideoNative.EXTRA_WATERMARK_TEXT_BOLD, true)
    }
    private val watermarkImageWidth: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_IMAGE_WIDTH, 0f).coerceAtLeast(0f)
    }
    private val watermarkImageHeight: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_IMAGE_HEIGHT, 0f).coerceAtLeast(0f)
    }
    private val watermarkImageGap: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_IMAGE_GAP, 0f).coerceAtLeast(0f)
    }
    private val watermarkBoxWidthRatio: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_BOX_WIDTH, 0f).coerceIn(0f, 1f)
    }
    private val watermarkBoxHeightRatio: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_BOX_HEIGHT, 0f).coerceIn(0f, 1f)
    }
    private val watermarkBoxBackgroundColor: Int by lazy {
        parseColorExtra(
            intent.getStringExtra(MarkVideoNative.EXTRA_WATERMARK_BOX_BACKGROUND_COLOR),
            Color.argb(155, 0, 0, 0)
        )
    }
    private val watermarkBoxBorderRadius: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_BOX_BORDER_RADIUS, 18f).coerceAtLeast(0f)
    }
    private val watermarkBoxPadding: Float by lazy {
        intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_BOX_PADDING, 0f).coerceAtLeast(0f)
    }
    private val targetFps: Int by lazy {
        intent.getIntExtra(MarkVideoNative.EXTRA_FPS, 30).coerceIn(8, 60)
    }
    private val targetBitrate: Int by lazy {
        intent.getIntExtra(MarkVideoNative.EXTRA_BITRATE, 0)
    }
    private val includeAudio: Boolean by lazy {
        intent.getBooleanExtra(MarkVideoNative.EXTRA_INCLUDE_AUDIO, true)
    }
    private val cameraFacing: String by lazy {
        intent.getStringExtra(MarkVideoNative.EXTRA_CAMERA_FACING) ?: "back"
    }
    private val maxDurationMs: Long by lazy {
        intent.getLongExtra(MarkVideoNative.EXTRA_MAX_DURATION_MS, 0L)
    }
    private val minDurationMs: Long by lazy {
        intent.getLongExtra(MarkVideoNative.EXTRA_MIN_DURATION_MS, 0L)
    }
    private val perfLogging: Boolean by lazy {
        intent.getBooleanExtra(MarkVideoNative.EXTRA_PERF_LOGGING, false)
    }

    private lateinit var previewView: TextureView
    private lateinit var watermarkOverlay: WatermarkOverlayView
    private lateinit var statusView: TextView
    private lateinit var recordButton: Button
    private lateinit var stopButton: Button

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var recorderThread: HandlerThread? = null
    private var recorderHandler: Handler? = null
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var previewSurface: Surface? = null
    private var captureSize: Size = Size(640, 480)
    private var recordingSize: Size = Size(640, 480)
    private val processingFrame = AtomicBoolean(false)
    private val snapshotFramePending = AtomicBoolean(false)

    @Volatile private var recording = false
    @Volatile private var stoppingRecording = false
    @Volatile private var finishingRecording = false
    @Volatile private var recorder: CameraMp4Recorder? = null
    private var outputFile: File? = null
    private var recordingStartedAt = 0L
    private var completed = false
    private var openingCamera = false
    private var previewFrameCounter = 0
    private var lastProcessedFrameAtMs = 0L
    private val previewSnapshotEncoding = true
    @Volatile private var snapshotCaptureRunning = false
    private var activityCreatedAtMs = 0L
    private var cameraOpenStartedAtMs = 0L
    private var sessionCreateStartedAtMs = 0L
    private var recorderStartRequestedAtMs = 0L
    private var firstFrameLogged = false
    private var reusableArgb: IntArray? = null
    private var reusableSnapshotBitmap: Bitmap? = null
    private var watermarkImage: Bitmap? = null
    private var scaledWatermarkImage: Bitmap? = null
    private var watermarkCenterXRatio = 0.5f
    private var watermarkCenterYRatio = 0.78f
    private var watermarkDragArmed = false
    private var watermarkDragging = false
    private val recordFrameStats = RecordingFrameStats()
    private val autoStopRunnable = Runnable {
        if (recording) {
            stopRecording(deleteFile = false)
        }
    }
    private val snapshotCaptureRunnable = object : Runnable {
        override fun run() {
            if (!snapshotCaptureRunning) return
            if (!recording || finishingRecording) {
                snapshotCaptureRunning = false
                return
            }

            requestPreviewSnapshotFrame()
        }
    }
    private val watermarkLongPressRunnable = Runnable {
        if (!recording && ::watermarkOverlay.isInitialized) {
            watermarkDragArmed = true
            statusView.text = "Drag watermark to position it before recording."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activityCreatedAtMs = System.currentTimeMillis()
        watermarkCenterXRatio = intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_X, 0.5f).coerceIn(0f, 1f)
        watermarkCenterYRatio = intent.getFloatExtra(MarkVideoNative.EXTRA_WATERMARK_Y, 0.78f).coerceIn(0f, 1f)
        perfLog("activity_on_create")
        buildUi()

        if (hasRequiredPermissions()) {
            startCameraThread()
            openCameraWhenPreviewReady()
        } else {
            requestRequiredPermissions()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_REQUIRED_PERMISSIONS && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            startCameraThread()
            openCameraWhenPreviewReady()
        } else {
            finishWithError(
                MarkVideoNative.ERR_PERMISSION_DENIED,
                "Camera or microphone permission denied."
            )
        }
    }

    override fun onBackPressed() {
        if (recording && !finishingRecording) {
            stopRecording(deleteFile = true)
        }
        if (!completed && !finishingRecording) {
            completed = true
            MarkVideoNative.failCameraRecorder(
                MarkVideoNative.ERR_CANCELLED,
                "Recording cancelled."
            )
        }
        super.onBackPressed()
    }

    override fun onDestroy() {
        stopButton.removeCallbacks(autoStopRunnable)
        stopPreviewSnapshotLoop()
        releaseWatermarkImages()
        releaseSnapshotBitmap()
        closeCamera()
        stopCameraThread()
        stopRecorderThread()
        if (!completed && !finishingRecording) {
            MarkVideoNative.failCameraRecorder(
                MarkVideoNative.ERR_CANCELLED,
                "Recorder closed before a video was created."
            )
        }
        super.onDestroy()
    }

    private fun buildUi() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(16, 22, 30))
        }

        previewView = TextureView(this).apply {
            surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                    previewSurface = Surface(surface)
                    openCameraWhenPreviewReady()
                }

                override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
                }

                override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                    releasePreviewSurface()
                    return true
                }

                override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
                }
            }
        }
        root.addView(previewView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        watermarkOverlay = WatermarkOverlayView(this).apply {
            setOnTouchListener { view, event ->
                handleWatermarkOverlayTouch(view, event)
            }
        }
        root.addView(watermarkOverlay, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.TOP or Gravity.START
        ))
        watermarkOverlay.post {
            positionWatermarkOverlayFromRatio()
        }

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(12), dp(18), dp(18))
            setBackgroundColor(Color.argb(190, 16, 22, 30))
        }

        statusView = TextView(this).apply {
            text = "Long-press watermark to drag before recording."
            setTextColor(Color.rgb(224, 233, 241))
            textSize = 13f
            gravity = Gravity.CENTER
        }
        controls.addView(statusView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        recordButton = Button(this).apply {
            text = "开始录制"
            setOnClickListener { startRecording() }
        }
        stopButton = Button(this).apply {
            text = "结束录制"
            isEnabled = false
            setOnClickListener { stopRecording(deleteFile = false) }
        }
        row.addView(recordButton, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
            rightMargin = dp(8)
        })
        row.addView(stopButton, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
            leftMargin = dp(8)
        })
        controls.addView(row, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = dp(10)
        })

        root.addView(controls, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        ))

        setContentView(root)
    }

    private fun startRecording() {
        startRecorderThread()
        val handler = recorderHandler
        if (handler == null) {
            finishWithError(
                MarkVideoNative.ERR_RECORDER_START_FAILED,
                "Recorder thread is not running."
            )
            return
        }
        if (::watermarkOverlay.isInitialized) {
            updateWatermarkRatiosFromOverlay()
        }
        recordingSize = chooseRecordingSizeFromPreview()
        recordButton.isEnabled = false
        stopButton.isEnabled = true
        statusView.text = "Recording with burned-in watermark..."
        recorderStartRequestedAtMs = System.currentTimeMillis()
        firstFrameLogged = false
        perfLog("record_start_requested")

        handler.post {
            try {
                val startSetupAtMs = System.currentTimeMillis()
                val outputSize = recordingSize
                val file = File(cacheDir, "uts-camera-watermark-${System.currentTimeMillis()}.mp4")
                val nextRecorder = CameraMp4Recorder(
                    output = file,
                    width = outputSize.width,
                    height = outputSize.height,
                    fps = targetFps,
                    bitrate = targetBitrate,
                    includeAudio = includeAudio,
                    perfLogger = ::perfLogDuration
                )
                nextRecorder.start()
                perfLogDuration("recorder_start_setup", startSetupAtMs)
                outputFile = file
                recorder = nextRecorder
                recordFrameStats.reset()
                snapshotFramePending.set(false)
                recordingStartedAt = System.currentTimeMillis()
                stoppingRecording = false
                finishingRecording = false
                recording = true
                startPreviewSnapshotLoop()
                if (maxDurationMs > 0L) {
                    runOnUiThread {
                        stopButton.removeCallbacks(autoStopRunnable)
                        stopButton.postDelayed(autoStopRunnable, maxDurationMs)
                    }
                }
            } catch (throwable: Throwable) {
                recording = false
                recorder = null
                outputFile?.delete()
                outputFile = null
                runOnUiThread {
                    recordButton.isEnabled = true
                    stopButton.isEnabled = false
                    statusView.text = throwable.message ?: "Recorder start failed."
                    finishWithError(
                        classifyRecorderStartError(throwable),
                        throwable.message ?: "Recorder start failed."
                    )
                }
            }
        }
    }

    private fun stopRecording(deleteFile: Boolean) {
        val handler = recorderHandler
        recordButton.isEnabled = false
        stopButton.isEnabled = false
        stopButton.removeCallbacks(autoStopRunnable)
        statusView.text = "Finishing MP4..."
        val stopRequestedAtMs = System.currentTimeMillis()
        stoppingRecording = true
        finishingRecording = true
        stopPreviewSnapshotLoop()
        perfLog("record_stop_requested")

        if (handler == null) {
            finishWithError(
                MarkVideoNative.ERR_RECORDER_STOP_FAILED,
                "Recorder thread is not running."
            )
            return
        }

        handler.post {
            finishRecordingOnCameraThread(deleteFile, stopRequestedAtMs)
        }
    }

    private fun finishRecordingOnCameraThread(deleteFile: Boolean, stopRequestedAtMs: Long) {
        val activeRecorder = recorder
        val file = outputFile

        if (!deleteFile &&
            activeRecorder != null &&
            activeRecorder.frameCount == 0 &&
            System.currentTimeMillis() - stopRequestedAtMs < FIRST_FRAME_STOP_GRACE_MS
        ) {
            requestPreviewSnapshotFrame()
            recorderHandler?.postDelayed({
                finishRecordingOnCameraThread(deleteFile, stopRequestedAtMs)
            }, 80L)
            return
        }

        recording = false
        recorder = null
        outputFile = null

        try {
            activeRecorder?.finish()
            perfLogDuration("record_stop_finish", stopRequestedAtMs)
            if (deleteFile) {
                file?.delete()
                finishingRecording = false
                completed = true
                runOnUiThread {
                    MarkVideoNative.failCameraRecorder(
                        MarkVideoNative.ERR_CANCELLED,
                        "Recording cancelled."
                    )
                    finish()
                }
                return
            }
            if (file == null || activeRecorder == null || activeRecorder.frameCount == 0) {
                file?.delete()
                throw MarkVideoException(
                    MarkVideoNative.ERR_NO_FRAMES,
                    "No frames were recorded."
                )
            }

            val durationMs = max(1L, System.currentTimeMillis() - recordingStartedAt)
            if (!deleteFile && minDurationMs > 0L && durationMs < minDurationMs) {
                file.delete()
                throw MarkVideoException(
                    MarkVideoNative.ERR_RECORDING_TOO_SHORT,
                    "Recording is shorter than ${minDurationMs}ms."
                )
            }
            val stats = recordFrameStats.copy(encoded = activeRecorder.frameCount)
            perfLog(
                "frame_stats received=${stats.received} " +
                    "dropped_busy=${stats.droppedBusy} " +
                    "dropped_fps=${stats.droppedFps} " +
                    "processed=${stats.processed} " +
                    "encoded=${stats.encoded}"
            )
            val savedPath = publishToGallery(file)
            completed = true
            finishingRecording = false
            runOnUiThread {
                    MarkVideoNative.completeCameraRecorder(
                        file.absolutePath,
                        savedPath,
                        durationMs,
                        activeRecorder.width,
                        activeRecorder.height,
                        watermarkText,
                    stats.received,
                    stats.droppedBusy,
                    stats.droppedFps,
                    stats.processed,
                    stats.encoded
                )
                finish()
            }
        } catch (throwable: Throwable) {
            file?.delete()
            finishingRecording = false
            runOnUiThread {
                finishWithError(
                    classifyRecorderStopError(throwable),
                    throwable.message ?: "Recorder stop failed."
                )
            }
        }
    }

    private fun startCameraThread() {
        if (cameraThread != null) return
        cameraThread = HandlerThread("uts-markvideo-camera").also {
            it.start()
            cameraHandler = Handler(it.looper)
        }
    }

    private fun stopCameraThread() {
        cameraThread?.quitSafely()
        cameraThread = null
        cameraHandler = null
    }

    private fun startRecorderThread() {
        if (recorderThread != null) return
        recorderThread = HandlerThread("uts-markvideo-recorder").also {
            it.start()
            recorderHandler = Handler(it.looper)
        }
    }

    private fun stopRecorderThread() {
        val handler = recorderHandler
        val thread = recorderThread
        recording = false
        recorderHandler = null
        recorderThread = null
        if (handler == null || thread == null) return
        handler.post {
            val activeRecorder = recorder
            val file = outputFile
            recorder = null
            outputFile = null
            try {
                activeRecorder?.finish()
            } catch (_: Throwable) {
            }
            file?.delete()
            thread.quitSafely()
        }
    }

    private fun handleWatermarkOverlayTouch(view: View, event: MotionEvent): Boolean {
        if (recording || finishingRecording) return true

        return when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                watermarkDragArmed = false
                watermarkDragging = false
                view.postDelayed(watermarkLongPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
                true
            }
            MotionEvent.ACTION_MOVE -> {
                if (watermarkDragArmed) {
                    watermarkDragging = true
                    updateWatermarkOverlayPosition(event.x, event.y)
                }
                true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                view.removeCallbacks(watermarkLongPressRunnable)
                if (watermarkDragging) {
                    updateWatermarkRatiosFromOverlay()
                    statusView.text = "Watermark position saved. Start recording when ready."
                }
                watermarkDragArmed = false
                watermarkDragging = false
                true
            }
            else -> true
        }
    }

    private fun updateWatermarkOverlayPosition(rawX: Float, rawY: Float) {
        if (watermarkOverlay.width <= 0 || watermarkOverlay.height <= 0) return
        watermarkCenterXRatio = (rawX / watermarkOverlay.width).coerceIn(0f, 1f)
        watermarkCenterYRatio = (rawY / watermarkOverlay.height).coerceIn(0f, 1f)
        watermarkOverlay.invalidate()
    }

    private fun updateWatermarkRatiosFromOverlay() {
        watermarkCenterXRatio = watermarkCenterXRatio.coerceIn(0f, 1f)
        watermarkCenterYRatio = watermarkCenterYRatio.coerceIn(0f, 1f)
    }

    private fun positionWatermarkOverlayFromRatio() {
        watermarkOverlay.invalidate()
    }

    private fun openCameraWhenPreviewReady() {
        if (cameraHandler == null || !hasRequiredPermissions()) return
        if (!previewView.isAvailable && previewSurface == null) return
        if (cameraDevice != null || openingCamera) return
        openCamera()
    }

    private fun ensurePreviewSurface(): Surface? {
        previewSurface?.let { return it }
        val texture = previewView.surfaceTexture ?: return null
        texture.setDefaultBufferSize(captureSize.width, captureSize.height)
        return Surface(texture).also { previewSurface = it }
    }

    private fun openCamera() {
        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val handler = cameraHandler ?: return

        try {
            openingCamera = true
            cameraOpenStartedAtMs = System.currentTimeMillis()
            val cameraId = selectCamera(manager)
            val characteristics = manager.getCameraCharacteristics(cameraId)
            captureSize = chooseCaptureSize(characteristics)
            previewView.surfaceTexture?.setDefaultBufferSize(captureSize.width, captureSize.height)
            perfLog("camera_open_start id=$cameraId size=${captureSize.width}x${captureSize.height}")
            imageReader = ImageReader.newInstance(
                captureSize.width,
                captureSize.height,
                android.graphics.ImageFormat.YUV_420_888,
                2
            ).apply {
                setOnImageAvailableListener({ reader ->
                    handleNextImage(reader)
                }, handler)
            }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !hasRequiredPermissions()) {
                    requestRequiredPermissions()
                    return
                }
            manager.openCamera(cameraId, cameraStateCallback, handler)
        } catch (throwable: Throwable) {
            openingCamera = false
            finishWithError(
                MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                throwable.message ?: "Open camera failed."
            )
        }
    }

    private fun closeCamera() {
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
        try {
            imageReader?.close()
        } catch (_: Throwable) {
        }
        imageReader = null
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

    private val cameraStateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            openingCamera = false
            perfLogDuration("camera_opened", cameraOpenStartedAtMs)
            cameraDevice = camera
            createCaptureSession()
        }

        override fun onDisconnected(camera: CameraDevice) {
            openingCamera = false
            try {
                camera.close()
            } catch (_: Throwable) {
            }
            finishWithError(
                MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                "Camera disconnected."
            )
        }

        override fun onError(camera: CameraDevice, error: Int) {
            openingCamera = false
            try {
                camera.close()
            } catch (_: Throwable) {
            }
            finishWithError(
                MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                "Camera error: $error"
            )
        }
    }

    private fun createCaptureSession() {
        val camera = cameraDevice ?: return
        val reader = imageReader ?: return
        val preview = ensurePreviewSurface() ?: run {
            finishWithError(
                MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                "Preview surface is unavailable."
            )
            return
        }
        val handler = cameraHandler ?: return
        sessionCreateStartedAtMs = System.currentTimeMillis()
        perfLog("session_create_start")

        try {
            camera.createCaptureSession(
                listOf(preview, reader.surface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        try {
                            perfLogDuration("session_configured", sessionCreateStartedAtMs)
                            captureSession = session
                            val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                addTarget(preview)
                                addTarget(reader.surface)
                                set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                selectFpsRange()?.let { range ->
                                    set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                                }
                            }.build()
                            session.setRepeatingRequest(request, null, handler)
                            runOnUiThread {
                                statusView.text = "Preview ready. Long-press watermark to drag before recording."
                            }
                        } catch (throwable: Throwable) {
                            finishWithError(
                                MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                                throwable.message ?: "Camera preview request failed."
                            )
                        }
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        finishWithError(
                            MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                            "Camera session configure failed."
                        )
                    }
                },
                handler
            )
        } catch (throwable: Throwable) {
            finishWithError(
                MarkVideoNative.ERR_CAMERA_UNAVAILABLE,
                throwable.message ?: "Create camera session failed."
            )
        }
    }

    private fun handleNextImage(reader: ImageReader) {
        if (previewSnapshotEncoding) {
            reader.acquireLatestImage()?.close()
            return
        }

        if (!processingFrame.compareAndSet(false, true)) {
            reader.acquireLatestImage()?.let { image ->
                if (recording) {
                    recordFrameStats.received += 1
                    recordFrameStats.droppedBusy += 1
                }
                image.close()
            }
            return
        }

        val image = reader.acquireLatestImage()
        if (image == null) {
            processingFrame.set(false)
            return
        }

        if (!recording) {
            image.close()
            processingFrame.set(false)
            return
        }

        try {
            recordFrameStats.received += 1
            if (!shouldProcessFrame()) {
                recordFrameStats.droppedFps += 1
                return
            }
            recordFrameStats.processed += 1
            val logFramePerf = perfLogging && previewFrameCounter % 30 == 0
            val frameStartMs = System.currentTimeMillis()
            val toBitmapStartMs = System.currentTimeMillis()
            val sourceBitmap = image.toReusableBitmap()
            perfLogFrameDuration("frame_to_bitmap", toBitmapStartMs, logFramePerf)

            val drawStartMs = System.currentTimeMillis()
            drawWatermark(sourceBitmap)
            perfLogFrameDuration("frame_draw_watermark", drawStartMs, logFramePerf)

            if (!firstFrameLogged) {
                firstFrameLogged = true
                perfLogDuration("first_encoded_frame_after_start", recorderStartRequestedAtMs)
            }
            val encodeStartMs = System.currentTimeMillis()
            if (recorder?.encodeFrame(sourceBitmap) == true) {
                recordFrameStats.encoded += 1
            }
            perfLogFrameDuration("frame_encode", encodeStartMs, logFramePerf)
            previewFrameCounter += 1
            sourceBitmap.recycle()
            perfLogFrameDuration("frame_total", frameStartMs, logFramePerf)
        } catch (throwable: Throwable) {
            runOnUiThread {
                statusView.text = throwable.message ?: "Frame encode failed."
            }
        } finally {
            image.close()
            processingFrame.set(false)
        }
    }

    private fun startPreviewSnapshotLoop() {
        if (Looper.myLooper() != mainLooper) {
            runOnUiThread {
                startPreviewSnapshotLoop()
            }
            return
        }
        if (!previewSnapshotEncoding) {
            requestPreviewSnapshotFrame()
            return
        }
        if (!::previewView.isInitialized || snapshotCaptureRunning) return
        snapshotCaptureRunning = true
        previewView.removeCallbacks(snapshotCaptureRunnable)
        previewView.post(snapshotCaptureRunnable)
    }

    private fun stopPreviewSnapshotLoop() {
        snapshotCaptureRunning = false
        snapshotFramePending.set(false)
        if (Looper.myLooper() != mainLooper) {
            runOnUiThread {
                stopPreviewSnapshotLoop()
            }
            return
        }
        if (::previewView.isInitialized) {
            previewView.removeCallbacks(snapshotCaptureRunnable)
        }
    }

    private fun requestPreviewSnapshotFrame() {
        val handler = recorderHandler ?: return
        if (!recording || stoppingRecording && recorder?.frameCount != 0) return
        if (!snapshotFramePending.compareAndSet(false, true)) {
            if (recording) {
                recordFrameStats.droppedBusy += 1
            }
            return
        }

        runOnUiThread {
            val snapshotStartedAtMs = System.currentTimeMillis()
            if (!recording || stoppingRecording && recorder?.frameCount != 0) {
                snapshotFramePending.set(false)
                return@runOnUiThread
            }
            if (!previewView.isAvailable) {
                snapshotFramePending.set(false)
                scheduleNextPreviewSnapshotFrame(snapshotStartedAtMs)
                return@runOnUiThread
            }
            val snapshotTarget = reusableSnapshotBitmap?.takeIf {
                !it.isRecycled &&
                    it.width == recordingSize.width &&
                    it.height == recordingSize.height
            } ?: Bitmap.createBitmap(
                recordingSize.width,
                recordingSize.height,
                Bitmap.Config.ARGB_8888
            ).also {
                reusableSnapshotBitmap?.recycle()
                reusableSnapshotBitmap = it
            }
            val snapshot = previewView.getBitmap(snapshotTarget)
            if (snapshot == null) {
                snapshotFramePending.set(false)
                scheduleNextPreviewSnapshotFrame(snapshotStartedAtMs)
                return@runOnUiThread
            }
            handler.post {
                try {
                    encodePreviewSnapshotFrame(snapshot)
                } finally {
                    snapshotFramePending.set(false)
                    scheduleNextPreviewSnapshotFrame(snapshotStartedAtMs)
                }
            }
        }
    }

    private fun encodePreviewSnapshotFrame(sourceBitmap: Bitmap) {
        if (!recording || recorder == null) return
        recordFrameStats.received += 1
        recordFrameStats.processed += 1
        drawWatermark(sourceBitmap)
        if (!firstFrameLogged) {
            firstFrameLogged = true
            perfLogDuration("first_encoded_frame_after_start", recorderStartRequestedAtMs)
        }
        if (recorder?.encodeFrame(sourceBitmap) == true) {
            recordFrameStats.encoded += 1
        }
        previewFrameCounter += 1
    }

    private fun scheduleNextPreviewSnapshotFrame(snapshotStartedAtMs: Long) {
        if (!snapshotCaptureRunning || !recording || finishingRecording) return
        val elapsedMs = System.currentTimeMillis() - snapshotStartedAtMs
        val targetIntervalMs = max(1L, 1000L / targetFps)
        val delayMs = max(0L, targetIntervalMs - elapsedMs)
        runOnUiThread {
            if (snapshotCaptureRunning && recording && !finishingRecording) {
                previewView.postDelayed(snapshotCaptureRunnable, delayMs)
            }
        }
    }

    private fun perfLog(message: String) {
        if (perfLogging) {
            Log.d(PERF_TAG, message)
        }
    }

    private fun perfLogDuration(label: String, startMs: Long) {
        if (perfLogging && startMs > 0L) {
            Log.d(PERF_TAG, "$label=${System.currentTimeMillis() - startMs}ms")
        }
    }

    private fun perfLogFrameDuration(label: String, startMs: Long, shouldLog: Boolean) {
        if (shouldLog) {
            Log.d(PERF_TAG, "$label=${System.currentTimeMillis() - startMs}ms")
        }
    }

    private fun shouldProcessFrame(): Boolean {
        val nowMs = System.currentTimeMillis()
        val minFrameIntervalMs = max(1L, 1000L / targetFps)
        return if (nowMs - lastProcessedFrameAtMs >= minFrameIntervalMs) {
            lastProcessedFrameAtMs = nowMs
            true
        } else {
            false
        }
    }

    private fun drawWatermark(source: Bitmap) {
        drawWatermarkOnCanvas(Canvas(source), source.width, source.height)
    }

    private fun drawWatermarkOnCanvas(canvas: Canvas, width: Int, height: Int) {
        val bandHeight = if (watermarkBoxHeightRatio > 0f) {
            max(1f, height * watermarkBoxHeightRatio)
        } else {
            max(72f, height * 0.16f)
        }
        val bandWidth = if (watermarkBoxWidthRatio > 0f) {
            max(1f, width * watermarkBoxWidthRatio)
        } else {
            width * 0.88f
        }
        val centerX = width * watermarkCenterXRatio
        val centerY = height * watermarkCenterYRatio
        val bandLeft = (centerX - bandWidth / 2f).coerceIn(0f, width - bandWidth)
        val bandTop = (centerY - bandHeight / 2f).coerceIn(0f, height - bandHeight)
        val bandRight = bandLeft + bandWidth
        val bandRect = RectF(bandLeft, bandTop, bandRight, bandTop + bandHeight)

        val bandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = watermarkBoxBackgroundColor
        }
        canvas.drawRoundRect(bandRect, watermarkBoxBorderRadius, watermarkBoxBorderRadius, bandPaint)

        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = watermarkTextColor
            textSize = if (watermarkTextFontSize > 0f) watermarkTextFontSize else max(24f, width / 20f)
            isFakeBoldText = watermarkTextBold
        }
        val hasText = watermarkText.isNotBlank()
        val logo = getScaledWatermarkImage(defaultLogoHeight = (bandHeight * 0.68f).toInt())
        val contentPadding = if (watermarkBoxPadding > 0f) watermarkBoxPadding else max(16f, width * 0.035f)
        val contentGap = if (logo != null && hasText) {
            if (watermarkImageGap > 0f) watermarkImageGap else max(12f, width * 0.02f)
        } else {
            0f
        }
        val logoWidth = logo?.width?.toFloat() ?: 0f
        val textMaxWidth = max(0f, bandRect.width() - contentPadding * 2f - logoWidth - contentGap)

        while (hasText && textPaint.measureText(watermarkText) > textMaxWidth && textPaint.textSize > 20f) {
            textPaint.textSize -= 2f
        }

        val textWidth = if (hasText) textPaint.measureText(watermarkText) else 0f
        val contentWidth = logoWidth + contentGap + textWidth
        var cursorX = bandRect.left + (bandRect.width() - contentWidth) / 2f

        if (logo != null) {
            val logoTop = bandRect.centerY() - logo.height / 2f
            canvas.drawBitmap(logo, cursorX, logoTop, Paint(Paint.ANTI_ALIAS_FLAG))
            cursorX += logo.width + contentGap
        }

        if (!hasText) return

        textPaint.textAlign = Paint.Align.LEFT
        val baseline = bandTop + bandHeight / 2f - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(watermarkText, cursorX, baseline, textPaint)
    }

    private fun getScaledWatermarkImage(defaultLogoHeight: Int): Bitmap? {
        val source = watermarkImage ?: loadWatermarkImage()?.also { watermarkImage = it } ?: return null
        val targetHeight = when {
            watermarkImageHeight > 0f -> watermarkImageHeight.toInt()
            watermarkImageWidth > 0f -> max(1, (source.height * (watermarkImageWidth / source.width)).toInt())
            else -> defaultLogoHeight
        }
        val targetWidth = when {
            watermarkImageWidth > 0f -> watermarkImageWidth.toInt()
            else -> max(1, (source.width * (targetHeight.toFloat() / source.height)).toInt())
        }
        val existing = scaledWatermarkImage
        if (existing != null && existing.width == targetWidth && existing.height == targetHeight) return existing
        existing?.recycle()
        return Bitmap.createScaledBitmap(source, max(1, targetWidth), max(1, targetHeight), true).also {
            scaledWatermarkImage = it
        }
    }

    private fun loadWatermarkImage(): Bitmap? {
        if (watermarkImagePath.isBlank()) return null
        return try {
            val uri = Uri.parse(watermarkImagePath)
            if (uri.scheme == "content" || uri.scheme == "file") {
                contentResolver.openInputStream(uri)?.use { input ->
                    BitmapFactory.decodeStream(input)
                }
            } else {
                BitmapFactory.decodeFile(watermarkImagePath)
            }
        } catch (throwable: Throwable) {
            perfLog("watermark_image_decode_failed=${throwable.javaClass.simpleName}")
            null
        }
    }

    private fun releaseWatermarkImages() {
        scaledWatermarkImage?.recycle()
        scaledWatermarkImage = null
        watermarkImage?.recycle()
        watermarkImage = null
    }

    private fun releaseSnapshotBitmap() {
        reusableSnapshotBitmap?.recycle()
        reusableSnapshotBitmap = null
    }

    private fun selectCamera(manager: CameraManager): String {
        val preferredFacing = if (cameraFacing == "front") {
            CameraCharacteristics.LENS_FACING_FRONT
        } else {
            CameraCharacteristics.LENS_FACING_BACK
        }
        return manager.cameraIdList.firstOrNull { cameraId ->
            val facing = manager.getCameraCharacteristics(cameraId)
                .get(CameraCharacteristics.LENS_FACING)
            facing == preferredFacing
        } ?: manager.cameraIdList.first()
    }

    private fun chooseCaptureSize(characteristics: CameraCharacteristics): Size {
        val sizes = characteristics
            .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(android.graphics.ImageFormat.YUV_420_888)
            ?: return Size(640, 480)

        return sizes
            .filter { it.width <= 1280 && it.height <= 720 && it.width % 2 == 0 && it.height % 2 == 0 }
            .maxByOrNull { it.width * it.height }
            ?: Size(640, 480)
    }

    private fun chooseRecordingSizeFromPreview(): Size {
        val sourceWidth = previewView.width.takeIf { it > 0 } ?: captureSize.width
        val sourceHeight = previewView.height.takeIf { it > 0 } ?: captureSize.height
        val longEdgeScale = MAX_RECORDING_LONG_EDGE.toDouble() / max(sourceWidth, sourceHeight).toDouble()
        val pixelScale = sqrt(MAX_RECORDING_PIXELS.toDouble() / (sourceWidth * sourceHeight).toDouble())
        val scale = min(1.0, min(longEdgeScale, pixelScale))
        val width = evenDimension((sourceWidth * scale).toInt())
        val height = evenDimension((sourceHeight * scale).toInt())
        return Size(width, height)
    }

    private fun evenDimension(value: Int): Int {
        val safeValue = max(2, value)
        return if (safeValue % 2 == 0) safeValue else safeValue - 1
    }

    private fun selectFpsRange(): Range<Int>? {
        val characteristics = cameraDevice?.id?.let { cameraId ->
            val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
            manager.getCameraCharacteristics(cameraId)
        } ?: return null
        val ranges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?: return null

        return ranges
            .filter { range -> range.upper >= targetFps }
            .minWithOrNull(
                compareBy<Range<Int>>(
                    { range -> range.upper - targetFps },
                    { range -> if (range.lower <= targetFps) 0 else range.lower - targetFps },
                    { range -> range.upper - range.lower }
                )
            )
            ?: ranges.maxByOrNull { range -> range.upper }
    }

    private fun hasRequiredPermissions(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            requiredPermissions().all { permission ->
                checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
            }
    }

    private fun requestRequiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(
                requiredPermissions(),
                REQUEST_REQUIRED_PERMISSIONS
            )
        }
    }

    private fun requiredPermissions(): Array<String> {
        return if (includeAudio) {
            arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        } else {
            arrayOf(Manifest.permission.CAMERA)
        }
    }

    private fun finishWithError(code: Int, message: String) {
        if (Looper.myLooper() != mainLooper) {
            runOnUiThread {
                finishWithError(code, message)
            }
            return
        }

        if (!completed) {
            completed = true
            MarkVideoNative.failCameraRecorder(code, message)
        }
        finish()
    }

    private fun classifyRecorderStartError(throwable: Throwable): Int {
        val message = throwable.message ?: ""
        return when {
            throwable is MarkVideoException -> throwable.code
            message.contains("encoder", ignoreCase = true) ||
                message.contains("codec", ignoreCase = true) ||
                message.contains("YUV420", ignoreCase = true) -> MarkVideoNative.ERR_ENCODER_UNAVAILABLE
            else -> MarkVideoNative.ERR_RECORDER_START_FAILED
        }
    }

    private fun classifyRecorderStopError(throwable: Throwable): Int {
        return when (throwable) {
            is MarkVideoException -> throwable.code
            else -> MarkVideoNative.ERR_RECORDER_STOP_FAILED
        }
    }

    private fun publishToGallery(source: File): String {
        val displayName = "uts-markvideo-${System.currentTimeMillis()}.mp4"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, displayName)
                put(android.provider.MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, "Movies/uts-markvideo")
                put(android.provider.MediaStore.Video.Media.IS_PENDING, 1)
            }
            val resolver = contentResolver
            val uri = resolver.insert(android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw MarkVideoException(
                    MarkVideoNative.ERR_RECORDER_STOP_FAILED,
                    "Unable to create gallery video entry."
                )

            try {
                resolver.openOutputStream(uri)?.use { output ->
                    FileInputStream(source).use { input ->
                        input.copyTo(output)
                    }
                } ?: throw MarkVideoException(
                    MarkVideoNative.ERR_RECORDER_STOP_FAILED,
                    "Unable to write gallery video."
                )
                values.clear()
                values.put(android.provider.MediaStore.Video.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                return uri.toString()
            } catch (throwable: Throwable) {
                resolver.delete(uri, null, null)
                throw throwable
            }
        }

        val moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
        val outputDir = File(moviesDir, "uts-markvideo").apply {
            if (!exists()) mkdirs()
        }
        val outputFile = File(outputDir, displayName)
        FileInputStream(source).use { input ->
            FileOutputStream(outputFile).use { output ->
                input.copyTo(output)
            }
        }
        MediaScannerConnection.scanFile(
            this,
            arrayOf(outputFile.absolutePath),
            arrayOf("video/mp4"),
            null
        )
        return Uri.fromFile(outputFile).toString()
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun parseColorExtra(value: String?, fallback: Int): Int {
        val raw = value?.trim()?.takeIf { it.isNotEmpty() } ?: return fallback
        return try {
            if (raw.startsWith("#") && raw.length == 9) {
                val red = raw.substring(1, 3).toInt(16)
                val green = raw.substring(3, 5).toInt(16)
                val blue = raw.substring(5, 7).toInt(16)
                val alpha = raw.substring(7, 9).toInt(16)
                Color.argb(alpha, red, green, blue)
            } else {
                Color.parseColor(raw)
            }
        } catch (_: Throwable) {
            fallback
        }
    }

    private fun Image.toReusableBitmap(): Bitmap {
        val yPlane = planes[0]
        val uPlane = planes[1]
        val vPlane = planes[2]
        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer
        val argb = reusableArgb?.takeIf { it.size == width * height }
            ?: IntArray(width * height).also { reusableArgb = it }

        for (row in 0 until height) {
            for (col in 0 until width) {
                val y = yBuffer.get(row * yPlane.rowStride + col * yPlane.pixelStride).toInt() and 0xff
                val uvRow = row / 2
                val uvCol = col / 2
                val u = uBuffer.get(uvRow * uPlane.rowStride + uvCol * uPlane.pixelStride).toInt() and 0xff
                val v = vBuffer.get(uvRow * vPlane.rowStride + uvCol * vPlane.pixelStride).toInt() and 0xff
                argb[row * width + col] = yuvToArgb(y, u, v)
            }
        }

        return Bitmap.createBitmap(argb, width, height, Bitmap.Config.ARGB_8888)
    }

    private fun yuvToArgb(yValue: Int, uValue: Int, vValue: Int): Int {
        val c = max(0, yValue - 16)
        val d = uValue - 128
        val e = vValue - 128
        val red = clamp((298 * c + 409 * e + 128) shr 8)
        val green = clamp((298 * c - 100 * d - 208 * e + 128) shr 8)
        val blue = clamp((298 * c + 516 * d + 128) shr 8)
        return Color.rgb(red, green, blue)
    }

    private fun clamp(value: Int): Int {
        return min(255, max(0, value))
    }

    private data class RecordingFrameStats(
        var received: Int = 0,
        var droppedBusy: Int = 0,
        var droppedFps: Int = 0,
        var processed: Int = 0,
        var encoded: Int = 0
    ) {
        fun reset() {
            received = 0
            droppedBusy = 0
            droppedFps = 0
            processed = 0
            encoded = 0
        }
    }

    private class MarkVideoException(
        val code: Int,
        message: String
    ) : IllegalStateException(message)

    private inner class WatermarkOverlayView(context: Context) : View(context) {
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            drawWatermarkOnCanvas(canvas, width, height)
        }
    }

    private class CameraMp4Recorder(
        private val output: File,
        val width: Int,
        val height: Int,
        private val fps: Int,
        private val bitrate: Int,
        private val includeAudio: Boolean,
        private val perfLogger: ((String, Long) -> Unit)? = null
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
            val muxerStartMs = System.currentTimeMillis()
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            perfLogger?.invoke("muxer_create", muxerStartMs)
            startVideoEncoder()
            if (includeAudio) {
                startAudioEncoder()
            }
        }

        private fun startVideoEncoder() {
            val startMs = System.currentTimeMillis()
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
            perfLogger?.invoke("video_encoder_start", startMs)
        }

        @SuppressLint("MissingPermission")
        private fun startAudioEncoder() {
            val startMs = System.currentTimeMillis()
            val audioMimeForDebug = "audio/mp4a-latm"
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
                encodeAudioLoop(recordBufferSize, audioMimeForDebug)
            }, "uts-markvideo-audio").apply {
                start()
            }
            perfLogger?.invoke("audio_encoder_start", startMs)
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

        private fun encodeAudioLoop(recordBufferSize: Int, audioMimeForDebug: String) {
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
                    drainAudio(codec, bufferInfo, endOfStream = false, audioMimeForDebug = audioMimeForDebug)
                }

                val deadlineMs = System.currentTimeMillis() + FINISH_TIMEOUT_MS
                queueAudioEndOfStream(codec, bufferInfo, audioMimeForDebug, deadlineMs)
                drainAudio(codec, bufferInfo, endOfStream = true, audioMimeForDebug = audioMimeForDebug, deadlineMs = deadlineMs)
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
            audioMimeForDebug: String,
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
                drainAudio(codec, bufferInfo, endOfStream = false, audioMimeForDebug = audioMimeForDebug, deadlineMs = deadlineMs)
            }
            throw IllegalStateException("Timed out waiting for audio encoder input buffer.")
        }

        private fun drainAudio(
            codec: MediaCodec,
            bufferInfo: MediaCodec.BufferInfo,
            endOfStream: Boolean,
            audioMimeForDebug: String,
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
                        check(audioMimeForDebug == "audio/mp4a-latm")
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

    private companion object {
        const val REQUEST_REQUIRED_PERMISSIONS = 4107
        const val PERF_TAG = "UTSMarkVideoPerf"
        const val MIME_TYPE = "video/avc"
        const val TIMEOUT_US = 10_000L
        const val FINISH_TIMEOUT_MS = 4_000L
        const val FIRST_FRAME_STOP_GRACE_MS = 800L
        const val MAX_RECORDING_LONG_EDGE = 960
        const val MAX_RECORDING_PIXELS = 720 * 960
        const val AUDIO_SAMPLE_RATE = 44_100
        const val AUDIO_CHANNEL_COUNT = 1
        const val AUDIO_BIT_RATE = 64_000
        const val AUDIO_CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_PCM_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }
}
