import { describe, expect, test } from "@odoo/hoot";
import { animationFrame } from "@odoo/hoot-mock";
import { press, queryAll, queryFirst } from "@odoo/hoot-dom";
import {
    contains,
    defineModels,
    fields,
    models,
    mountView,
    MockServer,
    mountViewInDialog,
    onRpc,
    webModels,
} from "@web/../tests/web_test_helpers";
import {
    arrangeColumns,
    clampWidth,
    computeViewKey,
    getEligibleColumns,
    mergeLayout,
    moveColumn,
    setColumnVisible,
    setColumnWidth,
} from "@smart_list_view_pro/js/column_layout";

describe.current.tags("desktop");

class Foo extends models.Model {
    name = fields.Char();
    amount = fields.Integer();
    note = fields.Char();
    secret = fields.Char();

    _records = [
        { id: 1, name: "b", amount: 10, note: "x" },
        { id: 2, name: "a", amount: 20, note: "y" },
    ];
}

/** Minimal stand-in for the server model; access rules are tested in Python. */
class SmartListPreset extends models.Model {
    _name = "smart.list.preset";

    name = fields.Char();
    visibility = fields.Selection({
        selection: [
            ["personal", "Personal"],
            ["shared", "Shared"],
        ],
        default: "personal",
    });
    model_name = fields.Char();
    view_ref = fields.Integer();
    action_ref = fields.Integer();
    layout_json = fields.Text();
    active = fields.Boolean({ default: true });
    owned = fields.Boolean({ default: true });

    // View isolation is covered by the Python tests; mock views get generated ids.
    get_presets_for_list(modelName, viewRef, actionRef) {
        return this.search_read([
            ["model_name", "=", modelName],
            ["action_ref", "=", actionRef],
        ]).map((preset) => ({
            id: preset.id,
            name: preset.name,
            visibility: preset.visibility,
            is_owner: preset.owned,
            columns: JSON.parse(preset.layout_json).columns,
            skipped: 0,
            valid: true,
        }));
    }
}

const { ResCompany, ResPartner, ResUsers } = webModels;

defineModels([Foo, SmartListPreset, ResCompany, ResPartner, ResUsers]);

function presetRecord(id, name, columns, extra = {}) {
    return {
        id,
        name,
        model_name: "foo",
        view_ref: 0,
        action_ref: 7,
        layout_json: JSON.stringify({ schema_version: 1, columns }),
        ...extra,
    };
}

/** Presets as currently stored by the mock server (archived ones included). */
function serverPresets() {
    return MockServer.env["smart.list.preset"].search_read([["active", "in", [true, false]]]);
}

function presetItem(name) {
    return `.o_smart_list_preset:has(.o_smart_list_apply:contains(${name}))`;
}

const ACTION_CONFIG = { actionId: 7, actionType: "ir.actions.act_window" };
const ARCH = `<list><field name="name"/><field name="amount"/></list>`;
const RICH_ARCH = `
    <list>
        <field name="name"/>
        <button name="do_it" type="object" string="Do it"/>
        <field name="amount"/>
        <field name="note" optional="hide"/>
        <field name="secret" column_invisible="1"/>
    </list>`;

function headerNames() {
    return queryAll(".o_list_table thead th[data-name], .o_list_table thead th.o_list_button").map(
        (th) => th.dataset.name || "button"
    );
}

function panelFields() {
    return queryAll(".o_smart_list_column").map((li) => li.dataset.field);
}

async function openPanel(arch = RICH_ARCH, params = {}) {
    await mountView({ resModel: "foo", type: "list", arch, config: ACTION_CONFIG, ...params });
    await contains(".o_smart_list_layouts_button").click();
}

