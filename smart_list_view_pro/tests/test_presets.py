import json

from psycopg2 import IntegrityError

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import PARTNER_KEY, PresetCase, layout


@tagged("post_install", "-at_install")
class TestPresetValidation(PresetCase):
    """Server-side validation of untrusted preset payloads (spec §6)."""

    def assertRejected(self, layout_json, model_name="res.partner"):
        with self.assertRaises(ValidationError):
            self.make(self.user_a, layout_json=layout_json, model_name=model_name)

    def test_payload_is_canonicalized(self):
        preset = self.make(self.user_a, layout_json=layout(("name", True, 150.4), ("email", False)))
        self.assertEqual(
            preset.layout_json,
            '{"schema_version":1,"columns":[{"field":"name","visible":true,"width":150},'
            '{"field":"email","visible":false}]}',
        )
        self.assertEqual(preset.view_key, PARTNER_KEY)

    def test_malformed_payloads_rejected(self):
        cases = {
            "not json": "{nope",
            "not an object": "[1, 2]",
            "extra top-level key": json.dumps(
                {"schema_version": 1, "columns": [{"field": "name", "visible": True}], "x": 1}
            ),
            "unknown version": layout(("name", True), version=2),
            "bool version": layout(("name", True), version=True),
            "no columns": layout(),
            "column not an object": json.dumps({"schema_version": 1, "columns": ["name"]}),
            "xss label key": json.dumps({"schema_version": 1, "columns": [
                {"field": "name", "visible": True, "label": "<img src=x onerror=alert(1)>"},
            ]}),
            "invalid field name": layout(("name); drop table", True)),
            "unknown field": layout(("name", True), ("x_does_not_exist", True)),
            "duplicate field": layout(("name", True), ("name", False)),
            "non-bool visible": json.dumps(
                {"schema_version": 1, "columns": [{"field": "name", "visible": 1}]}
            ),
            "all hidden": layout(("name", False), ("email", False)),
            "negative width": layout(("name", True, -50)),
            "width too small": layout(("name", True, 79)),
            "width too large": layout(("name", True, 601)),
            "string width": layout(("name", True, "120")),
            "bool width": layout(("name", True, True)),
            "NaN width": '{"schema_version":1,"columns":[{"field":"name","visible":true,"width":NaN}]}',
            "too many columns": layout(*[(f"f{i}", True) for i in range(101)]),
            "over 16 KB": json.dumps({"schema_version": 1, "columns": [
                {"field": "name", "visible": True},
            ]}) + " " * (16 * 1024),
            "not a string": None,
        }
        for label, payload in cases.items():
            with self.subTest(label):
                self.assertRejected(payload)

    def test_width_bounds_inclusive(self):
        preset = self.make(self.user_a, layout_json=layout(("name", True, 80), ("email", True, 600)))
        widths = [c["width"] for c in json.loads(preset.layout_json)["columns"]]
        self.assertEqual(widths, [80, 600])

    def test_restricted_field_rejected_for_user_without_access(self):
        self.patch(self.env["res.partner"]._fields["ref"], "groups", "base.group_system")
        self.assertRejected(layout(("name", True), ("ref", True)))

    def test_model_must_exist_be_regular_and_readable(self):
        self.assertRejected(layout(("name", True)), model_name="no.such.model")
        self.assertRejected(layout(("name", True)), model_name="base.module.uninstall")
        self.assertRejected(layout(("name", True)), model_name=False)
        with self.assertRaises(AccessError):
            # Internal users have no read access on ir.ui.view.
            self.make(self.user_a, model_name="ir.ui.view", layout_json=layout(("name", True)))

    def test_view_refs_must_be_non_negative_integers(self):
        for value in (-1, "12", 1.5, None):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.make(self.user_a, view_ref=value)

    def test_name_is_trimmed_and_bounded(self):
        preset = self.make(self.user_a, name="  Follow-ups  ")
        self.assertEqual(preset.name, "Follow-ups")
        for bad in ("", "   ", "x" * 81, None, 42):
            with self.subTest(name=bad), self.assertRaises(ValidationError):
                self.make(self.user_a, name=bad)
        with self.assertRaises(ValidationError):
            preset.write({"name": "  "})
        # Stored as plain text; rendering escapes it (t-esc).
        html = self.make(self.user_a, name="<b>bold</b>")
        self.assertEqual(html.name, "<b>bold</b>")

    def test_write_revalidates_layout(self):
        preset = self.make(self.user_a)
        with self.assertRaises(ValidationError):
            preset.write({"layout_json": layout(("x_nope", True))})
        preset.write({"layout_json": layout(("email", True, 999 - 499))})
        self.assertEqual(json.loads(preset.layout_json)["columns"][0]["width"], 500)

    def test_personal_names_unique_per_owner_and_list(self):
        self.make(self.user_a, name="Calls")
        with self.assertRaisesRegex(ValidationError, "already have a layout"):
            self.make(self.user_a, name="calls ")
        # Same name is fine for another user, another list, or once archived.
        self.make(self.user_b, name="Calls")
        self.make(self.user_a, name="Calls", view_ref=7)
        self.preset_model(self.user_a).search([("name", "=", "Calls"), ("view_ref", "=", 0)]).active = False
        renamed = self.make(self.user_a, name="Other")
        self.make(self.user_a, name="Calls")
        with self.assertRaises(ValidationError):
            renamed.write({"name": "CALLS"})
        renamed.write({"name": "other"})  # changing the case of its own name is fine

    def test_shared_names_unique_per_list(self):
        self.make(self.layout_admin, name="Review", visibility="shared")
        with self.assertRaisesRegex(ValidationError, "shared layout"):
            self.make(self.layout_admin_2, name="REVIEW", visibility="shared")
        # A personal layout may reuse a shared name.
        self.make(self.user_a, name="Review")

    def test_unique_indexes_back_the_checks(self):
        # Superuser skips the readable checks: the database still refuses duplicates.
        Preset = self.env["smart.list.preset"].sudo()
        Preset.create(self.vals(name="Calls", owner_id=self.user_a.id))
        with self.assertRaises(IntegrityError), mute_logger("odoo.sql_db"), self.cr.savepoint():
            Preset.create(self.vals(name="CALLS", owner_id=self.user_a.id))
            self.env.flush_all()
        Preset.create(self.vals(name="Team", visibility="shared"))
        with self.assertRaises(IntegrityError), mute_logger("odoo.sql_db"), self.cr.savepoint():
            Preset.create(self.vals(name="team", visibility="shared"))
            self.env.flush_all()

    def test_copies_get_free_names(self):
        preset = self.make(self.user_a, name="Calls")
        self.assertEqual(preset.copy().name, "Calls (copy)")
        self.assertEqual(preset.copy().name, "Calls (copy 2)")

    def test_copy_name_stays_within_limit(self):
        preset = self.make(self.user_a, name="x" * 80)
        copy = preset.copy()
        self.assertLessEqual(len(copy.name), 80)
        self.assertTrue(copy.name.endswith("(copy)"))


