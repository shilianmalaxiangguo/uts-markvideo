import AVFoundation
import CoreImage
import UIKit

public class MarkVideoRecorder: NSObject {
    private static var success: ((String, Double, Double, Double, String) -> Void)?
    private static var failure: ((String) -> Void)?

    @objc public static func openCameraRecorder(
        _ text: String,
        _ fps: NSNumber,
        _ onSuccess: @escaping (String, Double, Double, Double, String) -> Void,
        _ onFail: @escaping (String) -> Void
    ) {
        success = onSuccess
        failure = onFail

        DispatchQueue.main.async {
            requestPermissions { granted in
                guard granted else {
                    fail("Camera or microphone permission denied.")
                    return
                }
                guard let root = topViewController() else {
                    fail("No visible iOS view controller.")
                    return
                }
                let controller = MarkVideoRecorderViewController(
                    watermark: text.isEmpty ? "UTS 即拍即有水印" : text,
                    fps: max(8, min(24, fps.intValue))
                )
                root.present(controller, animated: true)
            }
        }
    }

    fileprivate static func complete(
        path: String,
        durationMs: Double,
        width: Int,
        height: Int,
        watermark: String
    ) {
        let callback = success
        success = nil
        failure = nil
        callback?(path, durationMs, Double(width), Double(height), watermark)
    }

    fileprivate static func fail(_ message: String) {
        let callback = failure
        success = nil
        failure = nil
        callback?(message)
    }

    private static func requestPermissions(_ complete: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { videoGranted in
            AVCaptureDevice.requestAccess(for: .audio) { audioGranted in
                DispatchQueue.main.async {
                    complete(videoGranted && audioGranted)
                }
            }
        }
    }