test("Layouts button opens the List layouts panel on a top-level list", async () => {
    await mountView({ resModel: "foo", type: "list", arch: ARCH, config: ACTION_CONFIG });
    expect(".o_smart_list_layouts_button").toHaveCount(1);
    await contains(".o_smart_list_layouts_button").click();
    expect(".o_smart_list_panel").toHaveCount(1);
    expect(".o_smart_list_panel h5").toHaveText("List layouts");
    expect(".o_smart_list_section_personal").toHaveCount(1);
    expect(".o_smart_list_section_shared").toHaveCount(1);
    await contains(".o_smart_list_panel .btn-close").click();
    expect(".o_smart_list_panel").toHaveCount(0);
});

test("native sorting still works with the Layouts control present", async () => {
    await mountView({ resModel: "foo", type: "list", arch: ARCH, config: ACTION_CONFIG });
    expect(".o_data_row:first .o_data_cell[name=name]").toHaveText("b");
    await contains("th[data-name=name]").click();
    expect(".o_data_row:first .o_data_cell[name=name]").toHaveText("a");
});

test("no Layouts button outside a window action", async () => {
    await mountView({ resModel: "foo", type: "list", arch: ARCH });
    expect(".o_smart_list_layouts_button").toHaveCount(0);
});

test("no Layouts button in a list opened inside a dialog", async () => {
    await mountViewInDialog({ resModel: "foo", type: "list", arch: ARCH, config: ACTION_CONFIG });
    expect(".modal .o_list_view").toHaveCount(1);
    expect(".o_smart_list_layouts_button").toHaveCount(0);
});

test("grouped list shows a notice instead of the column editor", async () => {
    await openPanel(ARCH, { groupBy: ["name"] });
    expect(".o_smart_list_grouped_notice").toHaveCount(1);
    expect(".o_smart_list_editor").toHaveCount(0);
});

test("editor lists eligible view columns only, with native visibility", async () => {
    await openPanel();
    // No button, no column_invisible column, never a field outside the arch.
    expect(panelFields()).toEqual(["name", "amount", "note"]);
    expect(".o_smart_list_column[data-field=name] label").toHaveText("Name");
    expect(".o_smart_list_column[data-field=name] input[type=checkbox]").toBeChecked();
    expect(".o_smart_list_column[data-field=note] input[type=checkbox]").not.toBeChecked();
    expect(".o_smart_list_modified_notice").toHaveCount(0);
});

test("hiding, showing and resetting columns updates the live list", async () => {
    await openPanel();
    expect(headerNames()).toEqual(["name", "button", "amount"]);
    expect(".o_optional_columns_dropdown").toHaveCount(1);

    await contains(".o_smart_list_column[data-field=amount] input[type=checkbox]").click();
    // The button stays next to the column that precedes it in the arch.
    expect(headerNames()).toEqual(["name", "button"]);
    expect(".o_smart_list_modified_notice").toHaveCount(1);
    expect(".o_smart_list_layouts_button .o_smart_list_modified_dot").toHaveCount(1);
    // The panel is the single column control while a layout is active.
    expect(".o_optional_columns_dropdown").toHaveCount(0);

    await contains(".o_smart_list_column[data-field=note] input[type=checkbox]").click();
    expect(headerNames()).toEqual(["name", "button", "note"]);

    await contains(".o_smart_list_reset").click();
    expect(headerNames()).toEqual(["name", "button", "amount"]);
    expect(".o_smart_list_modified_notice").toHaveCount(0);
    expect(".o_optional_columns_dropdown").toHaveCount(1);
});

test("the last visible column cannot be hidden", async () => {
    await openPanel(ARCH);
    await contains(".o_smart_list_column[data-field=amount] input[type=checkbox]").click();
    expect(".o_smart_list_column[data-field=name] input[type=checkbox]").toBeChecked();
    expect(".o_smart_list_column[data-field=name] input[type=checkbox]").toHaveAttribute("disabled");
    expect(headerNames()).toEqual(["name"]);
});

