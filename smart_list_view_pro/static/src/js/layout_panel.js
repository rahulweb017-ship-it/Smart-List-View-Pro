/** @odoo-module **/

import { Component, onMounted, onPatched, useRef, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { RPCError } from "@web/core/network/rpc_service";
import { useAutofocus, useService } from "@web/core/utils/hooks";
import {
    MAX_COLUMN_WIDTH,
    MIN_COLUMN_WIDTH,
    canHideColumn,
    isLayoutModified,
    mergeLayout,
    moveColumn,
    nativeLayout,
    serializeLayout,
    setColumnVisible,
    setColumnWidth,
} from "./column_layout";

const PRESET_MODEL = "smart.list.preset";
const ADMIN_GROUP = "smart_list_view_pro.group_preset_admin";
export const NAME_MAX_LENGTH = 80;

export class SmartLayoutPanel extends Component {
    static template = "smart_list_view_pro.LayoutPanel";
    static props = {
        close: Function,
        resModel: String,
        viewRef: Number,
        actionRef: Number,
        isGrouped: Boolean,
        layout: Object,
        getColumns: Function,
    };

    setup() {
        this.MIN_COLUMN_WIDTH = MIN_COLUMN_WIDTH;
        this.MAX_COLUMN_WIDTH = MAX_COLUMN_WIDTH;
        this.NAME_MAX_LENGTH = NAME_MAX_LENGTH;
        // The protected ORM drops responses arriving after the panel is closed,
        // so a slow answer can never be applied to another list.
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.user = useService("user");
        this.rootRef = useRef("root");
        useAutofocus(); // the name input of the save/rename form
        this.layout = useState(this.props.layout);
        this.state = useState({
            loading: true,
            loadFailed: false,
            presets: [],
            isAdmin: false,
            busy: false,
            // { mode: "new" | "rename", id?, name }
            form: null,
            confirmDeleteId: null,
        });
        // Moving a row re-inserts its DOM node, which drops the focus: restore it.
        this.pendingFocus = null;
        // Selector or element to focus once rendered (e.g. after a form closes).
        this.focusTarget = null;
        onMounted(() => this.focusFirst());
        onPatched(() => this.restoreFocus());
        this.loadPresets();
    }

    /** First column control, else "Save as new layout", else Close. */
    focusFirst() {
        const root = this.rootRef.el;
        const target = [
            ".o_smart_list_column input:not(:disabled)",
            ".o_smart_list_save_new:not(:disabled)",
            ".btn-close",
        ]
            .map((selector) => root.querySelector(selector))
            .find(Boolean);
        target?.focus();
    }

    // ------------------------------------------------------------------
    // Column editor
    // ------------------------------------------------------------------

    get available() {
        return this.props.getColumns();
    }

    /** Current layout over the columns the view offers now. */
    get columns() {
        const available = this.available;
        return mergeLayout(this.layout.columns || nativeLayout(available), available).columns;
    }

    get rows() {
        const labels = new Map(this.available.map((col) => [col.field, col.label]));
        const columns = this.columns;
        return columns.map((col, index) => {
            const label = labels.get(col.field);
            return {
                ...col,
                label,
                isFirst: index === 0,
                isLast: index === columns.length - 1,
                locked: col.visible && !canHideColumn(columns, col.field),
                showLabel: _t("Show %s", label),
                lockedLabel: _t("At least one column must stay visible."),
                moveUpLabel: _t("Move %s up", label),
                moveDownLabel: _t("Move %s down", label),
                widthLabel: _t("Width of %s in pixels", label),
            };
        });
    }

    update(change) {
        this.layout.columns = change(this.columns);
    }

    onToggle(field, visible) {
        this.update((columns) => setColumnVisible(columns, field, visible));
    }

    onMove(field, index, delta) {
        this.pendingFocus = { field, direction: delta < 0 ? "up" : "down" };
        this.update((columns) => moveColumn(columns, index, delta));
    }

    onWidthChange(field, ev) {
        const raw = ev.target.value.trim();
        const width = raw === "" ? null : Number(raw);
        if (width !== null && !Number.isFinite(width)) {
            ev.target.value = this.columns.find((col) => col.field === field)?.width ?? "";
            return;
        }
        this.update((columns) => setColumnWidth(columns, field, width));
        // Show the clamped value even when it equals the stored one (no re-render).
        ev.target.value = this.columns.find((col) => col.field === field)?.width ?? "";
    }

    /** Back to native Odoo columns; saved layouts are kept. */
    onReset() {
        this.layout.columns = null;
        this.layout.applied = null;
    }

    restoreFocus() {
        const root = this.rootRef.el;
        if (this.focusTarget) {
            const wanted = this.focusTarget;
            const target = typeof wanted === "string" ? root.querySelector(wanted) : wanted;
            if (typeof wanted !== "string" && !root.contains(wanted)) {
                this.focusTarget = null;
            } else if (target && !target.disabled) {
                this.focusTarget = null;
                target.focus();
                return;
            }
        }
        if (document.activeElement === document.body) {
            // The focused control was re-rendered away: stay inside the panel.
            this.focusFirst();
        }
        const pending = this.pendingFocus;
        this.pendingFocus = null;
        if (!pending) {
            return;
        }
        const row = [...root.querySelectorAll(".o_smart_list_column")].find(
            (el) => el.dataset.field === pending.field
        );
        if (!row) {
            return;
        }
        const other = pending.direction === "up" ? "down" : "up";
        const button = [pending.direction, other]
            .map((direction) => row.querySelector(`.o_smart_list_move_${direction}`))
            .find((el) => el && !el.disabled);
        button?.focus();
    }

    // ------------------------------------------------------------------
    // Saved layouts
    // ------------------------------------------------------------------

    get isModified() {
        return isLayoutModified(this.layout);
    }

    /** The saved layout currently shown, if the list still shows it. */
    get applied() {
        return this.layout.columns !== null ? this.layout.applied : null;
    }

    get appliedPreset() {
        const applied = this.applied;
        return applied ? this.state.presets.find((p) => p.id === applied.id) : null;
    }

    get personalPresets() {
        return this.state.presets.filter((p) => p.visibility === "personal");
    }

    get sharedPresets() {
        return this.state.presets.filter((p) => p.visibility === "shared");
    }

    /** @param {string|HTMLElement} target */
    focusLater(target) {
        this.focusTarget = target;
    }

    presetSelector(id, control) {
        return `.o_smart_list_preset[data-preset-id="${id}"] ${control}`;
    }

    canEdit(preset) {
        return preset.visibility === "personal" ? preset.is_owner : this.state.isAdmin;
    }

    isApplied(preset) {
        return this.applied?.id === preset.id;
    }

    actionLabel(action, preset) {
        const labels = {
            apply: _t("Apply layout %s", preset.name),
            rename: _t("Rename %s", preset.name),
            duplicate: _t("Duplicate %s as a personal layout", preset.name),
            delete: _t("Delete %s", preset.name),
            publish: _t("Publish %s as a shared layout", preset.name),
            unpublish: _t("Unpublish %s", preset.name),
        };
        return labels[action];
    }

    async loadPresets() {
        try {
            const [presets, isAdmin] = await Promise.all([
                this.orm.call(PRESET_MODEL, "get_presets_for_list", [
                    this.props.resModel,
                    this.props.viewRef,
                    this.props.actionRef,
                ]),
                this.user.hasGroup(ADMIN_GROUP),
            ]);
            this.state.presets = presets;
            this.state.isAdmin = isAdmin;
            this.state.loadFailed = false;
        } catch (error) {
            this.state.loadFailed = true;
            if (!(error instanceof RPCError)) {
                throw error;
            }
            this.showError(error);
        } finally {
            this.state.loading = false;
        }
    }

    showError(error) {
        const message = error.data?.message || error.message;
        this.notification.add(message, { type: "danger", title: _t("List layouts") });
    }

    /**
     * Run a server change, report errors from the server (access, validation)
     * as notifications and reload the presets of this list.
     *
     * @returns {Promise<any>} the result, or undefined when it failed
     */
    async mutate(operation, successMessage) {
        if (this.state.busy) {
            return;
        }
        this.state.busy = true;
        // Buttons are disabled while busy, which drops their focus: give it back.
        const trigger = document.activeElement;
        try {
            const result = await operation();
            if (successMessage) {
                this.notification.add(successMessage, { type: "success" });
            }
            await this.loadPresets();
            return result ?? true;
        } catch (error) {
            if (!(error instanceof RPCError)) {
                throw error;
            }
            this.showError(error);
        } finally {
            this.state.busy = false;
            if (!this.focusTarget && this.rootRef.el?.contains(trigger)) {
                this.focusLater(trigger);
            }
        }
    }

    createVals(name, columns, visibility = "personal") {
        return {
            name,
            visibility,
            model_name: this.props.resModel,
            view_ref: this.props.viewRef,
            action_ref: this.props.actionRef,
            layout_json: serializeLayout(columns),
        };
    }

    markApplied(id, columns) {
        const preset = this.state.presets.find((p) => p.id === id);
        this.layout.columns = columns;
        this.layout.applied = preset ? { id, name: preset.name, columns } : null;
    }

    onApply(preset) {
        if (!preset.valid) {
            return;
        }
        const { columns, skipped } = mergeLayout(preset.columns, this.available);
        this.layout.columns = columns;
        this.layout.applied = { id: preset.id, name: preset.name, columns };
        const missing = skipped + preset.skipped;
        if (missing) {
            this.notification.add(
                _t(
                    "%(count)s column(s) of “%(name)s” are no longer available in this list and were skipped.",
                    { count: missing, name: preset.name }
                ),
                { type: "warning" }
            );
        }
    }

    // Name form (save as new / rename) ---------------------------------

    onStartSaveNew() {
        this.state.confirmDeleteId = null;
        this.state.form = { mode: "new", name: "" };
    }

    onStartRename(preset) {
        this.state.confirmDeleteId = null;
        this.state.form = { mode: "rename", id: preset.id, name: preset.name };
    }

    onCancelForm() {
        const form = this.state.form;
        this.state.form = null;
        this.focusLater(
            form?.mode === "rename"
                ? this.presetSelector(form.id, ".o_smart_list_rename")
                : ".o_smart_list_save_new"
        );
    }

    onFormKeydown(ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            this.onSubmitForm();
        } else if (ev.key === "Escape") {
            // Cancel the form only; a second Escape closes the panel.
            ev.preventDefault();
            ev.stopPropagation();
            this.onCancelForm();
        }
    }

    async onSubmitForm() {
        const form = this.state.form;
        const name = (form?.name || "").trim();
        if (!name) {
            this.notification.add(_t("Please enter a layout name."), { type: "warning" });
            return;
        }
        if (form.mode === "new") {
            const columns = this.columns;
            const id = await this.mutate(
                () => this.orm.create(PRESET_MODEL, [this.createVals(name, columns)]),
                _t("Layout “%s” saved.", name)
            );
            if (id) {
                const newId = Array.isArray(id) ? id[0] : id;
                this.state.form = null;
                this.markApplied(newId, columns);
                this.focusLater(this.presetSelector(newId, ".o_smart_list_apply"));
            }
        } else {
            const done = await this.mutate(
                () => this.orm.write(PRESET_MODEL, [form.id], { name }),
                _t("Layout renamed.")
            );
            if (done) {
                this.state.form = null;
                this.focusLater(this.presetSelector(form.id, ".o_smart_list_rename"));
                if (this.layout.applied?.id === form.id) {
                    const preset = this.state.presets.find((p) => p.id === form.id);
                    this.layout.applied = { ...this.layout.applied, name: preset?.name || name };
                }
            }
        }
    }

    // Other actions ----------------------------------------------------

    async onUpdateApplied() {
        const preset = this.appliedPreset;
        if (!preset || !this.canEdit(preset)) {
            return;
        }
        const columns = this.columns;
        const done = await this.mutate(
            () =>
                this.orm.write(PRESET_MODEL, [preset.id], {
                    layout_json: serializeLayout(columns),
                }),
            _t("Layout “%s” updated.", preset.name)
        );
        if (done) {
            this.markApplied(preset.id, columns);
        }
    }

    async onDuplicate(preset) {
        await this.mutate(
            () => this.orm.call(PRESET_MODEL, "copy", [[preset.id]]),
            _t("Copy of “%s” added to your layouts.", preset.name)
        );
    }

    onAskDelete(preset) {
        this.state.form = null;
        this.state.confirmDeleteId = preset.id;
        // The safe choice gets the focus.
        this.focusLater(this.presetSelector(preset.id, ".o_smart_list_cancel_delete"));
    }

    onCancelDelete() {
        const id = this.state.confirmDeleteId;
        this.state.confirmDeleteId = null;
        this.focusLater(this.presetSelector(id, ".o_smart_list_delete"));
    }

    async onConfirmDelete(preset) {
        const done = await this.mutate(
            () => this.orm.unlink(PRESET_MODEL, [preset.id]),
            _t("Layout “%s” deleted.", preset.name)
        );
        if (done) {
            this.state.confirmDeleteId = null;
            this.focusLater(".o_smart_list_save_new");
            if (this.layout.applied?.id === preset.id) {
                // The columns stay as they are, now as unsaved changes.
                this.layout.applied = null;
            }
        }
    }

    async onPublish(preset) {
        if (!this.state.isAdmin) {
            return;
        }
        await this.mutate(
            () =>
                this.orm.create(PRESET_MODEL, [
                    this.createVals(preset.name, preset.columns, "shared"),
                ]),
            _t("“%s” is now shared with all internal users.", preset.name)
        );
    }

    async onUnpublish(preset) {
        if (!this.state.isAdmin) {
            return;
        }
        const done = await this.mutate(
            () => this.orm.write(PRESET_MODEL, [preset.id], { active: false }),
            _t("“%s” is no longer shared.", preset.name)
        );
        if (done && this.layout.applied?.id === preset.id) {
            this.layout.applied = null;
        }
    }
}
