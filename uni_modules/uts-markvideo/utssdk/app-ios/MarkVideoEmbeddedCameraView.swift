import AVFoundation
import CoreImage
import Photos
import UIKit

@objcMembers
public final class MarkVideoEmbeddedCameraView: UIView, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate, UIGestureRecognizerDelegate {
    private static let captureQueueKey = DispatchSpecificKey<Bool>()
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "uts.markvideo.embedded.capture")
    private let writerQueue = DispatchQueue(label: "uts.markvideo.embedded.writer")
    private let ciContext = CIContext()
    private let previewLayer: AVCaptureVideoPreviewLayer
    private let watermarkView = EmbeddedWatermarkPreviewView()
    private let stateLock = NSLock()

    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var audioOutput: AVCaptureAudioDataOutput?
    private var activeDevice: AVCaptureDevice?

    private var assetWriter: AVAssetWriter?
    private var writerVideoInput: AVAssetWriterInput?
    private var writerAudioInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var outputURL: URL?
    private var firstVideoTime: CMTime?
    private var lastVideoTime: CMTime?
    private var lastEncodedFrameTime: CMTime?
    private var videoFrameCount = 0
    private var videoSize = CGSize(width: 720, height: 1280)
    private var latestVideoPixelBuffer: CVPixelBuffer?

    private var ready = false
    private var recording = false
    private var destroyed = false
    private var videoPermissionRequestPending = false
    private var audioPermissionRequestPending = false
    private var cameraFacing = "back"
    private var zoom = "1x"
    private var flashEnabled = false
    private var activeTemplate: EmbeddedWatermarkTemplate?
    private var activeWatermarkImage: UIImage?
    private var frozenTemplate: EmbeddedWatermarkTemplate?
    private var frozenWatermarkImage: UIImage?
    private var dragStartOrigin = CGPoint.zero
    private var dragStartLocation = CGPoint.zero

    private var positionCallback: ((String) -> Void)?
    private var errorCallback: ((String) -> Void)?

    public override init(frame: CGRect) {
        previewLayer = AVCaptureVideoPreviewLayer(session: session)
        super.init(frame: frame)
        setupView()
    }

    required init?(coder: NSCoder) {
        previewLayer = AVCaptureVideoPreviewLayer(session: session)
        super.init(coder: coder)
        setupView()
    }

    private func setupView() {
        captureQueue.setSpecific(key: Self.captureQueueKey, value: true)
        backgroundColor = .black
        previewLayer.videoGravity = .resizeAspectFill
        if previewLayer.superlayer == nil {
            layer.addSublayer(previewLayer)
        }

        watermarkView.isHidden = true
        if watermarkView.superview == nil {
            addSubview(watermarkView)
        }
        let drag = UILongPressGestureRecognizer(target: self, action: #selector(handleWatermarkDrag(_:)))
        drag.minimumPressDuration = 0.18
        drag.delegate = self
        watermarkView.addGestureRecognizer(drag)
    }

    deinit {
        destroyResources()
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer.frame = bounds
        layoutWatermarkPreview(emitChange: false)
    }

    public func setEventHandlers(
        _ onWatermarkPositionChange: @escaping (String) -> Void,
        _ onNativeError: @escaping (String) -> Void
    ) {
        positionCallback = onWatermarkPositionChange
        errorCallback = onNativeError
    }

    public func mountCamera(
        _ previewWidth: NSNumber,
        _ previewHeight: NSNumber,
        _ nextFacing: String,
        _ nextZoom: String,
        _ nextFlashEnabled: Bool
    ) -> String {
        destroyed = false
        let videoAccess = requestVideoAccessIfNeeded()
        guard videoAccess.success else {
            return fail(videoAccess.code, videoAccess.message, videoAccess.nativeMessage)
        }

        cameraFacing = nextFacing == "front" ? "front" : "back"
        zoom = validZoom(nextZoom) ? nextZoom : "1x"
        flashEnabled = false

        let configured = configureCameraSession(facing: cameraFacing, zoom: zoom)
        guard configured.success else {
            return fail(configured.code, configured.message, configured.nativeMessage)
        }

        let started = runOnCaptureQueueSync {
            if !self.session.isRunning {
                self.session.startRunning()
            }
            return self.session.isRunning
        }
        guard started else {
            return fail("1101", "相机设备不可用", "Camera session failed to start.")
        }

        if nextFlashEnabled {
            _ = applyFlash(enabled: true)
        }

        ready = true
        return ok([
            "availableZooms": availableZooms(),
            "zoom": zoom,
            "flashAvailable": activeDevice?.hasTorch == true,
            "flashEnabled": flashEnabled,
            "cameraFacing": cameraFacing,
            "previewWidth": previewWidth,
            "previewHeight": previewHeight
        ])
    }

    public func setWatermark(_ templateJSON: String) -> String {
        guard !recording else {
            return fail("1403", "当前状态不允许执行该操作", "setWatermark while recording")
        }
        let parsed = EmbeddedWatermarkTemplate.parse(templateJSON)
        guard parsed.success, let template = parsed.template else {
            return fail(parsed.code, parsed.message, parsed.nativeMessage)
        }
        let image = loadImageIfNeeded(for: template)
        guard image.success else {
            return fail(image.code, image.message, image.nativeMessage)
        }

        activeTemplate = template
        activeWatermarkImage = image.image
        watermarkView.template = template
        watermarkView.watermarkImage = image.image
        watermarkView.isHidden = false
        layoutWatermarkPreview(emitChange: true)
        return ok([:])
    }

    public func clearWatermark() -> String {
        guard !recording else {
            return fail("1403", "当前状态不允许执行该操作", "clearWatermark while recording")
        }
        activeTemplate = nil
        activeWatermarkImage = nil
        watermarkView.template = nil
        watermarkView.watermarkImage = nil
        watermarkView.isHidden = true
        return ok([:])
    }

    public func getWatermarkPosition() -> String {
        guard ready else {
            return fail("1104", "相机未挂载或未就绪", "Camera is not ready.")
        }
        guard let template = activeTemplate else {
            return ok(["x": 0, "y": 0, "width": 0, "height": 0])
        }
        return ok([
            "x": template.positionX,
            "y": template.positionY,
            "width": template.boxWidth,
            "height": template.boxHeight
        ])
    }

    public func takePhoto(_ optionsJSON: String) -> String {
        guard ready else {
            return fail("1104", "相机未挂载或未就绪", "Camera is not ready.")
        }
        guard !recording else {
            return fail("1403", "当前状态不允许执行该操作", "takePhoto while recording")
        }
        guard let sourceBuffer = latestVideoPixelBuffer else {
            return fail("1301", "拍照失败", "No camera frame is available yet.")
        }

        let outputTemplate = templateFromOptions(optionsJSON) ?? activeTemplate
        let outputImage = imageForOutputTemplate(outputTemplate)

        do {
            let image = try makeWatermarkedImage(
                from: sourceBuffer,
                template: outputTemplate,
                watermarkImage: outputImage
            )
            let tempPath = try writePhotoTempFile(image)
            let save = saveImageToGallerySynchronously(image)
            if !save.success {
                emitNativeError("1501", "文件保存失败", save.nativeMessage)
            }
            return ok(photoData(
                tempFilePath: tempPath,
                albumFilePath: save.albumFilePath,
                width: Int(image.size.width),
                height: Int(image.size.height),
                template: outputTemplate
            ))
        } catch {
            return fail("1301", "拍照失败", error.localizedDescription)
        }
    }

    public func startRecord(_ optionsJSON: String) -> String {
        guard ready else {
            return fail("1104", "相机未挂载或未就绪", "Camera is not ready.")
        }
        guard !recording else {
            return fail("1403", "当前状态不允许执行该操作", "duplicate startRecord")
        }
        let audioAccess = requestAudioAccessIfNeeded()
        guard audioAccess.success else {
            return fail(audioAccess.code, audioAccess.message, audioAccess.nativeMessage)
        }

        let outputTemplate = templateFromOptions(optionsJSON) ?? activeTemplate
        frozenTemplate = outputTemplate
        frozenWatermarkImage = imageForOutputTemplate(outputTemplate)

        let audioReady = ensureAudioInputs()
        guard audioReady.success else {
            return fail(audioReady.code, audioReady.message, audioReady.nativeMessage)
        }

        do {
            try prepareWriter()
            firstVideoTime = nil
            lastVideoTime = nil
            lastEncodedFrameTime = nil
            videoFrameCount = 0
            recording = true
            watermarkView.isUserInteractionEnabled = false
            return ok([:])
        } catch {
            resetWriter()
            return fail("1401", "录像开始失败", error.localizedDescription)
        }
    }

    public func stopRecord() -> String {
        guard recording else {
            return fail("1403", "当前状态不允许执行该操作", "stopRecord while not recording")
        }
        recording = false
        watermarkView.isUserInteractionEnabled = true

        guard let url = outputURL, let writer = assetWriter else {
            resetWriter()
            return fail("1402", "录像停止失败", "Writer was not started.")
        }
        guard videoFrameCount > 0 else {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            resetWriter()
            return fail("1402", "录像停止失败", "No frames were recorded.")
        }

        writerVideoInput?.markAsFinished()
        writerAudioInput?.markAsFinished()
        let semaphore = DispatchSemaphore(value: 0)
        writer.finishWriting {
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + 20) == .timedOut {
            writer.cancelWriting()
            resetWriter()
            return fail("1402", "录像停止失败", "Timed out while finishing video.")
        }
        guard writer.status == .completed else {
            let message = writer.error?.localizedDescription ?? "Recorder finish failed."
            try? FileManager.default.removeItem(at: url)
            resetWriter()
            return fail("1402", "录像停止失败", message)
        }

        let durationMs: Double
        if let first = firstVideoTime, let last = lastVideoTime {
            durationMs = max(1, CMTimeSubtract(last, first).seconds * 1000)
        } else {
            durationMs = 0
        }
        let template = frozenTemplate
        let save = saveVideoToGallerySynchronously(url)
        if !save.success {
            emitNativeError("1501", "文件保存失败", save.nativeMessage)
        }
        resetWriter()
        frozenTemplate = nil
        frozenWatermarkImage = nil
        return ok(videoData(
            tempFilePath: url.path,
            albumFilePath: save.albumFilePath,
            durationMs: durationMs,
            width: Int(videoSize.width),
            height: Int(videoSize.height),
            template: template
        ))
    }

    public func switchFlash(_ enabled: Bool) -> String {
        guard ready else {
            return fail("1104", "相机未挂载或未就绪", "Camera is not ready.")
        }
        let result = applyFlash(enabled: enabled)
        guard result.success else {
            return fail(result.code, result.message, result.nativeMessage)
        }
        return ok(["enabled": flashEnabled])
    }

    public func setZoom(_ nextZoom: String) -> String {
        guard ready else {
            return fail("1104", "相机未挂载或未就绪", "Camera is not ready.")
        }
        guard validZoom(nextZoom) else {
            return fail("1103", "焦段不可用", nextZoom)
        }
        let result = applyZoom(nextZoom)
        guard result.success else {
            return fail(result.code, result.message, result.nativeMessage)
        }
        return ok(["zoom": zoom, "availableZooms": availableZooms()])
    }

    public func switchCamera(_ nextFacing: String) -> String {
        guard !recording else {
            return fail("1403", "当前状态不允许执行该操作", "switchCamera while recording")
        }
        guard ready else {
            return fail("1104", "相机未挂载或未就绪", "Camera is not ready.")
        }
        let facing = nextFacing == "front" ? "front" : "back"
        let result = configureCameraSession(facing: facing, zoom: "1x")
        guard result.success else {
            return fail(result.code, result.message, result.nativeMessage)
        }
        cameraFacing = facing
        zoom = "1x"
        flashEnabled = false
        return ok(["cameraFacing": cameraFacing])
    }

    public func destroyCamera() -> String {
        destroyResources()
        return ok([:])
    }

    private func configureCameraSession(facing: String, zoom requestedZoom: String) -> NativeStatus {
        return runOnCaptureQueueSync {
            configureCameraSessionOnCaptureQueue(facing: facing, zoom: requestedZoom)
        }
    }

    private func configureCameraSessionOnCaptureQueue(facing: String, zoom requestedZoom: String) -> NativeStatus {
        let position: AVCaptureDevice.Position = facing == "front" ? .front : .back
        guard let camera = cameraDevice(facing: position, zoom: requestedZoom) else {
            return NativeStatus(false, "1101", "相机设备不可用", "No camera device.")
        }

        var didBeginConfiguration = false
        do {
            let nextVideoInput = try AVCaptureDeviceInput(device: camera)
            let nextVideoOutput = AVCaptureVideoDataOutput()
            nextVideoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            nextVideoOutput.alwaysDiscardsLateVideoFrames = true
            nextVideoOutput.setSampleBufferDelegate(self, queue: writerQueue)

            session.beginConfiguration()
            didBeginConfiguration = true
            session.sessionPreset = .hd1280x720
            if let videoInput = videoInput {
                session.removeInput(videoInput)
            }
            if let videoOutput = videoOutput {
                session.removeOutput(videoOutput)
            }
            guard session.canAddInput(nextVideoInput) else {
                session.commitConfiguration()
                return NativeStatus(false, "1101", "相机设备不可用", "Cannot add camera input.")
            }
            guard session.canAddOutput(nextVideoOutput) else {
                session.commitConfiguration()
                return NativeStatus(false, "1101", "相机设备不可用", "Cannot add video output.")
            }
            session.addInput(nextVideoInput)
            session.addOutput(nextVideoOutput)
            if let connection = nextVideoOutput.connection(with: .video) {
                connection.videoOrientation = .portrait
                if connection.isVideoMirroringSupported {
                    connection.automaticallyAdjustsVideoMirroring = false
                    connection.isVideoMirrored = false
                }
            }
            session.commitConfiguration()
            didBeginConfiguration = false

            videoInput = nextVideoInput
            videoOutput = nextVideoOutput
            activeDevice = camera
            return applyZoom(requestedZoom)
        } catch {
            if didBeginConfiguration {
                session.commitConfiguration()
            }
            return NativeStatus(false, "1101", "相机设备不可用", error.localizedDescription)
        }
    }

    private func ensureAudioInputs() -> NativeStatus {
        return runOnCaptureQueueSync {
            if audioInput != nil && audioOutput != nil {
                return NativeStatus.ok
            }
            guard let microphone = AVCaptureDevice.default(for: .audio) else {
                return NativeStatus(false, "1002", "麦克风权限被拒绝", "No microphone device.")
            }
            var didBeginConfiguration = false
            do {
                let nextInput = try AVCaptureDeviceInput(device: microphone)
                let nextOutput = AVCaptureAudioDataOutput()
                nextOutput.setSampleBufferDelegate(self, queue: writerQueue)
                session.beginConfiguration()
                didBeginConfiguration = true
                if session.canAddInput(nextInput) {
                    session.addInput(nextInput)
                } else {
                    session.commitConfiguration()
                    return NativeStatus(false, "1401", "录像开始失败", "Cannot add microphone input.")
                }
                if session.canAddOutput(nextOutput) {
                    session.addOutput(nextOutput)
                } else {
                    session.commitConfiguration()
                    return NativeStatus(false, "1401", "录像开始失败", "Cannot add audio output.")
                }
                session.commitConfiguration()
                didBeginConfiguration = false
                audioInput = nextInput
                audioOutput = nextOutput
                return NativeStatus.ok
            } catch {
                if didBeginConfiguration {
                    session.commitConfiguration()
                }
                return NativeStatus(false, "1401", "录像开始失败", error.localizedDescription)
            }
        }
    }

    private func destroyResources() {
        destroyed = true
        recording = false
        ready = false
        watermarkView.isUserInteractionEnabled = true
        runOnCaptureQueueSync {
            if self.session.isRunning {
                self.session.stopRunning()
            }
            self.session.beginConfiguration()
            for input in self.session.inputs {
                self.session.removeInput(input)
            }
            for output in self.session.outputs {
                self.session.removeOutput(output)
            }
            self.session.commitConfiguration()
            self.videoInput = nil
            self.audioInput = nil
            self.videoOutput = nil
            self.audioOutput = nil
            self.activeDevice = nil
        }
        writerQueue.sync {
            if let writer = self.assetWriter, writer.status == .writing {
                writer.cancelWriting()
            }
            self.resetWriter()
        }
        activeTemplate = nil
        activeWatermarkImage = nil
        frozenTemplate = nil
        frozenWatermarkImage = nil
        watermarkView.template = nil
        watermarkView.watermarkImage = nil
        watermarkView.isHidden = true
    }

    private func validZoom(_ value: String) -> Bool {
        return value == "wide" || value == "1x" || value == "2x"
    }

    private func availableZooms() -> [String] {
        return ["wide", "1x", "2x"]
    }

    private func cameraDevice(facing position: AVCaptureDevice.Position, zoom requestedZoom: String) -> AVCaptureDevice? {
        if requestedZoom == "wide", position == .back, #available(iOS 13.0, *) {
            let devices = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInUltraWideCamera],
                mediaType: .video,
                position: position
            ).devices
            if let device = devices.first {
                return device
            }
        }
        if #available(iOS 10.0, *) {
            return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
        }
        return AVCaptureDevice.default(for: .video)
    }

    private func runOnCaptureQueueSync<T>(_ block: () -> T) -> T {
        if DispatchQueue.getSpecific(key: Self.captureQueueKey) == true {
            return block()
        }
        return captureQueue.sync(execute: block)
    }

    private func applyZoom(_ nextZoom: String) -> NativeStatus {
        guard let device = activeDevice else {
            return NativeStatus(false, "1101", "相机设备不可用", "No active camera device.")
        }
        if nextZoom == "wide" {
            if cameraFacing == "back", #available(iOS 13.0, *), device.deviceType == .builtInUltraWideCamera {
                zoom = "wide"
                return NativeStatus.ok
            }
            if cameraFacing == "back", let ultraWide = cameraDevice(facing: .back, zoom: "wide"), ultraWide.uniqueID != device.uniqueID {
                return configureCameraSession(facing: cameraFacing, zoom: "wide")
            }
            return NativeStatus(false, "1103", "焦段不可用", "Ultra wide camera is unavailable.")
        }
        let desiredFactor: CGFloat = nextZoom == "2x" ? 2.0 : 1.0
        if nextZoom != "wide", #available(iOS 13.0, *), device.deviceType == .builtInUltraWideCamera {
            return configureCameraSession(facing: cameraFacing, zoom: nextZoom)
        }
        guard desiredFactor <= device.activeFormat.videoMaxZoomFactor else {
            return NativeStatus(false, "1103", "焦段不可用", "Requested zoom exceeds device maximum.")
        }
        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = max(1.0, desiredFactor)
            device.unlockForConfiguration()
            zoom = nextZoom
            return NativeStatus.ok
        } catch {
            return NativeStatus(false, "1103", "焦段不可用", error.localizedDescription)
        }
    }

    private func applyFlash(enabled: Bool) -> NativeStatus {
        guard let device = activeDevice else {
            return NativeStatus(false, "1101", "相机设备不可用", "No active camera device.")
        }
        guard device.hasTorch else {
            if !enabled {
                flashEnabled = false
                return NativeStatus.ok
            }
            return NativeStatus(false, "1102", "闪光灯不可用", "Torch is unavailable.")
        }
        do {
            try device.lockForConfiguration()
            device.torchMode = enabled ? .on : .off
            device.unlockForConfiguration()
            flashEnabled = enabled
            return NativeStatus.ok
        } catch {
            return NativeStatus(false, "1102", "闪光灯不可用", error.localizedDescription)
        }
    }

    @objc private func handleWatermarkDrag(_ gesture: UILongPressGestureRecognizer) {
        guard !recording, var template = activeTemplate, bounds.width > 0, bounds.height > 0 else { return }
        let location = gesture.location(in: self)
        switch gesture.state {
        case .began:
            dragStartOrigin = CGPoint(x: template.positionX, y: template.positionY)
            dragStartLocation = location
        case .changed:
            let dx = (location.x - dragStartLocation.x) / bounds.width
            let dy = (location.y - dragStartLocation.y) / bounds.height
            template.positionX = EmbeddedWatermarkTemplate.clampedRatio(dragStartOrigin.x + dx, upper: 1 - template.boxWidth)
            template.positionY = EmbeddedWatermarkTemplate.clampedRatio(dragStartOrigin.y + dy, upper: 1 - template.boxHeight)
            activeTemplate = template
            watermarkView.template = template
            layoutWatermarkPreview(emitChange: false)
        case .ended, .cancelled, .failed:
            layoutWatermarkPreview(emitChange: true)
        default:
            break
        }
    }

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        return true
    }

    private func layoutWatermarkPreview(emitChange: Bool) {
        guard var template = activeTemplate, bounds.width > 0, bounds.height > 0 else { return }
        template.clampPosition()
        activeTemplate = template
        watermarkView.template = template
        let frame = CGRect(
            x: bounds.width * template.positionX,
            y: bounds.height * template.positionY,
            width: bounds.width * template.boxWidth,
            height: bounds.height * template.boxHeight
        )
        watermarkView.frame = frame
        watermarkView.setNeedsDisplay()
        if emitChange {
            emitWatermarkPosition(template)
        }
    }

    private func emitWatermarkPosition(_ template: EmbeddedWatermarkTemplate) {
        positionCallback?(Self.jsonString([
            "x": template.positionX,
            "y": template.positionY,
            "width": template.boxWidth,
            "height": template.boxHeight,
            "watermarkTemplateId": template.templateId
        ]))
    }

    private func emitNativeError(_ code: String, _ message: String, _ nativeMessage: String) {
        errorCallback?(Self.jsonString([
            "errorCode": code,
            "errorMessage": message,
            "nativeMessage": nativeMessage
        ]))
    }

    private func requestVideoAccessIfNeeded() -> NativeStatus {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            videoPermissionRequestPending = false
            return .ok
        case .notDetermined:
            if !videoPermissionRequestPending {
                videoPermissionRequestPending = true
                AVCaptureDevice.requestAccess(for: .video) { [weak self] isGranted in
                    DispatchQueue.main.async {
                        self?.videoPermissionRequestPending = false
                        if !isGranted {
                            self?.emitNativeError("1001", "相机权限被拒绝", "Camera permission denied.")
                        }
                    }
                }
            }
            return NativeStatus(false, "1104", "相机未挂载或未就绪", "permission request is pending")
        default:
            videoPermissionRequestPending = false
            return NativeStatus(false, "1001", "相机权限被拒绝", "Camera permission denied.")
        }
    }

    private func requestAudioAccessIfNeeded() -> NativeStatus {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized:
            audioPermissionRequestPending = false
            return .ok
        case .notDetermined:
            if !audioPermissionRequestPending {
                audioPermissionRequestPending = true
                AVCaptureDevice.requestAccess(for: .audio) { [weak self] isGranted in
                    DispatchQueue.main.async {
                        self?.audioPermissionRequestPending = false
                        if !isGranted {
                            self?.emitNativeError("1002", "麦克风权限被拒绝", "Microphone permission denied.")
                        }
                    }
                }
            }
            return NativeStatus(false, "1104", "相机未挂载或未就绪", "permission request is pending")
        default:
            audioPermissionRequestPending = false
            return NativeStatus(false, "1002", "麦克风权限被拒绝", "Microphone permission denied.")
        }
    }

    private func templateFromOptions(_ optionsJSON: String) -> EmbeddedWatermarkTemplate? {
        guard
            let data = optionsJSON.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            let options = object as? [String: Any],
            let template = options["watermarkTemplate"] as? [String: Any],
            !template.isEmpty
        else {
            return nil
        }
        let parsed = EmbeddedWatermarkTemplate.parse(Self.jsonString(template))
        return parsed.template
    }

    private func imageForOutputTemplate(_ template: EmbeddedWatermarkTemplate?) -> UIImage? {
        guard let template = template else { return nil }
        if activeTemplate?.templateId == template.templateId {
            return activeWatermarkImage
        }
        if frozenTemplate?.templateId == template.templateId {
            return frozenWatermarkImage
        }
        return loadImageIfNeeded(for: template).image
    }

    private func loadImageIfNeeded(for template: EmbeddedWatermarkTemplate) -> (success: Bool, image: UIImage?, code: String, message: String, nativeMessage: String) {
        guard template.templateType == "image_title_subtitle" else {
            return (true, nil, "", "", "")
        }
        guard let image = loadWatermarkImage(from: template.imagePath) else {
            return (false, nil, "1202", "水印图片资源不可读或解码失败", template.imagePath)
        }
        return (true, image, "", "", "")
    }

    private func loadWatermarkImage(from rawPath: String) -> UIImage? {
        let path = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return nil }
        if let url = URL(string: path), url.isFileURL {
            return UIImage(contentsOfFile: url.path)
        }
        if path.hasPrefix("file://") {
            return UIImage(contentsOfFile: String(path.dropFirst("file://".count)))
        }
        if let image = UIImage(contentsOfFile: path) {
            return image
        }
        let bundlePath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        if let image = UIImage(named: bundlePath) {
            return image
        }
        let resourceURL = URL(fileURLWithPath: bundlePath)
        let resourceName = resourceURL.deletingPathExtension().path
        let resourceExtension = resourceURL.pathExtension
        if
            !resourceName.isEmpty,
            !resourceExtension.isEmpty,
            let resourcePath = Bundle.main.path(forResource: resourceName, ofType: resourceExtension)
        {
            return UIImage(contentsOfFile: resourcePath)
        }
        return nil
    }

    private func prepareWriter() throws {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("uts-ios-embedded-watermark-\(Int(Date().timeIntervalSince1970 * 1000)).mp4")
        try? FileManager.default.removeItem(at: url)
        outputURL = url

        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecH264,
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
        guard writer.canAdd(videoInput) else {
            throw NSError(domain: "uts.markvideo.embedded", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add video writer input."])
        }
        writer.add(videoInput)

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
        if writer.canAdd(audioInput) {
            writer.add(audioInput)
            writerAudioInput = audioInput
        } else {
            writerAudioInput = nil
        }

        assetWriter = writer
        writerVideoInput = videoInput
        pixelBufferAdaptor = adaptor
    }

    private func resetWriter() {
        assetWriter = nil
        writerVideoInput = nil
        writerAudioInput = nil
        pixelBufferAdaptor = nil
        outputURL = nil
        firstVideoTime = nil
        lastVideoTime = nil
        lastEncodedFrameTime = nil
        videoFrameCount = 0
    }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output is AVCaptureVideoDataOutput {
            if let sourceBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
                latestVideoPixelBuffer = sourceBuffer
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
            let videoInput = writerVideoInput,
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
            }
            lastEncodedFrameTime = timestamp
            lastVideoTime = timestamp
            videoFrameCount += 1
        }
    }

    private func appendAudio(_ sampleBuffer: CMSampleBuffer) {
        guard firstVideoTime != nil, let writer = assetWriter, writer.status == .writing else { return }
        guard let audioInput = writerAudioInput, audioInput.isReadyForMoreMediaData else { return }
        audioInput.append(sampleBuffer)
    }

    private func shouldEncodeFrame(at timestamp: CMTime) -> Bool {
        guard let last = lastEncodedFrameTime else {
            return true
        }
        let frameInterval = CMTime(value: 1, timescale: 24)
        return CMTimeCompare(CMTimeSubtract(timestamp, last), frameInterval) >= 0
    }

    private func makeWatermarkedPixelBuffer(
        from sourceBuffer: CVPixelBuffer,
        adaptor: AVAssetWriterInputPixelBufferAdaptor
    ) -> CVPixelBuffer? {
        guard let pool = adaptor.pixelBufferPool else { return nil }
        var outputBuffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outputBuffer)
        guard let targetBuffer = outputBuffer else { return nil }
        ciContext.render(CIImage(cvPixelBuffer: sourceBuffer), to: targetBuffer)
        drawWatermark(into: targetBuffer, template: frozenTemplate, watermarkImage: frozenWatermarkImage)
        return targetBuffer
    }

    private func makeWatermarkedImage(
        from sourceBuffer: CVPixelBuffer,
        template: EmbeddedWatermarkTemplate?,
        watermarkImage: UIImage?
    ) throws -> UIImage {
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
            throw NSError(domain: "uts.markvideo.embedded", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to allocate photo buffer."])
        }
        ciContext.render(CIImage(cvPixelBuffer: sourceBuffer), to: targetBuffer)
        drawWatermark(into: targetBuffer, template: template, watermarkImage: watermarkImage)
        let outputImage = CIImage(cvPixelBuffer: targetBuffer)
        guard let cgImage = ciContext.createCGImage(outputImage, from: outputImage.extent) else {
            throw NSError(domain: "uts.markvideo.embedded", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to render photo."])
        }
        return UIImage(cgImage: cgImage, scale: 1, orientation: .up)
    }

    private func drawWatermark(into buffer: CVPixelBuffer, template: EmbeddedWatermarkTemplate?, watermarkImage: UIImage?) {
        guard let template = template else { return }
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
        let canvas = CGSize(width: CGFloat(width), height: CGFloat(height))
        EmbeddedWatermarkRenderer.draw(
            template: template,
            image: watermarkImage,
            in: EmbeddedWatermarkRenderer.watermarkRect(template: template, canvasSize: canvas),
            context: context
        )
        context.restoreGState()
    }

    private func writePhotoTempFile(_ image: UIImage) throws -> String {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("uts-ios-embedded-watermark-\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
        guard let data = image.jpegData(compressionQuality: 0.92) else {
            throw NSError(domain: "uts.markvideo.embedded", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unable to encode photo."])
        }
        try data.write(to: url, options: .atomic)
        return url.path
    }

    private func saveImageToGallerySynchronously(_ image: UIImage) -> (success: Bool, albumFilePath: String, nativeMessage: String) {
        guard requestPhotoWriteAccessSynchronously() else {
            return (false, "", "Photo library permission denied.")
        }
        let semaphore = DispatchSemaphore(value: 0)
        var localIdentifier = ""
        var nativeMessage = ""
        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetChangeRequest.creationRequestForAsset(from: image)
            localIdentifier = request.placeholderForCreatedAsset?.localIdentifier ?? ""
        }, completionHandler: { success, error in
            if !success {
                nativeMessage = error?.localizedDescription ?? "Photo save failed."
            }
            semaphore.signal()
        })
        semaphore.wait()
        return (nativeMessage.isEmpty, localIdentifier, nativeMessage)
    }

    private func saveVideoToGallerySynchronously(_ url: URL) -> (success: Bool, albumFilePath: String, nativeMessage: String) {
        guard requestPhotoWriteAccessSynchronously() else {
            return (false, "", "Photo library permission denied.")
        }
        let semaphore = DispatchSemaphore(value: 0)
        var localIdentifier = ""
        var nativeMessage = ""
        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
            localIdentifier = request?.placeholderForCreatedAsset?.localIdentifier ?? ""
        }, completionHandler: { success, error in
            if !success {
                nativeMessage = error?.localizedDescription ?? "Video save failed."
            }
            semaphore.signal()
        })
        semaphore.wait()
        return (nativeMessage.isEmpty, localIdentifier, nativeMessage)
    }

    private func requestPhotoWriteAccessSynchronously() -> Bool {
        if #available(iOS 14, *) {
            let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            if status == .authorized || status == .limited {
                return true
            }
            if status != .notDetermined {
                return false
            }
            let semaphore = DispatchSemaphore(value: 0)
            var granted = false
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { nextStatus in
                granted = nextStatus == .authorized || nextStatus == .limited
                semaphore.signal()
            }
            semaphore.wait()
            return granted
        }
        let status = PHPhotoLibrary.authorizationStatus()
        if status == .authorized {
            return true
        }
        if status != .notDetermined {
            return false
        }
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        PHPhotoLibrary.requestAuthorization { nextStatus in
            granted = nextStatus == .authorized
            semaphore.signal()
        }
        semaphore.wait()
        return granted
    }

    private func photoData(
        tempFilePath: String,
        albumFilePath: String,
        width: Int,
        height: Int,
        template: EmbeddedWatermarkTemplate?
    ) -> [String: Any] {
        return baseMediaData(
            tempFilePath: tempFilePath,
            albumFilePath: albumFilePath,
            width: width,
            height: height,
            template: template
        )
    }

    private func videoData(
        tempFilePath: String,
        albumFilePath: String,
        durationMs: Double,
        width: Int,
        height: Int,
        template: EmbeddedWatermarkTemplate?
    ) -> [String: Any] {
        var data = baseMediaData(
            tempFilePath: tempFilePath,
            albumFilePath: albumFilePath,
            width: width,
            height: height,
            template: template
        )
        data["durationMs"] = durationMs
        return data
    }

    private func baseMediaData(
        tempFilePath: String,
        albumFilePath: String,
        width: Int,
        height: Int,
        template: EmbeddedWatermarkTemplate?
    ) -> [String: Any] {
        return [
            "tempFilePath": tempFilePath,
            "albumFilePath": albumFilePath,
            "width": width,
            "height": height,
            "watermarkTemplateId": template?.templateId ?? "",
            "watermarkPositionX": template?.positionX ?? 0,
            "watermarkPositionY": template?.positionY ?? 0,
            "watermarkBoxWidth": template?.boxWidth ?? 0,
            "watermarkBoxHeight": template?.boxHeight ?? 0,
            "watermarkTemplateSnapshot": template?.snapshot ?? [:]
        ]
    }

    private func ok(_ data: [String: Any]) -> String {
        return Self.jsonString([
            "success": true,
            "errorCode": "",
            "errorMessage": "",
            "nativeMessage": "",
            "data": data
        ])
    }

    private func fail(_ code: String, _ message: String, _ nativeMessage: String = "") -> String {
        return Self.jsonString([
            "success": false,
            "errorCode": code,
            "errorMessage": message,
            "nativeMessage": nativeMessage,
            "data": [:]
        ])
    }

    private static func jsonString(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: []),
              let text = String(data: data, encoding: .utf8)
        else {
            return "{\"success\":false,\"errorCode\":\"9001\",\"errorMessage\":\"未知原生错误\",\"nativeMessage\":\"JSON encoding failed.\",\"data\":{}}"
        }
        return text
    }
}

