import Foundation
import ImageIO
import Testing
import UIKit
@testable import CrowHR

/// Screen logic: load states, the leave query, Singapore dates,
/// uploads, the payslip PDF and the approval details.
@Suite("Screen logic")
struct ScreenLogicTests {
    @Test func aCancelledLoadLeavesTheScreenToLoadAgain() {
        // Switching tab mid-load cancels it: it used to stay "You're offline" until Try again.
        let loading = LoadState<Int>.loading
        #expect(LoadState.after(failure: URLError(.cancelled), cancelled: false, current: loading) == nil)
        #expect(LoadState.after(failure: APIError.offline, cancelled: true, current: loading) == nil)
        #expect(LoadState.after(failure: CancellationError(), cancelled: false, current: loading) == nil)
    }

    @Test func contentStaysOnAPassingFailureButNotOnARealOne() {
        let shown = LoadState<Int>.loaded(1)
        #expect(LoadState.after(failure: APIError.offline, cancelled: false, current: shown) == nil)
        #expect(LoadState.after(failure: APIError.server(status: 503, code: "http_503", message: "x"), cancelled: false, current: shown) == nil)
        #expect(LoadState.after(failure: APIError.server(status: 403, code: "forbidden", message: "No"), cancelled: false, current: shown)
            == .failed(.server(status: 403, code: "forbidden", message: "No")))
        #expect(LoadState<Int>.after(failure: APIError.offline, cancelled: false, current: .loading) == .failed(.offline))
    }

    @Test func myLeaveIsAlwaysFilteredToTheEmployee() {
        #expect(LeaveData.myRequestsQuery(employeeId: nil) == nil)
        let q = LeaveData.myRequestsQuery(employeeId: "e-1") ?? []
        #expect(q.first { $0.name == "employeeId" }?.value == "e-1")
        #expect(q.first { $0.name == "limit" }?.value == "50")
    }

    @Test func yearsAreSingaporeYearsOnTheGregorianCalendar() {
        // 31 Dec 2026 17:00 UTC is 1 Jan 2027 01:00 in Singapore.
        let newYear = Date(timeIntervalSince1970: 1_798_736_400)
        #expect(Fmt.year(newYear) == 2027)
        #expect(Fmt.day(newYear) == "2027-01-01")
        #expect(Fmt.calendar.identifier == .gregorian)
        #expect(Fmt.calendar.timeZone.identifier == "Asia/Singapore")
        #expect(Fmt.daySpoken(Fmt.parseDay("2026-11-13")!) == "Friday 13 November")
    }

    @Test func formattersAreReusedAndStillSingapore() {
        // Cached formatters must give the same answers on every call.
        let d = Fmt.parseInstant("2026-10-31T00:58:00.000Z")!
        for _ in 0..<3 {
            #expect(Fmt.dateTime(d) == "31 Oct 2026, 08:58")
            #expect(Fmt.dayString("2026-10-31") == "31 Oct 2026")
        }
    }

    @MainActor
    @Test func photosAreScaledDownForUpload() async throws {
        let big = Self.photo(width: 4000, height: 3000)
        let sent = CapturedImage.forUpload(big)
        #expect(sent.size.width * sent.scale == 2400 && sent.size.height * sent.scale == 1800)
        let small = CameraCapture.stubReceipt()
        #expect(CapturedImage.forUpload(small) === small)
        // Made once when the photo arrives, off the main thread; Submit only reads it.
        let camera = await CapturedImage.make(camera: big)
        let jpeg = try #require(camera.jpeg)
        #expect(jpeg.count < 10 * 1024 * 1024)
        #expect(Self.pixels(jpeg)?.size == CGSize(width: 2400, height: 1800))
        #expect(camera.image.size.width * camera.image.scale == 2400)
        let stub = await CapturedImage.make(camera: small)
        let stubJPEG = try #require(stub.jpeg)
        // Already within 2,400 px (600 x 800 points at the screen's scale): sent at its own size.
        #expect(Self.pixels(stubJPEG)?.size == CGSize(width: small.size.width * small.scale, height: small.size.height * small.scale))
    }

    @Test func libraryPhotosAreDecodedAtUploadSizeAndUpright() async throws {
        // A portrait photo as cameras store it: 4000 x 3000 pixels, EXIF "rotate 90° clockwise".
        let portrait = Self.jpeg(Self.photo(width: 4000, height: 3000), orientation: 6)
        let captured = try #require(await CapturedImage.make(data: portrait))
        let capturedJPEG = try #require(captured.jpeg)
        let sent = try #require(Self.pixels(capturedJPEG))
        #expect(sent.size == CGSize(width: 1800, height: 2400))
        #expect(sent.orientation == 1)
        // A small photo keeps its size; something that isn't an image is refused.
        let small = try #require(await CapturedImage.make(data: Self.jpeg(Self.photo(width: 600, height: 800), orientation: 1)))
        let smallJPEG = try #require(small.jpeg)
        #expect(Self.pixels(smallJPEG)?.size == CGSize(width: 600, height: 800))
        #expect(await CapturedImage.make(data: Data("not a photo".utf8)) == nil)
    }

    private static func photo(width: Int, height: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
            UIColor.black.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width / 4, height: height / 4))
        }
    }

    private static func jpeg(_ image: UIImage, orientation: Int) -> Data {
        let out = NSMutableData()
        let destination = CGImageDestinationCreateWithData(out, "public.jpeg" as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image.cgImage!, [kCGImagePropertyOrientation: orientation] as CFDictionary)
        CGImageDestinationFinalize(destination)
        return out as Data
    }

    /// Pixel size and EXIF orientation (1 when absent) of an encoded image.
    private static func pixels(_ data: Data) -> (size: CGSize, orientation: Int)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let p = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = p[kCGImagePropertyPixelWidth] as? Int, let h = p[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (CGSize(width: w, height: h), p[kCGImagePropertyOrientation] as? Int ?? 1)
    }

    @Test func approvalDetailsDecodeWithAndWithoutComments() throws {
        let json = #"""
        {"id":"r1","subjectType":"claim","subjectLabel":"Claim","title":"Meals claim","status":"pending","policyName":"Default",
         "summary":{"title":"Meals claim","lines":[{"label":"Total","value":"S$12.50"}],"context":[{"label":"Department","value":"Kitchen"}]},
         "comments":[{"id":"c1","author":"Nurul Huda","body":"Receipt attached","createdAt":"2026-11-11T02:00:00.000Z"}],"futureField":1}
        """#
        let d = try JSONDecoder().decode(ApprovalRequestDetail.self, from: Data(json.utf8))
        #expect(d.summary?.lines == [.init(label: "Total", value: "S$12.50")])
        #expect(d.summary?.context.first?.value == "Kitchen")
        #expect(d.comments.map(\.author) == ["Nurul Huda"])
        let bare = try JSONDecoder().decode(ApprovalRequestDetail.self, from: Data(#"{"summary":null}"#.utf8))
        #expect(bare.summary == nil && bare.comments.isEmpty)
    }

    @Test func onlyAPDFOpensAsAPayslip() {
        #expect(PayslipPDF.looksLikePDF(Data("%PDF-1.7\n".utf8)))
        #expect(!PayslipPDF.looksLikePDF(Data("<html>Sign in to the Wi-Fi</html>".utf8)))
        #expect(!PayslipPDF.looksLikePDF(Data()))
    }
}
