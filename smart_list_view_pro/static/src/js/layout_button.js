/** @odoo-module **/

import { Component, useRef, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { usePopover } from "@web/core/popover/popover_hook";
import { isLayoutModified } from "./column_layout";
import { SmartLayoutPanel } from "./layout_panel";

export class SmartLayoutsButton extends Component {
    static template = "smart_list_view_pro.LayoutsButton";
    static props = {
        resModel: String,
        viewId: { type: [Number, Boolean] },
        actionId: { type: [Number, Boolean] },
        isGrouped: Boolean,
        layout: Object,
        getColumns: Function,
    };

    setup() {
        this.buttonRef = useRef("button");
        this.layout = useState(this.props.layout);
        this.popover = usePopover(SmartLayoutPanel, {
            position: "bottom-end",
            popoverClass: "o_smart_list_popover",
            onClose: () => {
                // Give focus back unless the user moved it elsewhere (e.g. clicked an input).
                const active = document.activeElement;
                if (!active || active === document.body || active.closest(".o_smart_list_popover")) {
                    this.buttonRef.el?.focus();
                }
            },
        });
    }

    get isModified() {
        return isLayoutModified(this.layout);
    }

    get title() {
        const applied = this.layout.columns !== null && this.layout.applied;
        return applied ? _t("List layouts (applied: %s)", applied.name) : _t("List layouts");
    }

    onClick(ev) {
        if (this.popover.isOpen) {
            this.popover.close();
            return;
        }
        this.popover.open(ev.currentTarget, {
            resModel: this.props.resModel,
            viewRef: this.props.viewId || 0,
            actionRef: this.props.actionId || 0,
            isGrouped: this.props.isGrouped,
            layout: this.props.layout,
            getColumns: this.props.getColumns,
        });
    }
}