@tagged("post_install", "-at_install")
class TestPresetListing(PresetCase):
    """get_presets_for_list: scoping, view isolation and resilience (FR-07, FR-09)."""

    def ids(self, user, *args):
        return {p["id"] for p in self.preset_model(user).get_presets_for_list(*args)}

    def test_lists_own_and_shared_only_for_matching_list(self):
        mine = self.make(self.user_a, name="Mine")
        theirs = self.make(self.user_b, name="Theirs")
        shared = self.make(self.layout_admin, name="Team", visibility="shared")
        other_action = self.make(self.user_a, name="Other action", action_ref=12)
        self.make(self.user_a, name="Other model", model_name="res.users",
                  layout_json=layout(("name", True)))
        archived = self.make(self.layout_admin, name="Old", visibility="shared")
        archived.active = False

        self.assertEqual(self.ids(self.user_a, "res.partner"), {mine.id, shared.id})
        self.assertEqual(self.ids(self.user_b, "res.partner"), {theirs.id, shared.id})
        self.assertEqual(self.ids(self.user_a, "res.partner", 0, 12), {other_action.id})

        [entry] = [p for p in self.preset_model(self.user_a).get_presets_for_list("res.partner")
                   if p["id"] == shared.id]
        self.assertEqual(
            set(entry),
            {"id", "name", "visibility", "is_owner", "is_default", "columns", "skipped", "valid"},
        )
        self.assertFalse(entry["is_owner"])
        self.assertEqual(entry["visibility"], "shared")

    def test_removed_field_is_skipped_not_fatal(self):
        preset = self.make(self.user_a, layout_json=layout(("name", True), ("email", True)))
        # Simulate a field removed after saving (bypasses ORM validation on purpose).
        stale = layout(("name", True), ("x_removed_field", True), ("email", False))
        self.env.cr.execute(
            "UPDATE smart_list_preset SET layout_json = %s WHERE id = %s", (stale, preset.id)
        )
        preset.invalidate_recordset()
        [entry] = self.preset_model(self.user_a).get_presets_for_list("res.partner")
        self.assertTrue(entry["valid"])
        self.assertEqual(entry["skipped"], 1)
        self.assertEqual([c["field"] for c in entry["columns"]], ["name", "email"])

    def test_preset_without_remaining_visible_column_is_invalid(self):
        preset = self.make(self.user_a)
        self.env.cr.execute(
            "UPDATE smart_list_preset SET layout_json = %s WHERE id = %s",
            (layout(("x_gone", True), ("email", False)), preset.id),
        )
        preset.invalidate_recordset()
        [entry] = self.preset_model(self.user_a).get_presets_for_list("res.partner")
        self.assertFalse(entry["valid"])
        self.assertEqual(entry["columns"], [])

    def test_restricted_columns_of_shared_preset_hidden_from_employee(self):
        shared = self.make(self.layout_admin, name="Team", visibility="shared",
                           layout_json=layout(("name", True), ("ref", True)))
        self.patch(self.env["res.partner"]._fields["ref"], "groups", "base.group_system")
        [entry] = self.preset_model(self.user_a).get_presets_for_list("res.partner")
        self.assertEqual(entry["id"], shared.id)
        self.assertEqual([c["field"] for c in entry["columns"]], ["name"])
        self.assertEqual(entry["skipped"], 1)

    def test_listing_requires_read_access_on_target_model(self):
        with self.assertRaises(AccessError):
            self.preset_model(self.user_a).get_presets_for_list("ir.ui.view")
        with self.assertRaises(ValidationError):
            self.preset_model(self.user_a).get_presets_for_list("res.partner", -1)


