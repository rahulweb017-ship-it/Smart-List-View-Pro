# Changelog

## 19.0.1.0.0 (unreleased)
- Milestone A: module skeleton, admin group, "Layouts" button with
  "List layouts" panel on top-level list views. The list template extension is
  loaded right after web's list_controller.xml so primary copies of
  `web.ListView` (e.g. crm_enterprise) inherit it.
- Milestone B: `smart.list.preset` hardened — server-side payload validation
  (schema v1, 16 KB / 100 columns, widths 80–600, readable existing fields only),
  forced ownership, immutable identity (owner, visibility, model, view, action),
  shared presets admin-only, case-insensitive unique names, computed `view_key`,
  `get_presets_for_list()` client API with tolerant re-validation on read.
- Milestone C: column editor in the panel (visibility, up/down order with
  focus kept, clamped widths, Reset, "Unsaved layout changes" state). The
  renderer only filters/reorders the columns it would show anyway; other
  columns (buttons, widgets) follow the field that precedes them in the arch.
  Widths go through the standard column `width` attribute of the width hook.
  Real-browser tours on Contacts, CRM and Sales quotations lists edit, apply
  and reset a layout, then check sort, pager, selection and record navigation.
- Milestone D: saved layouts in the panel — save as new, save changes, apply,
  rename, duplicate (personal copy), delete with confirmation, publish /
  unpublish for layout administrators; applied/unsaved state, skipped-column
  warning, server errors as notifications. Server: readable duplicate-name
  errors (unique indexes kept), free copy names ("(copy 2)"), copies keep only
  the columns the copying user can read. Cross-user tour: an administrator
  publishes, an internal user applies and copies.
- Milestone E: keyboard and focus polish (Escape cancels the name form before
  closing the panel; focus goes to Cancel on delete confirmation and returns to
  a sensible control after rename, delete, duplicate and other server actions;
  the locked last column explains why; loading sections are `aria-busy`).
  Packaging: `static/description/index.html` (also stops Odoo parsing the
  README as reStructuredText), original icon, screenshots captured from the
  real web client, full OPL-1 text, translation template. Regression: Odoo's
  own list view unit tests run with this module loaded; install, upgrade and
  uninstall smoke tests.