test("moving columns reorders the list and keeps focus on the moved row", async () => {
    await openPanel(ARCH);
    expect(".o_smart_list_column[data-field=name] .o_smart_list_move_up").toHaveAttribute("disabled");
    await contains(".o_smart_list_column[data-field=name] .o_smart_list_move_down").click();
    expect(panelFields()).toEqual(["amount", "name"]);
    expect(headerNames()).toEqual(["amount", "name"]);
    // Down is now disabled for the last row: focus falls back to its Up button.
    expect(".o_smart_list_column[data-field=name] .o_smart_list_move_up").toBeFocused();
    await contains(".o_smart_list_column[data-field=name] .o_smart_list_move_up").click();
    expect(headerNames()).toEqual(["name", "amount"]);

    // Native sorting, rows and record data are untouched by the layout.
    await contains("th[data-name=name]").click();
    expect(".o_data_row:first .o_data_cell[name=name]").toHaveText("a");
    expect(".o_data_row").toHaveCount(2);
});

test("column widths are clamped and applied to the header", async () => {
    // A flexible column takes the remaining space; when every visible column is
    // fixed, Odoo's width algorithm spreads it over all of them (as for arch widths).
    await openPanel(`<list><field name="name"/><field name="amount"/><field name="note"/></list>`);
    await contains(".o_smart_list_column[data-field=name] .o_smart_list_width").edit("5000");
    expect(".o_smart_list_column[data-field=name] .o_smart_list_width").toHaveValue(600);
    // Rendered width = layout width + the cell's horizontal paddings.
    expect(parseInt(queryFirst("th[data-name=name]").style.width)).toBeGreaterThan(599);
    expect(parseInt(queryFirst("th[data-name=name]").style.width)).toBeLessThan(640);

    await contains(".o_smart_list_column[data-field=name] .o_smart_list_width").edit("10");
    expect(".o_smart_list_column[data-field=name] .o_smart_list_width").toHaveValue(80);

    await contains(".o_smart_list_column[data-field=name] .o_smart_list_width").clear();
    expect(queryFirst(".o_smart_list_column[data-field=name] .o_smart_list_width").value).toBe("");
});

test("column_layout helpers", () => {
    expect(clampWidth(10)).toBe(80);
    expect(clampWidth(9999)).toBe(600);
    expect(clampWidth(150.4)).toBe(150);
    expect(clampWidth(NaN)).toBe(null);
    expect(clampWidth("120")).toBe(null);
    expect(computeViewKey({ resModel: "crm.lead", viewId: 12, actionId: 3 })).toBe(
        "crm.lead|view:12|action:3"
    );
    expect(computeViewKey({ resModel: "crm.lead", viewId: false, actionId: false })).toBe(
        "crm.lead|view:0|action:0"
    );
});

test("getEligibleColumns keeps plain, visible, first-occurrence field columns", () => {
    const columns = [
        { id: "c1", type: "field", name: "sequence", widget: "handle" },
        { id: "c2", type: "field", name: "name" },
        { id: "c3", type: "button_group" },
        { id: "c4", type: "field", name: "name" },
        { id: "c5", type: "field", name: "props", fieldType: "properties" },
        { id: "c6", type: "field", name: "props.x", relatedPropertyField: {} },
        { id: "c7", type: "field", name: "hidden", column_invisible: "1" },
        { id: "c8", type: "widget", name: "w" },
        { id: "c9", type: "field", name: "amount" },
        { id: "c10", type: "field", name: "date", column_invisible: "1" },
        { id: "c11", type: "field", name: "date" },
    ];
    const eligible = getEligibleColumns(columns, (col) => col.column_invisible === "1");
    expect(eligible.map((col) => col.id)).toEqual(["c2", "c9", "c11"]);
});

