from odoo.exceptions import AccessError
from odoo.tests import HttpCase, tagged
from odoo.tests.common import JsonRpcException
from odoo.tools import mute_logger

from .common import PARTNER_KEY, PresetCase, layout, layout_compact


@tagged("post_install", "-at_install")
class TestPresetSecurity(PresetCase):
    """Authorization matrix (spec §7.2, §10.2), exercised through direct ORM calls."""

    def test_admin_group_implied_by_system(self):
        admin_group = self.env.ref("smart_list_view_pro.group_preset_admin")
        self.assertIn(admin_group, self.env.ref("base.group_system").trans_implied_ids)
        self.assertFalse(self.user_a.has_group("smart_list_view_pro.group_preset_admin"))

    def test_owner_is_forced_to_creator(self):
        preset = self.make(self.user_a)
        self.assertEqual(preset.owner_id, self.user_a)
        self.assertEqual(preset.visibility, "personal")
        with self.assertRaises(AccessError):
            self.make(self.user_a, owner_id=self.user_b.id)

    def test_other_user_cannot_read_write_unlink_personal(self):
        preset = self.make(self.user_a)
        as_b = preset.with_user(self.user_b)
        self.assertFalse(self.preset_model(self.user_b).search([("id", "=", preset.id)]))
        with self.assertRaises(AccessError):
            as_b.read(["name", "layout_json"])
        with self.assertRaises(AccessError):
            as_b.write({"name": "Hijacked"})
        with self.assertRaises(AccessError):
            as_b.unlink()
        self.assertEqual(preset.name, "Follow-ups")

    def test_layout_admin_cannot_touch_someone_elses_personal(self):
        preset = self.make(self.user_a)
        with self.assertRaises(AccessError):
            preset.with_user(self.layout_admin).read(["name"])
        with self.assertRaises(AccessError):
            preset.with_user(self.layout_admin).write({"name": "Hijacked"})
        with self.assertRaises(AccessError):
            preset.with_user(self.layout_admin).unlink()

    def test_owner_can_edit_and_delete_own_personal(self):
        preset = self.make(self.user_a)
        preset.write({"name": "Renamed"})
        self.assertEqual(preset.name, "Renamed")
        preset.unlink()
        self.assertFalse(preset.exists())

    def test_employee_cannot_create_shared(self):
        with self.assertRaises(AccessError):
            self.make(self.user_a, visibility="shared")

    def test_employee_cannot_convert_personal_to_shared(self):
        preset = self.make(self.user_a)
        with self.assertRaises(AccessError):
            preset.write({"visibility": "shared"})
        self.assertEqual(preset.visibility, "personal")

    def test_identity_fields_are_immutable(self):
        preset = self.make(self.user_a)
        for vals in (
            {"owner_id": self.user_b.id},
            {"model_name": "res.users"},
            {"view_ref": 42},
            {"action_ref": 42},
        ):
            with self.subTest(vals=vals), self.assertRaises(AccessError):
                preset.write(vals)
        # view_key is computed server-side: a client value is ignored.
        preset.write({"view_key": "crm.lead|view:1|action:1"})
        self.assertEqual(preset.view_key, PARTNER_KEY)

    def test_layout_admin_publishes_and_manages_shared(self):
        shared = self.make(self.layout_admin, name="Sales Review", visibility="shared")
        self.assertEqual(shared.visibility, "shared")
        shared.write({"name": "Sales Review v2"})
        # Another layout administrator may manage it as well.
        shared.with_user(self.layout_admin_2).write({"active": False})
        self.assertFalse(shared.active)
        shared.with_user(self.layout_admin_2).unlink()
        self.assertFalse(shared.exists())

    def test_admin_cannot_unpublish_by_converting_to_personal(self):
        shared = self.make(self.layout_admin, visibility="shared")
        with self.assertRaises(AccessError):
            shared.write({"visibility": "personal"})

    def test_employee_reads_but_cannot_modify_shared(self):
        shared = self.make(self.layout_admin, name="Sales Review", visibility="shared")
        as_a = shared.with_user(self.user_a)
        self.assertEqual(as_a.name, "Sales Review")
        with self.assertRaises(AccessError):
            as_a.write({"name": "Mine now"})
        with self.assertRaises(AccessError):
            as_a.write({"active": False})
        with self.assertRaises(AccessError):
            as_a.unlink()

    def test_employee_duplicates_shared_into_personal(self):
        shared = self.make(self.layout_admin, name="Sales Review", visibility="shared")
        copy = shared.with_user(self.user_a).copy()
        self.assertEqual(copy.owner_id, self.user_a)
        self.assertEqual(copy.visibility, "personal")
        self.assertEqual(copy.name, "Sales Review (copy)")

    def test_copy_keeps_only_columns_the_user_can_read(self):
        shared = self.make(self.layout_admin, name="Team", visibility="shared",
                           layout_json=layout(("name", True), ("ref", True)))
        self.patch(self.env["res.partner"]._fields["ref"], "groups", "base.group_system")
        copy = shared.with_user(self.user_a).copy()
        self.assertEqual(copy.layout_json, layout_compact(("name", True)))
        self.assertEqual(copy.owner_id, self.user_a)

    def test_portal_and_public_have_no_access(self):
        preset = self.make(self.user_a)
        shared = self.make(self.layout_admin, name="Shared", visibility="shared")
        for user in (self.portal, self.public):
            with self.subTest(user=user.login):
                with self.assertRaises(AccessError):
                    self.preset_model(user).search([])
                with self.assertRaises(AccessError):
                    (preset | shared).with_user(user).read(["name"])
                with self.assertRaises(AccessError):
                    self.make(user)
                with self.assertRaises(AccessError):
                    self.preset_model(user).get_presets_for_list("res.partner")


@tagged("post_install", "-at_install")
class TestPresetRpc(HttpCase):
    """Same rules over the real JSON-RPC endpoint used by the web client."""

    def setUp(self):
        super().setUp()
        self.user = self.env["res.users"].create({
            "name": "SLV RPC user",
            "login": "slv_rpc",
            "password": "slv_rpc_pwd",
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id])],
        })

    def _call_kw(self, method, args, kwargs=None):
        return self.make_jsonrpc_request(
            f"/web/dataset/call_kw/smart.list.preset/{method}",
            {"model": "smart.list.preset", "method": method, "args": args, "kwargs": kwargs or {}},
        )

    @mute_logger("odoo.http")
    def test_rpc_cannot_publish_or_escalate(self):
        self.authenticate("slv_rpc", "slv_rpc_pwd")
        vals = {
            "name": "RPC",
            "model_name": "res.partner",
            "layout_json": '{"schema_version":1,"columns":[{"field":"name","visible":true}]}',
        }
        with self.assertRaises(JsonRpcException) as ctx:
            self._call_kw("create", [{**vals, "visibility": "shared"}])
        self.assertEqual(ctx.exception.args[0], "odoo.exceptions.AccessError")
        admin_id = self.env.ref("base.user_admin").id
        with self.assertRaises(JsonRpcException):
            self._call_kw("create", [{**vals, "owner_id": admin_id}])
        preset_id = self._call_kw("create", [vals])
        with self.assertRaises(JsonRpcException):
            self._call_kw("write", [[preset_id], {"visibility": "shared"}])
        presets = self._call_kw("get_presets_for_list", ["res.partner"])
        self.assertEqual([p["id"] for p in presets], [preset_id])
