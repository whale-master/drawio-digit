# State Management

> How state is managed in this project.

## Canvas plugin state and editable diagrams

**Scope.** A pipeline editor owns temporary cursor, selection, form and drag state. Its persisted record belongs to one draw.io matrix cell. The image, geometry and record participate in the same draw.io transaction so a file save, copy or undo captures a consistent diagram.

**Interfaces.** `applyCommand(matrix, command)` returns the proposed matrix or throws before the graph is changed. The plugin validates the parsed `pipelineData` record with `validateMatrix(record)` and uses `graph.setAttributeForCell(cell, 'pipelineData', JSON.stringify(next))` in the transaction that updates the image.

**Host signals.** A graph may remain enabled while its current file is read-only. Check `ui.getCurrentFile()?.isEditable()` for an existing file and `graph.isEnabled()` plus `graph.isCellLocked(target)` for graph access. Check at entry and commit because write permission can change while an input is open. Use the host action's enabled state for undo and redo.

| Situation | Observable behavior |
| --- | --- |
| Enter an empty editable page | A temporary grid appears. Toggling the mode alone creates no cell. |
| Rename a copied matrix's block | Only the copy's record and image change, even though it initially carries the same block IDs. |
| File becomes read-only during entry | Reject the pending command; keep the last stored record, geometry and image. |
| Target cell or layer is hidden or removed | Release the editor. A cell can remain in the model after it loses its visible view state. |
| Malformed or unsupported record | Preserve the visible image and report the read error. |

**Verification.** Exercise a transaction through the user-facing input, then inspect the cell attribute and embedded SVG independently. Test a rejected command with an existing cell. Assert its stored record and image are unchanged. For visibility changes, assert the editor is gone even when `model.contains(cell)` is still true.

Checking only `graph.isEnabled()` before writing misses file access changes. Checking only `model.contains(cell)` before displaying a cell overlay misses hidden layers. The pipeline plugin checks file access at command time and pairs containment with `graph.view.getState(cell)` when refreshing the editor.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)
