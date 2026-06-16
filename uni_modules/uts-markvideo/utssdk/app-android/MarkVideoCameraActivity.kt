package uts.markvideo.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
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
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Size
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class MarkVideoCameraActivity : Activity() {
    private val watermarkText: String by lazy {
        intent.getStringExtra(MarkVideoNative.EXTRA_WATERMARK_TEXT) ?: "UTS 即拍即有水印"
    }
    private val targetFps: Int by lazy {
        intent.getIntExtra(MarkVideoNative.EXTRA_FPS, 15).coerceIn(8, 24)
    }

    private lateinit var previewView: ImageView
    private lateinit var statusView: TextView
    private lateinit var recordButton: Button
    private lateinit var stopButton: Button

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var captureSize: Size = Size(640, 480)
    private val processingFrame = AtomicBoolean(false)

    @Volatile private var recording = false
    private var recorder: CameraMp4Recorder? = null
    private var outputFile: File? = null
    private var recordingStartedAt = 0L
    private var completed = false
    private var previewFrameCounter = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()

        if (hasRequiredPermissions()) {
            startCameraThread()
            openCamera()
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
            openCamera()
        } else {
            finishWithError("Camera or microphone permission denied.")
        }
    }

    override fun onBackPressed() {
        if (recording) {
            stopRecording(deleteFile = true)
        }
        if (!completed) {
            completed = true
            MarkVideoNative.failCameraRecorder("Recording cancelled.")
        }
        super.onBackPressed()
    }

    override fun onDestroy() {
        closeCamera()
        stopCameraThread()
        if (!completed) {
            MarkVideoNative.failCameraRecorder("Recorder closed before a video was created.")
        }
        super.onDestroy()
    }

    private fun buildUi() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(16, 22, 30))
        }

        previewView = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.BLACK)
        }
        root.addView(previewView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val overlay = TextView(this).apply {
            text = watermarkText
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(145, 0, 0, 0))
            setPadding(dp(16), dp(8), dp(16), dp(8))
        }
        root.addView(overlay, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            dp(56),
            Gravity.BOTTOM
        ).apply {
            bottomMargin = dp(112)
            leftMargin = dp(18)
            rightMargin = dp(18)
        })

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(12), dp(18), dp(18))
            setBackgroundColor(Color.argb(190, 16, 22, 30))
        }

        statusView = TextView(this).apply {
            text = "Camera preview"
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
        val handler = cameraHandler ?: return
        recordButton.isEnabled = false
        stopButton.isEnabled = true
        statusView.text = "Recording with burned-in watermark..."

        handler.post {
            try {
                val file = File(cacheDir, "uts-camera-watermark-${System.currentTimeMillis()}.mp4")
                val nextRecorder = CameraMp4Recorder(
                    output = file,
                    width = captureSize.width,
                    height = captureSize.height,
                    fps = targetFps
                )
                nextRecorder.start()
                outputFile = file
                recorder = nextRecorder
                recordingStartedAt = System.currentTimeMillis()
                recording = true
            } catch (throwable: Throwable) {
                runOnUiThread {
                    recordButton.isEnabled = true
                    stopButton.isEnabled = false
                    statusView.text = throwable.message ?: "Recorder start failed."
                }
            }
        }
    }

    private fun stopRecording(deleteFile: Boolean) {
        val handler = cameraHandler
        recordButton.isEnabled = false
        stopButton.isEnabled = false
        statusView.text = "Finishing MP4..."

        if (handler == null) {
            finishWithError("Camera thread is not running.")
            return
        }

        handler.post {
            val activeRecorder = recorder
            val file = outputFile
            recording = false
            recorder = null
            outputFile = null

            try {
                activeRecorder?.finish()
                if (deleteFile) {
                    file?.delete()
                    return@post
                }
                if (file == null || activeRecorder == null || activeRecorder.frameCount == 0) {
                    file?.delete()
                    throw IllegalStateException("No frames were recorded.")
                }

                val durationMs = max(1L, System.currentTimeMillis() - recordingStartedAt)
                completed = true
                runOnUiThread {
                    MarkVideoNative.completeCameraRecorder(
                        file.absolutePath,
                        durationMs,
                        captureSize.width,
                        captureSize.height,
                        watermarkText
                    )
                    finish()
                }
            } catch (throwable: Throwable) {
                file?.delete()
                runOnUiThread {
                    finishWithError(throwable.message ?: "Recorder stop failed.")
                }
            }
        }
    }

    private fun startCameraThread() {
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

    private fun openCamera() {
        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val handler = cameraHandler ?: return

        try {
            val cameraId = selectBackCamera(manager)
            val characteristics = manager.getCameraCharacteristics(cameraId)
            captureSize = chooseCaptureSize(characteristics)
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
            finishWithError(throwable.message ?: "Open camera failed.")
        }
    }

    private fun closeCamera() {
        captureSession?.close()
        captureSession = null
        cameraDevice?.close()
        cameraDevice = null
        imageReader?.close()
        imageReader = null
    }

    private val cameraStateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            cameraDevice = camera
            createCaptureSession()
        }

        override fun onDisconnected(camera: CameraDevice) {
            camera.close()
            finishWithError("Camera disconnected.")
        }

        override fun onError(camera: CameraDevice, error: Int) {
            camera.close()
            finishWithError("Camera error: $error")
        }
    }

    private fun createCaptureSession() {
        val camera = cameraDevice ?: return
        val reader = imageReader ?: return
        val handler = cameraHandler ?: return

        camera.createCaptureSession(
            listOf(reader.surface),
            object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    captureSession = session
                    val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                        addTarget(reader.surface)
                        set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                    }.build()
                    session.setRepeatingRequest(request, null, handler)
                    runOnUiThread {
                        statusView.text = "Preview ready. Watermark will be burned into MP4."
                    }
                }

                override fun onConfigureFailed(session: CameraCaptureSession) {
                    finishWithError("Camera session configure failed.")
                }
            },
            handler
        )
    }

    private fun handleNextImage(reader: ImageReader) {
        if (!processingFrame.compareAndSet(false, true)) {
            reader.acquireLatestImage()?.close()
            return
        }

        val image = reader.acquireLatestImage()
        if (image == null) {
            processingFrame.set(false)
            return
        }

        try {
            val bitmap = drawWatermark(image.toBitmap())
            if (recording) {
                recorder?.encodeFrame(bitmap)
            }
            previewFrameCounter += 1
            if (previewFrameCounter % 2 == 0) {
                runOnUiThread {
                    previewView.setImageBitmap(bitmap)
                }
            }
        } catch (throwable: Throwable) {
            if (recording) {
                runOnUiThread {
                    statusView.text = throwable.message ?: "Frame encode failed."
                }
            }
        } finally {
            image.close()
            processingFrame.set(false)
        }
    }

    private fun drawWatermark(source: Bitmap): Bitmap {
        val bitmap = source.copy(Bitmap.Config.ARGB_8888, true)
        source.recycle()

        val canvas = Canvas(bitmap)
        val bandHeight = max(72f, bitmap.height * 0.16f)
        val bandTop = bitmap.height - bandHeight - bitmap.height * 0.04f

        val bandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(155, 0, 0, 0)
        }
        canvas.drawRoundRect(
            RectF(bitmap.width * 0.06f, bandTop, bitmap.width * 0.94f, bandTop + bandHeight),
            18f,
            18f,
            bandPaint
        )

        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = max(24f, bitmap.width / 20f)
            isFakeBoldText = true
        }
        while (textPaint.measureText(watermarkText) > bitmap.width * 0.78f && textPaint.textSize > 20f) {
            textPaint.textSize -= 2f
        }
        val baseline = bandTop + bandHeight / 2f - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(watermarkText, bitmap.width / 2f, baseline, textPaint)

        return bitmap
    }

    private fun selectBackCamera(manager: CameraManager): String {
        return manager.cameraIdList.firstOrNull { cameraId ->
            val facing = manager.getCameraCharacteristics(cameraId)
                .get(CameraCharacteristics.LENS_FACING)
            facing == CameraCharacteristics.LENS_FACING_BACK
        } ?: manager.cameraIdList.first()
    }

    private fun chooseCaptureSize(characteristics: CameraCharacteristics): Size {
        val sizes = characteristics
            .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(android.graphics.ImageFormat.YUV_420_888)
            ?: return Size(640, 480)

        return sizes
            .filter { it.width <= 1280 && it.height <= 720 && it.width % 2 == 0 && it.height % 2 == 0 }
            .minByOrNull { abs(it.width - 640) + abs(it.height - 480) }
            ?: Size(640, 480)
    }

    private fun hasRequiredPermissions(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            (
                checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            )
    }

    private fun requestRequiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO),
                REQUEST_REQUIRED_PERMISSIONS
            )
        }
    }

    private fun finishWithError(message: String) {
        if (Looper.myLooper() != mainLooper) {
            runOnUiThread {
                finishWithError(message)
            }
            return
        }

        if (!completed) {
            completed = true
            MarkVideoNative.failCameraRecorder(message)
        }
        finish()
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun Image.toBitmap(): Bitmap {
        val yPlane = planes[0]
        val uPlane = planes[1]
        val vPlane = planes[2]
        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer
        val argb = IntArray(width * height)

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

    private class CameraMp4Recorder(
        private val output: File,
        private val width: Int,
        private val height: Int,
        private val fps: Int
    ) {
        private val frameSize = width * height
        private val quarterFrameSize = frameSize / 4
        private val muxerLock = Object()
        private var videoEncoder: MediaCodec? = null
        private var audioEncoder: MediaCodec? = null
        private var audioRecord: AudioRecord? = null
        private var audioThread: Thread? = null
        @Volatile private var audioRunning = false
        private var audioStartedAtNs = 0L
        private var muxer: MediaMuxer? = null
        private var colorFormat: Int = 0
        private var videoTrackIndex = -1
        private var audioTrackIndex = -1
        private var muxerStarted = false
        var frameCount: Int = 0
            private set

        fun start() {
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            startVideoEncoder()
            startAudioEncoder()
        }

        private fun startVideoEncoder() {
            val codecInfo = selectEncoder()
            colorFormat = selectColorFormat(codecInfo)
            val format = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, colorFormat)
                setInteger(MediaFormat.KEY_BIT_RATE, width * height * 3)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }

            videoEncoder = MediaCodec.createByCodecName(codecInfo.name).apply {
                configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
        }

        @SuppressLint("MissingPermission")
        private fun startAudioEncoder() {
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
        }

        fun encodeFrame(bitmap: Bitmap) {
            val activeEncoder = videoEncoder ?: return
            val inputIndex = activeEncoder.dequeueInputBuffer(TIMEOUT_US)
            if (inputIndex >= 0) {
                val inputBuffer = activeEncoder.getInputBuffer(inputIndex) ?: return
                val pixels = IntArray(frameSize)
                bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
                val yuv = argbToYuv420(pixels)
                inputBuffer.clear()
                inputBuffer.put(yuv)
                activeEncoder.queueInputBuffer(
                    inputIndex,
                    0,
                    yuv.size,
                    presentationTimeUs(frameCount),
                    0
                )
                frameCount += 1
            }
            drainVideo(endOfStream = false)
        }

        fun finish() {
            audioRunning = false
            audioThread?.join(1500L)
            audioThread = null

            val activeEncoder = videoEncoder ?: return
            while (true) {
                val inputIndex = activeEncoder.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    activeEncoder.queueInputBuffer(
                        inputIndex,
                        0,
                        0,
                        presentationTimeUs(frameCount),
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM
                    )
                    break
                }
            }
            drainVideo(endOfStream = true)
            activeEncoder.stop()
            activeEncoder.release()
            videoEncoder = null
            synchronized(muxerLock) {
                muxer?.release()
                muxer = null
            }
        }

        private fun drainVideo(endOfStream: Boolean) {
            val activeEncoder = videoEncoder ?: return
            val activeMuxer = muxer ?: return
            val bufferInfo = MediaCodec.BufferInfo()

            while (true) {
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

                queueAudioEndOfStream(codec)
                drainAudio(codec, bufferInfo, endOfStream = true, audioMimeForDebug = audioMimeForDebug)
            } finally {
                try {
                    recorder.stop()
                } catch (_: Throwable) {
                }
                recorder.release()
                codec.stop()
                codec.release()
                audioRecord = null
                audioEncoder = null
            }
        }

        private fun queueAudioEndOfStream(codec: MediaCodec) {
            while (true) {
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
            }
        }

        private fun drainAudio(
            codec: MediaCodec,
            bufferInfo: MediaCodec.BufferInfo,
            endOfStream: Boolean,
            audioMimeForDebug: String
        ) {
            val activeMuxer = muxer ?: return

            while (true) {
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
        }

        private fun addMuxerTrack(activeMuxer: MediaMuxer, format: MediaFormat, isAudio: Boolean): Int {
            synchronized(muxerLock) {
                val index = activeMuxer.addTrack(format)
                if (isAudio) {
                    audioTrackIndex = index
                } else {
                    videoTrackIndex = index
                }
                if (!muxerStarted && videoTrackIndex >= 0 && audioTrackIndex >= 0) {
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

        private fun argbToYuv420(pixels: IntArray): ByteArray {
            val yuv = ByteArray(frameSize + quarterFrameSize * 2)
            val planar = isPlanar(colorFormat)
            var yIndex = 0

            for (row in 0 until height) {
                for (col in 0 until width) {
                    val pixel = pixels[row * width + col]
                    val red = (pixel shr 16) and 0xff
                    val green = (pixel shr 8) and 0xff
                    val blue = pixel and 0xff
                    val y = clamp(((66 * red + 129 * green + 25 * blue + 128) shr 8) + 16)
                    val u = clamp(((-38 * red - 74 * green + 112 * blue + 128) shr 8) + 128)
                    val v = clamp(((112 * red - 94 * green - 18 * blue + 128) shr 8) + 128)

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

            return yuv
        }

        private fun presentationTimeUs(frameIndex: Int): Long {
            return 132L + frameIndex * 1_000_000L / fps
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
        const val MIME_TYPE = "video/avc"
        const val TIMEOUT_US = 10_000L
        const val AUDIO_SAMPLE_RATE = 44_100
        const val AUDIO_CHANNEL_COUNT = 1
        const val AUDIO_BIT_RATE = 64_000
        const val AUDIO_CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_PCM_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }
}
