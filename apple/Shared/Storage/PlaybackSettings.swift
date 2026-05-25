import Foundation
import SwiftData

@Model
final class PlaybackSettings {
    var serverURL: String = ""
    var title: String = ""
    var skipIntroSeconds: Int = 0
    var skipOutroSeconds: Int = 0

    init(serverURL: String, title: String, skipIntroSeconds: Int = 0, skipOutroSeconds: Int = 0) {
        self.serverURL = serverURL
        self.title = title
        self.skipIntroSeconds = skipIntroSeconds
        self.skipOutroSeconds = skipOutroSeconds
    }

    static func get(in context: ModelContext, serverURL: String, title: String) -> PlaybackSettings {
        let descriptor = FetchDescriptor<PlaybackSettings>(
            predicate: #Predicate { $0.serverURL == serverURL && $0.title == title }
        )
        if let existing = try? context.fetch(descriptor).first {
            return existing
        }
        let settings = PlaybackSettings(serverURL: serverURL, title: title)
        context.insert(settings)
        try? context.save()
        return settings
    }
}
