import json
import math
import re

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, ValidationError

SCHEMA_VERSION = 1
MAX_PAYLOAD_BYTES = 16 * 1024
MAX_COLUMNS = 100
MIN_WIDTH = 80
MAX_WIDTH = 600
NAME_MAX_LENGTH = 80
FIELD_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
PAYLOAD_KEYS = {"schema_version", "columns"}
COLUMN_KEYS = {"field", "visible", "width"}
# Identity of a preset: fixed at creation, even for administrators.
# Publishing creates a separate shared preset; unpublishing archives it.
IMMUTABLE_FIELDS = {"owner_id", "visibility", "model_name", "view_ref", "action_ref"}
ADMIN_GROUP = "smart_list_view_pro.group_preset_admin"


def compute_view_key(model_name, view_ref, action_ref):
    """Must stay identical to ``computeViewKey`` in static/src/js/column_layout.js."""
    return f"{model_name}|view:{view_ref or 0}|action:{action_ref or 0}"


class SmartListPreset(models.Model):
    """A saved list-view column layout (UI only, never business data).

    Security layers: ACL (internal users only) + record rules (own personal,
    shared read-only for non-admins) + the defensive checks below, which also
    cover transitions that record rules cannot see (owner/visibility changes).
    """

    _name = "smart.list.preset"
    _description = "Smart List Layout Preset"
    _order = "visibility, name, id"

    name = fields.Char(required=True, size=NAME_MAX_LENGTH)
    owner_id = fields.Many2one(
        "res.users",
        required=True,
        readonly=True,
        copy=False,
        default=lambda self: self.env.user,
        ondelete="cascade",
        index=True,
    )
    visibility = fields.Selection(
        [("personal", "Personal"), ("shared", "Shared")],
        required=True,
        default="personal",
        copy=False,
    )
    model_name = fields.Char(required=True, index=True)
    # Plain integers rather than Many2one: internal users have no read access
    # to ir.ui.view / ir.actions.act_window, and the key grants nothing.
    view_ref = fields.Integer(string="View ID", default=0)
    action_ref = fields.Integer(string="Window Action ID", default=0)
    view_key = fields.Char(compute="_compute_view_key", store=True, index=True)
    layout_json = fields.Text(required=True)
    active = fields.Boolean(default=True)

    def init(self):
        # Partial, case-insensitive unique indexes (no declarative equivalent
        # before Odoo 19). _check_name_available gives the readable error.
        self.env.cr.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS smart_list_preset_personal_name_unique
                ON smart_list_preset (owner_id, view_key, lower(name))
                WHERE visibility = 'personal' AND active;
            CREATE UNIQUE INDEX IF NOT EXISTS smart_list_preset_shared_name_unique
                ON smart_list_preset (view_key, lower(name))
                WHERE visibility = 'shared' AND active;
        """)

    @api.depends("model_name", "view_ref", "action_ref")
    def _compute_view_key(self):
        for preset in self:
            preset.view_key = compute_view_key(
                preset.model_name, preset.view_ref, preset.action_ref
            )

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    @api.model
    def _is_preset_admin(self):
        return self.env.su or self.env.user.has_group(ADMIN_GROUP)

    @api.model
    def _can_read_field(self, Model, field):
        return self.env.su or not field.groups or Model.user_has_groups(field.groups)

    @api.model
    def _normalize_name(self, name):
        name = (name or "").strip() if isinstance(name, str) else ""
        if not name:
            raise ValidationError(_("A layout name is required."))
        if len(name) > NAME_MAX_LENGTH:
            raise ValidationError(
                _("Layout names are limited to %s characters.", NAME_MAX_LENGTH)
            )
        return name

    @api.model
    def _get_target_model(self, model_name):
        """Return the business model, if it exists and the user may read it."""
        if not isinstance(model_name, str) or model_name not in self.env:
            raise ValidationError(_("Unknown model for this layout."))
        Model = self.env[model_name]
        if Model._abstract or Model._transient:
            raise ValidationError(_("Layouts are only supported on regular models."))
        if not Model.check_access_rights("read", raise_exception=False):
            raise AccessError(_("You cannot save a layout for a list you cannot read."))
        return Model

    @api.model
    def _normalize_layout(self, layout_json, model_name, strict=True):
        """Parse, validate and canonicalize an untrusted layout payload.

        :param strict: when False (reading stored presets), columns whose field
            no longer exists or is not readable by the current user are dropped
            instead of rejecting the whole payload.
        :return: tuple (canonical JSON string, number of dropped columns)
        :raise ValidationError: on any malformed or disallowed content
        """
        if not isinstance(layout_json, str):
            raise ValidationError(_("The layout must be a JSON string."))
        if len(layout_json.encode()) > MAX_PAYLOAD_BYTES:
            raise ValidationError(_("The layout is too large."))
        try:
            payload = json.loads(layout_json)
        except ValueError:
            raise ValidationError(_("The layout is not valid JSON.")) from None

        if not isinstance(payload, dict) or set(payload) - PAYLOAD_KEYS:
            raise ValidationError(_("The layout has an unexpected structure."))
        version = payload.get("schema_version")
        if type(version) is not int or version != SCHEMA_VERSION:
            raise ValidationError(_("Unsupported layout version."))
        columns = payload.get("columns")
        if not isinstance(columns, list) or not columns or len(columns) > MAX_COLUMNS:
            raise ValidationError(
                _("A layout needs between 1 and %s columns.", MAX_COLUMNS)
            )

        Model = self._get_target_model(model_name)
        normalized, seen, dropped = [], set(), 0
        for column in columns:
            if not isinstance(column, dict) or set(column) - COLUMN_KEYS:
                raise ValidationError(_("A layout column has an unexpected structure."))
            fname = column.get("field")
            if not isinstance(fname, str) or not FIELD_NAME_RE.match(fname):
                raise ValidationError(_("A layout column has an invalid field name."))
            if fname in seen:
                raise ValidationError(_("A layout column is listed twice."))
            seen.add(fname)
            field = Model._fields.get(fname)
            if not field or not self._can_read_field(Model, field):
                if not strict:
                    dropped += 1
                    continue
                # Same message for unknown and restricted fields: don't leak which exist.
                raise ValidationError(_("A layout column refers to an unavailable field."))
            visible = column.get("visible")
            if type(visible) is not bool:
                raise ValidationError(_("A layout column has an invalid visibility."))
            entry = {"field": fname, "visible": visible}
            if "width" in column:
                width = column["width"]
                if (
                    type(width) not in (int, float)
                    or not math.isfinite(width)
                    or not MIN_WIDTH <= width <= MAX_WIDTH
                ):
                    raise ValidationError(
                        _("Column widths must be between %(min)s and %(max)s pixels.",
                          min=MIN_WIDTH, max=MAX_WIDTH)
                    )
                entry["width"] = round(width)
            normalized.append(entry)

        if not any(entry["visible"] for entry in normalized):
            raise ValidationError(_("At least one column must remain visible."))
        canonical = json.dumps(
            {"schema_version": SCHEMA_VERSION, "columns": normalized},
            separators=(",", ":"),
        )
        return canonical, dropped

    @api.model
    def _check_name_available(self, name, view_key, visibility, exclude_id=None):
        """Readable duplicate-name error (the unique indexes stay the real guard).

        Searched with the caller's rights: their own personal layouts, or the
        shared layouts every internal user can read.
        """
        domain = [("view_key", "=", view_key), ("visibility", "=", visibility)]
        if visibility == "personal":
            domain.append(("owner_id", "=", self.env.uid))
        if exclude_id:
            domain.append(("id", "!=", exclude_id))
        if any(p.name.lower() == name.lower() for p in self.search(domain)):
            if visibility == "shared":
                raise ValidationError(_("A shared layout named “%s” already exists for this list.", name))
            raise ValidationError(_("You already have a layout named “%s” for this list.", name))

    @api.model
    def _check_refs(self, vals):
        for fname in ("view_ref", "action_ref"):
            value = vals.get(fname, 0)
            if type(value) is not int or value < 0:
                raise ValidationError(_("Invalid list reference."))

    # ------------------------------------------------------------------
    # CRUD overrides (defensive; record rules remain the primary barrier)
    # ------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        is_admin = self._is_preset_admin()
        for vals in vals_list:
            if not self.env.su:
                owner = vals.get("owner_id", self.env.uid)
                if owner != self.env.uid:
                    raise AccessError(_("You can only create layouts for yourself."))
                vals["owner_id"] = self.env.uid
            if vals.get("visibility", "personal") == "shared" and not is_admin:
                raise AccessError(_("Only layout administrators can publish shared layouts."))
            vals.pop("view_key", None)
            self._check_refs(vals)
            vals["name"] = self._normalize_name(vals.get("name"))
            vals["layout_json"], _dropped = self._normalize_layout(
                vals.get("layout_json"), vals.get("model_name")
            )
            if vals.get("active", True) and not self.env.su:
                self._check_name_available(
                    vals["name"],
                    compute_view_key(vals["model_name"], vals.get("view_ref"), vals.get("action_ref")),
                    vals.get("visibility", "personal"),
                )
        return super().create(vals_list)

    def write(self, vals):
        if not self:
            return True
        if not self.env.su:
            if IMMUTABLE_FIELDS & set(vals):
                raise AccessError(
                    _("The owner, visibility and target list of a layout cannot be changed.")
                )
            # Reading with the caller's rights: unreadable records raise here.
            is_admin = self._is_preset_admin()
            for preset in self:
                if preset.visibility == "shared" and not is_admin:
                    raise AccessError(_("Only layout administrators can change shared layouts."))
                if preset.visibility == "personal" and preset.owner_id.id != self.env.uid:
                    raise AccessError(_("You can only change your own layouts."))
        vals = dict(vals)
        vals.pop("view_key", None)
        if "name" in vals:
            vals["name"] = self._normalize_name(vals["name"])
            if not self.env.su:
                for preset in self.filtered("active"):
                    self._check_name_available(
                        vals["name"], preset.view_key, preset.visibility, exclude_id=preset.id
                    )
        if "layout_json" in vals:
            for model_name in set(self.mapped("model_name")):
                normalized, _dropped = self._normalize_layout(vals["layout_json"], model_name)
            vals["layout_json"] = normalized
        return super().write(vals)

    def unlink(self):
        if not self.env.su and self:
            is_admin = self._is_preset_admin()
            for preset in self:
                if preset.visibility == "shared" and not is_admin:
                    raise AccessError(_("Only layout administrators can delete shared layouts."))
                if preset.visibility == "personal" and preset.owner_id.id != self.env.uid:
                    raise AccessError(_("You can only delete your own layouts."))
        return super().unlink()

    def copy_data(self, default=None):
        default = dict(default or {})
        vals_list = super().copy_data(default=default)
        for preset, vals in zip(self, vals_list):
            if "name" not in default:
                vals["name"] = preset._free_copy_name()
            if "layout_json" not in default:
                # Keep only the columns the copying user may read (e.g. a shared
                # layout saved by an administrator who sees more fields).
                vals["layout_json"], _dropped = self._normalize_layout(
                    preset.layout_json, preset.model_name, strict=False
                )
        return vals_list

    def _free_copy_name(self):
        """'Name (copy)', then 'Name (copy 2)'…, unused among the caller's layouts."""
        self.ensure_one()
        taken = {
            name.lower()
            for name in self.search([
                ("view_key", "=", self.view_key),
                ("visibility", "=", "personal"),
                ("owner_id", "=", self.env.uid),
            ]).mapped("name")
        }
        for index in range(1, 100):
            suffix = _(" (copy)") if index == 1 else _(" (copy %s)", index)
            name = self.name[: NAME_MAX_LENGTH - len(suffix)] + suffix
            if name.lower() not in taken:
                return name
        raise ValidationError(_("Too many copies of this layout."))

    # ------------------------------------------------------------------
    # Client API
    # ------------------------------------------------------------------

    @api.model
    def get_presets_for_list(self, model_name, view_ref=0, action_ref=0):
        """Presets the current user may apply to one list, payloads parsed.

        Runs with the caller's rights (ACL + record rules). Stored payloads are
        re-validated: columns whose field was removed or is not readable by the
        caller are dropped and counted in ``skipped``; a preset left without a
        valid visible column is returned with ``valid: False`` and no columns.
        Only technical field names are returned, never labels or record values.
        """
        self._check_refs({"view_ref": view_ref, "action_ref": action_ref})
        self._get_target_model(model_name)
        view_key = compute_view_key(model_name, view_ref, action_ref)
        result = []
        for preset in self.search([("view_key", "=", view_key)]):
            try:
                canonical, skipped = self._normalize_layout(
                    preset.layout_json, model_name, strict=False
                )
                columns, valid = json.loads(canonical)["columns"], True
            except ValidationError:
                columns, skipped, valid = [], 0, False
            result.append({
                "id": preset.id,
                "name": preset.name,
                "visibility": preset.visibility,
                "is_owner": preset.owner_id.id == self.env.uid,
                "columns": columns,
                "skipped": skipped,
                "valid": valid,
            })
        return result
