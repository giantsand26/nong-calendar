import SwiftUI
import PhotosUI
import UIKit
import SwiftData

struct ContentView: View {
    @Query(sort: \.date) private var storedEvents: [StoredEvent]
    @State private var selectedDate = Date()
    @State private var showingImport = false
    @State private var showingAdd = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker("选择日期", selection: $selectedDate, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                }

                Section("日程") {
                    let dayEvents = storedEvents.filter { Calendar.current.isDate($0.date, inSameDayAs: selectedDate) }
                    if dayEvents.isEmpty {
                        ContentUnavailableView("暂无日程", systemImage: "calendar")
                    } else {
                        ForEach(dayEvents) { event in
                            NavigationLink {
                                StoredEventDetailView(event: event)
                            } label: {
                                StoredEventRow(event: event)
                            }
                        }
                    }
                }
            }
            .navigationTitle("我的日程")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingImport = true } label: {
                        Label("导入", systemImage: "doc.on.clipboard")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingImport) { ImportView() }
            .sheet(isPresented: $showingAdd) { AddEventView() }
        }
    }
}

struct StoredEventRow: View {
    let event: StoredEvent
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: event.type == EventType.businessTrip.rawValue ? "airplane" : "calendar.badge.clock")
                .foregroundStyle(event.status == EventStatus.needsConfirmation.rawValue ? .orange : .blue)
            VStack(alignment: .leading) {
                Text(event.title).font(.headline)
                Text(event.location.isEmpty ? event.type : "\(event.type) · \(event.location)")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if event.status == EventStatus.needsConfirmation.rawValue { Text("待确认").font(.caption).foregroundStyle(.orange) }
        }
    }
}

struct StoredEventDetailView: View {
    let event: StoredEvent
    var body: some View {
        Form {
            LabeledContent("标题", value: event.title)
            LabeledContent("类型", value: event.type)
            LabeledContent("状态", value: event.status)
            LabeledContent("地点", value: event.location.isEmpty ? "未填写" : event.location)
            LabeledContent("角色", value: event.role.isEmpty ? "未填写" : event.role)
            Section("原始内容") { Text(event.sourceText.isEmpty ? "未保存原文" : event.sourceText).font(.footnote) }
        }
        .navigationTitle("日程详情")
    }
}

struct EventRow: View {
    let event: CalendarEvent
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: event.type == .businessTrip ? "airplane" : "calendar.badge.clock")
                .foregroundStyle(event.status == .needsConfirmation ? .orange : .blue)
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title).font(.headline)
                Text(event.location.isEmpty ? event.type.rawValue : "\(event.type.rawValue) · \(event.location)")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if event.status == .needsConfirmation { Text("待确认").font(.caption).foregroundStyle(.orange) }
        }
    }
}

struct EventDetailView: View {
    let event: CalendarEvent
    var body: some View {
        Form {
            Section("基本信息") {
                LabeledContent("标题", value: event.title)
                LabeledContent("类型", value: event.type.rawValue)
                LabeledContent("状态", value: event.status.rawValue)
                LabeledContent("地点", value: event.location.isEmpty ? "未填写" : event.location)
                LabeledContent("角色", value: event.role.isEmpty ? "未填写" : event.role)
            }
            Section("提醒") {
                Label("可添加多个提醒", systemImage: "bell.badge")
                    .foregroundStyle(.secondary)
            }
            Section("附件") {
                Label("关联图片、PDF、Excel 或 Word", systemImage: "paperclip")
                    .foregroundStyle(.secondary)
            }
            if !event.sourceText.isEmpty {
                Section("原始内容") { Text(event.sourceText).font(.footnote) }
            }
        }
        .navigationTitle("日程详情")
    }
}

struct ImportView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var showingResult = false
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var isRecognizing = false
    var body: some View {
        NavigationStack {
            Form {
                Section("截图识别") {
                    PhotosPicker(selection: $selectedPhotos, maxSelectionCount: 10, matching: .images) {
                        Label("选择微信截图（可多选）", systemImage: "photo.on.rectangle.angled")
                    }
                    if !selectedPhotos.isEmpty {
                        Text("已选择 \(selectedPhotos.count) 张图片")
                            .foregroundStyle(.secondary)
                    }
                    Button(isRecognizing ? "识别中…" : "识别截图") {
                        Task { await recognizePhotos() }
                    }
                    .disabled(selectedPhotos.isEmpty || isRecognizing)
                }
                Section("粘贴聊天内容") {
                    TextEditor(text: $text).frame(minHeight: 180)
                    Button("识别日程") { showingResult = true }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Section { Text("识别后会逐条确认，不会自动保存。") .font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("导入日程")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            .sheet(isPresented: $showingResult) { RecognitionResultView(sourceText: text) }
        }
    }

    private func recognizePhotos() async {
        isRecognizing = true
        defer { isRecognizing = false }
        var results: [String] = []
        for item in selectedPhotos {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data),
               let recognized = try? await OCRService.recognizeText(in: image) {
                results.append(recognized)
            }
        }
        text = results.joined(separator: "\n\n")
        showingResult = !text.isEmpty
    }
}

struct RecognitionResultView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    let sourceText: String
    var body: some View {
        let draft = LocalEventParser.parse(sourceText)
        NavigationStack {
            Form {
                Section("识别结果") {
                    LabeledContent("类型", value: draft.type.rawValue)
                    LabeledContent("日期", value: draft.dateText.isEmpty ? "待确认" : draft.dateText)
                    LabeledContent("时间", value: draft.timeText.isEmpty ? "待确认" : draft.timeText)
                    LabeledContent("标题", value: draft.title)
                    LabeledContent("地点", value: draft.location.isEmpty ? "待确认" : draft.location)
                    LabeledContent("角色", value: draft.role.isEmpty ? "未识别" : draft.role)
                    LabeledContent("状态", value: draft.status.rawValue)
                }
                Section { Text("这是原型界面。下一步将接入真实的日期、时间、角色和会议链接识别。") .font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("确认日程")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("保存") { save(draft); dismiss() } } }
        }
    }

    private func save(_ draft: ParsedEventDraft) {
        modelContext.insert(StoredEvent(title: draft.title,
                                        date: draft.parsedDate ?? .now,
                                        type: draft.type.rawValue,
                                        status: draft.status.rawValue,
                                        location: draft.location,
                                        role: draft.role,
                                        sourceText: draft.sourceText,
                                        meetingURL: draft.meetingURL?.absoluteString ?? ""))
        try? modelContext.save()
    }
}

struct AddEventView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var type: EventType = .meeting
    var body: some View {
        NavigationStack {
            Form {
                TextField("标题", text: $title)
                Picker("类型", selection: $type) { ForEach(EventType.allCases) { Text($0.rawValue).tag($0) } }
            }
            .navigationTitle("新建日程")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("保存") { dismiss() } } }
        }
    }
}
