import { onWillStart, proxy } from "@odoo/owl";
import { useLayoutEffect, useSubEnv } from "@web/owl2/utils";
import { evaluateBooleanExpr } from "@web/core/py_js/py";
import { patch } from "@web/core/utils/patch";
import { ListController } from "@web/views/list/list_controller";
import { ListRenderer } from "@web/views/list/list_renderer";
import { arrangeColumns, getEligibleColumns } from "./column_layout";
import { SmartLayoutsButton } from "./layout_button";

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
            this.smartLayout = proxy({
                resModel: this.props.resModel,
                columns: null,
                applied: null, // { id, name, columns } of the last applied or saved layout
            });
            useSubEnv({ smartListLayout: this.smartLayout });
            this.getSmartLayoutColumns = this.getSmartLayoutColumns.bind(this);
            // Fetched alongside the records, so the default layout is there on
            // the first render (no flash of the standard columns).
            onWillStart(() => this.loadSmartDefaultLayout());
        }
    },

    /**
     * Apply the user's default layout of this list, else the team default.
     * The stored entries are applied as they are: columns the view no longer
     * offers are ignored and new ones keep their native visibility.
     * A failure never blocks the list, which then shows the standard columns.
     */
    async loadSmartDefaultLayout() {
        const config = this.env.config;
        let preset;
        try {
            preset = await this.orm.call("smart.list.preset", "get_default_preset", [
                this.props.resModel,
                config.viewId || 0,
                config.actionId || 0,
            ]);
        } catch (error) {
            // Includes network errors: the list must open whatever happens here.
            console.warn("Smart List View Pro: default layout not loaded", error);
            return;
        }
        if (preset && preset.valid && preset.columns.length && this.smartLayout.columns === null) {
            this.smartLayout.columns = preset.columns;
            this.smartLayout.applied = { id: preset.id, name: preset.name, columns: preset.columns };
        }
    },

    get smartLayoutsEligible() {
        const config = this.env.config || {};
        return Boolean(
            !this.env.inDialog &&
                // Odoo 20 has no showButtons prop: lists embedded without a control panel are skipped.
                Boolean(this.props.display?.controlPanel) &&
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
        const columns = getEligibleColumns(this.props.archInfo.columns, (column) =>
            evaluateBooleanExpr(column.column_invisible, evalContext)
        );
        return columns.map((column) => ({
            field: column.name,
            label: column.label || this.props.fields[column.name]?.string || column.name,
            nativeVisible: !column.optional || Boolean(this.optionalActiveFields[column.name]),
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
        // A proxy: reading it while rendering subscribes the renderer to it.
        this.smartLayout = layout && layout.resModel === this.props.list.resModel ? layout : null;
        this.smartWidthCache = new Map();
        if (this.smartLayout) {
            let mounted = false;
            useLayoutEffect(
                () => {
                    // Same column ids with new widths: the width hook keeps its frozen
                    // widths unless asked to recompute them.
                    if (mounted && this.useMagicColumnWidths) {
                        this.columnWidths.resetWidths();
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
        const copy = { ...column, attrs: { ...column.attrs, width: `${width}px` } };
        this.smartWidthCache.set(column.id, { source: column, width, column: copy });
        return copy;
    },

    get displayOptionalFields() {
        // While a layout is active the Layouts panel is the single column control;
        // Reset brings the native optional-columns menu back.
        return this.smartLayout?.columns ? false : super.displayOptionalFields;
    },
});
