import { registry } from "@web/core/registry";

/**
 * Real-browser smoke check on an actual backend list: the Layouts control
 * works, a layout can be edited and reset on the real columns, and native
 * list behaviour (sort, pager, selection, record links) is unaffected.
 *
 * @param {Object} fields `second` natively follows `first`; `resize` is shown
 */
function listLayoutsSteps({ first, second, resize }) {
    const row = (field) => `.o_smart_list_column[data-field=${field}]`;
    const nativeOrder = `thead th[data-name=${first}] + th[data-name=${second}]`;
    return [
        { trigger: ".o_switch_view.o_list", run: "click" },
        { trigger: ".o_list_view .o_data_row" },
        // Layouts control and panel.
        { trigger: ".o_control_panel .o_smart_list_layouts_button", run: "click" },
        { trigger: ".o_smart_list_panel h5:contains(List layouts)" },
        { trigger: ".o_smart_list_panel .o_smart_list_section_personal" },
        // Edit the layout of the real list: move, hide, resize, then reset.
        { trigger: nativeOrder },
        { trigger: `${row(second)} .o_smart_list_move_up`, run: "click" },
        { trigger: `thead th[data-name=${second}] + th[data-name=${first}]` },
        { trigger: ".o_smart_list_modified_notice" },
        { trigger: `${row(first)} input[type=checkbox]`, run: "click" },
        { trigger: `thead:not(:has(th[data-name=${first}]))` },
        { trigger: `${row(resize)} .o_smart_list_width`, run: "edit 300 && press Enter" },
        { trigger: `thead th[data-name=${resize}][style*="width: 3"]` },
        { trigger: ".o_smart_list_reset", run: "click" },
        { trigger: nativeOrder },
        { trigger: ".o_smart_list_panel:not(:has(.o_smart_list_modified_notice))" },
        { trigger: ".o_smart_list_panel .btn-close", run: "click" },
        { trigger: "body:not(:has(.o_smart_list_panel))" },
        // Native sorting, both directions.
        { trigger: "thead th.o_column_sortable[data-name]:first", run: "click" },
        { trigger: "thead .o_list_sortable_icon.fa-sort-asc, thead .o_list_sortable_icon.fa-sort-desc" },
        {
            trigger: "thead th.o_column_sortable[data-name]:has(.fa-sort-asc, .fa-sort-desc)",
            run: "click",
        },
        { trigger: "thead .o_list_sortable_icon.fa-sort-asc, thead .o_list_sortable_icon.fa-sort-desc" },
        // Native pager.
        { trigger: ".o_pager_next:enabled", run: "click" },
        { trigger: ".o_pager_value:contains(81-)" },
        { trigger: ".o_pager_previous:enabled", run: "click" },
        { trigger: ".o_pager_value:contains(1-80)" },
        // Selection: the control yields its place to native selection actions.
        { trigger: ".o_data_row:first .o_list_record_selector input", run: "click" },
        { trigger: ".o_selection_box" },
        { trigger: ".o_control_panel:not(:has(.o_smart_list_layouts_button))" },
        { trigger: ".o_data_row:first .o_list_record_selector input", run: "click" },
        { trigger: ".o_control_panel .o_smart_list_layouts_button" },
        // Record navigation and back.
        { trigger: ".o_data_row:first td.o_data_cell:first", run: "click" },
        { trigger: ".o_form_view" },
        { trigger: ".o_back_button", run: "click" },
        { trigger: ".o_list_view .o_control_panel .o_smart_list_layouts_button" },
    ];
}

registry.category("web_tour.tours").add("smart_list_view_pro_contacts", {
    url: "/odoo/action-contacts.action_contacts",
    steps: () => listLayoutsSteps({ first: "email", second: "phone", resize: "display_name" }),
});

registry.category("web_tour.tours").add("smart_list_view_pro_crm", {
    url: "/odoo/action-crm.crm_lead_action_pipeline",
    steps: () => listLayoutsSteps({ first: "contact_name", second: "email_from", resize: "name" }),
});

registry.category("web_tour.tours").add("smart_list_view_pro_sale", {
    url: "/odoo/action-sale.action_quotations_with_onboarding",
    steps: () => listLayoutsSteps({ first: "partner_id", second: "user_id", resize: "name" }),
});

const personal = ".o_smart_list_section_personal";
const shared = ".o_smart_list_section_shared";

