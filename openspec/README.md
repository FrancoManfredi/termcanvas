# OpenSpec - SDD Artifact Store

## Overview

This directory contains the SDD (Structured Development Document) artifacts for the TermCanvas project. It serves as a persistent storage for design decisions, specifications, and implementation plans.

## Directory Structure

```
openspec/
├── config/           # Configuration files
│   ├── config.yaml           # Project configuration
│   └── testing-capabilities.yaml  # Testing setup
├── proposals/        # Change proposals
├── specs/           # Delta specifications
├── designs/         # Technical designs
├── tasks/           # Implementation tasks
└── archive/         # Completed changes
```

## SDD Workflow

### 1. Explore Phase
- Use `sdd-explore` skill to investigate ideas
- Document requirements and constraints
- Identify affected components

### 2. Propose Phase
- Use `sdd-propose` skill to create change proposals
- Define intent, scope, and approach
- Get approval before proceeding

### 3. Spec Phase
- Use `sdd-spec` skill to write delta specs
- Define requirements and acceptance criteria
- Create test scenarios

### 4. Design Phase
- Use `sdd-design` skill for technical design
- Document architecture decisions
- Create implementation approach

### 5. Tasks Phase
- Use `sdd-tasks` skill to break down work
- Create implementation tasks
- Estimate effort and dependencies

### 6. Apply Phase
- Use `sdd-apply` skill to implement changes
- Follow test-driven development
- Write tests alongside code

### 7. Verify Phase
- Use `sdd-verify` skill to validate implementation
- Run tests and verify specs
- Document test results

### 8. Archive Phase
- Use `sdd-archive` skill to complete changes
- Sync delta specs to main specs
- Document lessons learned

## Configuration

### Persistence Mode
- **Mode**: Hybrid (Engram + OpenSpec)
- **Engram**: For session-based memory and decisions
- **OpenSpec**: For persistent artifacts and specifications

### Testing Capabilities
- **Runner**: Node.js test runner via tsx
- **Coverage**: Not configured (manual testing)
- **Strict TDD**: Disabled

### Code Quality
- **TypeScript**: Strict mode
- **Linting**: Manual review (no ESLint)
- **Formatting**: EditorConfig (2 spaces, LF)

## Usage Examples

### Starting a New Feature
```bash
# 1. Explore the idea
/sdd-explore "Add dark mode support"

# 2. Create proposal
/sdd-propose "Dark Mode Implementation"

# 3. Write spec
/sdd-spec "dark-mode-spec"

# 4. Design solution
/sdd-design "dark-mode-design"

# 5. Break into tasks
/sdd-tasks "dark-mode-tasks"

# 6. Implement
/sdd-apply "dark-mode-implementation"

# 7. Verify
/sdd-verify "dark-mode-verification"

# 8. Archive
/sdd-archive "dark-mode-complete"
```

### Quick Reference
- **Proposals**: `openspec/proposals/`
- **Specs**: `openspec/specs/`
- **Designs**: `openspec/designs/`
- **Tasks**: `openspec/tasks/`
- **Archive**: `openspec/archive/`

## Conventions

### File Naming
- Proposals: `{feature}-proposal.md`
- Specs: `{feature}-spec.md`
- Designs: `{feature}-design.md`
- Tasks: `{feature}-tasks.md`

### Artifact Format
- Use Markdown for all artifacts
- Include metadata (status, date, author)
- Reference related artifacts
- Link to relevant code

### Status Tracking
- **Draft**: Initial version
- **Review**: Under review
- **Approved**: Ready for implementation
- **In Progress**: Being implemented
- **Complete**: Finished and archived
- **Superseded**: Replaced by newer version

## Integration with Engram

### Memory Topics
- `sdd-init/termcanvas`: Project initialization
- `sdd-design/*`: Architecture decisions
- `sdd-learnings/*`: Technical discoveries

### Session Protocol
1. **Start**: Load relevant SDD artifacts
2. **Work**: Reference specs and designs
3. **Save**: Update artifacts with decisions
4. **End**: Archive completed work

## Best Practices

### Before Starting Work
1. Check existing specs and designs
2. Review related proposals
3. Understand affected components
4. Identify testing requirements

### During Implementation
1. Follow test-driven development
2. Reference specs continuously
3. Document decisions and trade-offs
4. Update tasks as work progresses

### After Completion
1. Verify against specs
2. Update documentation
3. Archive completed work
4. Share learnings with team

## Tools and Integration

### SDD Skills
- `sdd-init`: Initialize project context
- `sdd-explore`: Investigate ideas
- `sdd-propose`: Create proposals
- `sdd-spec`: Write specifications
- `sdd-design`: Technical design
- `sdd-tasks`: Break down work
- `sdd-apply`: Implement changes
- `sdd-verify`: Validate implementation
- `sdd-archive`: Complete changes

### Development Workflow
- **Git**: Conventional commits, no AI attribution
- **Testing**: Node.js test runner via tsx
- **Building**: Vite + esbuild
- **Type Checking**: TypeScript strict mode

## Maintenance

### Regular Tasks
- Review and update specs quarterly
- Archive completed features
- Update testing capabilities
- Refresh skill registry

### Cleanup
- Remove outdated proposals
- Supersede old specs with new versions
- Archive deprecated designs
- Update configuration as needed

## Support

### Getting Help
- Check this README first
- Review SDD skill documentation
- Look at example artifacts
- Ask team members

### Contributing
1. Follow SDD workflow
2. Use proper file naming
3. Include metadata
4. Reference related work
5. Update documentation