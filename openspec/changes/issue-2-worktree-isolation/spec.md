# Delta Spec: GitHub Issues Worktree Isolation

## Change: issue-2-worktree-isolation

## ADDED Requirements

### Requirement: Issue Branch Naming

The system MUST provide a `buildIssueBranchName(issue)` utility that converts an issue number and title into a kebab-case branch name in the format `issue-<N>-<slug>`. The slug MUST be derived from the issue title by lowercasing, replacing non-alphanumeric characters with hyphens, collapsing consecutive hyphens, and trimming leading/trailing hyphens. The slug MUST be truncated to a maximum of 40 characters.

#### Scenario: Standard title sanitization

- GIVEN an issue with number 42 and title "Fix login bug"
- WHEN `buildIssueBranchName` is called
- THEN the result MUST be `issue-42-fix-login-bug`

#### Scenario: Special characters in title

- GIVEN an issue with number 7 and title "Add @auth & \"quotes\" support!"
- WHEN `buildIssueBranchName` is called
- THEN the result MUST be `issue-7-add-auth-quotes-support`

#### Scenario: Title exceeding max slug length

- GIVEN an issue with number 10 and a title longer than 40 characters after sanitization
- WHEN `buildIssueBranchName` is called
- THEN the slug MUST be truncated to 40 characters
- AND any trailing hyphen MUST be trimmed

---

### Requirement: Isolated Worktree Creation on Resolve

The system MUST create an isolated git worktree before launching the resolve terminal. When the user triggers "RESOLVER ISSUE", the handler MUST call `buildIssueBranchName(issue)`, then invoke `createWorktree(repoPath, branchName)` to create the worktree, then call `syncWorktrees` to register it, and finally create the terminal in the new worktree's path.

#### Scenario: Happy path — worktree and terminal created

- GIVEN the user right-clicks an issue card (#42) and selects "RESOLVER ISSUE"
- WHEN no existing worktree exists for branch `issue-42-<slug>`
- THEN the system MUST call `createWorktree` with the repo path and branch name
- AND call `syncWorktrees` to register the new worktree
- AND create a terminal in the new worktree's directory
- AND the terminal MUST receive the same `initialPrompt` as the previous behavior

---

### Requirement: Idempotent Worktree Reuse

The system MUST reuse an existing worktree when the same issue is resolved more than once. After building the branch name, the handler MUST check if a worktree for that branch already exists in the project's worktree list. If it exists, the handler MUST skip `createWorktree` and use the existing worktree's path directly.

#### Scenario: Same issue resolved twice

- GIVEN the user previously resolved issue #42, creating worktree `issue-42-fix-login-bug`
- WHEN the user triggers "RESOLVER ISSUE" on issue #42 again
- THEN the system MUST NOT call `createWorktree`
- AND MUST create the terminal in the existing worktree's directory

---

### Requirement: Worktree Creation Failure Handling

If `createWorktree` throws or returns an error, the system MUST abort the resolve flow entirely. The system MUST NOT fall back to creating the terminal in the focused worktree. The system MUST display an error toast notification with the failure details.

#### Scenario: git worktree add fails

- GIVEN the user triggers "RESOLVER ISSUE" on issue #99
- WHEN `createWorktree` fails (e.g., branch already exists on a different path, dirty repo)
- THEN the system MUST show an error toast notification
- AND MUST NOT create any terminal
- AND MUST NOT fall back to the focused worktree

---

### Requirement: Busy State During Worktree Creation

The system MUST set a busy state (`isCreatingWorktree`) while the worktree is being created, mirroring the existing `isFetchingIssues` pattern. The busy state MUST prevent duplicate resolve actions and provide visual feedback to the user.

#### Scenario: UI shows busy state during worktree creation

- GIVEN the user triggers "RESOLVER ISSUE"
- WHEN the worktree creation is in progress
- THEN the UI MUST reflect the busy state (e.g., disabled context menu or loading indicator)
- AND when worktree creation completes (success or failure), the busy state MUST be cleared
