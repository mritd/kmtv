#if os(iOS)
import Foundation

/// Removes download directories without blocking the main actor. An episode can hold thousands of
/// segment files, so `discard` renames its directory into the trash (one metadata operation on
/// the same volume) and deletes it on a utility queue; `sweep` empties trash a previous launch
/// left behind.
///
/// 在不阻塞主 actor 的前提下移除下载目录. 一集可能有数千个分片文件, 因此 `discard` 先把目录重命名
/// 到回收站 (同一卷上的一次元数据操作), 再在 utility 队列上删除; `sweep` 清空上次启动遗留的回收站.
final class DownloadTrash: Sendable {
    private let trashDir: URL
    private let queue = DispatchQueue(label: "com.mritd.kmtv.downloads.trash", qos: .utility)

    init(layout: DownloadLayout) {
        trashDir = layout.trashDir
    }

    /// Moves `dir` out of the way at once and deletes it in the background. When the rename fails
    /// (for example the directory is already gone), it is removed in place, so the path is always
    /// free when this returns and a re-download can recreate it.
    ///
    /// 立即把 `dir` 移走, 并在后台删除. 重命名失败时 (例如目录已不存在) 原地删除, 因此返回时该路径
    /// 一定已空出, 重新下载可以重建它.
    func discard(_ dir: URL) {
        let fileManager = FileManager.default
        let target = trashDir.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        do {
            try fileManager.createDirectory(at: trashDir, withIntermediateDirectories: true)
            try fileManager.moveItem(at: dir, to: target)
        } catch {
            try? fileManager.removeItem(at: dir)
            return
        }
        queue.async { try? FileManager.default.removeItem(at: target) }
    }

    /// Deletes everything in the trash in the background; called at launch.
    ///
    /// 在后台删除回收站中的所有内容; 启动时调用.
    func sweep() {
        let trashDir = trashDir
        queue.async {
            let fileManager = FileManager.default
            let items = (try? fileManager.contentsOfDirectory(at: trashDir, includingPropertiesForKeys: nil)) ?? []
            for item in items { try? fileManager.removeItem(at: item) }
        }
    }

    /// Returns once every removal queued so far has run; for tests.
    ///
    /// 在截至目前排入的所有删除执行完毕后返回; 供测试使用.
    func flush() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { continuation.resume() }
        }
    }
}
#endif