test("mergeLayout drops unknown fields and appends new ones", () => {
    const available = [
        { field: "name", nativeVisible: true },
        { field: "email", nativeVisible: false },
        { field: "phone", nativeVisible: true },
    ];
    const { columns, skipped } = mergeLayout(
        [
            { field: "phone", visible: false, width: 9999 },
            { field: "gone", visible: true },
            { field: "name", visible: true, width: 150 },
            { field: "name", visible: false },
        ],
        available
    );
    expect(skipped).toBe(2);
    expect(columns).toEqual([
        { field: "phone", visible: false, width: 600 },
        { field: "name", visible: true, width: 150 },
        { field: "email", visible: false },
    ]);
});

test("layout editing helpers are immutable and guard the last column", () => {
    const layout = [
        { field: "a", visible: true },
        { field: "b", visible: false, width: 100 },
    ];
    expect(moveColumn(layout, 0, 1).map((c) => c.field)).toEqual(["b", "a"]);
    expect(moveColumn(layout, 0, -1)).toBe(layout);
    expect(setColumnVisible(layout, "a", false)).toBe(layout);
    expect(setColumnVisible(layout, "b", true)[1].visible).toBe(true);
    expect(setColumnWidth(layout, "a", 50)[0].width).toBe(80);
    expect(setColumnWidth(layout, "b", null)[1]).toEqual({ field: "b", visible: false });
    expect(layout[1].width).toBe(100);
});

test("arrangeColumns reorders eligible columns and anchors the others", () => {
    const col = (id, name) => ({ id, name, type: name ? "field" : "button_group" });
    const handle = col("h");
    const name = col("n", "name");
    const button = col("b");
    const amount = col("a", "amount");
    const note = col("o", "note");
    const candidates = [handle, name, button, amount, note];
    const native = new Set(["h", "n", "b", "a"]);
    const eligible = new Set(["n", "a", "o"]);
    const ids = (layout) =>
        arrangeColumns(candidates, native, eligible, layout, (c, w) => ({ ...c, w })).map(
            (c) => c.id + (c.w ? `:${c.w}` : "")
        );

    expect(
        ids([
            { field: "amount", visible: true },
            { field: "name", visible: true, width: 200 },
        ])
    ).toEqual(["h", "a", "n:200", "b"]);
    // Anchor hidden and no shown column before it: the button moves to the front.
    expect(
        ids([
            { field: "name", visible: false },
            { field: "note", visible: true },
            { field: "amount", visible: true },
        ])
    ).toEqual(["h", "b", "o", "a"]);
});

test("save as new layout, reset, apply it again", async () => {
    await openPanel(ARCH);
    expect(".o_smart_list_empty").toHaveCount(1);
    await contains(".o_smart_list_column[data-field=amount] input[type=checkbox]").click();
    await contains(".o_smart_list_save_new").click();
    expect(".o_smart_list_name_input").toBeFocused();
    await contains(".o_smart_list_name_input").edit("Follow-ups", { confirm: false });
    await contains(".o_smart_list_form_save").click();

    const [saved] = serverPresets().filter((r) => r.name === "Follow-ups");
    expect(saved.model_name).toBe("foo");
    expect(saved.action_ref).toBe(7);
    expect(saved.visibility).toBe("personal");
    expect(JSON.parse(saved.layout_json)).toEqual({
        schema_version: 1,
        columns: [
            { field: "name", visible: true },
            { field: "amount", visible: false },
        ],
    });
    expect(`${presetItem("Follow-ups")} .o_smart_list_applied_badge`).toHaveCount(1);
    expect(".o_smart_list_applied_notice").toHaveCount(1);
    expect(".o_smart_list_modified_notice").toHaveCount(0);
    expect(".o_smart_list_layouts_button .o_smart_list_modified_dot").toHaveCount(0);

    await contains(".o_smart_list_reset").click();
    expect(headerNames()).toEqual(["name", "amount"]);
    expect(".o_smart_list_applied_badge").toHaveCount(0);
    // Reset never deletes saved layouts.
    expect(presetItem("Follow-ups")).toHaveCount(1);

    await contains(`${presetItem("Follow-ups")} .o_smart_list_apply`).click();
    expect(headerNames()).toEqual(["name"]);
    expect(".o_smart_list_applied_notice").toHaveCount(1);
});