/** Layout administrator: save, apply, rename, duplicate, delete, publish. */
registry.category("web_tour.tours").add("smart_list_view_pro_presets_admin", {
    url: "/odoo/action-contacts.action_contacts",
    steps: () => [
        { trigger: ".o_switch_view.o_list", run: "click" },
        { trigger: ".o_list_view .o_data_row" },
        { trigger: ".o_control_panel .o_smart_list_layouts_button", run: "click" },
        { trigger: `${personal} .o_smart_list_empty` },
        // Save the current changes as a new personal layout.
        { trigger: ".o_smart_list_column[data-field=email] input[type=checkbox]", run: "click" },
        { trigger: "thead:not(:has(th[data-name=email]))" },
        { trigger: ".o_smart_list_save_new", run: "click" },
        { trigger: ".o_smart_list_name_form .o_smart_list_name_input", run: "edit SLV Follow-ups" },
        { trigger: ".o_smart_list_name_form .o_smart_list_form_save", run: "click" },
        { trigger: `${personal} .o_smart_list_preset:has(.o_smart_list_applied_badge) .o_smart_list_apply:contains(SLV Follow-ups)` },
        // Reset keeps the saved layout; applying it brings the columns back.
        { trigger: ".o_smart_list_reset", run: "click" },
        { trigger: "thead th[data-name=email]" },
        { trigger: `${personal} .o_smart_list_apply:contains(SLV Follow-ups)`, run: "click" },
        { trigger: "thead:not(:has(th[data-name=email]))" },
        { trigger: ".o_smart_list_applied_notice" },
        // Rename.
        { trigger: `${personal} .o_smart_list_rename`, run: "click" },
        { trigger: `${personal} .o_smart_list_name_input`, run: "edit SLV Calls" },
        { trigger: `${personal} .o_smart_list_form_save`, run: "click" },
        { trigger: `${personal} .o_smart_list_apply:contains(SLV Calls)` },
        // Duplicate, then delete the copy.
        { trigger: `${personal} .o_smart_list_duplicate`, run: "click" },
        { trigger: `${personal} .o_smart_list_apply:contains(copy)` },
        { trigger: `${personal} .o_smart_list_preset:has(.o_smart_list_apply:contains(copy)) .o_smart_list_delete`, run: "click" },
        { trigger: `${personal} .o_smart_list_confirm_delete`, run: "click" },
        { trigger: `${personal}:not(:has(.o_smart_list_apply:contains(copy)))` },
        // Publish, unpublish, publish again.
        { trigger: `${shared} .o_smart_list_shared_empty` },
        { trigger: `${personal} .o_smart_list_publish`, run: "click" },
        { trigger: `${shared} .o_smart_list_apply:contains(SLV Calls)` },
        { trigger: `${shared} .o_smart_list_unpublish`, run: "click" },
        { trigger: `${shared} .o_smart_list_shared_empty` },
        { trigger: `${personal} .o_smart_list_publish`, run: "click" },
        { trigger: `${shared} .o_smart_list_apply:contains(SLV Calls)` },
        { trigger: ".o_smart_list_panel .btn-close", run: "click" },
        { trigger: "body:not(:has(.o_smart_list_panel))" },
    ],
});

/** Internal user: sees and applies the shared layout, can only copy it. */
registry.category("web_tour.tours").add("smart_list_view_pro_presets_employee", {
    url: "/odoo/action-contacts.action_contacts",
    steps: () => [
        { trigger: ".o_switch_view.o_list", run: "click" },
        { trigger: ".o_list_view .o_data_row" },
        { trigger: ".o_control_panel .o_smart_list_layouts_button", run: "click" },
        // The administrator's personal layout is not visible to others.
        { trigger: `${personal} .o_smart_list_empty` },
        { trigger: `${shared} .o_smart_list_apply:contains(SLV Calls)` },
        {
            trigger: `${shared} .o_smart_list_preset:not(:has(.o_smart_list_rename, .o_smart_list_unpublish, .o_smart_list_delete))`,
        },
        { trigger: ".o_smart_list_panel:not(:has(.o_smart_list_publish))" },
        { trigger: "thead th[data-name=email]" },
        { trigger: `${shared} .o_smart_list_apply:contains(SLV Calls)`, run: "click" },
        { trigger: "thead:not(:has(th[data-name=email]))" },
        // Changing it cannot be saved back, but a personal copy can be made.
        { trigger: ".o_smart_list_column[data-field=phone] input[type=checkbox]", run: "click" },
        { trigger: ".o_smart_list_modified_notice:not(:has(.o_smart_list_update))" },
        { trigger: `${shared} .o_smart_list_duplicate`, run: "click" },
        { trigger: `${personal} .o_smart_list_apply:contains(SLV Calls)` },
        { trigger: ".o_smart_list_panel .btn-close", run: "click" },
        { trigger: "body:not(:has(.o_smart_list_panel))" },
    ],
});
