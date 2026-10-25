from odoo.tests import HttpCase, new_test_user, tagged


@tagged("post_install", "-at_install")
class TestSmartListTour(HttpCase):
    """Drives real backend lists; skipped when the target app isn't installed."""

    def _require(self, module):
        if self.env["ir.module.module"]._get(module).state != "installed":
            self.skipTest(f"{module} not installed")

    def test_contacts_list_tour(self):
        self._require("contacts")
        self.env["res.partner"].create([{"name": f"SLV Contact {i:03d}"} for i in range(90)])
        self.start_tour("/odoo", "smart_list_view_pro_contacts", login="admin")

    def test_crm_list_tour(self):
        self._require("crm")
        admin = self.env.ref("base.user_admin")  # the pipeline action filters on "My Pipeline"
        self.env["crm.lead"].create(
            [
                {"name": f"SLV Opportunity {i:03d}", "type": "opportunity", "user_id": admin.id}
                for i in range(90)
            ]
        )
        self.start_tour("/odoo", "smart_list_view_pro_crm", login="admin")

    def test_sale_list_tour(self):
        self._require("sale_management")
        admin = self.env.ref("base.user_admin")  # the action filters on "My Quotations"
        partner = self.env["res.partner"].create({"name": "SLV Customer"})
        self.env["sale.order"].create(
            [{"partner_id": partner.id, "user_id": admin.id} for _i in range(90)]
        )
        self.start_tour("/odoo", "smart_list_view_pro_sale", login="admin")


@tagged("post_install", "-at_install")
class TestPresetTours(HttpCase):
    """Saved layouts across two real users, through the real web client."""

    def test_admin_publishes_employee_applies(self):
        if self.env["ir.module.module"]._get("contacts").state != "installed":
            self.skipTest("contacts not installed")
        employee = new_test_user(self.env, login="slv_tour_employee", groups="base.group_user")
        Preset = self.env["smart.list.preset"].with_context(active_test=False)
        admin = self.env.ref("base.user_admin")

        self.start_tour("/odoo", "smart_list_view_pro_presets_admin", login="admin")
        mine = Preset.search([("owner_id", "=", admin.id), ("visibility", "=", "personal")])
        self.assertEqual(mine.mapped("name"), ["SLV Calls"])
        self.assertIn('"field":"email","visible":false', mine.layout_json)
        shared = Preset.search([("visibility", "=", "shared"), ("name", "=", "SLV Calls")])
        self.assertEqual(sorted(shared.mapped("active")), [False, True])
        self.assertTrue(all(p.view_key == mine.view_key for p in shared))

        self.start_tour("/odoo", "smart_list_view_pro_presets_employee", login=employee.login)
        copy = Preset.search([("owner_id", "=", employee.id)])
        self.assertEqual(copy.mapped("name"), ["SLV Calls (copy)"])
        self.assertEqual(copy.visibility, "personal")
        # The shared layout itself is untouched by the employee.
        self.assertEqual(shared.filtered("active").layout_json, mine.layout_json)