test("changes to an applied layout can be saved back to it", async () => {
    SmartListPreset._records = [
        presetRecord(1, "Mine", [
            { field: "amount", visible: true, width: 120 },
            { field: "name", visible: true },
        ]),
    ];
    await openPanel(ARCH);
    await contains(`${presetItem("Mine")} .o_smart_list_apply`).click();
    expect(headerNames()).toEqual(["amount", "name"]);
    expect(".o_smart_list_column[data-field=amount] .o_smart_list_width").toHaveValue(120);

    await contains(".o_smart_list_column[data-field=name] .o_smart_list_move_up").click();
    expect(".o_smart_list_modified_notice").toHaveCount(1);
    expect(".o_smart_list_layouts_button .o_smart_list_modified_dot").toHaveCount(1);
    await contains(".o_smart_list_update").click();
    expect(JSON.parse(serverPresets()[0].layout_json).columns).toEqual([
        { field: "name", visible: true },
        { field: "amount", visible: true, width: 120 },
    ]);
    expect(".o_smart_list_modified_notice").toHaveCount(0);
    expect(".o_smart_list_applied_notice").toHaveCount(1);
});

test("rename and delete a personal layout", async () => {
    SmartListPreset._records = [presetRecord(1, "Mine", [{ field: "name", visible: true }])];
    await openPanel(ARCH);
    await contains(`${presetItem("Mine")} .o_smart_list_rename`).click();
    expect(".o_smart_list_preset .o_smart_list_name_input").toBeFocused();
    // Enter submits the form.
    await contains(".o_smart_list_preset .o_smart_list_name_input").edit("Renamed");
    expect(serverPresets()[0].name).toBe("Renamed");
    expect(presetItem("Renamed")).toHaveCount(1);

    await contains(`${presetItem("Renamed")} .o_smart_list_delete`).click();
    // Asks first; cancelling keeps it.
    await contains(".o_smart_list_cancel_delete").click();
    expect(presetItem("Renamed")).toHaveCount(1);
    await contains(`${presetItem("Renamed")} .o_smart_list_delete`).click();
    await contains(".o_smart_list_confirm_delete").click();
    expect(serverPresets()).toHaveLength(0);
    expect(".o_smart_list_empty").toHaveCount(1);
});

test("employees see shared layouts read-only and no publish action", async () => {
    onRpc("has_group", () => false);
    SmartListPreset._records = [
        presetRecord(1, "Mine", [{ field: "name", visible: true }]),
        presetRecord(2, "Team", [{ field: "amount", visible: true }], {
            visibility: "shared",
            owned: false,
        }),
    ];
    await openPanel(ARCH);
    expect(".o_smart_list_section_personal .o_smart_list_preset").toHaveCount(1);
    expect(".o_smart_list_section_shared .o_smart_list_preset").toHaveCount(1);
    expect(`${presetItem("Team")} .o_smart_list_rename`).toHaveCount(0);
    expect(`${presetItem("Team")} .o_smart_list_unpublish`).toHaveCount(0);
    expect(`${presetItem("Team")} .o_smart_list_delete`).toHaveCount(0);
    expect(`${presetItem("Team")} .o_smart_list_duplicate`).toHaveCount(1);
    expect(".o_smart_list_publish").toHaveCount(0);
    expect(`${presetItem("Mine")} .o_smart_list_delete`).toHaveCount(1);

    await contains(`${presetItem("Team")} .o_smart_list_apply`).click();
    expect(headerNames()).toEqual(["amount", "name"]);
    // Changing a shared layout cannot be saved back by an employee.
    await contains(".o_smart_list_column[data-field=name] input[type=checkbox]").click();
    expect(".o_smart_list_modified_notice").toHaveCount(1);
    expect(".o_smart_list_update").toHaveCount(0);
});

