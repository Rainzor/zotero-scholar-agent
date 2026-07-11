---
status: accepted
---

# Use semantic UI tokens for Zotero Agent surfaces

## Context

The reader sidebar and preferences window previously assigned component-level
light-theme colors, gray scales, radii, and type sizes directly. This broke
Zotero dark mode, produced inconsistent visual states, and made small UI
changes require repeated palette decisions.

## Decision

Define a namespaced `--za-*` token layer that maps to Zotero semantic theme
variables where they are available.

- Surfaces: panel, surface, subtle, muted, and elevated.
- Text: primary, secondary, and tertiary.
- States: accent, success, warning, and danger, each with a soft surface.
- Geometry: `6px`, `10px`, and pill radii.
- Type: `11px`, `12px`, `13px`, and `15px`.

Reader and preferences styles consume these tokens rather than component-level
color literals. A token-layer dark-mode fallback supports standalone or
incomplete host-theme environments. The reader stylesheet is split by visual
responsibility, with a small import-only entrypoint.

## Consequences

- Reader and preferences UI inherit Zotero light/dark themes consistently.
- Visual state changes stay local to the token layer.
- New UI work must use the semantic tokens unless an external asset requires a
  literal value.
- The preference page can share the same theme vocabulary without loading the
  sidebar implementation.
