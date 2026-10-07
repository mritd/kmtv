#if os(iOS)
import SwiftUI

/// The edit-mode scaffolding shared by the downloads list and a show's episodes: an Edit button, a
/// bottom Delete bar for the selection, the tab bar hidden while editing, selection cleared when
/// editing ends, and edit mode left when the list empties. The list itself binds its selection
/// with `Binding.onlyWhileEditing`.
///
/// 下载列表与单部剧的分集共用的编辑模式脚手架: 编辑按钮, 针对所选内容的底部删除栏, 编辑时隐藏标签栏,
/// 结束编辑时清空选择, 列表变空时退出编辑模式. 列表自身通过 `Binding.onlyWhileEditing` 绑定选择集.
private struct DownloadsEditing: ViewModifier {
    @Binding var editMode: EditMode
    @Binding var selection: Set<String>
    let isEmpty: Bool
    let showsEditButton: Bool
    let delete: (Set<String>) async -> Void

    func body(content: Content) -> some View {
        content
            .toolbar {
                if showsEditButton {
                    ToolbarItem(placement: .topBarTrailing) { EditButton() }
                }
                if editMode.isEditing && !selection.isEmpty {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Delete", role: .destructive) {
                            let doomed = selection
                            selection = []
                            editMode = .inactive
                            Task { await delete(doomed) }
                        }
                        // Red like other deletes; the app-wide accent tint would otherwise color it.
                        //
                        // 与其他删除操作一样使用红色; 否则会被全局强调色着色.
                        .tint(.red)
                    }
                }
            }
            // Applied outside `.toolbar`, so `EditButton` and the bottom bar read the same binding as the list.
            //
            // 放在 `.toolbar` 之外, `EditButton` 与底部栏才能和列表读到同一个绑定.
            .environment(\.editMode, $editMode)
            // The floating tab bar would cover the bottom Delete bar, so editing hides it, as Photos does.
            //
            // 浮动标签栏会遮住底部的删除栏, 因此编辑时将其隐藏, 与 "照片" 的做法一致.
            .toolbar(editMode.isEditing ? .hidden : .automatic, for: .tabBar)
            .onChange(of: isEmpty) { _, empty in
                if empty { editMode = .inactive }
            }
            .onChange(of: editMode.isEditing) { _, editing in
                if !editing { selection = [] }
            }
    }
}

extension View {
    /// Adds the downloads edit-mode scaffolding; `delete` receives the selected keys.
    ///
    /// 添加下载页的编辑模式脚手架; `delete` 接收被选中的键.
    func downloadsEditing(editMode: Binding<EditMode>, selection: Binding<Set<String>>, isEmpty: Bool,
                          showsEditButton: Bool = true,
                          delete: @escaping (Set<String>) async -> Void) -> some View {
        modifier(DownloadsEditing(editMode: editMode, selection: selection, isEmpty: isEmpty,
                                  showsEditButton: showsEditButton, delete: delete))
    }
}
#endif
