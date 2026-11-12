import Foundation
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
    @Test func photosAreScaledDownForUpload() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let big = UIGraphicsImageRenderer(size: CGSize(width: 4000, height: 3000), format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 4000, height: 3000))
        }
        let sent = CapturedImage.forUpload(big)
        #expect(sent.size.width * sent.scale == 2400 && sent.size.height * sent.scale == 1800)
        let small = CameraCapture.stubReceipt()
        #expect(CapturedImage.forUpload(small) === small)
        #expect(try #require(CapturedImage(image: big).jpeg).count < 10 * 1024 * 1024)
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
