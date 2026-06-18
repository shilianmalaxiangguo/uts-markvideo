import AVFoundation
import CoreImage
import Photos
import UIKit

public class MarkVideoRecorder: NSObject {
    private static var success: ((String, NSNumber, NSNumber, NSNumber, String, String, String) -> Void)?
    private static var failure: ((String) -> Void)?

    @objc public static func openCameraRecorder(
        _ text: String,
        _ fps: NSNumber,
        _ width: NSNumber,
        _ height: NSNumber,
        _ bitrate: NSNumber,
        _ includeAudio: Bool,
        _ facing: String,
        _ enablePhoto: Bool,
        _ maxDurationMs: NSNumber,
        _ minDurationMs: NSNumber,
        _ perfLogging: Bool,
        _ imagePath: String,
        _ x: NSNumber,
        _ y: NSNumber,
        _ textColor: String,
        _ fontSize: NSNumber,
        _ textBold: Bool,
        _ imageWidth: NSNumber,
        _ imageHeight: NSNumber,
        _ imageGap: NSNumber,
        _ boxWidth: NSNumber,
        _ boxHeight: NSNumber,
        _ backgroundColor: String,
        _ borderRadius: NSNumber,
        _ padding: NSNumber,
        _ onSuccess: @escaping (String, NSNumber, NSNumber, NSNumber, String, String, String) -> Void,
        _ onFail: @escaping (String) -> Void
    ) {
        DispatchQueue.main.async {
            guard success == nil && failure == nil else {
                onFail("Recorder is already running.")
                return
            }
            success = onSuccess
            failure = onFail

            requestPermissions(includeAudio: includeAudio) { videoGranted, audioGranted in
                guard videoGranted else {
                    fail("Camera permission denied.")
                    return
                }
                guard !includeAudio || audioGranted || enablePhoto else {
                    fail("Camera or microphone permission denied.")
                    return
                }
                guard let root = topViewController() else {
                    fail("No visible iOS view controller.")
                    return
                }
                let effectiveIncludeAudio = includeAudio && audioGranted
                let watermarkOptions = WatermarkRenderOptions(
                    imagePath: imagePath,
                    x: x.doubleValue,
                    y: y.doubleValue,
                    textColor: textColor,
                    fontSize: fontSize.doubleValue,
                    textBold: textBold,
                    imageWidth: imageWidth.doubleValue,
                    imageHeight: imageHeight.doubleValue,
                    imageGap: imageGap.doubleValue,
                    boxWidth: boxWidth.doubleValue,
                    boxHeight: boxHeight.doubleValue,
                    backgroundColor: backgroundColor,
                    borderRadius: borderRadius.doubleValue,
                    padding: padding.doubleValue
                )
                let controller = MarkVideoRecorderViewController(
                    watermark: text.isEmpty ? "UTS 即拍即有水印" : text,
                    watermarkOptions: watermarkOptions,
                    fps: max(8, min(24, fps.intValue)),
                    preferredWidth: max(0, width.intValue),
                    preferredHeight: max(0, height.intValue),
                    bitrate: max(0, bitrate.intValue),
                    includeAudio: effectiveIncludeAudio,
                    facing: facing == "front" ? .front : .back,
                    enablePhoto: enablePhoto,
                    maxDurationMs: max(0, maxDurationMs.intValue),
                    minDurationMs: max(0, min(60_000, minDurationMs.intValue))
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
        watermark: String,
        photoTempFilePaths: [String],
        photoSavedFilePaths: [String]
    ) {
        let callback = success
        success = nil
        failure = nil
        callback?(
            path,
            NSNumber(value: durationMs),
            NSNumber(value: width),
            NSNumber(value: height),
            watermark,
            encodePathList(photoTempFilePaths),
            encodePathList(photoSavedFilePaths)
        )
    }

    fileprivate static func fail(_ message: String) {
        let callback = failure
        success = nil
        failure = nil
        callback?(message)
    }

    private static func encodePathList(_ paths: [String]) -> String {
        paths.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    private static func requestPermissions(includeAudio: Bool, _ complete: @escaping (Bool, Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { videoGranted in
            guard includeAudio else {
                DispatchQueue.main.async {
                    complete(videoGranted, true)
                }
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { audioGranted in
                DispatchQueue.main.async {
                    complete(videoGranted, audioGranted)
                }
            }
        }
    }

    private static func topViewController() -> UIViewController? {
        let root: UIViewController?
        if #available(iOS 13.0, *) {
            root = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow }?
                .rootViewController
        } else {
            root = UIApplication.shared.keyWindow?.rootViewController
        }
        var top = root
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

private struct WatermarkRenderOptions {
    let imagePath: String
    let x: CGFloat
    let y: CGFloat
    let textColor: UIColor
    let fontSize: CGFloat
    let textBold: Bool
    let imageWidth: CGFloat
    let imageHeight: CGFloat
    let imageGap: CGFloat
    let boxWidthRatio: CGFloat
    let boxHeightRatio: CGFloat
    let backgroundColor: UIColor
    let borderRadius: CGFloat
    let padding: CGFloat

    init(
        imagePath: String,
        x: Double,
        y: Double,
        textColor: String,
        fontSize: Double,
        textBold: Bool,
        imageWidth: Double,
        imageHeight: Double,
        imageGap: Double,
        boxWidth: Double,
        boxHeight: Double,
        backgroundColor: String,
        borderRadius: Double,
        padding: Double
    ) {
        self.imagePath = imagePath
        self.x = Self.clampRatio(CGFloat(x), fallback: 0.5)
        self.y = Self.clampRatio(CGFloat(y), fallback: 0.78)
        self.textColor = Self.color(from: textColor, fallback: .white)
        self.fontSize = CGFloat(fontSize > 0 ? fontSize : 30)
        self.textBold = textBold
        self.imageWidth = CGFloat(imageWidth > 0 ? imageWidth : 72)
        self.imageHeight = CGFloat(imageHeight > 0 ? imageHeight : 72)
        self.imageGap = CGFloat(imageGap >= 0 ? imageGap : 18)
        self.boxWidthRatio = Self.clampPositiveRatio(CGFloat(boxWidth), fallback: 0.88)
        self.boxHeightRatio = Self.clampPositiveRatio(CGFloat(boxHeight), fallback: 0.16)
        self.backgroundColor = Self.color(
            from: backgroundColor,
            fallback: UIColor.black.withAlphaComponent(0.60)
        )
        self.borderRadius = CGFloat(borderRadius >= 0 ? borderRadius : 18)
        self.padding = CGFloat(padding >= 0 ? padding : 28)
    }

    private static func clampRatio(_ value: CGFloat, fallback: CGFloat) -> CGFloat {
        guard value.isFinite else { return fallback }
        return min(max(value, 0), 1)
    }

    private static func clampPositiveRatio(_ value: CGFloat, fallback: CGFloat) -> CGFloat {
        guard value.isFinite && value > 0 else { return fallback }
        return min(max(value, 0), 1)
    }

    private static func color(from raw: String, fallback: UIColor) -> UIColor {
        var hex = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if hex.hasPrefix("#") {
            hex.removeFirst()
        }
        guard hex.count == 6 || hex.count == 8 else { return fallback }
        var value: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&value) else { return fallback }
        let red: CGFloat
        let green: CGFloat
        let blue: CGFloat
        let alpha: CGFloat
        if hex.count == 8 {
            red = CGFloat((value & 0xFF000000) >> 24) / 255.0
            green = CGFloat((value & 0x00FF0000) >> 16) / 255.0
            blue = CGFloat((value & 0x0000FF00) >> 8) / 255.0
            alpha = CGFloat(value & 0x000000FF) / 255.0
        } else {
            red = CGFloat((value & 0xFF0000) >> 16) / 255.0
            green = CGFloat((value & 0x00FF00) >> 8) / 255.0
            blue = CGFloat(value & 0x0000FF) / 255.0
            alpha = 1.0
        }
        return UIColor(red: red, green: green, blue: blue, alpha: alpha)
    }
}

private final class MarkVideoRecorderViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate, UIGestureRecognizerDelegate {
    private let watermark: String
    private let watermarkOptions: WatermarkRenderOptions
    private let fps: Int
    private let preferredWidth: Int
    private let preferredHeight: Int
    private let bitrate: Int
    private let includeAudio: Bool
    private let facing: AVCaptureDevice.Position
    private let enablePhoto: Bool
    private let maxDurationMs: Int
    private let minDurationMs: Int
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "uts.markvideo.capture")
    private let writerQueue = DispatchQueue(label: "uts.markvideo.writer")
    private let ciContext = CIContext()

    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var watermarkContainer = UIView()
    private var watermarkImageView = UIImageView()
    private var watermarkLabel = UILabel()
    private var watermarkImageWidthConstraint: NSLayoutConstraint?
    private var watermarkImageHeightConstraint: NSLayoutConstraint?
    private var watermarkLabelTopConstraint: NSLayoutConstraint?
    private var recordingStatusView = UIView()
    private var recordingIndicatorRow = UIStackView()
    private var recordingDotView = UIView()
    private var recordingTimeLabel = UILabel()
    private var recordingTimer: Timer?
    private var recordingStartDate: Date?
    private var controlPanel = UIStackView()
    private var statusLabel = UILabel()
    private var startButton = UIButton(type: .system)
    private var stopButton = UIButton(type: .system)
    private var photoButton = UIButton(type: .system)
    private var doneButton = UIButton(type: .system)

    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var firstVideoTime: CMTime?
    private var lastVideoTime: CMTime?
    private var lastEncodedFrameTime: CMTime?
    private var outputURL: URL?
    private var photoTempFilePaths: [String] = []
    private var photoSavedFilePaths: [String] = []
    private var recording = false
    private var completed = false
    private var videoFrameCount = 0
    private var videoSize = CGSize(width: 720, height: 1280)
    private var latestVideoPixelBuffer: CVPixelBuffer?
    private var watermarkImage: UIImage?
    private let watermarkStateLock = NSLock()
    private var watermarkCenterRatio = CGPoint(x: 0.5, y: 0.78)
    private var watermarkScale: CGFloat = 1
    private var dragStartCenterRatio = CGPoint(x: 0.5, y: 0.78)
    private var dragStartLocation = CGPoint.zero
    private var pinchStartScale: CGFloat = 1
    private var frameInterval: CMTime {
        CMTime(value: 1, timescale: CMTimeScale(fps))
    }

    private struct WatermarkLayoutState {
        let centerRatio: CGPoint
        let scale: CGFloat
    }

    private struct WatermarkDrawLayout {
        let rect: CGRect
        let imageRect: CGRect?
        let textRect: CGRect
        let fontSize: CGFloat
        let cornerRadius: CGFloat
        let padding: CGFloat
    }

    init(
        watermark: String,
        watermarkOptions: WatermarkRenderOptions,
        fps: Int,
        preferredWidth: Int,
        preferredHeight: Int,
        bitrate: Int,
        includeAudio: Bool,
        facing: AVCaptureDevice.Position,
        enablePhoto: Bool,
        maxDurationMs: Int,
        minDurationMs: Int
    ) {
        self.watermark = watermark
        self.watermarkOptions = watermarkOptions
        self.fps = fps
        self.preferredWidth = preferredWidth
        self.preferredHeight = preferredHeight
        self.bitrate = bitrate
        self.includeAudio = includeAudio
        self.facing = facing
        self.enablePhoto = enablePhoto
        self.maxDurationMs = maxDurationMs
        self.minDurationMs = minDurationMs
        self.watermarkCenterRatio = CGPoint(x: watermarkOptions.x, y: watermarkOptions.y)
        self.dragStartCenterRatio = self.watermarkCenterRatio
        if preferredWidth > 0 && preferredHeight > 0 {
            self.videoSize = CGSize(width: preferredWidth, height: preferredHeight)
        }
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        watermarkImage = loadWatermarkImage(from: watermarkOptions.imagePath)
        buildUI()
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        layoutWatermarkPreview()
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

        watermarkLabel.text = watermark
        watermarkLabel.textColor = watermarkOptions.textColor
        watermarkLabel.font = watermarkOptions.textBold ? .boldSystemFont(ofSize: 18) : .systemFont(ofSize: 18)
        watermarkLabel.textAlignment = .center
        watermarkLabel.translatesAutoresizingMaskIntoConstraints = false
        watermarkLabel.numberOfLines = 2

        watermarkImageView.image = watermarkImage
        watermarkImageView.contentMode = .scaleAspectFit
        watermarkImageView.isHidden = watermarkImage == nil
        watermarkImageView.translatesAutoresizingMaskIntoConstraints = false

        watermarkContainer.backgroundColor = watermarkOptions.backgroundColor
        watermarkContainer.layer.cornerRadius = min(14, max(8, watermarkOptions.borderRadius / 2))
        watermarkContainer.layer.shadowColor = UIColor.black.cgColor
        watermarkContainer.layer.shadowOpacity = 0.28
        watermarkContainer.layer.shadowRadius = 10
        watermarkContainer.layer.shadowOffset = CGSize(width: 0, height: 4)
        watermarkContainer.translatesAutoresizingMaskIntoConstraints = true
        watermarkContainer.addSubview(watermarkImageView)
        watermarkContainer.addSubview(watermarkLabel)

        let dragGesture = UILongPressGestureRecognizer(target: self, action: #selector(handleWatermarkLongPress(_:)))
        dragGesture.minimumPressDuration = 0.18
        dragGesture.delegate = self
        watermarkContainer.addGestureRecognizer(dragGesture)

        let pinchGesture = UIPinchGestureRecognizer(target: self, action: #selector(handleWatermarkPinch(_:)))
        pinchGesture.delegate = self
        watermarkContainer.addGestureRecognizer(pinchGesture)

        controlPanel.axis = .vertical
        controlPanel.alignment = .fill
        controlPanel.spacing = 12
        controlPanel.backgroundColor = UIColor.black.withAlphaComponent(0.70)
        controlPanel.isLayoutMarginsRelativeArrangement = true
        controlPanel.layoutMargins = UIEdgeInsets(top: 12, left: 18, bottom: 18, right: 18)
        controlPanel.translatesAutoresizingMaskIntoConstraints = false

        recordingStatusView.backgroundColor = UIColor.black.withAlphaComponent(0.64)
        recordingStatusView.layer.cornerRadius = 16
        recordingStatusView.layer.shadowColor = UIColor.black.cgColor
        recordingStatusView.layer.shadowOpacity = 0.24
        recordingStatusView.layer.shadowRadius = 8
        recordingStatusView.layer.shadowOffset = CGSize(width: 0, height: 3)
        recordingStatusView.isHidden = true
        recordingStatusView.translatesAutoresizingMaskIntoConstraints = false

        recordingIndicatorRow.axis = .horizontal
        recordingIndicatorRow.alignment = .center
        recordingIndicatorRow.spacing = 8
        recordingIndicatorRow.translatesAutoresizingMaskIntoConstraints = false

        recordingDotView.backgroundColor = .systemRed
        recordingDotView.layer.cornerRadius = 5
        recordingDotView.translatesAutoresizingMaskIntoConstraints = false
        recordingDotView.widthAnchor.constraint(equalToConstant: 10).isActive = true
        recordingDotView.heightAnchor.constraint(equalToConstant: 10).isActive = true

        recordingTimeLabel.text = Self.formatRecordingTime(elapsed: 0)
        recordingTimeLabel.textColor = UIColor(white: 0.96, alpha: 1)
        recordingTimeLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        recordingTimeLabel.textAlignment = .left

        recordingIndicatorRow.addArrangedSubview(recordingDotView)
        recordingIndicatorRow.addArrangedSubview(recordingTimeLabel)
        recordingStatusView.addSubview(recordingIndicatorRow)

        statusLabel.text = "Camera preview"
        statusLabel.textColor = UIColor(white: 0.92, alpha: 1)
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textAlignment = .center

        startButton.setTitle("开始录制", for: .normal)
        startButton.addTarget(self, action: #selector(startRecording), for: .touchUpInside)
        stopButton.setTitle("结束录制", for: .normal)
        stopButton.isEnabled = false
        stopButton.addTarget(self, action: #selector(stopRecording), for: .touchUpInside)

        photoButton.setTitle("拍照", for: .normal)
        photoButton.isHidden = !enablePhoto
        photoButton.isEnabled = false
        photoButton.addTarget(self, action: #selector(takePhoto), for: .touchUpInside)

        doneButton.setTitle("完成", for: .normal)
        doneButton.isHidden = !enablePhoto
        doneButton.isEnabled = enablePhoto
        doneButton.addTarget(self, action: #selector(finishPhotoSession), for: .touchUpInside)

        let buttonRow = enablePhoto
            ? UIStackView(arrangedSubviews: [startButton, stopButton, doneButton, photoButton])
            : UIStackView(arrangedSubviews: [startButton, stopButton])
        buttonRow.axis = .horizontal
        buttonRow.spacing = 12
        buttonRow.distribution = .fillEqually

        controlPanel.addArrangedSubview(statusLabel)
        controlPanel.addArrangedSubview(buttonRow)

        view.addSubview(watermarkContainer)
        view.addSubview(recordingStatusView)
        view.addSubview(controlPanel)

        let recordingStatusTopAnchor: NSLayoutYAxisAnchor
        if #available(iOS 11.0, *) {
            recordingStatusTopAnchor = view.safeAreaLayoutGuide.topAnchor
        } else {
            recordingStatusTopAnchor = topLayoutGuide.bottomAnchor
        }

        let imageWidthConstraint = watermarkImageView.widthAnchor.constraint(equalToConstant: 0)
        let imageHeightConstraint = watermarkImageView.heightAnchor.constraint(equalToConstant: 0)
        let labelTopConstraint = watermarkLabel.topAnchor.constraint(equalTo: watermarkImageView.bottomAnchor, constant: 0)
        watermarkImageWidthConstraint = imageWidthConstraint
        watermarkImageHeightConstraint = imageHeightConstraint
        watermarkLabelTopConstraint = labelTopConstraint

        NSLayoutConstraint.activate([
            watermarkLabel.leadingAnchor.constraint(equalTo: watermarkContainer.leadingAnchor, constant: 16),
            watermarkLabel.trailingAnchor.constraint(equalTo: watermarkContainer.trailingAnchor, constant: -16),
            labelTopConstraint,
            watermarkLabel.bottomAnchor.constraint(equalTo: watermarkContainer.bottomAnchor, constant: -10),
            watermarkImageView.centerXAnchor.constraint(equalTo: watermarkContainer.centerXAnchor),
            watermarkImageView.topAnchor.constraint(equalTo: watermarkContainer.topAnchor, constant: 10),
            imageWidthConstraint,
            imageHeightConstraint,
            recordingStatusView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            recordingStatusView.topAnchor.constraint(equalTo: recordingStatusTopAnchor, constant: 12),
            recordingIndicatorRow.leadingAnchor.constraint(equalTo: recordingStatusView.leadingAnchor, constant: 14),
            recordingIndicatorRow.trailingAnchor.constraint(equalTo: recordingStatusView.trailingAnchor, constant: -14),
            recordingIndicatorRow.topAnchor.constraint(equalTo: recordingStatusView.topAnchor, constant: 8),
            recordingIndicatorRow.bottomAnchor.constraint(equalTo: recordingStatusView.bottomAnchor, constant: -8),
            controlPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controlPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controlPanel.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        layoutWatermarkPreview()
    }

    private func layoutWatermarkPreview() {
        guard view.bounds.width > 0 && view.bounds.height > 0 else { return }
        let state = currentWatermarkLayoutState()
        let size = watermarkPreviewSize(scale: state.scale)
        let targetCenter = CGPoint(
            x: state.centerRatio.x * view.bounds.width,
            y: state.centerRatio.y * view.bounds.height
        )
        watermarkContainer.bounds = CGRect(origin: .zero, size: size)
        watermarkContainer.center = clampedWatermarkCenter(targetCenter, size: size)
        let previewLayout = watermarkDrawLayout(
            canvasSize: size,
            state: WatermarkLayoutState(centerRatio: CGPoint(x: 0.5, y: 0.5), scale: 1)
        )
        watermarkImageWidthConstraint?.constant = previewLayout.imageRect?.width ?? 0
        watermarkImageHeightConstraint?.constant = previewLayout.imageRect?.height ?? 0
        watermarkLabelTopConstraint?.constant = previewLayout.imageRect == nil ? 0 : min(8, watermarkOptions.imageGap / 2)
        watermarkLabel.font = watermarkOptions.textBold
            ? .boldSystemFont(ofSize: min(20, max(13, previewLayout.fontSize)))
            : .systemFont(ofSize: min(20, max(13, previewLayout.fontSize)))
    }

    @objc private func handleWatermarkLongPress(_ gesture: UILongPressGestureRecognizer) {
        let location = gesture.location(in: view)
        switch gesture.state {
        case .began:
            let state = currentWatermarkLayoutState()
            dragStartCenterRatio = state.centerRatio
            dragStartLocation = location
        case .changed:
            let state = currentWatermarkLayoutState()
            let nextCenter = CGPoint(
                x: dragStartCenterRatio.x * view.bounds.width + location.x - dragStartLocation.x,
                y: dragStartCenterRatio.y * view.bounds.height + location.y - dragStartLocation.y
            )
            updateWatermarkLayout(center: nextCenter, scale: state.scale)
        default:
            layoutWatermarkPreview()
        }
    }

    @objc private func handleWatermarkPinch(_ gesture: UIPinchGestureRecognizer) {
        switch gesture.state {
        case .began:
            pinchStartScale = currentWatermarkLayoutState().scale
        case .changed:
            let state = currentWatermarkLayoutState()
            let currentCenter = CGPoint(
                x: state.centerRatio.x * view.bounds.width,
                y: state.centerRatio.y * view.bounds.height
            )
            updateWatermarkLayout(center: currentCenter, scale: pinchStartScale * gesture.scale)
        default:
            layoutWatermarkPreview()
        }
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        return true
    }

    private func updateWatermarkLayout(center: CGPoint, scale: CGFloat) {
        guard view.bounds.width > 0 && view.bounds.height > 0 else { return }
        let nextScale = min(max(scale, 0.6), 2.2)
        let size = watermarkPreviewSize(scale: nextScale)
        let clampedCenter = clampedWatermarkCenter(center, size: size)
        let nextRatio = CGPoint(
            x: min(max(clampedCenter.x / view.bounds.width, 0), 1),
            y: min(max(clampedCenter.y / view.bounds.height, 0), 1)
        )
        watermarkStateLock.lock()
        watermarkCenterRatio = nextRatio
        watermarkScale = nextScale
        watermarkStateLock.unlock()
        layoutWatermarkPreview()
    }

    private func currentWatermarkLayoutState() -> WatermarkLayoutState {
        watermarkStateLock.lock()
        let state = WatermarkLayoutState(centerRatio: watermarkCenterRatio, scale: watermarkScale)
        watermarkStateLock.unlock()
        return state
    }

    private func watermarkPreviewSize(scale: CGFloat) -> CGSize {
        let baseWidth = min(max(220, view.bounds.width * watermarkOptions.boxWidthRatio), max(180, view.bounds.width - 36))
        let baseHeight = max(56, view.bounds.height * watermarkOptions.boxHeightRatio)
        return CGSize(width: baseWidth * scale, height: min(baseHeight, 150) * scale)
    }

    private func clampedWatermarkCenter(_ center: CGPoint, size: CGSize) -> CGPoint {
        let horizontalMargin = size.width / 2 + 18
        let minX = min(horizontalMargin, view.bounds.midX)
        let maxX = max(view.bounds.width - horizontalMargin, view.bounds.midX)
        let minY = topSafeInset() + size.height / 2 + 18
        let controlTop = controlPanel.frame.minY > 0 ? controlPanel.frame.minY : view.bounds.height
        let maxY = max(controlTop - size.height / 2 - 18, minY)
        return CGPoint(
            x: min(max(center.x, minX), maxX),
            y: min(max(center.y, minY), maxY)
        )
    }

    private func topSafeInset() -> CGFloat {
        if #available(iOS 11.0, *) {
            return view.safeAreaInsets.top
        }
        return topLayoutGuide.length
    }

    private func loadWatermarkImage(from rawPath: String) -> UIImage? {
        let path = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return nil }
        if let url = URL(string: path), url.isFileURL {
            return UIImage(contentsOfFile: url.path)
        }
        if path.hasPrefix("file://") {
            let filePath = String(path.dropFirst("file://".count))
            return UIImage(contentsOfFile: filePath)
        }
        return UIImage(contentsOfFile: path)
    }

    private func watermarkDrawLayout(canvasSize: CGSize, state: WatermarkLayoutState) -> WatermarkDrawLayout {
        let boxWidth = max(1, canvasSize.width * watermarkOptions.boxWidthRatio * state.scale)
        let boxHeight = max(1, canvasSize.height * watermarkOptions.boxHeightRatio * state.scale)
        let center = CGPoint(
            x: canvasSize.width * state.centerRatio.x,
            y: canvasSize.height * state.centerRatio.y
        )
        let rect = CGRect(
            x: center.x - boxWidth / 2,
            y: center.y - boxHeight / 2,
            width: boxWidth,
            height: boxHeight
        )
        let padding = min(watermarkOptions.padding * state.scale, min(boxWidth, boxHeight) * 0.28)
        let gap = min(watermarkOptions.imageGap * state.scale, max(0, boxHeight * 0.18))
        let hasImage = watermarkImage != nil
        let imageWidth = min(watermarkOptions.imageWidth * state.scale, max(0, boxWidth - padding * 2))
        let imageHeight = min(watermarkOptions.imageHeight * state.scale, max(0, boxHeight * 0.46))
        let imageRect = hasImage && imageWidth > 0 && imageHeight > 0
            ? CGRect(
                x: rect.midX - imageWidth / 2,
                y: rect.minY + padding,
                width: imageWidth,
                height: imageHeight
            )
            : nil
        let textTop = (imageRect?.maxY ?? rect.minY + padding) + (imageRect == nil ? 0 : gap)
        let textRect = CGRect(
            x: rect.minX + padding,
            y: textTop,
            width: max(1, rect.width - padding * 2),
            height: max(1, rect.maxY - padding - textTop)
        )
        return WatermarkDrawLayout(
            rect: rect,
            imageRect: imageRect,
            textRect: textRect,
            fontSize: max(10, watermarkOptions.fontSize * state.scale),
            cornerRadius: max(0, watermarkOptions.borderRadius * state.scale),
            padding: padding
        )
    }

    private func startRecordingIndicator() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async {
                self.startRecordingIndicator()
            }
            return
        }
        recordingStartDate = Date()
        recordingTimeLabel.text = Self.formatRecordingTime(elapsed: 0)
        recordingStatusView.isHidden = false
        recordingDotView.layer.removeAllAnimations()
        recordingDotView.alpha = 1
        recordingTimer?.invalidate()
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self, let startDate = self.recordingStartDate else { return }
            let elapsed = Int(Date().timeIntervalSince(startDate))
            self.recordingTimeLabel.text = Self.formatRecordingTime(elapsed: elapsed)
        }
        if let timer = recordingTimer {
            RunLoop.main.add(timer, forMode: .common)
        }
        UIView.animate(
            withDuration: 0.8,
            delay: 0,
            options: [.autoreverse, .repeat, .allowUserInteraction],
            animations: {
                self.recordingDotView.alpha = 0.25
            }
        )
        scheduleMaxDurationStopIfNeeded()
    }

    private func stopRecordingIndicator() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async {
                self.stopRecordingIndicator()
            }
            return
        }
        recordingTimer?.invalidate()
        recordingTimer = nil
        recordingStartDate = nil
        recordingDotView.layer.removeAllAnimations()
        recordingDotView.alpha = 1
        recordingStatusView.isHidden = true
        recordingTimeLabel.text = Self.formatRecordingTime(elapsed: 0)
    }

    private func scheduleMaxDurationStopIfNeeded() {
        guard maxDurationMs > 0 else { return }
        NSObject.cancelPreviousPerformRequests(
            withTarget: self,
            selector: #selector(MarkVideoRecorderViewController.stopRecording),
            object: nil
        )
        perform(
            #selector(MarkVideoRecorderViewController.stopRecording),
            with: nil,
            afterDelay: Double(maxDurationMs) / 1000.0
        )
    }

    private static func formatRecordingTime(elapsed: Int) -> String {
        let safeElapsed = max(0, elapsed)
        let minutes = safeElapsed / 60
        let seconds = safeElapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720

        do {
            guard let camera = defaultVideoCamera() else {
                throw NSError(domain: "uts.markvideo", code: 1, userInfo: [NSLocalizedDescriptionKey: "No camera device."])
            }
            let videoInput = try AVCaptureDeviceInput(device: camera)
            guard session.canAddInput(videoInput) else {
                throw NSError(domain: "uts.markvideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Cannot add camera input."])
            }
            session.addInput(videoInput)

            if includeAudio {
                guard let microphone = AVCaptureDevice.default(for: .audio) else {
                    throw NSError(domain: "uts.markvideo", code: 2, userInfo: [NSLocalizedDescriptionKey: "No microphone device."])
                }
                let micInput = try AVCaptureDeviceInput(device: microphone)
                guard session.canAddInput(micInput) else {
                    throw NSError(domain: "uts.markvideo", code: 5, userInfo: [NSLocalizedDescriptionKey: "Cannot add microphone input."])
                }
                session.addInput(micInput)
            }

            let videoOutput = AVCaptureVideoDataOutput()
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(self, queue: writerQueue)
            guard session.canAddOutput(videoOutput) else {
                throw NSError(domain: "uts.markvideo", code: 6, userInfo: [NSLocalizedDescriptionKey: "Cannot add video output."])
            }
            session.addOutput(videoOutput)
            if let videoConnection = videoOutput.connection(with: .video) {
                videoConnection.videoOrientation = .portrait
                if videoConnection.isVideoMirroringSupported {
                    videoConnection.automaticallyAdjustsVideoMirroring = false
                    videoConnection.isVideoMirrored = false
                }
            }

            if includeAudio {
                let audioOutput = AVCaptureAudioDataOutput()
                audioOutput.setSampleBufferDelegate(self, queue: writerQueue)
                guard session.canAddOutput(audioOutput) else {
                    throw NSError(domain: "uts.markvideo", code: 7, userInfo: [NSLocalizedDescriptionKey: "Cannot add audio output."])
                }
                session.addOutput(audioOutput)
            }
        } catch {
            session.commitConfiguration()
            finishWithError(error.localizedDescription)
            return
        }

        session.commitConfiguration()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
    }

    @objc private func startRecording() {
        startButton.isEnabled = false
        stopButton.isEnabled = false
        photoButton.isEnabled = false
        doneButton.isEnabled = false
        statusLabel.text = "Starting recorder..."

        writerQueue.async {
            guard !self.recording && self.assetWriter == nil else {
                DispatchQueue.main.async {
                    self.startButton.isEnabled = false
                    self.stopButton.isEnabled = true
                    self.photoButton.isEnabled = false
                    self.doneButton.isEnabled = false
                    self.statusLabel.text = "Recording with burned-in watermark..."
                }
                return
            }

            do {
                try self.prepareWriter()
                self.recording = true
                self.firstVideoTime = nil
                self.lastVideoTime = nil
                self.lastEncodedFrameTime = nil
                self.videoFrameCount = 0
                DispatchQueue.main.async {
                    self.startButton.isEnabled = false
                    self.stopButton.isEnabled = true
                    self.photoButton.isEnabled = false
                    self.doneButton.isEnabled = false
                    self.statusLabel.text = "Preparing first recorded frame..."
                }
            } catch {
                self.recording = false
                if let outputURL = self.outputURL {
                    try? FileManager.default.removeItem(at: outputURL)
                }
                self.resetWriter()
                self.finishWithError(error.localizedDescription)
            }
        }
    }

    @objc private func takePhoto() {
        guard enablePhoto, !recording else { return }
        photoButton.isEnabled = false
        doneButton.isEnabled = false
        startButton.isEnabled = false
        stopButton.isEnabled = false
        statusLabel.text = "Saving photo..."

        writerQueue.async {
            guard !self.recording && self.assetWriter == nil else {
                DispatchQueue.main.async {
                    self.photoButton.isEnabled = false
                    self.doneButton.isEnabled = false
                    self.statusLabel.text = "Recording with burned-in watermark..."
                }
                return
            }
            guard let sourceBuffer = self.latestVideoPixelBuffer else {
                DispatchQueue.main.async {
                    self.startButton.isEnabled = true
                    self.stopButton.isEnabled = false
                    self.photoButton.isEnabled = false
                    self.doneButton.isEnabled = true
                    self.statusLabel.text = "Camera preview is warming up..."
                }
                return
            }

            do {
                let image = try self.makeWatermarkedImage(from: sourceBuffer)
                let tempPath = try self.writePhotoTempFile(image)
                self.savePhotoToGallery(image) { savedPath, errorMessage in
                    DispatchQueue.main.async {
                        if let savedPath = savedPath {
                            self.photoTempFilePaths.append(tempPath)
                            self.photoSavedFilePaths.append(savedPath)
                            self.startButton.isEnabled = true
                            self.stopButton.isEnabled = false
                            self.photoButton.isEnabled = true
                            self.doneButton.isEnabled = true
                            self.statusLabel.text = "Photo saved to gallery."
                        } else {
                            try? FileManager.default.removeItem(atPath: tempPath)
                            self.completed = true
                            MarkVideoRecorder.fail(errorMessage ?? "Photo capture failed.")
                            self.dismiss(animated: true)
                        }
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.completed = true
                    MarkVideoRecorder.fail(error.localizedDescription)
                    self.dismiss(animated: true)
                }
            }
        }
    }

    @objc private func stopRecording() {
        startButton.isEnabled = false
        stopButton.isEnabled = false
        photoButton.isEnabled = false
        doneButton.isEnabled = false
        stopRecordingIndicator()
        NSObject.cancelPreviousPerformRequests(
            withTarget: self,
            selector: #selector(MarkVideoRecorderViewController.stopRecording),
            object: nil
        )
        statusLabel.text = "Finishing file..."

        writerQueue.async {
            self.recording = false
            guard let outputURL = self.outputURL else {
                self.finishWithError("Writer was not started.")
                return
            }
            self.finishRecordingOnWriterQueue(outputURL: outputURL)
        }
    }

    private func handleFinishedWriting(outputURL: URL, writer: AVAssetWriter) {
        guard writer.status == .completed else {
            failWriter(outputURL: outputURL, message: writer.error?.localizedDescription ?? "Recorder finish failed.")
            return
        }

        guard videoFrameCount > 0 else {
            failNoFrames(outputURL: outputURL)
            return
        }

        let durationMs: Double
        if let first = firstVideoTime, let last = lastVideoTime {
            durationMs = max(1, CMTimeSubtract(last, first).seconds * 1000)
        } else {
            durationMs = 0
        }
        resetWriter()
        DispatchQueue.main.async {
            self.stopRecordingIndicator()
            self.completed = true
            MarkVideoRecorder.complete(
                path: outputURL.path,
                durationMs: durationMs,
                width: Int(self.videoSize.width),
                height: Int(self.videoSize.height),
                watermark: self.watermark,
                photoTempFilePaths: self.photoTempFilePaths,
                photoSavedFilePaths: self.photoSavedFilePaths
            )
            self.dismiss(animated: true)
        }
    }

    private func finishRecordingOnWriterQueue(outputURL: URL) {
        guard let writer = assetWriter else {
            finishWithError("Writer was not started.")
            return
        }

        guard videoFrameCount > 0 else {
            if writer.status == .writing {
                writer.cancelWriting()
            }
            failNoFrames(outputURL: outputURL)
            return
        }

        videoInput?.markAsFinished()
        audioInput?.markAsFinished()
        writer.finishWriting {
            self.writerQueue.async {
                self.handleFinishedWriting(outputURL: outputURL, writer: writer)
            }
        }
    }

    private func failNoFrames(outputURL: URL) {
        try? FileManager.default.removeItem(at: outputURL)
        resetWriter()
        finishWithError("No frames were recorded.")
    }

    private func failWriter(outputURL: URL, message: String) {
        try? FileManager.default.removeItem(at: outputURL)
        resetWriter()
        finishWithError(message)
    }

    private func finishWithError(_ message: String) {
        DispatchQueue.main.async {
            if self.completed {
                return
            }
            self.stopRecordingIndicator()
            self.completed = true
            MarkVideoRecorder.fail(message)
            self.dismiss(animated: true)
        }
    }

    private func prepareWriter() throws {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("uts-ios-watermark-\(Int(Date().timeIntervalSince1970 * 1000)).mp4")
        try? FileManager.default.removeItem(at: url)
        outputURL = url

        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        var videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecH264,
            AVVideoWidthKey: Int(videoSize.width),
            AVVideoHeightKey: Int(videoSize.height)
        ]
        if bitrate > 0 {
            videoSettings[AVVideoCompressionPropertiesKey] = [
                AVVideoAverageBitRateKey: bitrate
            ]
        }
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

        guard writer.canAdd(videoInput) else {
            throw NSError(domain: "uts.markvideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot add writer inputs."])
        }

        writer.add(videoInput)
        if includeAudio {
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
            guard writer.canAdd(audioInput) else {
                throw NSError(domain: "uts.markvideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot add writer inputs."])
            }
            writer.add(audioInput)
            self.audioInput = audioInput
        } else {
            self.audioInput = nil
        }
        self.assetWriter = writer
        self.videoInput = videoInput
        self.pixelBufferAdaptor = adaptor
    }

    private func defaultVideoCamera() -> AVCaptureDevice? {
        if #available(iOS 10.0, *) {
            return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: facing) ??
                AVCaptureDevice.default(for: .video)
        }
        return AVCaptureDevice.default(for: .video)
    }

    private func resetWriter() {
        assetWriter = nil
        videoInput = nil
        audioInput = nil
        pixelBufferAdaptor = nil
        firstVideoTime = nil
        lastVideoTime = nil
        lastEncodedFrameTime = nil
        outputURL = nil
        videoFrameCount = 0
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output is AVCaptureVideoDataOutput {
            if let sourceBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
                latestVideoPixelBuffer = sourceBuffer
                DispatchQueue.main.async {
                    if self.enablePhoto && self.startButton.isEnabled && !self.completed {
                        self.photoButton.isEnabled = true
                    }
                }
            }
            guard recording else { return }
            appendVideo(sampleBuffer)
        } else if output is AVCaptureAudioDataOutput {
            guard recording else { return }
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
        guard shouldEncodeFrame(at: timestamp) else { return }
        if writer.status == .unknown {
            writer.startWriting()
            writer.startSession(atSourceTime: timestamp)
        }

        guard writer.status == .writing, videoInput.isReadyForMoreMediaData else { return }
        guard let watermarkedBuffer = makeWatermarkedPixelBuffer(from: sourceBuffer, adaptor: adaptor) else { return }
        if adaptor.append(watermarkedBuffer, withPresentationTime: timestamp) {
            if firstVideoTime == nil {
                firstVideoTime = timestamp
                DispatchQueue.main.async {
                    self.startRecordingIndicator()
                    self.statusLabel.text = "Recording with burned-in watermark..."
                }
            }
            lastEncodedFrameTime = timestamp
            lastVideoTime = timestamp
            videoFrameCount += 1
        }
    }

    private func shouldEncodeFrame(at timestamp: CMTime) -> Bool {
        guard let last = lastEncodedFrameTime else {
            return true
        }

        return CMTimeCompare(CMTimeSubtract(timestamp, last), frameInterval) >= 0
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

    private func makeWatermarkedImage(from sourceBuffer: CVPixelBuffer) throws -> UIImage {
        var outputBuffer: CVPixelBuffer?
        CVPixelBufferCreate(
            nil,
            CVPixelBufferGetWidth(sourceBuffer),
            CVPixelBufferGetHeight(sourceBuffer),
            kCVPixelFormatType_32BGRA,
            [
                kCVPixelBufferCGImageCompatibilityKey as String: true,
                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
            ] as CFDictionary,
            &outputBuffer
        )
        guard let targetBuffer = outputBuffer else {
            throw NSError(domain: "uts.markvideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unable to allocate photo buffer."])
        }

        let image = CIImage(cvPixelBuffer: sourceBuffer)
        ciContext.render(image, to: targetBuffer)
        drawWatermark(into: targetBuffer)

        let outputImage = CIImage(cvPixelBuffer: targetBuffer)
        guard let cgImage = ciContext.createCGImage(outputImage, from: outputImage.extent) else {
            throw NSError(domain: "uts.markvideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unable to render photo."])
        }
        return UIImage(cgImage: cgImage, scale: 1, orientation: .up)
    }

    private func writePhotoTempFile(_ image: UIImage) throws -> String {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("uts-ios-watermark-\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
        guard let data = image.jpegData(compressionQuality: 0.92) else {
            throw NSError(domain: "uts.markvideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unable to encode photo."])
        }
        try data.write(to: url, options: .atomic)
        return url.path
    }

    private func savePhotoToGallery(_ image: UIImage, _ complete: @escaping (String?, String?) -> Void) {
        requestPhotoWriteAccess { granted in
            guard granted else {
                complete(nil, "Photo library permission denied.")
                return
            }

            var localIdentifier: String?
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetChangeRequest.creationRequestForAsset(from: image)
                localIdentifier = request.placeholderForCreatedAsset?.localIdentifier
            }, completionHandler: { success, error in
                if success {
                    complete((localIdentifier?.isEmpty == false) ? localIdentifier : nil, nil)
                } else {
                    complete(nil, error?.localizedDescription ?? "Photo capture failed.")
                }
            })
        }
    }

    private func requestPhotoWriteAccess(_ complete: @escaping (Bool) -> Void) {
        if #available(iOS 14, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                complete(status == .authorized || status == .limited)
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                complete(status == .authorized)
            }
        }
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

        context.saveGState()
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)

        let state = currentWatermarkLayoutState()
        let layout = watermarkDrawLayout(
            canvasSize: CGSize(width: CGFloat(width), height: CGFloat(height)),
            state: state
        )
        context.setFillColor(watermarkOptions.backgroundColor.cgColor)
        let backgroundPath = UIBezierPath(
            roundedRect: layout.rect,
            cornerRadius: min(layout.cornerRadius, min(layout.rect.width, layout.rect.height) / 2)
        )
        context.addPath(backgroundPath.cgPath)
        context.fillPath()

        UIGraphicsPushContext(context)
        if let imageRect = layout.imageRect, let cgImage = watermarkImage?.cgImage {
            context.draw(cgImage, in: imageRect)
        }
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byTruncatingTail
        let attributes: [NSAttributedString.Key: Any] = [
            .font: watermarkOptions.textBold
                ? UIFont.boldSystemFont(ofSize: layout.fontSize)
                : UIFont.systemFont(ofSize: layout.fontSize),
            .foregroundColor: watermarkOptions.textColor,
            .paragraphStyle: paragraph
        ]
        (watermark as NSString).draw(in: layout.textRect, withAttributes: attributes)
        UIGraphicsPopContext()
        context.restoreGState()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopRecordingIndicator()
        NSObject.cancelPreviousPerformRequests(
            withTarget: self,
            selector: #selector(MarkVideoRecorderViewController.stopRecording),
            object: nil
        )
        if !completed {
            if enablePhoto && !recording && !photoTempFilePaths.isEmpty {
                completed = true
                MarkVideoRecorder.complete(
                    path: "",
                    durationMs: 0,
                    width: 0,
                    height: 0,
                    watermark: watermark,
                    photoTempFilePaths: photoTempFilePaths,
                    photoSavedFilePaths: photoSavedFilePaths
                )
                return
            }
            completed = true
            writerQueue.async {
                self.recording = false
                if let writer = self.assetWriter, writer.status == .writing {
                    self.videoInput?.markAsFinished()
                    self.audioInput?.markAsFinished()
                    writer.cancelWriting()
                }
                if let outputURL = self.outputURL {
                    try? FileManager.default.removeItem(at: outputURL)
                }
                self.resetWriter()
            }
            MarkVideoRecorder.fail("Recording cancelled.")
        }
    }

    @objc private func finishPhotoSession() {
        guard enablePhoto, !recording else { return }
        guard !photoTempFilePaths.isEmpty else {
            completed = true
            MarkVideoRecorder.fail("Recording cancelled.")
            dismiss(animated: true)
            return
        }
        completed = true
        MarkVideoRecorder.complete(
            path: "",
            durationMs: 0,
            width: 0,
            height: 0,
            watermark: watermark,
            photoTempFilePaths: photoTempFilePaths,
            photoSavedFilePaths: photoSavedFilePaths
        )
        dismiss(animated: true)
    }
}
