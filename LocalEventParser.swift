import Foundation

struct ParsedEventDraft {
    var title = "待填写日程"
    var dateText = ""
    var timeText = ""
    var location = ""
    var role = ""
    var type: EventType = .meeting
    var status: EventStatus = .needsConfirmation
    var meetingURL: URL?
    var meetingID = ""
    var meetingPassword = ""
    var sourceText = ""

    var parsedDate: Date? {
        let formats = ["yyyy/M/d", "yyyy-MM-dd", "M/d", "M月d日"]
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN")
        for format in formats {
            formatter.dateFormat = format
            if let date = formatter.date(from: dateText) {
                if format == "M/d" || format == "M月d日" {
                    let components = Calendar.current.dateComponents([.month, .day], from: date)
                    return Calendar.current.date(from: DateComponents(year: Calendar.current.component(.year, from: .now), month: components.month, day: components.day))
                }
                return date
            }
        }
        return nil
    }
}

enum LocalEventParser {
    private static func firstCapture(_ pattern: String, in text: String) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.firstMatch(in: text, range: range), match.numberOfRanges > 1,
              let captureRange = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[captureRange])
    }

    static func parse(_ text: String) -> ParsedEventDraft {
        var result = ParsedEventDraft(sourceText: text)
        let normalized = text.replacingOccurrences(of: "：", with: ":")
        if normalized.contains("出差") || normalized.contains("有空去") || normalized.contains("去吗") {
            result.type = .businessTrip; result.title = "出差/外出安排"
        }
        if let urlText = firstCapture("(https?://[^\\s)]+)", in: normalized) {
            result.meetingURL = URL(string: urlText); result.type = .meeting
        }
        if let title = firstCapture("会议主题\\s*:\\s*(.+)", in: normalized) {
            result.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        } else if let title = firstCapture("(?:有一个|一个)\\s*(.+?)(?:的会议|会议)", in: normalized) {
            result.title = title
        }
        result.dateText = firstCapture("(\\d{4}[/-]\\d{1,2}[/-]\\d{1,2})", in: normalized)
            ?? firstCapture("(\\d{1,2}[月/-]\\d{1,2}(?:日)?)", in: normalized) ?? ""
        if let time = firstCapture("(\\d{1,2}:\\d{2}\\s*[-到至]\\s*\\d{1,2}:\\d{2})", in: normalized) {
            result.timeText = time
        } else if let time = firstCapture("(\\d{1,2}\\s*点\\s*\\d{0,2}\\s*到\\s*\\d{1,2}\\s*点\\s*\\d{0,2})", in: normalized) {
            result.timeText = time
        } else if normalized.contains("上午") { result.timeText = "上午" }
        else if normalized.contains("下午") { result.timeText = "下午" }
        result.location = firstCapture("(?:地点|会议地点)\\s*:?\\s*([^，。\\n]+)", in: normalized)?.trimmingCharacters(in: .whitespaces) ?? ""
        if result.location.isEmpty { result.location = firstCapture("在([^，。\\n]+)", in: normalized)?.trimmingCharacters(in: .whitespaces) ?? "" }
        for candidate in ["讲者", "讲课", "主持", "讨论", "汇报", "参会"] where normalized.contains(candidate) {
            result.role = candidate; break
        }
        result.meetingID = firstCapture("腾讯会议[：:]\\s*([\\d-]+)", in: normalized) ?? ""
        result.meetingPassword = firstCapture("会议密码[：:]\\s*([\\w]+)", in: normalized) ?? ""
        return result
    }
}
