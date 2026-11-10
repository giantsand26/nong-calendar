import Foundation

enum EventType: String, CaseIterable, Identifiable {
    case meeting = "会议"
    case businessTrip = "出差/外出"
    case other = "其他"
    var id: String { rawValue }
}

enum EventStatus: String {
    case confirmed = "已确认"
    case needsConfirmation = "待确认"
}

struct CalendarEvent: Identifiable {
    let id = UUID()
    var title: String
    var date: Date
    var start: Date?
    var end: Date?
    var type: EventType
    var status: EventStatus
    var location: String = ""
    var role: String = ""
    var people: String = ""
    var sourceText: String = ""
    var meetingURL: URL?
    var attachmentNames: [String] = []
}

final class CalendarStore: ObservableObject {
    @Published var events: [CalendarEvent] = [
        CalendarEvent(title: "免疫主题会议", date: Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 23))!, start: Calendar.current.date(from: DateComponents(hour: 15, minute: 40))!, end: Calendar.current.date(from: DateComponents(hour: 16))!, type: .meeting, status: .needsConfirmation, location: "天坛医院", role: "讲者"),
        CalendarEvent(title: "苏州出差", date: Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 15))!, start: nil, end: nil, type: .businessTrip, status: .needsConfirmation, location: "苏州")
    ]

    func events(on date: Date) -> [CalendarEvent] {
        events.filter { Calendar.current.isDate($0.date, inSameDayAs: date) }
    }
}
