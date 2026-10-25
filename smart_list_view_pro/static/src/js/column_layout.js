/** @odoo-module **/

/**
 * Pure helpers for list layout state. No DOM, no services: unit-testable.
 *
 * A layout is an ordered array of `{ field, visible, width? }` entries over the
 * *eligible* columns of the current list view (see `getEligibleColumns`).
 * Layouts only ever filter and reorder columns the view already renders; they
 * never introduce a column.
 */

export const LAYOUT_SCHEMA_VERSION = 1;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 600;
const FIELD_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * @param {number} width
 * @returns {number|null} the width clamped to the allowed bounds, or null if invalid
 */
export function clampWidth(width) {
    if (typeof width !== "number" || !Number.isFinite(width)) {
        return null;
    }
    return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

/**
 * Stable identifier of a list context: model + resolved view + window action.
 * Must match `compute_view_key` in models/smart_list_preset.py.
 * Never keyed by model alone, so two actions sharing a model stay isolated.
 *
 * @param {{ resModel: string, viewId?: number|false, actionId?: number|false }} params
 * @returns {string}
 */
export function computeViewKey({ resModel, viewId, actionId }) {
    return `${resModel}|view:${viewId || 0}|action:${actionId || 0}`;
}

/**
 * Columns a layout may hide, move or resize: plain field columns of the arch.
 * Buttons, widgets, handles, properties, columns hidden by `column_invisible`
 * and further occurrences of a repeated field stay under Odoo's control.
 *
 * @param {Object[]} columns arch columns, in arch order
 * @param {(column: Object) => boolean} isInvisible evaluates `column_invisible`
 * @returns {Object[]} eligible columns, in arch order
 */
export function getEligibleColumns(columns, isInvisible) {
    const seen = new Set();
    return columns.filter((column) => {
        if (
            column.type !== "field" ||
            column.widget === "handle" ||
            column.isHandle ||
            column.fieldType === "properties" ||
            column.relatedPropertyField ||
            !FIELD_NAME_RE.test(column.name) ||
            seen.has(column.name) ||
            isInvisible(column)
        ) {
            return false;
        }
        // A field repeated in the arch: only its first rendered occurrence.
        seen.add(column.name);
        return true;
    });
}

/**
 * Complete layout entries against the columns the view offers right now:
 * unknown fields are dropped (and counted), missing eligible columns are
 * appended with their native visibility, widths are clamped.
 *
 * @param {{ field: string, visible: boolean, width?: number }[]} entries
 * @param {{ field: string, nativeVisible: boolean }[]} available eligible columns, arch order
 * @returns {{ columns: Object[], skipped: number }}
 */
export function mergeLayout(entries, available) {
    const byField = new Map(available.map((col) => [col.field, col]));
    const used = new Set();
    const columns = [];
    let skipped = 0;
    for (const entry of entries) {
        if (!byField.has(entry.field) || used.has(entry.field)) {
            skipped++;
            continue;
        }
        used.add(entry.field);
        const column = { field: entry.field, visible: Boolean(entry.visible) };
        const width = entry.width === undefined ? null : clampWidth(entry.width);
        if (width !== null) {
            column.width = width;
        }
        columns.push(column);
    }
    for (const col of available) {
        if (!used.has(col.field)) {
            columns.push({ field: col.field, visible: col.nativeVisible });
        }
    }
    return { columns, skipped };
}

/**
 * @param {{ field: string, nativeVisible: boolean }[]} available
 * @returns {Object[]} a layout reproducing the current native state
 */
export function nativeLayout(available) {
    return available.map((col) => ({ field: col.field, visible: col.nativeVisible }));
}

/**
 * @returns {Object[]} new layout with the entry at `index` moved by `delta` (-1/+1)
 */
export function moveColumn(columns, index, delta) {
    const target = index + delta;
    if (index < 0 || index >= columns.length || target < 0 || target >= columns.length) {
        return columns;
    }
    const result = columns.slice();
    [result[index], result[target]] = [result[target], result[index]];
    return result;
}

/**
 * @returns {boolean} whether `field` may be hidden without hiding every column
 */
export function canHideColumn(columns, field) {
    return columns.some((col) => col.visible && col.field !== field);
}

/**
 * @returns {Object[]} new layout with `field` shown or hidden; at least one
 *   column always stays visible
 */
export function setColumnVisible(columns, field, visible) {
    if (!visible && !canHideColumn(columns, field)) {
        return columns;
    }
    return columns.map((col) => (col.field === field ? { ...col, visible } : col));
}

/**
 * @param {number|null} width a width in pixels, or null to restore automatic sizing
 * @returns {Object[]} new layout with the width of `field` set (clamped) or removed
 */
export function setColumnWidth(columns, field, width) {
    const clamped = width === null ? null : clampWidth(width);
    return columns.map((col) => {
        if (col.field !== field) {
            return col;
        }
        const { width: _previous, ...rest } = col;
        return clamped === null ? rest : { ...rest, width: clamped };
    });
}

/**
 * Order the renderer's columns according to a layout.
 *
 * Eligible columns follow the layout (hidden ones are removed). Every other
 * column the renderer would natively show keeps following the eligible
 * column that precedes it in the arch (or stays in front), so buttons and
 * widgets remain next to the data they relate to.
 *
 * @param {Object[]} candidates renderer columns in arch order, `column_invisible` excluded
 * @param {Set<string>} nativeActiveIds ids of the columns the renderer shows natively
 * @param {Set<string>} eligibleIds ids of the eligible columns
 * @param {Object[]} layout layout entries
 * @param {(column: Object, width: number) => Object} [withWidth] returns the column
 *   rendered with a fixed width
 * @returns {Object[]}
 */
export function arrangeColumns(candidates, nativeActiveIds, eligibleIds, layout, withWidth) {
    const eligibleByField = new Map();
    for (const column of candidates) {
        if (eligibleIds.has(column.id)) {
            eligibleByField.set(column.name, column);
        }
    }
    const ordered = [];
    const placed = new Set();
    for (const entry of layout) {
        const column = eligibleByField.get(entry.field);
        if (!column || placed.has(column.id)) {
            continue;
        }
        placed.add(column.id);
        if (entry.visible) {
            const width = entry.width === undefined ? null : clampWidth(entry.width);
            ordered.push(width !== null && withWidth ? withWidth(column, width) : column);
        }
    }
    for (const column of eligibleByField.values()) {
        if (!placed.has(column.id) && nativeActiveIds.has(column.id)) {
            ordered.push(column);
        }
    }

    const shownIds = new Set(ordered.map((column) => column.id));
    const leading = [];
    const followers = new Map();
    let anchor = null;
    for (const column of candidates) {
        if (eligibleIds.has(column.id)) {
            if (shownIds.has(column.id)) {
                anchor = column.id;
            }
        } else if (nativeActiveIds.has(column.id)) {
            if (anchor) {
                if (!followers.has(anchor)) {
                    followers.set(anchor, []);
                }
                followers.get(anchor).push(column);
            } else {
                leading.push(column);
            }
        }
    }
    const result = [...leading];
    for (const column of ordered) {
        result.push(column, ...(followers.get(column.id) || []));
    }
    return result;
}

function canonicalEntries(columns) {
    return columns.map((col) => {
        const entry = { field: col.field, visible: Boolean(col.visible) };
        if (typeof col.width === "number") {
            entry.width = col.width;
        }
        return entry;
    });
}

/**
 * @returns {string} the `layout_json` payload stored by the server
 */
export function serializeLayout(columns) {
    return JSON.stringify({
        schema_version: LAYOUT_SCHEMA_VERSION,
        columns: canonicalEntries(columns),
    });
}

/**
 * @returns {boolean} whether two layouts show the same columns, order and widths
 */
export function sameLayout(a, b) {
    return JSON.stringify(canonicalEntries(a)) === JSON.stringify(canonicalEntries(b));
}

/**
 * @param {{ columns: Object[]|null, applied: Object|null }} state
 * @returns {boolean} whether the list shows changes no saved layout holds
 */
export function isLayoutModified(state) {
    if (state.columns === null) {
        return false;
    }
    return !state.applied || !sameLayout(state.columns, state.applied.columns);
}
