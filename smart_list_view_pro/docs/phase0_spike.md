# Phase 0 spike note — Odoo 19 list integration

Runtime inspected: Odoo 19.0+e-20260605 (Windows installer build),
`server/odoo/addons/web/static/src`.

## Inspected source
- `views/list/list_controller.js` / `.xml` — `ListController` (template `web.ListView`),
  props incl. `showButtons`, `archInfo`, `resModel`; slots `layout-buttons`,
  `control-panel-additional-actions` (CogMenu), `control-panel-selection-actions`.
- `views/view.js` — `View` sets `env.config.viewId` (resolved arch id), `viewType`,
  `viewSubType` (js_class); `env.config.actionId` / `actionType` come from the action service.
- `search/layout.js` — `Layout` drops `layout-buttons` inside dialogs.
- `core/popover/popover_hook.js` — `usePopover(Component, options)`; popover injects `close` prop.
- `core/utils/patch.js` — `patch(obj, extension)`.
- 47 addons subclass `ListController`; several copy `static components` at import time.

## Decision
1. QWeb extension of `web.ListView`: insert before the first `CogMenu` in
   `control-panel-additional-actions`.
   **Load order matters** (`web/static/src/core/templates.js`, `_getTemplate`): a primary
   template (`t-inherit-mode="primary"`) only receives parent extensions registered in an
   earlier asset block. With the default load order the button was missing on the CRM
   pipeline list (`crm_enterprise` primary copy, found by the real-browser tour). The
   extension is therefore its own file, inserted with the manifest directive
   `("after", "web/static/src/views/list/list_controller.xml", …)`. The 13 primary copies
   found in this install (crm_enterprise, project ×3, purchase, documents, hr_holidays,
   hr_expense, hr_payroll, sign, website_slides, account_accountant, a POS popup) all
   load after it.
2. One read-only getter patched on `ListController.prototype` (`smartLayouts`),
   rendered via `t-component`, so no `static components` registration is needed
   on subclasses.
3. Eligibility: `env.config.actionType === "ir.actions.act_window"`,
   `env.config.viewType === "list"`, not `env.inDialog`, `props.showButtons`,
   no selected records. Grouped lists show a notice (editing disabled in MVP).
4. `view_key = "<model>|view:<viewId>|action:<actionId>"` (`column_layout.js`).
   Fallback to `0` when an id is missing; field-signature fallback to be decided in Milestone C.
5. HOOT tests live in `static/tests/` (Odoo convention), not `static/src/tests/` as the spec sketched.

## Limitations / open points
- Custom `js_class` lists whose template does not derive from `web.ListView` won't show the button.
- Mobile (`env.isSmall`) only shows the icon; behaviour is best-effort.

## Milestone B: deviation from the spec's data model
The spec suggested `view_id` (Many2one `ir.ui.view`) and `action_id`
(Many2one `ir.actions.act_window`). In Odoo 19, internal users have **no read
access** to either model (`base/security/ir.model.access.csv`), so reading a
preset with those Many2one fields would raise AccessError for ordinary users,
and validating them would require `sudo()`. They are stored instead as plain
integers `view_ref` / `action_ref`; `view_key` is a stored compute of
`model|view:<id>|action:<id>` and cannot be set by clients. The key only
scopes lookups; it grants no access.

## Milestone C: renderer integration
Inspected: `views/list/list_renderer.js` (`allColumns` → `getActiveColumns()` in
`onWillRender`, `optionalActiveFields` + localStorage, `displayOptionalFields`),
`views/list/column_width_hook.js` (`useMagicColumnWidths`: widths frozen per
column-id hash; `getWidthSpecs` honours `column.attrs.width` as min = max;
`resetWidths()`), `views/list/list_arch_parser.js` (column objects, labels).

- The controller owns a `reactive({ resModel, columns })` state (`columns: null`
  = native) and shares it with its own renderer through `useSubEnv`. Only
  eligible controllers create it; the renderer also checks `resModel`.
- `ListRenderer.getActiveColumns()` is wrapped: it starts from the native result
  and from `allColumns` (never from fields outside the arch), and calls the pure
  `arrangeColumns()` (`column_layout.js`).
- Widths: a cached copy of the column with `attrs.width = "<n>px"`, so the
  standard width hook enforces it; `resetWidths()` runs when the layout changes
  because a width-only change keeps the same column-id hash.
- Subclasses overriding `getActiveColumns` with `super` (hr_payroll, product,
  sale order lines) keep working; Studio's editor renderer has no layout state.
- Duplicated arch fields (e.g. CRM `date_deadline`, `company_id`): only the first
  occurrence that is not `column_invisible` is eligible.
