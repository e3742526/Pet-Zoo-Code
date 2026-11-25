# Modularity Assessment: `webview-ui/src/components/modes/ModesView.tsx`

**Date:** 2026-11-24  
**Target File:** [ModesView.tsx](webview-ui/src/components/modes/ModesView.tsx) (`1,789` lines, `60,391` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`ModesView.tsx` is a monolithic single-file React component (`const ModesView = () => ...`, default-exported at line 1789) that currently owns **9 distinct responsibilities** and **25+ `useState` hooks**:

1. **Toolbar & Config Menu (`620–710`):** JSON config dropdown (`openCustomModesSettings`, `openFile` for `./.roomodes`), Marketplace trigger (`window.postMessage`), Import Mode button.
2. **Mode Selector Popover & Search (`112–114`, `238–254`, `758–852`):** Radix `Popover` + `Command` searchable combobox with optimistic `localRenames` overlay.
3. **Inline Mode Rename (`119–126`, `256–300`, `724–755`):** Inline `VSCodeTextField` + save/cancel buttons, duplicate-name guard, optimistic `localRenames`.
4. **Mode Action Buttons (`854–924`):** Create (`+`), Rename, Delete (triggers `deleteCustomMode` with `checkOnly: true`), Export (`exportMode`).
5. **Mode-Scoped API Configuration Selector (`928–955`):** `Select` bound to `currentApiConfigName`, posting `loadApiConfiguration`.
6. **Prompt & Instructions Editors (`129–152`, `600–614`, `958–1342`):** Four nearly identical editable sections (`roleDefinition`, `description`, `whenToUse`, `customInstructions`) with built-in reset buttons, custom-vs-built-in branching (`updateCustomMode` vs `updateAgentPrompt`), and `./.roo/rules-<slug>/rules.md` link.
7. **Tools & MCP Restriction Editor (`490–514`, `1124–1236`):** Toggleable `TOOL_GROUPS` checkbox grid + `McpServerRestriction` (already extracted to [McpServerRestriction.tsx](webview-ui/src/components/modes/McpServerRestriction.tsx)).
8. **System Prompt Preview / Copy & Global Custom Instructions (`1344–1444`, `1674–1702`):** Preview/copy buttons, full-height slide-over modal for `systemPrompt`, and global `customInstructions` textarea + `./.roo/rules/rules.md` link.
9. **Modals & Host Message Bus (`324–487`, `536–598`, `1447–1784`):**
    - Create Mode slide-over dialog (9 form fields + 5 Zod error states + `McpServerChecklist`)
    - System Prompt preview slide-over dialog
    - Import Mode dialog (`project` vs `global`)
    - `DeleteModeDialog` ([DeleteModeDialog.tsx](webview-ui/src/components/modes/DeleteModeDialog.tsx))
    - Single `window.addEventListener("message", ...)` dispatcher using 4 refs (`handleModeSwitchRef`, `customModesRef`, `switchModeRef`, `modeToDeleteRef`) + `visualModeRef`.

---

## 2. Exact Dependency Map

### A. Inbound Consumers (Who Imports / Renders `ModesView`)

| File                                                                                                                               | Usage                                                                                                  | Impact if Modularized                                                                                |
| :--------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| [SettingsView.tsx](webview-ui/src/components/settings/SettingsView.tsx#L86)                                                        | `import ModesView from "../modes/ModesView"` and `{activeTab === "modes" && <ModesView />}` (line 910) | **None** if `ModesView.tsx` keeps its default export and zero-prop signature.                        |
| [App.spec.tsx](webview-ui/src/__tests__/App.spec.tsx#L71)                                                                          | `vi.mock("@src/components/modes/ModesView", ...)`                                                      | **None** if path & default export are preserved.                                                     |
| [SettingsView.change-detection.spec.tsx](webview-ui/src/components/settings/__tests__/SettingsView.change-detection.spec.tsx#L192) | `vi.mock("@src/components/modes/ModesView", ...)`                                                      | **None.**                                                                                            |
| [SettingsView.unsaved-changes.spec.tsx](webview-ui/src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx#L168)   | `vi.mock("@src/components/modes/ModesView", ...)`                                                      | **None.**                                                                                            |
| [ModesView.spec.tsx](webview-ui/src/components/modes/__tests__/ModesView.spec.tsx)                                                 | Imports `../ModesView`, mocks `@src/utils/vscode`, queries `data-testid`s and i18n keys                | **High** if `data-testid`s or `vscode.postMessage` payloads change.                                  |
| [ModesView.import-switch.spec.tsx](webview-ui/src/components/modes/__tests__/ModesView.import-switch.spec.tsx)                     | Imports `../ModesView`, dispatches `importModeResult` window messages                                  | **High** if `importModeResult` handling or `visualMode` switching moves without preserving behavior. |
| [McpServerRestriction.spec.tsx](webview-ui/src/components/modes/__tests__/McpServerRestriction.spec.tsx)                           | Imports `../ModesView`, mocks `DeleteModeDialog`                                                       | **Medium/High** — tests `ModesView` integration with `McpServerRestriction`.                         |

### B. Outbound Imports (What `ModesView.tsx` Depends On)

- **External Packages:** `react`, `@vscode/webview-ui-toolkit/react` (`VSCodeCheckbox`, `VSCodeRadioGroup`, `VSCodeRadio`, `VSCodeTextArea`, `VSCodeLink`, `VSCodeTextField`), `react-i18next` (`Trans`), `lucide-react` (`ChevronDown`, `X`, `Upload`, `Download`).
- **Workspace Packages:**
    - `@roo-code/types`: `ModeConfig`, `GroupEntry`, `PromptComponent`, `ToolGroup`, `modeConfigSchema`
    - `@roo/modes`: `Mode`, `getRoleDefinition`, `getWhenToUse`, `getDescription`, `getCustomInstructions`, `getAllModes`, `findModeBySlug`, `defaultModeSlug`
    - `@roo/tools`: `TOOL_GROUPS`
- **Internal Webview Modules:**
    - `@src/utils/vscode`, `@src/utils/docLinks`
    - `@src/i18n/TranslationContext` (`useAppTranslation`)
    - `@src/context/ExtensionStateContext` (`useExtensionState`: `customModePrompts`, `listApiConfigMeta`, `currentApiConfigName`, `mode`, `customInstructions`, `setCustomInstructions`, `customModes`, `mcpServers`)
    - `@src/components/settings/Section`
    - `@src/components/ui` (`Button`, `Select*`, `Popover*`, `Command*`, `Input`, `StandardTooltip`)
    - `@src/hooks/useEscapeKey`
    - Siblings: [DeleteModeDialog.tsx](webview-ui/src/components/modes/DeleteModeDialog.tsx) (56 lines), [McpServerRestriction.tsx](webview-ui/src/components/modes/McpServerRestriction.tsx) (173 lines), [McpServerChecklist.tsx](webview-ui/src/components/modes/McpServerChecklist.tsx) (64 lines).

### C. Extension Host Message Contract (`vscode.postMessage` ↔ `window` `"message"`)

All 13 outbound messages and 5 inbound messages are handled in [webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts) (none need backend changes during a pure UI modularization):

- **Outbound (`webview -> host`):**
    1. `updatePrompt` (`promptMode`, `customPrompt`) → line 2127
    2. `updateCustomMode` (`slug`, `modeConfig`) → line 2592
    3. `mode` (`text: slug`) → mode switch
    4. `checkRulesDirectory` (`slug`) → line 2873
    5. `openCustomModesSettings` → line 1887
    6. `openFile` (`text`, `values: { create, content }`) → `./.roomodes`, `./.roo/rules-<slug>/rules.md`, `./.roo/rules/rules.md`
    7. `deleteCustomMode` (`slug`, optional `checkOnly: true`) → line 2636
    8. `exportMode` (`slug`) → line 2703
    9. `importMode` (`source: "global" | "project"`) → line 2781
    10. `loadApiConfiguration` (`text`) → line 2471
    11. `getSystemPrompt` (`mode`) → line 2267
    12. `copySystemPrompt` (`mode`) → line 2283
    13. `customInstructions` (`text`) → line 736
    14. _(Local webview event)_ `window.postMessage({ type: "action", action: "marketplaceButtonClicked", values: { marketplaceTab: "mode" } }, "*")`
- **Inbound (`host -> webview`):**
    1. `systemPrompt` (`text`, `mode`)
    2. `exportModeResult` (`success`, `error`)
    3. `importModeResult` (`success`, `slug`, `error`)
    4. `checkRulesDirectoryResult` (`slug`, `hasContent`)
    5. `deleteCustomModeCheck` (`slug`, `rulesFolderPath`)

---

## 3. Recommended Modularization Plan (Exact Steps)

Split `ModesView.tsx` into cohesive, single-responsibility modules under `webview-ui/src/components/modes/` while keeping `ModesView.tsx` as a thin orchestrator (`~150–200` lines) with the exact same default export:

1. **Step 1 — Extract Shared Helpers & Types (`modeHelpers.ts`):**
    - Move `availableGroups`, `ModeSource`, `ImportModeResult`, `getGroupName()`, `generateSlug()`, and the `extractToolkitInputValue(e)` helper (replacing the 5 duplicated `(e as unknown as CustomEvent)?.detail?.target?.value ?? ((e as any).target as HTMLTextAreaElement).value` blocks).
2. **Step 2 — Extract Custom Hook for Mode State & Host Messages (`useModesState.ts`):**
    - Own `visualMode` + `visualModeRef` Flicker-A guard, `modes` / `displayModes`, `getCurrentMode`, `handleModeSwitch`, `updateAgentPrompt`, `updateCustomMode`, `handleAgentReset`, and the `window.addEventListener("message", ...)` handler (with clean callbacks for `systemPrompt`, `exportModeResult`, `importModeResult`, `deleteCustomModeCheck`).
3. **Step 3 — Extract Toolbar & Config Menu (`ModesToolbar.tsx`):**
    - Header title, JSON config dropdown (`openCustomModesSettings`, `./.roomodes`), Marketplace button, and Import Mode trigger button.
4. **Step 4 — Extract Mode Selector & Action Bar (`ModeSelectorBar.tsx`):**
    - Searchable `Popover` + `Command` list, inline rename mode (`isRenamingMode`, `localRenames`, `renameInputRef`), and `+` / Rename / Delete / Export icon buttons.
5. **Step 5 — Extract Reusable Prompt Field Editor (`ModePromptField.tsx`) & Prompt Section (`ModePromptsSection.tsx`):**
    - Parameterize the 4 duplicated field editors (`roleDefinition`, `description`, `whenToUse`, `customInstructions`) into a single shared component/helper handling built-in reset buttons, `updateCustomMode` vs `updateAgentPrompt`, and `data-testid` preservation.
    - Include `ModeApiConfigSelect.tsx` (or keep inside `ModePromptsSection`) and `GlobalCustomInstructionsSection.tsx`.
6. **Step 6 — Extract Tools & MCP Section (`ModeToolsSection.tsx`):**
    - `TOOL_GROUPS` grid, `handleGroupChange`, read-only summary view, and `<McpServerRestriction />`.
7. **Step 7 — Extract Modals (`CreateModeDialog.tsx`, `ImportModeDialog.tsx`, `SystemPromptPreviewDialog.tsx`):**
    - Move the 9-field Create Mode form + Zod validation (`modeConfigSchema.safeParse`) + `McpServerChecklist` into `CreateModeDialog.tsx`.
    - Move the Import Mode radio modal into `ImportModeDialog.tsx`.
    - Move the System Prompt preview slide-over into `SystemPromptPreviewDialog.tsx`.

---

## 4. What Needs to Be Fixed, Patched, or Preserved When Modularizing

### Bugs & Code-Quality Issues to Fix During Modularization

1. **Remove `as any` casts (5 occurrences + 1 `useRef<any>`):**
    - Lines 992, 1047, 1102, 1278, 1400 use `((e as any).target as HTMLTextAreaElement).value`; line 121 uses `useRef<any>(null)`. Replace with a typed helper (e.g., `extractToolkitValue(e)`) and `useRef<HTMLElement | null>(null)` so no lint suppressions are introduced.
2. **Dead `hasRulesToExport` state & unused `checkRulesDirectory` round-trip:**
    - Lines 102, 309–322, 577–581 fetch `checkRulesDirectory` on every mode switch and store `hasRulesToExport[slug]`, **but `hasRulesToExport` is never read in the UI**. Either wire it to the UI or remove the dead message round-trip (verify no tests assert on `checkRulesDirectory` first).
3. **Stale `localRenames` overlay:**
    - `localRenames` (line 124) is never pruned once `customModes` from the host catches up with the renamed `name`. Clear the entry for `slug` when `customModes` reflects the new name.
4. **Menu close race (`document.addEventListener("click")` + `onBlur` + `setTimeout(..., 200)`):**
    - Replace the manual `showConfigMenu` click-outside + `setTimeout` blur hack (lines 517–526, 636–639) with the repo's existing `Popover` / `DropdownMenu` primitive from `@src/components/ui`.
5. **Inconsistent inline `style={{ ... }}` in Create Mode Dialog:**
    - Lines 1517–1528 use inline styles (`marginBottom: "16px"`, `var(--vscode-descriptionForeground)`) while the rest of the file uses Tailwind classes (`mb-4`, `text-vscode-descriptionForeground`). Normalize to Tailwind.

### Invariants & Contracts That MUST Be Preserved (Do Not Break)

1. **All `23` `data-testid` attributes:**
    - Tests in `ModesView.spec.tsx` and `McpServerRestriction.spec.tsx` query exact IDs: `import-mode-toolbar-button`, `save-mode-rename-button`, `cancel-mode-rename-button`, `mode-select-trigger`, `mode-search-input`, `mode-option-${slug}`, `add-mode-button`, `rename-mode-button`, `delete-mode-button`, `export-mode-toolbar-button`, `role-definition-reset`, `${slug}-prompt-textarea`, `description-reset`, `${slug}-description-textfield`, `when-to-use-reset`, `${slug}-when-to-use-textarea`, `custom-instructions-reset`, `${slug}-custom-instructions-textarea`, `preview-prompt-button`, `copy-prompt-button`, `global-custom-instructions-textarea`, `create-mcp-server-restriction`, `create-restrict-mcp-servers-toggle`.
2. **Flicker-A `visualModeRef` guard (`228–236`):**
    - Keep `visualModeRef` so host state pushes carrying a stale `mode` do not flash the detail panel back to the previous mode mid-switch.
3. **`importModeResult` auto-switch race fallback (`552–576`):**
    - Tested by `ModesView.import-switch.spec.tsx`: must read `customModesRef.current` (freshest modes) and fall back to `defaultModeSlug` if the imported slug is not yet in `customModes`.
4. **`deleteCustomMode` two-step flow (`882–896`, `582–593`, `1770–1784`):**
    - Clicking trash sends `{ type: "deleteCustomMode", slug, checkOnly: true }` and sets `modeToDelete`; `DeleteModeDialog` only opens after `deleteCustomModeCheck` arrives with `rulesFolderPath`.
5. **Default export & zero-prop signature of `ModesView.tsx`:**
    - Required by [SettingsView.tsx](webview-ui/src/components/settings/SettingsView.tsx#L86) and the 3 `vi.mock("@src/components/modes/ModesView", ...)` test mocks.

---

## 5. Other Files Impacted

- **Zero backend (`src/`) changes required** — all 13 outbound and 5 inbound message types in [webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts) and [ClineProvider.ts](src/core/webview/ClineProvider.ts) remain untouched.
- **Zero `SettingsView.tsx` changes required** (unless you also choose to lazy-load `ModesView` with `React.lazy` later, which is orthogonal).
- **Test files to run/verify after modularization:**
    - [ModesView.spec.tsx](webview-ui/src/components/modes/__tests__/ModesView.spec.tsx)
    - [ModesView.import-switch.spec.tsx](webview-ui/src/components/modes/__tests__/ModesView.import-switch.spec.tsx)
    - [McpServerRestriction.spec.tsx](webview-ui/src/components/modes/__tests__/McpServerRestriction.spec.tsx)
    - [SettingsView.change-detection.spec.tsx](webview-ui/src/components/settings/__tests__/SettingsView.change-detection.spec.tsx)
    - [SettingsView.unsaved-changes.spec.tsx](webview-ui/src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx)
    - [App.spec.tsx](webview-ui/src/__tests__/App.spec.tsx)
- **New unit tests recommended** for extracted pure helpers/hooks (`modeHelpers.spec.ts`, `useModesState.spec.ts`, `CreateModeDialog.spec.tsx`).
