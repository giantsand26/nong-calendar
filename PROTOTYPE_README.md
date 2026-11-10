# Nong Calendar SwiftUI 原型

当前原型包含：

- 日历首页和日期选择
- 会议与出差/外出两类日程
- 待确认状态
- 粘贴导入入口
- 多张微信截图选择与本地 Vision OCR
- 识别确认后使用 SwiftData 本地保存
- 识别结果确认页
- 日程详情页中的提醒、附件和原文预留

使用方式：在 Xcode 中新建 iOS App（SwiftUI、Swift），将 `NongCalendarApp.swift`、`CalendarModels.swift` 和 `ContentView.swift` 加入项目即可运行。

下一阶段：将首页改为读取 SwiftData、接入 Share Extension、系统剪贴板提示、真实中文日期/时间识别、附件文件保存和 UserNotifications 多提醒。

已加入 `LocalEventParser.swift`，用于本地解析常见格式；它不联网、不使用服务器，也不调用 LLM。后续可在解析失败或内容复杂时，由用户主动选择调用 LLM。

## Safari 本地 PWA

`index.html`、`styles.css`、`app.js`、`manifest.json` 和 `sw.js` 是不依赖 Xcode 的浏览器版本。它使用 `localStorage` 保存日程、使用 `IndexedDB` 保存附件，可在 Safari 中运行。已支持月/周/日视图、文字和截图导入、本地规则识别、浏览器 OCR、确认编辑、附件、多提醒、删除、备份与恢复。详细操作见 `PWA使用说明.md`。
