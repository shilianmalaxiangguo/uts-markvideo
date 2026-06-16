package uts.markvideo.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import io.dcloud.uts.UTSAndroid
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min

object MarkVideoNative {
    private const val MIME_TYPE = "video/avc"
    private const val TIMEOUT_US = 10_000L

    @JvmStatic
    fun createSampleVideo(
        text: String,
        durationMs: Number,
        width: Number,
        height: Number,
        fps: Number,
        onSuccess: (String, Long, Int, Int) -> Unit,
        onFail: (String) -> Unit
    ) {
        Thread {
            val activity = UTSAndroid.getUniActivity()
            if (activity == null) {
                onFail("No active uni-app activity.")
                return@Thread
            }

            val safeWidth = even(width.toInt().coerceIn(320, 1920))
            val safeHeight = even(height.toInt().coerceIn(320, 1920))
            val safeFps = fps.toInt().coerceIn(12, 30)
            val safeDurationMs = durationMs.toLong().coerceIn(1000L, 10_000L)
            val output = File(activity.cacheDir, "uts-markvideo-${System.currentTimeMillis()}.mp4")

            try {
                WatermarkMp4Encoder(
                    output = output,
                    watermarkText = text.ifBlank { "UTS MarkVideo MVP" },
                    width = safeWidth,
                    height = safeHeight,
                    fps = safeFps,
                    durationMs = safeDurationMs
                ).encode()

                activity.runOnUiThread {
                    onSuccess(output.absolutePath, safeDurationMs, safeWidth, safeHeight)
                }
            } catch (throwable: Throwable) {
                activity.runOnUiThread {
                    onFail(throwable.message ?: throwable.javaClass.simpleName)
                }
            }
        }.start()
    }

    private fun even(value: Int): Int {
        return if (value % 2 == 0) value else value - 1
    }

    private class WatermarkMp4Encoder(
        private val output: File,
        private val watermarkText: String,
        private val width: Int,
        private val height: Int,
        private val fps: Int,
        private val durationMs: Long
    ) {
        private val frameSize = width * height
        private val quarterFrameSize = frameSize / 4

        fun encode() {
            val codecInfo = selectEncoder()
            val colorFormat = selectColorFormat(codecInfo)
            val videoFormat = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, colorFormat)
                setInteger(MediaFormat.KEY_BIT_RATE, width * height * 3)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }

            val encoder = MediaCodec.createByCodecName(codecInfo.name)
            val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val bufferInfo = MediaCodec.BufferInfo()
            val state = MuxerState()

            try {
                encoder.configure(videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                encoder.start()

                val totalFrames = max(1, (durationMs * fps / 1000L).toInt())
                var frameIndex = 0

                while (frameIndex < totalFrames) {
                    val inputBufferIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
                    if (inputBufferIndex >= 0) {
                        val inputBuffer = encoder.getInputBuffer(inputBufferIndex)
                            ?: error("Encoder input buffer is null.")
                        val frameBytes = renderFrame(frameIndex, totalFrames, colorFormat)
                        inputBuffer.clear()
                        inputBuffer.put(frameBytes)
                        encoder.queueInputBuffer(
                            inputBufferIndex,
                            0,
                            frameBytes.size,
                            presentationTimeUs(frameIndex),
                            0
                        )
                        frameIndex += 1
                    }
                    drainEncoder(encoder, muxer, bufferInfo, state, false)
                }

                queueEndOfStream(encoder, totalFrames)
                drainEncoder(encoder, muxer, bufferInfo, state, true)
            } finally {
                try {
                    encoder.stop()
                } catch (_: Throwable) {
                }
                encoder.release()
                muxer.release()
            }
        }

        private fun queueEndOfStream(encoder: MediaCodec, frameIndex: Int) {
            while (true) {
                val inputBufferIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
                if (inputBufferIndex >= 0) {
                    encoder.queueInputBuffer(
                        inputBufferIndex,
                        0,
                        0,
                        presentationTimeUs(frameIndex),
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM
                    )
                    return
                }
            }
        }

        private fun drainEncoder(
            encoder: MediaCodec,
            muxer: MediaMuxer,
            bufferInfo: MediaCodec.BufferInfo,
            state: MuxerState,
            endOfStream: Boolean
        ) {
            while (true) {
                val outputBufferIndex = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)

                when {
                    outputBufferIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (!endOfStream) return
                    }

                    outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        check(!state.muxerStarted) { "Encoder output format changed twice." }
                        state.trackIndex = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        state.muxerStarted = true
                    }

                    outputBufferIndex >= 0 -> {
                        val encodedData = encoder.getOutputBuffer(outputBufferIndex)
                            ?: error("Encoder output buffer is null.")

                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                            bufferInfo.size = 0
                        }

                        if (bufferInfo.size != 0) {
                            check(state.muxerStarted) { "Muxer has not started." }
                            encodedData.position(bufferInfo.offset)
                            encodedData.limit(bufferInfo.offset + bufferInfo.size)
                            muxer.writeSampleData(state.trackIndex, encodedData, bufferInfo)
                        }

                        encoder.releaseOutputBuffer(outputBufferIndex, false)

                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            return
                        }
                    }
                }
            }
        }

        private fun renderFrame(frameIndex: Int, totalFrames: Int, colorFormat: Int): ByteArray {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val progress = frameIndex.toFloat() / max(1, totalFrames - 1).toFloat()

            drawScene(canvas, progress, frameIndex)

            val pixels = IntArray(frameSize)
            bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
            bitmap.recycle()

            return argbToYuv420(pixels, colorFormat)
        }

        private fun drawScene(canvas: Canvas, progress: Float, frameIndex: Int) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            canvas.drawColor(Color.rgb(23, 33, 43))

            paint.color = Color.rgb(28, 111, 224)
            canvas.drawRoundRect(
                RectF(width * 0.08f, height * 0.12f, width * 0.92f, height * 0.52f),
                28f,
                28f,
                paint
            )

            paint.color = Color.rgb(23 + (progress * 90).toInt(), 186, 157)
            canvas.drawCircle(width * (0.18f + progress * 0.64f), height * 0.33f, width * 0.16f, paint)

            paint.color = Color.argb(150, 0, 0, 0)
            canvas.drawRoundRect(
                RectF(width * 0.07f, height * 0.74f, width * 0.93f, height * 0.89f),
                24f,
                24f,
                paint
            )

            val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textAlign = Paint.Align.CENTER
                textSize = width / 18f
                isFakeBoldText = true
            }
            canvas.drawText(watermarkText, width / 2f, height * 0.81f, titlePaint)

            val metaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.rgb(224, 233, 241)
                textAlign = Paint.Align.CENTER
                textSize = width / 32f
            }
            canvas.drawText(
                "native encoded frame ${frameIndex + 1}",
                width / 2f,
                height * 0.86f,
                metaPaint
            )
        }

        private fun argbToYuv420(pixels: IntArray, colorFormat: Int): ByteArray {
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

        private fun selectEncoder(): MediaCodecInfo {
            return MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { codec ->
                codec.isEncoder && codec.supportedTypes.any { it.equals(MIME_TYPE, ignoreCase = true) }
            } ?: error("No AVC encoder found on this device.")
        }

        private fun selectColorFormat(codecInfo: MediaCodecInfo): Int {
            val capabilities = codecInfo.getCapabilitiesForType(MIME_TYPE)
            val supported = capabilities.colorFormats.toSet()
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

        private fun clamp(value: Int): Int {
            return min(255, max(0, value))
        }
    }

    private class MuxerState {
        var trackIndex: Int = -1
        var muxerStarted: Boolean = false
    }
}
