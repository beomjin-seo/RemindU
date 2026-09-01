import SwiftUI

struct SettingsView: View {
    @AppStorage(AppConfig.serverURLKey) private var serverURL: String = AppConfig.defaultServerURL

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("http://localhost:8000", text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Server URL")
                } footer: {
                    Text("Base URL of the Capture Inbox backend. Default is http://localhost:8000 for local development.")
                }
                Section("About") {
                    LabeledContent("App", value: "Capture Inbox")
                    LabeledContent("Version", value: "0.1.0")
                    Text("Share a screenshot in 2 taps. Capture Inbox extracts what it is and brings it back when it matters: sale and deadline alerts for shopping, map pins for places.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
