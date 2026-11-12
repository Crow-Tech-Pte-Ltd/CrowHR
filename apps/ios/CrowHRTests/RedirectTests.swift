import Foundation
import Testing
@testable import CrowHR

/// Answers every request itself: the company server redirects `/api/v1/*` to another host, and
/// that other host answers 200. Records every URL that reached it.
final class RedirectingURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var urls: [URL] = []
    static let elsewhere = URL(string: "https://elsewhere.example/collect")!

    static func reset() { lock.withLock { urls = [] } }
    static func seenHosts() -> [String] { lock.withLock { urls.compactMap { $0.host() } } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.withLock { Self.urls.append(url) }
        if url.host() == Self.elsewhere.host() {
            let ok = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: ok, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(#"{"status":"accepted","flags":[]}"#.utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        let redirect = HTTPURLResponse(url: url, statusCode: 302, httpVersion: "HTTP/1.1",
                                       headerFields: ["Location": Self.elsewhere.absoluteString, "Content-Type": "text/html"])!
        client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: Self.elsewhere), redirectResponse: redirect)
        // Refused, the 302 itself is the answer.
        client?.urlProtocol(self, didReceive: redirect, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("<a href=\"https://elsewhere.example/collect\">Found</a>".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// The HTTP client never follows a redirect (as Android, `followRedirects(false)`): the request
/// and its bearer token stay on the company's server, and the allow-list recorder sees the host
/// every answer came from.
@Suite("Redirects", .serialized)
struct RedirectTests {
    private func transport() -> URLSessionTransport {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RedirectingURLProtocol.self]
        return URLSessionTransport(session: URLSessionTransport.makeSession(configuration: config))
    }

    @Test func aRedirectIsHandedBackNotFollowed() async throws {
        RedirectingURLProtocol.reset()
        let recorder = NetworkRecorder()
        let api = APIClient(server: testServer, transport: RecordingTransport(inner: transport(), recorder: recorder), auth: nil)
        await #expect(throws: APIError.server(status: 302, code: "http_302", message: "The server returned an error (302). Try again later.")) {
            let _: Me = try await api.get("/api/v1/me")
        }
        #expect(RedirectingURLProtocol.seenHosts() == ["hr.example.sg"])
        #expect(await recorder.distinctOrigins() == ["https://hr.example.sg"])
        // Not the server ending the session.
        #expect(APIError.server(status: 302, code: "http_302", message: "").endsSession == false)
    }

    @Test func withoutRefusingThemTheSameRedirectIsFollowed() async throws {
        // The control: a plain session over the same stand-in server goes to the other host,
        // which is what the app's session prevents.
        RedirectingURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RedirectingURLProtocol.self]
        let (_, response) = try await URLSessionTransport(session: URLSession(configuration: config)).send(URLRequest(url: URL(string: "https://hr.example.sg/api/v1/me")!))
        #expect(response.url?.host() == "elsewhere.example")
        #expect(RedirectingURLProtocol.seenHosts() == ["hr.example.sg", "elsewhere.example"])
    }

    @Test func aPunchAnsweredWithARedirectWaitsAndIsSentAgainLater() async throws {
        RedirectingURLProtocol.reset()
        let sender = APIPunchSender(api: APIClient(server: testServer, transport: transport(), auth: nil))
        let q = PunchQueue(store: MemoryPunchQueueStore(), bootSession: { "boot-1" })
        try await q.enqueue(kind: .in, membershipId: "member-1", location: nil)
        let summary = await q.drain(membershipId: "member-1", using: sender)
        #expect(summary.stop == .network)
        #expect(await q.pending().count == 1)
        #expect(RedirectingURLProtocol.seenHosts() == ["hr.example.sg"])
    }

    @Test func theSessionTransportRefusesRedirects() async throws {
        let session = URLSessionTransport.makeSession()
        #expect(session.delegate is RefuseRedirects)
        let redirect = HTTPURLResponse(url: URL(string: "https://hr.example.sg/api/v1/me")!, statusCode: 307, httpVersion: "HTTP/1.1", headerFields: nil)!
        let task = session.dataTask(with: URL(string: "https://hr.example.sg/api/v1/me")!)
        #expect(await RefuseRedirects().urlSession(session, task: task, willPerformHTTPRedirection: redirect, newRequest: URLRequest(url: RedirectingURLProtocol.elsewhere)) == nil)
        task.cancel()
    }

    @Test func theAllowListRecorderAlsoSeesWhereAnAnswerCameFrom() async throws {
        // A transport that followed a redirect: the answer's URL is another host.
        struct Followed: HTTPTransport {
            func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
                (Data("{}".utf8), HTTPURLResponse(url: RedirectingURLProtocol.elsewhere, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!)
            }
        }
        let recorder = NetworkRecorder()
        _ = try await RecordingTransport(inner: Followed(), recorder: recorder).send(URLRequest(url: URL(string: "https://hr.example.sg/api/v1/meta")!))
        #expect(await recorder.distinctOrigins() == ["https://elsewhere.example", "https://hr.example.sg"])
    }
}
