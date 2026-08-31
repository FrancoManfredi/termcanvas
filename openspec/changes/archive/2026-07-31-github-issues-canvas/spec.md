# Delta for github-issues-canvas

## ADDED Requirements

### Requirement: Context Menu Integration

The system MUST display a "Traer issues de GitHub" menu item in the canvas right-click context menu, positioned alongside existing items like "New Shell". The menu item MUST only appear when a valid project/worktree context is resolved.

#### Scenario: Context menu shows GitHub issues option

- GIVEN the user right-clicks on the canvas with a focused worktree
- WHEN the context menu renders
- THEN the menu MUST include a "Traer issues de GitHub" item
- AND the item MUST be interactive and clickable

#### Scenario: Context menu without worktree focus

- GIVEN the user right-clicks on the canvas with no focused worktree
- WHEN the context menu renders
- THEN the "Traer issues de GitHub" item MUST NOT appear

---

### Requirement: Worktree Context Resolution

The system MUST resolve the target project/worktree for the GitHub issues action using the same logic as existing context menu actions (via extracted `resolveContextMenuTarget` helper). The resolution MUST identify the focused worktree's repository directory.

#### Scenario: Resolve focused worktree for issues

- GIVEN a worktree node is focused on the canvas
- WHEN the user clicks "Traer issues de GitHub"
- THEN the system MUST resolve the worktree's repository directory
- AND use that directory as the working context for the `gh` CLI command

---

### Requirement: GitHub CLI Execution via IPC

The system MUST execute `gh issue list --state open --json number,title,body,url,labels` in the resolved worktree's repository directory via Electron IPC (main process). The renderer MUST invoke the `github:fetch-issues` channel with the repository path.

#### Scenario: Fetch issues via IPC

- GIVEN a resolved worktree repository path
- WHEN the user triggers the GitHub issues action
- THEN the renderer MUST send an IPC message to `github:fetch-issues` with the repo path
- AND the main process MUST execute the `gh` CLI command in that directory
- AND return the JSON output to the renderer

---

### Requirement: JSON Output Parsing

The system MUST parse the JSON output from the `gh` CLI command. The parser MUST handle empty arrays (no open issues) gracefully and validate that required fields (`number`, `title`, `url`) are present. Optional fields (`body`, `labels`) MUST be handled when absent.

#### Scenario: Parse valid issue list

- GIVEN the `gh` CLI returns valid JSON with issue objects
- WHEN the output is parsed
- THEN each issue MUST extract `number`, `title`, `url` as required fields
- AND `body` and `labels` MUST be extracted when present

#### Scenario: Handle empty repository

- GIVEN the `gh` CLI returns an empty JSON array `[]`
- WHEN the output is parsed
- THEN the system MUST handle it gracefully without errors
- AND no issue nodes MUST be created

#### Scenario: Handle missing optional fields

- GIVEN an issue object lacks `body` or `labels`
- WHEN the output is parsed
- THEN the system MUST use default values (empty string for `body`, empty array for `labels`)

---

### Requirement: Issue Node Creation

The system MUST create an `IssueNode` for each parsed issue with a visual card component displaying the issue number (e.g., `#123`), title, and labels (with color if available from `gh`). The node MUST use the `IssueNodeData` interface and be registered in the `nodeTypes` map.

#### Scenario: Create issue node with labels

- GIVEN a parsed issue with number, title, and colored labels
- WHEN the node is created
- THEN the card MUST display `#number` (e.g., `#42`)
- AND the title text
- AND labels with their associated colors (if provided by `gh`)

#### Scenario: Create issue node without labels

- GIVEN a parsed issue with no labels
- WHEN the node is created
- THEN the card MUST display `#number` and title
- AND the labels section MUST be empty or hidden

---

### Requirement: Grid Layout Positioning

The system MUST position issue nodes in a grid layout offset from the focused worktree's position. The grid MUST use 3 columns, wrapping to the next row after every 3 issues. The offset MUST prevent overlap with the worktree node.

#### Scenario: Position issues in 3-column grid

- GIVEN 7 issues fetched from a worktree at position (100, 200)
- WHEN issue nodes are created
- THEN nodes 1-3 MUST be positioned in the first row offset from (100, 200)
- AND nodes 4-6 MUST be positioned in the second row
- AND node 7 MUST be positioned in the third row
- AND no issue node MUST overlap the worktree node

---

### Requirement: Deduplication on Re-fetch

The system MUST deduplicate issues by issue number when re-fetching. The `useIssueStore` MUST expose a `hasIssue(number)` method. Only issues NOT already present on the canvas MUST be added.

#### Scenario: Skip existing issues on re-fetch

- GIVEN the canvas already displays issue #42
- WHEN the user re-fetches issues and the API returns #42 again
- THEN issue #42 MUST NOT be added to the canvas again
- AND only new issues (not already present) MUST be added

#### Scenario: Add only new issues

- GIVEN the canvas displays issues #1, #2, #3
- WHEN a re-fetch returns issues #1, #2, #3, #4, #5
- THEN only issues #4 and #5 MUST be added to the canvas
- AND issues #1, #2, #3 MUST remain unchanged

---

### Requirement: Persistence Across Restarts

The system MUST persist issue nodes across app restarts via the existing scene document mechanism. The `SceneDocument` MUST include an optional `issues?: PersistedIssueNode[]` field (backward-compatible with v3). On load, missing `issues` field MUST default to an empty array.

#### Scenario: Persist issue nodes to scene document

- GIVEN issue nodes are displayed on the canvas
- WHEN the scene is saved
- THEN the `SceneDocument` MUST include an `issues` array with all issue node data
- AND each persisted issue MUST include number, title, url, position, and labels

#### Scenario: Load scene with issue nodes

- GIVEN a saved `SceneDocument` with an `issues` array
- WHEN the scene is loaded
- THEN all issue nodes MUST be restored to their saved positions
- AND all issue data (number, title, url, labels) MUST be preserved

#### Scenario: Load scene without issues field (backward compatibility)

- GIVEN a saved `SceneDocument` from v3 without an `issues` field
- WHEN the scene is loaded
- THEN the system MUST default to an empty issues array
- AND no issue nodes MUST be displayed

---

### Requirement: Click Opens Issue URL

The system MUST open the GitHub issue URL in the default browser when the user clicks an issue card. The click handler MUST use Electron's `shell.openExternal` API.

#### Scenario: Click issue card opens browser

- GIVEN an issue card is displayed on the canvas
- WHEN the user clicks the card
- THEN the system MUST invoke `shell.openExternal` with the issue's URL
- AND the default browser MUST open to the GitHub issue page

---

### Requirement: Error Handling and User Feedback

The system MUST show a toast notification with error details and a dialog suggesting troubleshooting steps when the `gh` CLI command fails. Common failure modes include: `gh` not installed, not authenticated, or network errors.

#### Scenario: gh CLI not installed

- GIVEN the `gh` CLI is not installed on the system
- WHEN the user triggers the GitHub issues action
- THEN a toast notification MUST appear with an error message
- AND a dialog MUST suggest installing `gh` CLI with a link to installation instructions

#### Scenario: gh CLI not authenticated

- GIVEN the `gh` CLI is installed but not authenticated
- WHEN the user triggers the GitHub issues action
- THEN a toast notification MUST appear with an authentication error
- AND a dialog MUST suggest running `gh auth login`

#### Scenario: Network error during fetch

- GIVEN a network error occurs during the `gh` CLI execution
- WHEN the command fails
- THEN a toast notification MUST appear with the network error details
- AND a dialog MUST suggest checking network connectivity