test("layout administrators get publish and unpublish actions", async () => {
    SmartListPreset._records = [
        presetRecord(1, "Mine", [{ field: "name", visible: true }]),
        presetRecord(2, "Team", [{ field: "amount", visible: true }], {
            visibility: "shared",
            owned: false,
        }),
    ];
    await openPanel(ARCH);
    await contains(`${presetItem("Mine")} .o_smart_list_publish`).click();
    const shared = serverPresets().filter((r) => r.visibility === "shared");
    expect(shared.map((r) => r.name)).toEqual(["Team", "Mine"]);
    expect(".o_smart_list_section_shared .o_smart_list_preset").toHaveCount(2);

    await contains(`.o_smart_list_section_shared ${presetItem("Team")} .o_smart_list_unpublish`).click();
    expect(serverPresets().find((r) => r.id === 2).active).toBe(false);
    expect(".o_smart_list_section_shared .o_smart_list_preset").toHaveCount(1);
});

test("columns no longer in the view are skipped with a warning", async () => {
    SmartListPreset._records = [
        presetRecord(1, "Old", [
            { field: "gone", visible: true },
            { field: "amount", visible: true },
        ]),
    ];
    await openPanel(ARCH);
    await contains(`${presetItem("Old")} .o_smart_list_apply`).click();
    await animationFrame();
    expect(headerNames()).toEqual(["amount", "name"]);
    expect(".o_notification:contains(no longer available)").toHaveCount(1);
});

test("keyboard: Escape cancels the name form first, then closes the panel", async () => {
    await openPanel(ARCH);
    expect(".o_smart_list_column[data-field=name] input[type=checkbox]").toBeFocused();
    await contains(".o_smart_list_save_new").click();
    expect(".o_smart_list_name_input").toBeFocused();
    await press("Escape");
    await animationFrame();
    expect(".o_smart_list_name_form").toHaveCount(0);
    expect(".o_smart_list_panel").toHaveCount(1);
    expect(".o_smart_list_save_new").toBeFocused();
    await press("Escape");
    await animationFrame();
    expect(".o_smart_list_panel").toHaveCount(0);
    expect(".o_smart_list_layouts_button").toBeFocused();
});

test("keyboard: focus stays on a sensible control around delete and rename", async () => {
    SmartListPreset._records = [presetRecord(1, "Mine", [{ field: "name", visible: true }])];
    await openPanel(ARCH);
    await contains(`${presetItem("Mine")} .o_smart_list_delete`).click();
    expect(".o_smart_list_cancel_delete").toBeFocused();
    await contains(".o_smart_list_cancel_delete").click();
    expect(`${presetItem("Mine")} .o_smart_list_delete`).toBeFocused();

    await contains(`${presetItem("Mine")} .o_smart_list_rename`).click();
    await contains(".o_smart_list_preset .o_smart_list_form_cancel").click();
    expect(`${presetItem("Mine")} .o_smart_list_rename`).toBeFocused();

    await contains(`${presetItem("Mine")} .o_smart_list_duplicate`).click();
    expect(".o_smart_list_section_personal .o_smart_list_preset").toHaveCount(2);
    expect(`.o_smart_list_preset[data-preset-id="1"] .o_smart_list_duplicate`).toBeFocused();

    await contains(`.o_smart_list_preset[data-preset-id="1"] .o_smart_list_delete`).click();
    await contains(".o_smart_list_confirm_delete").click();
    expect(".o_smart_list_save_new").toBeFocused();
});

test("the locked last column explains why it cannot be hidden", async () => {
    await openPanel(ARCH);
    await contains(".o_smart_list_column[data-field=amount] input[type=checkbox]").click();
    expect(".o_smart_list_column[data-field=name] input[type=checkbox]").toHaveAttribute(
        "title",
        "At least one column must stay visible."
    );
    expect(".o_smart_list_column[data-field=amount] input[type=checkbox]").not.toHaveAttribute(
        "title"
    );
});