@tagged("post_install", "-at_install")
class TestPresetDefaults(PresetCase):
    """Default layouts: one per user and list, one team default per list."""

    def default_id(self, user, *args):
        info = self.preset_model(user).get_default_preset("res.partner", *args)
        return info and info["id"]

    def test_no_default_by_default(self):
        self.make(self.user_a)
        self.assertFalse(self.default_id(self.user_a))

    def test_personal_default_is_returned_with_columns(self):
        preset = self.make(self.user_a)
        preset.with_user(self.user_a).set_default()
        info = self.preset_model(self.user_a).get_default_preset("res.partner")
        self.assertEqual(info["id"], preset.id)
        self.assertTrue(info["is_default"])
        self.assertEqual([c["field"] for c in info["columns"]], ["name", "email", "phone"])
        # Someone else's default never applies to me.
        self.assertFalse(self.default_id(self.user_b))

    def test_set_default_replaces_previous_one(self):
        first = self.make(self.user_a, name="First")
        second = self.make(self.user_a, name="Second")
        first.with_user(self.user_a).set_default()
        second.with_user(self.user_a).set_default()
        self.assertFalse(first.is_default)
        self.assertTrue(second.is_default)
        self.assertEqual(self.default_id(self.user_a), second.id)

    def test_defaults_are_per_user_and_per_list(self):
        mine = self.make(self.user_a)
        theirs = self.make(self.user_b)
        other_list = self.make(self.user_a, action_ref=7)
        for preset, user in ((mine, self.user_a), (theirs, self.user_b), (other_list, self.user_a)):
            preset.with_user(user).set_default()
        self.assertTrue(mine.is_default and theirs.is_default and other_list.is_default)
        self.assertEqual(self.default_id(self.user_a), mine.id)
        self.assertEqual(self.default_id(self.user_a, 0, 7), other_list.id)

    def test_personal_default_wins_over_team_default(self):
        team = self.make(self.layout_admin, name="Team", visibility="shared")
        team.with_user(self.layout_admin).set_default()
        self.assertEqual(self.default_id(self.user_a), team.id)
        mine = self.make(self.user_a)
        mine.with_user(self.user_a).set_default()
        self.assertEqual(self.default_id(self.user_a), mine.id)
        mine.with_user(self.user_a).clear_default()
        self.assertEqual(self.default_id(self.user_a), team.id)

    def test_invalid_default_falls_back_to_team_default(self):
        team = self.make(self.layout_admin, name="Team", visibility="shared")
        team.with_user(self.layout_admin).set_default()
        mine = self.make(self.user_a)
        mine.with_user(self.user_a).set_default()
        self.env.cr.execute(
            "UPDATE smart_list_preset SET layout_json = %s WHERE id = %s",
            (layout(("x_gone", True), ("email", False)), mine.id),
        )
        mine.invalidate_recordset()
        self.assertEqual(self.default_id(self.user_a), team.id)

    def test_unpublishing_clears_team_default(self):
        team = self.make(self.layout_admin, name="Team", visibility="shared")
        team.with_user(self.layout_admin).set_default()
        team.with_user(self.layout_admin).write({"active": False})
        self.assertFalse(team.is_default)
        self.assertFalse(self.default_id(self.user_a))
        with self.assertRaises(ValidationError):
            team.with_user(self.layout_admin).set_default()

    def test_copy_is_not_default(self):
        preset = self.make(self.user_a)
        preset.with_user(self.user_a).set_default()
        copy = preset.with_user(self.user_a).copy()
        self.assertFalse(copy.is_default)

    def test_default_unique_indexes(self):
        first = self.make(self.user_a, name="First")
        second = self.make(self.user_a, name="Second")
        first.with_user(self.user_a).set_default()
        with mute_logger("odoo.sql_db"), self.assertRaises(IntegrityError), self.env.cr.savepoint():
            second.with_user(self.user_a).write({"is_default": True})
        team_1 = self.make(self.layout_admin, name="Team 1", visibility="shared")
        team_2 = self.make(self.layout_admin, name="Team 2", visibility="shared")
        team_1.with_user(self.layout_admin).set_default()
        with mute_logger("odoo.sql_db"), self.assertRaises(IntegrityError), self.env.cr.savepoint():
            team_2.with_user(self.layout_admin).write({"is_default": True})
