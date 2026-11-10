import Foundation
import SwiftData

@Model
final class StoredEvent {
    var title: String
    var date: Date
    var start: Date?
    var end: Date?
    var type: String
    var status: String
    var location: String
    var role: String
    var sourceText: String
    var meetingURL: String
    var createdAt: Date

    init(title: String, date: Date = .now, start: Date? = nil, end: Date? = nil,
         type: String = EventType.meeting.rawValue, status: String = EventStatus.needsConfirmation.rawValue,
         location: String = "", role: String = "", sourceText: String = "", meetingURL: String = "") {
        self.title = title
        self.date = date
        self.start = start
        self.end = end
        self.type = type
        self.status = status
        self.location = location
        self.role = role
        self.sourceText = sourceText
        self.meetingURL = meetingURL
        self.createdAt = .now
    }
}
