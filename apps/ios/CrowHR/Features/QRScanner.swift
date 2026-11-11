import AVFoundation
import SwiftUI

/// Scans the web app's connection QR code with AVFoundation (no third-party scanner).
struct QRScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onResult: (Result<ConnectLink, ConnectLink.Invalid>) -> Void
    @State private var status: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        NavigationStack {
            Group {
                if AVCaptureDevice.default(for: .video) == nil {
                    EmptyStateView(title: "No camera", message: "This device has no camera. Type the server address instead.", systemImage: "camera")
                } else if status == .denied || status == .restricted {
                    EmptyStateView(title: "Camera access is off", message: "Allow camera access for Crow HR in Settings, or type the server address instead.", systemImage: "camera")
                } else {
                    QRCameraView { code in
                        do throws(ConnectLink.Invalid) { onResult(.success(try ConnectLink.parse(code))) } catch { onResult(.failure(error)) }
                    }
                    .ignoresSafeArea()
                    .overlay(alignment: .bottom) {
                        Text("Point the camera at the QR code on My profile → Mobile app.")
                            .font(CrowFont.body(.subheadline))
                            .padding(12)
                            .background(Crow.surface)
                            .clipShape(RoundedRectangle(cornerRadius: Crow.radius))
                            .padding()
                    }
                }
            }
            .crowScreen()
            .navigationTitle("Scan QR code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) } }
            .task {
                if status == .notDetermined {
                    _ = await AVCaptureDevice.requestAccess(for: .video)
                    status = AVCaptureDevice.authorizationStatus(for: .video)
                }
            }
        }
        // iPad: a form-sized sheet, not the whole screen.
        .presentationSizing(.form)
    }
}

struct QRCameraView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let c = ScannerController()
        c.onCode = onCode
        return c
    }

    func updateUIViewController(_ controller: ScannerController, context: Context) {}

    struct SessionBox: @unchecked Sendable { let session: AVCaptureSession }

    final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: ((String) -> Void)?
        private let session = AVCaptureSession()
        private var delivered = false
        /// Keeps the preview upright in every orientation the window has (all four on an iPad).
        private var rotation: AVCaptureDevice.RotationCoordinator?
        private var rotationObservation: NSKeyValueObservation?

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black
            guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let preview = AVCaptureVideoPreviewLayer(session: session)
            preview.videoGravity = .resizeAspectFill
            preview.frame = view.layer.bounds
            view.layer.addSublayer(preview)
            let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: preview)
            rotation = coordinator
            applyRotation()
            rotationObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { @Sendable [weak self] _, _ in
                Task { @MainActor in self?.applyRotation() }
            }
            let box = SessionBox(session: session)
            DispatchQueue.global(qos: .userInitiated).async { box.session.startRunning() }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            view.layer.sublayers?.first { $0 is AVCaptureVideoPreviewLayer }?.frame = view.layer.bounds
            applyRotation()
        }

        private func applyRotation() {
            guard let rotation, let preview = view.layer.sublayers?.first(where: { $0 is AVCaptureVideoPreviewLayer }) as? AVCaptureVideoPreviewLayer,
                  let connection = preview.connection else { return }
            let angle = rotation.videoRotationAngleForHorizonLevelPreview
            if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            let box = SessionBox(session: session)
            DispatchQueue.global(qos: .userInitiated).async { box.session.stopRunning() }
        }

        nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            let value = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue
            MainActor.assumeIsolated {
                guard !delivered, let value else { return }
                delivered = true
                onCode?(value)
            }
        }
    }
}