    private static func topViewController() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController
        var top = root
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

private final class MarkVideoRecorderViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let watermark: String
    private let fps: Int
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "uts.markvideo.capture")
    private let writerQueue = DispatchQueue(label: "uts.markvideo.writer")
    private let ciContext = CIContext()

    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var statusLabel = UILabel()
    private var startButton = UIButton(type: .system)
    private var stopButton = UIButton(type: .system)

    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var firstVideoTime: CMTime?
    private var lastVideoTime: CMTime?
    private var outputURL: URL?
    private var recording = false
    private var completed = false
    private var videoSize = CGSize(width: 720, height: 1280)

    init(watermark: String, fps: Int) {
        self.watermark = watermark
        self.fps = fps
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureQueue.async {
            self.session.startRunning()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureQueue.async {
            self.session.stopRunning()
        }
    }

    private func buildUI() {
        view.backgroundColor = .black

        let watermarkLabel = UILabel()
        watermarkLabel.text = watermark
        watermarkLabel.textColor = .white
        watermarkLabel.font = .boldSystemFont(ofSize: 18)
        watermarkLabel.textAlignment = .center
        watermarkLabel.backgroundColor = UIColor.black.withAlphaComponent(0.56)
        watermarkLabel.layer.cornerRadius = 8
        watermarkLabel.layer.masksToBounds = true
        watermarkLabel.translatesAutoresizingMaskIntoConstraints = false

        let controlPanel = UIStackView()
        controlPanel.axis = .vertical
        controlPanel.alignment = .fill
        controlPanel.spacing = 12
        controlPanel.backgroundColor = UIColor.black.withAlphaComponent(0.70)
        controlPanel.isLayoutMarginsRelativeArrangement = true
        controlPanel.layoutMargins = UIEdgeInsets(top: 12, left: 18, bottom: 18, right: 18)
        controlPanel.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.text = "Camera preview"
        statusLabel.textColor = UIColor(white: 0.92, alpha: 1)
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textAlignment = .center

        startButton.setTitle("开始录制", for: .normal)
        startButton.addTarget(self, action: #selector(startRecording), for: .touchUpInside)
        stopButton.setTitle("结束录制", for: .normal)
        stopButton.isEnabled = false
        stopButton.addTarget(self, action: #selector(stopRecording), for: .touchUpInside)

        let buttonRow = UIStackView(arrangedSubviews: [startButton, stopButton])
        buttonRow.axis = .horizontal
        buttonRow.spacing = 12
        buttonRow.distribution = .fillEqually

        controlPanel.addArrangedSubview(statusLabel)
        controlPanel.addArrangedSubview(buttonRow)

        view.addSubview(watermarkLabel)
        view.addSubview(controlPanel)

        NSLayoutConstraint.activate([
            watermarkLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            watermarkLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            watermarkLabel.bottomAnchor.constraint(equalTo: controlPanel.topAnchor, constant: -18),
            watermarkLabel.heightAnchor.constraint(equalToConstant: 56),
            controlPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controlPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controlPanel.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720

        do {
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) ??
                AVCaptureDevice.default(for: .video) else {
                throw NSError(domain: "uts.markvideo", code: 1, userInfo: [NSLocalizedDescriptionKey: "No camera device."])
            }
            let videoInput = try AVCaptureDeviceInput(device: camera)
            if session.canAddInput(videoInput) {
                session.addInput(videoInput)
            }

            guard let microphone = AVCaptureDevice.default(for: .audio) else {
                throw NSError(domain: "uts.markvideo", code: 2, userInfo: [NSLocalizedDescriptionKey: "No microphone device."])
            }
            let micInput = try AVCaptureDeviceInput(device: microphone)
            if session.canAddInput(micInput) {
                session.addInput(micInput)
            }

            let videoOutput = AVCaptureVideoDataOutput()
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(self, queue: writerQueue)
            if session.canAddOutput(videoOutput) {
                session.addOutput(videoOutput)
            }
            videoOutput.connection(with: .video)?.videoOrientation = .portrait

            let audioOutput = AVCaptureAudioDataOutput()
            audioOutput.setSampleBufferDelegate(self, queue: writerQueue)
            if session.canAddOutput(audioOutput) {
                session.addOutput(audioOutput)
            }
        } catch {
            MarkVideoRecorder.fail(error.localizedDescription)
            dismiss(animated: true)
        }

        session.commitConfiguration()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
    }

    @objc private func startRecording() {
        writerQueue.async {
            do {
                try self.prepareWriter()
                self.recording = true
                self.firstVideoTime = nil
                self.lastVideoTime = nil
                DispatchQueue.main.async {
                    self.startButton.isEnabled = false
                    self.stopButton.isEnabled = true
                    self.statusLabel.text = "Recording video and audio..."
                }
            } catch {
                DispatchQueue.main.async {
                    self.statusLabel.text = error.localizedDescription
                }
            }
        }
    }

    @objc private func stopRecording() {
        startButton.isEnabled = false
        stopButton.isEnabled = false
        statusLabel.text = "Finishing file..."

        writerQueue.async {
            self.recording = false
            guard let writer = self.assetWriter, let outputURL = self.outputURL else {
                DispatchQueue.main.async {
                    MarkVideoRecorder.fail("Writer was not started.")
                    self.dismiss(animated: true)
                }
                return
            }

            self.videoInput?.markAsFinished()
            self.audioInput?.markAsFinished()
            writer.finishWriting {
                let durationMs: Double
                if let first = self.firstVideoTime, let last = self.lastVideoTime {
                    durationMs = max(1, CMTimeSubtract(last, first).seconds * 1000)
                } else {
                    durationMs = 0
                }
                DispatchQueue.main.async {
                    self.completed = true
                    MarkVideoRecorder.complete(
                        path: outputURL.path,
                        durationMs: durationMs,
                        width: Int(self.videoSize.width),
                        height: Int(self.videoSize.height),
                        watermark: self.watermark
                    )
                    self.dismiss(animated: true)
                }
            }
        }
    }

    private func prepareWriter() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("uts-ios-watermark-\(Int(Date().timeIntervalSince1970 * 1000)).mp4")
        try? FileManager.default.removeItem(at: url)
        outputURL = url

        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(videoSize.width),
            AVVideoHeightKey: Int(videoSize.height)
        ]
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: Int(videoSize.width),
                kCVPixelBufferHeightKey as String: Int(videoSize.height)
            ]
        )

        let audioInput = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64_000
            ]
        )
        audioInput.expectsMediaDataInRealTime = true

        guard writer.canAdd(videoInput), writer.canAdd(audioInput) else {
            throw NSError(domain: "uts.markvideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot add writer inputs."])
        }

        writer.add(videoInput)
        writer.add(audioInput)
        self.assetWriter = writer
        self.videoInput = videoInput
        self.audioInput = audioInput
        self.pixelBufferAdaptor = adaptor
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard recording else { return }

        if output is AVCaptureVideoDataOutput {
            appendVideo(sampleBuffer)
        } else if output is AVCaptureAudioDataOutput {
            appendAudio(sampleBuffer)
        }
    }

    private func appendVideo(_ sampleBuffer: CMSampleBuffer) {
        guard
            let writer = assetWriter,
            let videoInput = videoInput,
            let adaptor = pixelBufferAdaptor,
            let sourceBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstVideoTime == nil {
            firstVideoTime = timestamp
            writer.startWriting()
            writer.startSession(atSourceTime: timestamp)
        }
        lastVideoTime = timestamp

        guard writer.status == .writing, videoInput.isReadyForMoreMediaData else { return }
        guard let watermarkedBuffer = makeWatermarkedPixelBuffer(from: sourceBuffer, adaptor: adaptor) else { return }
        adaptor.append(watermarkedBuffer, withPresentationTime: timestamp)
    }

    private func appendAudio(_ sampleBuffer: CMSampleBuffer) {
        guard firstVideoTime != nil, let writer = assetWriter, writer.status == .writing else { return }
        guard let audioInput = audioInput, audioInput.isReadyForMoreMediaData else { return }
        audioInput.append(sampleBuffer)
    }

    private func makeWatermarkedPixelBuffer(
        from sourceBuffer: CVPixelBuffer,
        adaptor: AVAssetWriterInputPixelBufferAdaptor
    ) -> CVPixelBuffer? {
        guard let pool = adaptor.pixelBufferPool else { return nil }
        var outputBuffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outputBuffer)
        guard let targetBuffer = outputBuffer else { return nil }

        let image = CIImage(cvPixelBuffer: sourceBuffer)
        ciContext.render(image, to: targetBuffer)
        drawWatermark(into: targetBuffer)
        return targetBuffer
    }

    private func drawWatermark(into buffer: CVPixelBuffer) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: base,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return }

        let bandHeight = max(72, Int(Double(height) * 0.16))
        let rect = CGRect(
            x: CGFloat(width) * 0.06,
            y: CGFloat(height - bandHeight) - CGFloat(height) * 0.04,
            width: CGFloat(width) * 0.88,
            height: CGFloat(bandHeight)
        )
        context.setFillColor(UIColor.black.withAlphaComponent(0.58).cgColor)
        context.fill(rect)

        UIGraphicsPushContext(context)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: max(22, CGFloat(width) / 22)),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraph
        ]
        let textRect = rect.insetBy(dx: 16, dy: CGFloat(bandHeight) * 0.28)
        (watermark as NSString).draw(in: textRect, withAttributes: attributes)
        UIGraphicsPopContext()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if !completed {
            MarkVideoRecorder.fail("Recording cancelled.")
        }
    }
}
