import SwiftUI
import XCTest
@testable import KMTV

/// Renders the player's progress bar and reads the result back as pixels.
///
/// 渲染播放器进度条并以像素形式读回结果.
///
/// A buffered track that is drawn in the wrong order, at the wrong width, or not at all
/// still compiles and still passes every value-level assertion — the bar is three
/// overlapping capsules, so only the rendered image shows what a viewer would see.
///
/// 已缓冲轨道即便层叠顺序错误, 宽度错误或根本没有绘制, 依然能编译,
/// 也依然能通过所有基于取值的断言 — 进度条由三条重叠的胶囊构成,
/// 因此只有渲染出的图像才能反映观众实际看到的内容.
@MainActor
final class CustomSliderTests: XCTestCase {
    private let width: CGFloat = 200
    private let height: CGFloat = 32

    func testBufferedTrackSitsBetweenThePlayedFillAndTheBackground() throws {
        let pixels = try render(value: 0.25, buffered: 0.75)

        // Sampled away from the capsule ends and the thumb, which sits at the playhead.
        //
        // 采样点避开胶囊两端与位于播放头处的滑块.
        let played = pixels.luma(atX: 0.10)
        let buffered = pixels.luma(atX: 0.50)
        let background = pixels.luma(atX: 0.90)

        XCTAssertGreaterThan(played, buffered, "the played fill must stay the brightest layer")
        XCTAssertGreaterThan(buffered, background, "the buffered track must be visible against the track")
        // The layers composite rather than replace, so the buffered track reads brighter
        // than its own 50% white: 0.5 x 255 over the 30% track's 76.5 lands at 165.75.
        //
        // 各层是叠加而非替换, 因此已缓冲轨道比其自身的 50% 白更亮:
        // 0.5 x 255 叠在 30% 轨道的 76.5 之上, 结果为 165.75.
        XCTAssertEqual(played, 255, accuracy: 8, "played fill is solid white")
        XCTAssertEqual(buffered, 166, accuracy: 12, "50% white composited over the 30% track")
        XCTAssertEqual(background, 77, accuracy: 12, "track background is 30% white")
    }

    // Without this the bar would look identical at every buffer level, which is the failure
    // mode a value-level test cannot see.
    //
    // 缺少这条断言时, 任何缓冲量下进度条看起来都完全一样,
    // 而这正是基于取值的测试无法发现的失效方式.
    func testBufferedTrackEndsWhereTheBufferDoes() throws {
        let pixels = try render(value: 0, buffered: 0.5)

        XCTAssertGreaterThan(pixels.luma(atX: 0.45), 100, "inside the buffered half")
        XCTAssertLessThan(pixels.luma(atX: 0.55), 100, "past the buffered half")
    }

    func testNoBufferDrawsNoBufferedTrack() throws {
        let pixels = try render(value: 0, buffered: 0)

        XCTAssertEqual(pixels.luma(atX: 0.50), 77, accuracy: 12, "bare track background")
    }

    // MARK: - Rendering

    private func render(value: Double, buffered: Double) throws -> RenderedRow {
        let view = CustomSlider(value: .constant(value), buffered: buffered)
            .frame(width: width, height: height)
            .background(Color.black)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage, "ImageRenderer produced no image")

        let pixelWidth = image.width
        var raw = [UInt8](repeating: 0, count: pixelWidth * image.height * 4)
        let context = try XCTUnwrap(CGContext(
            data: &raw,
            width: pixelWidth,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: pixelWidth * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.draw(image, in: CGRect(x: 0, y: 0, width: pixelWidth, height: image.height))

        // The 3pt track is centred vertically, so the middle row crosses all three layers.
        //
        // 3pt 高的轨道垂直居中, 因此中间一行会穿过全部三层.
        let row = image.height / 2
        return RenderedRow(raw: raw, width: pixelWidth, row: row)
    }

    private struct RenderedRow {
        let raw: [UInt8]
        let width: Int
        let row: Int

        func luma(atX fraction: Double) -> Double {
            let x = min(width - 1, max(0, Int(Double(width) * fraction)))
            let i = (row * width + x) * 4
            return 0.299 * Double(raw[i]) + 0.587 * Double(raw[i + 1]) + 0.114 * Double(raw[i + 2])
        }
    }
}