private struct NativeStatus {
    let success: Bool
    let code: String
    let message: String
    let nativeMessage: String

    init(_ success: Bool, _ code: String = "", _ message: String = "", _ nativeMessage: String = "") {
        self.success = success
        self.code = code
        self.message = message
        self.nativeMessage = nativeMessage
    }

    static let ok = NativeStatus(true)
}

private struct EmbeddedWatermarkTemplate {
    var templateId: String
    var templateName: String
    var templateType: String
    var mainTitleText: String
    var subtitleText: String
    var mainTitleColor: UIColor
    var subtitleColor: UIColor
    var mainTitleColorRaw: String
    var subtitleColorRaw: String
    var mainTitleFontSize: CGFloat
    var subtitleFontSize: CGFloat
    var mainTitleBold: Bool
    var subtitleBold: Bool
    var imagePath: String
    var imageMimeType: String
    var imageWidth: CGFloat
    var imageHeight: CGFloat
    var imageTextGap: CGFloat
    var boxWidth: CGFloat
    var boxHeight: CGFloat
    var boxBackgroundColor: UIColor
    var boxBackgroundColorRaw: String
    var boxRadius: CGFloat
    var boxPadding: CGFloat
    var positionX: CGFloat
    var positionY: CGFloat

    var snapshot: [String: Any] {
        return [
            "templateId": templateId,
            "templateName": templateName,
            "templateType": templateType,
            "mainTitleText": mainTitleText,
            "subtitleText": subtitleText,
            "mainTitleColor": mainTitleColorRaw,
            "subtitleColor": subtitleColorRaw,
            "mainTitleFontSize": Double(mainTitleFontSize),
            "subtitleFontSize": Double(subtitleFontSize),
            "mainTitleBold": mainTitleBold,
            "subtitleBold": subtitleBold,
            "imagePath": imagePath,
            "imageMimeType": imageMimeType,
            "imageWidth": Double(imageWidth),
            "imageHeight": Double(imageHeight),
            "imageTextGap": Double(imageTextGap),
            "boxWidth": Double(boxWidth),
            "boxHeight": Double(boxHeight),
            "boxBackgroundColor": boxBackgroundColorRaw,
            "boxRadius": Double(boxRadius),
            "boxPadding": Double(boxPadding),
            "positionX": Double(positionX),
            "positionY": Double(positionY)
        ]
    }

