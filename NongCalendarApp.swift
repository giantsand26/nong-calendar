import SwiftUI
import SwiftData

@main
struct NongCalendarApp: App {
    @StateObject private var store = CalendarStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .modelContainer(for: StoredEvent.self)
    }
}
