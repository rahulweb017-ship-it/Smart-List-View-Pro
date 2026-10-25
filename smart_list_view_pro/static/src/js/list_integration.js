/** @odoo-module **/

import { markRaw, reactive, useEffect, useState, useSubEnv } from "@odoo/owl";
import { evaluateBooleanExpr } from "@web/core/py_js/py";
import { patch } from "@web/core/utils/patch";
import { ListController } from "@web/views/list/list_controller";
import { ListRenderer } from "@web/views/list/list_renderer";
import { arrangeColumns, getEligibleColumns } from "./column_layout";
import { SmartLayoutsButton } from "./layout_button";

// Odoo 17: narrowest width other columns are squeezed to when a layout widens one.
const SMART_MIN_FLEX_WIDTH = 60;

/**
 * Controller side: decides whether the Layouts control applies, owns the
 * (UI-only) layout state of this list and shares it with its renderer via
 * the env. The template renders the button through `t-component` so that the
 * many ListController subclasses (which copy `static components` at import
 * time) need no registration.
 */
patch(ListController.prototype, {
    setup() {
        super.setup(...arguments);
        this.smartLayout = null;
        if (this.smartLayoutsEligible) {
            // `columns: null` means native Odoo behaviour.
            this.smartLayout = reactive({
                resModel: this.props.resModel,
                columns: null,
                applied: null, // { id, name, columns } of the last applied or saved layout
            });
            // Odoo 17: the renderer, not the controller, knows the active optional columns.
            this.smartHooks = markRaw({ getOptionalActiveFields: null });
            useSubEnv({ smartListLayout: this.smartLayout, smartListHooks: this.smartHooks });
            this.getSmartLayoutColumns = this.getSmartLayoutColumns.bind(this);
        }
    },

    get smartLayoutsEligible() {
        const config = this.env.config || {};
        return Boolean(
            !this.env.inDialog &&
                this.props.showButtons &&
                config.actionType === "ir.actions.act_window" &&
                config.viewType === "list"
        );
    },

    get smartLayouts() {
        if (!this.smartLayout) {
            return null;
        }
        const config = this.env.config;
        return {
            Component: SmartLayoutsButton,
            props: {
                resModel: this.props.resModel,
                viewId: config.viewId || false,
                actionId: config.actionId || false,
                isGrouped: Boolean(this.model.root?.isGrouped),
                layout: this.smartLayout,
                getColumns: this.getSmartLayoutColumns,
            },
        };
    },

    /**
     * Columns the user may arrange, with the labels this user's view renders.
     * Only columns of the current arch are offered: the server already strips
     * fields the user cannot access from it.
     */
    getSmartLayoutColumns() {
        const evalContext = this.model.root.evalContext;
        const optional = this.smartHooks.getOptionalActiveFields?.() || {};
        const columns = getEligibleColumns(this.props.archInfo.columns, (column) =>
            evaluateBooleanExpr(column.column_invisible, evalContext)
        );
        return columns.map((column) => ({
            field: column.name,
            label: column.label || this.props.fields[column.name]?.string || column.name,
            nativeVisible: !column.optional || Boolean(optional[column.name]),
        }));
    },
});

/**
 * Renderer side: when a layout is active, filter/reorder the columns the
 * renderer would show anyway and give resized ones a fixed width through the
 * standard `width` column attribute understood by the column width hook.
 * Without a layout (or outside an eligible controller) nothing changes.
 */
patch(ListRenderer.prototype, {
    setup() {
        super.setup(...arguments);
        const layout = this.env.smartListLayout;
        this.smartLayout =
            layout && layout.resModel === this.props.list.resModel ? useState(layout) : null;
        this.smartWidthCache = new Map();
        if (this.smartLayout) {
            this.env.smartListHooks.getOptionalActiveFields = () => this.optionalActiveFields;
            // Odoo 17 keeps the active columns in state: refresh them when the
            // layout changes, and let the widths be computed again.
            let mounted = false;
            useEffect(
                () => {
                    if (mounted) {
                        this.keepColumnWidths = false;
                        this.state.columns = this.getActiveColumns(this.props.list);
                    }
                    mounted = true;
                },
                () => [this.smartLayout.columns]
            );
        }
    },

    getActiveColumns() {
        const nativeColumns = super.getActiveColumns(...arguments);
        const layout = this.smartLayout?.columns;
        if (!layout) {
            return nativeColumns;
        }
        const isInvisible = (column) => this.evalColumnInvisible(column.column_invisible);
        const eligibleIds = new Set(
            getEligibleColumns(this.allColumns, isInvisible).map((column) => column.id)
        );
        const candidates = this.allColumns.filter((column) => !isInvisible(column));
        const nativeIds = new Set(nativeColumns.map((column) => column.id));
        return arrangeColumns(candidates, nativeIds, eligibleIds, layout, (column, width) =>
            this.smartColumnWithWidth(column, width)
        );
    },

    /** Stable copy of `column` with a fixed width (identity kept across renders). */
    smartColumnWithWidth(column, width) {
        const cached = this.smartWidthCache.get(column.id);
        if (cached && cached.source === column && cached.width === width) {
            return cached.column;
        }
        const copy = { ...column, smartWidth: width };
        this.smartWidthCache.set(column.id, { source: column, width, column: copy });
        return copy;
    },

    /** Odoo 17 only uses arch widths as a minimum: enforce the layout widths. */
    freezeColumnWidths() {
        super.freezeColumnWidths(...arguments);
        if (!this.smartLayout?.columns) {
            return;
        }
        const headers = [
            ...this.tableRef.el.querySelectorAll("thead th:not(.o_list_actions_header)"),
        ];
        const offset = this.hasSelectors ? 1 : 0;
        const cells = this.state.columns
            .map((column, index) => ({ column, th: headers[index + offset] }))
            .filter(({ th }) => th);
        const widthOf = (th) => parseFloat(th.style.width) || th.getBoundingClientRect().width;
        const fixed = cells.filter(({ column }) => column.smartWidth);
        const flexible = cells.filter(({ column }) => !column.smartWidth);
        // Keep the table as wide as Odoo made it: the other columns give (or
        // take) the difference, in proportion to their size.
        const delta = fixed.reduce((sum, { column, th }) => sum + column.smartWidth - widthOf(th), 0);
        const flexibleTotal = flexible.reduce((sum, { th }) => sum + widthOf(th), 0);
        fixed.forEach(({ column, th }) => (th.style.width = `${column.smartWidth}px`));
        if (!flexibleTotal || !delta) {
            return;
        }
        const ratio = delta / flexibleTotal;
        for (const { th } of flexible) {
            const width = widthOf(th);
            th.style.width = `${Math.max(SMART_MIN_FLEX_WIDTH, Math.floor(width * (1 - ratio)))}px`;
        }
    },

    get displayOptionalFields() {
        // While a layout is active the Layouts panel is the single column control;
        // Reset brings the native optional-columns menu back.
        return this.smartLayout?.columns ? false : super.displayOptionalFields;
    },
});