    static func parse(_ text: String) -> (success: Bool, template: EmbeddedWatermarkTemplate?, code: String, message: String, nativeMessage: String) {
        guard
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            let raw = object as? [String: Any]
        else {
            return invalid("Template JSON is invalid.")
        }

        let templateId = string(raw["templateId"])
        let templateName = string(raw["templateName"])
        let templateType = string(raw["templateType"])
        guard !templateId.isEmpty else { return invalid("templateId is empty.") }
        guard !templateName.isEmpty else { return invalid("templateName is empty.") }
        guard ["title_text", "title_subtitle_text", "image_title_subtitle"].contains(templateType) else {
            return invalid("templateType is invalid.")
        }

        let mainTitleText = string(raw["mainTitleText"])
        var subtitleText = string(raw["subtitleText"])
        var imagePath = string(raw["imagePath"])
        var imageMimeType = string(raw["imageMimeType"])
        var imageWidth = number(raw["imageWidth"], 0)
        var imageHeight = number(raw["imageHeight"], 0)
        let imageTextGap = number(raw["imageTextGap"], 8)

        if templateType == "title_text" {
            subtitleText = ""
            imagePath = ""
            imageMimeType = ""
            imageWidth = 0
            imageHeight = 0
        }
        if templateType == "title_subtitle_text" {
            imagePath = ""
            imageMimeType = ""
            imageWidth = 0
            imageHeight = 0
        }

        if templateType == "title_text", mainTitleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return invalid("title_text requires mainTitleText.")
        }
        if templateType == "title_subtitle_text",
           mainTitleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            subtitleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return invalid("title_subtitle_text requires mainTitleText and subtitleText.")
        }
        if templateType == "image_title_subtitle" {
            guard !mainTitleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !subtitleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !imagePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  imageMimeType == "image/png",
                  imageWidth > 0,
                  imageHeight > 0
            else {
                return invalid("image_title_subtitle image or text fields are invalid.")
            }
        }

        let mainTitleColorRaw = string(raw["mainTitleColor"], "#26313B")
        let subtitleColorRaw = string(raw["subtitleColor"], "#56616D")
        let boxBackgroundColorRaw = string(raw["boxBackgroundColor"], "rgba(255,255,255,0.78)")
        guard let mainTitleColor = UIColor.embeddedCameraColor(mainTitleColorRaw),
              let subtitleColor = UIColor.embeddedCameraColor(subtitleColorRaw),
              let boxBackgroundColor = UIColor.embeddedCameraColor(boxBackgroundColorRaw)
        else {
            return invalid("Color format is invalid.")
        }

        let mainTitleFontSize = number(raw["mainTitleFontSize"], 16)
        let subtitleFontSize = number(raw["subtitleFontSize"], 12)
        let boxWidth = number(raw["boxWidth"], 0.64)
        let boxHeight = number(raw["boxHeight"], 0.16)
        let boxRadius = number(raw["boxRadius"], 8)
        let boxPadding = number(raw["boxPadding"], 10)
        let positionX = number(raw["positionX"], 0.18)
        let positionY = number(raw["positionY"], 0.25)

        guard range(mainTitleFontSize, 8, 72) else { return invalid("mainTitleFontSize is out of range.") }
        guard range(subtitleFontSize, 8, 48) else { return invalid("subtitleFontSize is out of range.") }
        guard range(imageWidth, 0, 512) else { return invalid("imageWidth is out of range.") }
        guard range(imageHeight, 0, 512) else { return invalid("imageHeight is out of range.") }
        guard range(imageTextGap, 0, 64) else { return invalid("imageTextGap is out of range.") }
        guard range(boxWidth, 0.1, 1) else { return invalid("boxWidth is out of range.") }
        guard range(boxHeight, 0.05, 1) else { return invalid("boxHeight is out of range.") }
        guard range(boxRadius, 0, 80) else { return invalid("boxRadius is out of range.") }
        guard range(boxPadding, 0, 80) else { return invalid("boxPadding is out of range.") }
        guard range(positionX, 0, 1) else { return invalid("positionX is out of range.") }
        guard range(positionY, 0, 1) else { return invalid("positionY is out of range.") }

        var template = EmbeddedWatermarkTemplate(
            templateId: templateId,
            templateName: templateName,
            templateType: templateType,
            mainTitleText: mainTitleText,
            subtitleText: subtitleText,
            mainTitleColor: mainTitleColor,
            subtitleColor: subtitleColor,
            mainTitleColorRaw: mainTitleColorRaw,
            subtitleColorRaw: subtitleColorRaw,
            mainTitleFontSize: mainTitleFontSize,
            subtitleFontSize: subtitleFontSize,
            mainTitleBold: bool(raw["mainTitleBold"], true),
            subtitleBold: bool(raw["subtitleBold"], false),
            imagePath: imagePath,
            imageMimeType: imageMimeType,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            imageTextGap: imageTextGap,
            boxWidth: boxWidth,
            boxHeight: boxHeight,
            boxBackgroundColor: boxBackgroundColor,
            boxBackgroundColorRaw: boxBackgroundColorRaw,
            boxRadius: boxRadius,
            boxPadding: boxPadding,
            positionX: positionX,
            positionY: positionY
        )
        template.clampPosition()
        return (true, template, "", "", "")
    }

    mutating func clampPosition() {
        positionX = Self.clampedRatio(positionX, upper: 1 - boxWidth)
        positionY = Self.clampedRatio(positionY, upper: 1 - boxHeight)
    }

    static func clampedRatio(_ value: CGFloat, upper: CGFloat) -> CGFloat {
        guard value.isFinite else { return 0 }
        return min(max(value, 0), max(0, upper))
    }

    private static func invalid(_ nativeMessage: String) -> (Bool, EmbeddedWatermarkTemplate?, String, String, String) {
        return (false, nil, "1201", "水印模板参数无效", nativeMessage)
    }

    private static func string(_ value: Any?, _ fallback: String = "") -> String {
        if let value = value as? String {
            return value
        }
        return fallback
    }

    private static func number(_ value: Any?, _ fallback: CGFloat) -> CGFloat {
        if let value = value as? NSNumber {
            return CGFloat(truncating: value)
        }
        if let value = value as? Double {
            return CGFloat(value)
        }
        if let value = value as? String, let number = Double(value) {
            return CGFloat(number)
        }
        return fallback
    }

    private static func bool(_ value: Any?, _ fallback: Bool) -> Bool {
        if let value = value as? Bool {
            return value
        }
        if let value = value as? NSNumber {
            return value.boolValue
        }
        return fallback
    }

    private static func range(_ value: CGFloat, _ minValue: CGFloat, _ maxValue: CGFloat) -> Bool {
        return value.isFinite && value >= minValue && value <= maxValue
    }
}

