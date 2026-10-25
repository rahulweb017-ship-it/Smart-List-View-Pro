# Smart List View Pro (Odoo 19)

Save personal list layouts and publish team presets without modifying business records.

**Status: Milestone E (release candidate, not yet published).** The "Layouts" panel edits the columns
of the current list (show/hide, move up/down, width 80–600 px) and saves them
as named layouts: save as new, save changes, apply, rename, duplicate, delete,
and — for layout administrators — publish to / unpublish from "Shared layouts".
Reset always returns to native Odoo columns without deleting anything.
A layout is applied when you choose it; it is not re-applied automatically
after a reload (automatic defaults are a planned P1 feature).

## Column editor
- Offers only plain field columns the current view already renders for this
  user. Buttons, widgets, the drag handle, property columns and columns hidden
  by `column_invisible` stay under Odoo's control; a layout never adds a column.
- At least one column always stays visible.
- While a layout is active, the native "optional columns" menu is hidden so
  there is a single column control; **Reset** brings native behaviour back.
- Widths use Odoo's own column width mechanism (like `width="…"` in the arch):
  when every visible column has a fixed width and the list is wider than their
  sum, Odoo spreads the remaining space over them.
- Not editable while the list is grouped (a notice is shown).

## Supported
- Odoo 19 Community / Enterprise, self-hosted or Odoo.sh. Not Odoo Online.
  Verified on Odoo 19.0+e (Enterprise, self-hosted); Community not yet tested.
- Top-level list views opened from a window action.

## Install
1. Copy `smart_list_view_pro` into a directory of your `addons_path`.
2. Restart Odoo, update the Apps list, install **Smart List View Pro**.
3. Open any list (e.g. Contacts, CRM, Sales) and click **Layouts**.

Settings administrators are layout administrators automatically; give the
"Smart List Layouts Administrator" group to other users who should publish
shared layouts.

Uninstalling removes the saved layouts (the `smart.list.preset` table) and
nothing else.

## Keyboard
- Every action is a button reachable with Tab; columns move with the up/down
  buttons (no drag-and-drop needed), and focus follows the moved row.
- Enter saves the name form; Escape cancels it, a second Escape closes the
  panel and returns focus to the **Layouts** button.

## Troubleshooting
- *No Layouts button*: the list is inside a dialog, an x2many field or a
  client action, or rows are selected (the selection actions take the place).
- *"N column(s) … were skipped"*: the view no longer shows those columns, or
  you are not allowed to read them; save the layout again to clean it up.
- *"No longer applicable"*: none of the layout's visible columns remain.
- *Widths look wider than set*: when every visible column has a fixed width,
  Odoo spreads the free space over them (standard list behaviour).

## Not shown on
- Lists opened in dialogs (e.g. "Search more…"), x2many sub-lists,
  client actions embedding a list, non-list views.

## Permissions
| Actor | Read own | Read shared | Create personal | Edit/delete own | Manage shared |
|---|---|---|---|---|---|
| Internal user | Yes | Yes | Yes | Yes | No |
| Smart List Layouts Administrator (implied by Settings admin) | Yes | Yes | Yes | Yes | Yes |
| Portal / public | No | No | No | No | No |

Shared layouts are published as separate records and unpublished by archiving;
a layout's owner, visibility and target list never change after creation.
Duplicating a layout always creates a personal copy for the current user,
keeping only the columns that user may read. Layout names are unique per list
(per owner for personal layouts).

## Saved layouts
- **Saved for one list**: model + list view + window action. A Sales Order
  layout never shows up in CRM, nor in another action on the same model.
- **Resilient**: columns removed from the view, or not readable by the current
  user, are skipped with a warning; a layout with no remaining visible column is
  shown as "no longer applicable".

## Development
```
odoo-bin -c odoo.conf --addons-path=<odoo>/addons,<this repo> -d <dev_db> \
    -i smart_list_view_pro --stop-after-init --test-enable --test-tags /smart_list_view_pro
```
JS unit tests: open `/web/tests?filter=smart_list_view_pro` while logged in as admin
(the headless run needs the `websocket-client` Python package).

## Support
Softdeviser · rahul@softdeviser.com · https://softdeviser.com

This release supports Odoo 19.0 (self-hosted and Odoo.sh). Odoo Online is not
supported. Custom views and third-party list widgets are outside the scope of
support.