private final class EmbeddedWatermarkPreviewView: UIView {
    var template: EmbeddedWatermarkTemplate? {
        didSet { setNeedsDisplay() }
    }
    var watermarkImage: UIImage? {
        didSet { setNeedsDisplay() }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        clipsToBounds = false
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), let template = template else { return }
        EmbeddedWatermarkRenderer.draw(template: template, image: watermarkImage, in: bounds, context: context)
    }
}

private enum EmbeddedWatermarkRenderer {
    static func watermarkRect(template: EmbeddedWatermarkTemplate, canvasSize: CGSize) -> CGRect {
        var next = template
        next.clampPosition()
        return CGRect(
            x: canvasSize.width * next.positionX,
            y: canvasSize.height * next.positionY,
            width: canvasSize.width * next.boxWidth,
            height: canvasSize.height * next.boxHeight
        )
    }

    static func draw(
        template: EmbeddedWatermarkTemplate,
        image: UIImage?,
        in rect: CGRect,
        context: CGContext
    ) {
        guard rect.width > 0, rect.height > 0 else { return }
        context.saveGState()
        let radius = min(template.boxRadius, min(rect.width, rect.height) / 2)
        let path = UIBezierPath(roundedRect: rect, cornerRadius: radius)
        context.setFillColor(template.boxBackgroundColor.cgColor)
        context.addPath(path.cgPath)
        context.fillPath()
        context.clip(to: rect)

        UIGraphicsPushContext(context)
        let padding = min(template.boxPadding, rect.width * 0.28, rect.height * 0.35)
        var contentRect = rect.insetBy(dx: padding, dy: padding)
        guard contentRect.width > 1, contentRect.height > 1 else {
            UIGraphicsPopContext()
            context.restoreGState()
            return
        }

        if template.templateType == "image_title_subtitle", let image = image {
            let imageWidth = min(template.imageWidth, contentRect.width * 0.38)
            let imageHeight = min(template.imageHeight, contentRect.height)
            let imageRect = CGRect(
                x: contentRect.minX,
                y: contentRect.midY - imageHeight / 2,
                width: imageWidth,
                height: imageHeight
            )
            image.draw(in: imageRect)
            let textLeft = imageRect.maxX + template.imageTextGap
            contentRect = CGRect(
                x: textLeft,
                y: contentRect.minY,
                width: max(1, contentRect.maxX - textLeft),
                height: contentRect.height
            )
        }

        let titleFont = template.mainTitleBold
            ? UIFont.boldSystemFont(ofSize: template.mainTitleFontSize)
            : UIFont.systemFont(ofSize: template.mainTitleFontSize)
        let subtitleFont = template.subtitleBold
            ? UIFont.boldSystemFont(ofSize: template.subtitleFontSize)
            : UIFont.systemFont(ofSize: template.subtitleFontSize)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        paragraph.alignment = .left
        let titleHeight = min(titleFont.lineHeight, contentRect.height)
        let hasSubtitle = template.templateType != "title_text"
        let subtitleHeight = hasSubtitle ? min(subtitleFont.lineHeight * 2, max(0, contentRect.height - titleHeight - 2)) : 0
        let totalTextHeight = titleHeight + (hasSubtitle ? 2 + subtitleHeight : 0)
        var y = contentRect.midY - totalTextHeight / 2
        let titleRect = CGRect(x: contentRect.minX, y: y, width: contentRect.width, height: titleHeight)
        NSAttributedString(
            string: template.mainTitleText,
            attributes: [.font: titleFont, .foregroundColor: template.mainTitleColor, .paragraphStyle: paragraph]
        ).draw(with: titleRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
        if hasSubtitle {
            y = titleRect.maxY + 2
            let subtitleRect = CGRect(x: contentRect.minX, y: y, width: contentRect.width, height: subtitleHeight)
            NSAttributedString(
                string: template.subtitleText,
                attributes: [.font: subtitleFont, .foregroundColor: template.subtitleColor, .paragraphStyle: paragraph]
            ).draw(with: subtitleRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
        }
        UIGraphicsPopContext()
        context.restoreGState()
    }
}

private extension UIColor {
    static func embeddedCameraColor(_ raw: String) -> UIColor? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("#") {
            return hexColor(text)
        }
        if text.lowercased().hasPrefix("rgba("), text.hasSuffix(")") {
            return rgbaColor(text)
        }
        return nil
    }

    private static func hexColor(_ raw: String) -> UIColor? {
        var hex = raw
        hex.removeFirst()
        guard hex.count == 6 || hex.count == 8 else { return nil }
        var value: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&value) else { return nil }
        if hex.count == 8 {
            let alpha = CGFloat((value & 0xFF000000) >> 24) / 255.0
            let red = CGFloat((value & 0x00FF0000) >> 16) / 255.0
            let green = CGFloat((value & 0x0000FF00) >> 8) / 255.0
            let blue = CGFloat(value & 0x000000FF) / 255.0
            return UIColor(red: red, green: green, blue: blue, alpha: alpha)
        }
        let red = CGFloat((value & 0xFF0000) >> 16) / 255.0
        let green = CGFloat((value & 0x00FF00) >> 8) / 255.0
        let blue = CGFloat(value & 0x0000FF) / 255.0
        return UIColor(red: red, green: green, blue: blue, alpha: 1)
    }

    private static func rgbaColor(_ raw: String) -> UIColor? {
        let inside = raw.dropFirst(5).dropLast()
        let parts = inside.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard parts.count == 4,
              let redValue = Double(parts[0]),
              let greenValue = Double(parts[1]),
              let blueValue = Double(parts[2]),
              let alphaValue = Double(parts[3]),
              redValue >= 0, redValue <= 255,
              greenValue >= 0, greenValue <= 255,
              blueValue >= 0, blueValue <= 255,
              alphaValue >= 0, alphaValue <= 1
        else {
            return nil
        }
        return UIColor(
            red: CGFloat(redValue / 255),
            green: CGFloat(greenValue / 255),
            blue: CGFloat(blueValue / 255),
            alpha: CGFloat(alphaValue)
        )
    }
}
