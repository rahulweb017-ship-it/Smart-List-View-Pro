import json

from odoo.tests import TransactionCase, new_test_user

PARTNER_KEY = "res.partner|view:0|action:0"


def layout(*columns, version=1):
    """Build a layout payload; columns are (field, visible[, width]) tuples."""
    cols = []
    for column in columns:
        entry = {"field": column[0], "visible": column[1]}
        if len(column) > 2:
            entry["width"] = column[2]
        cols.append(entry)
    return json.dumps({"schema_version": version, "columns": cols})


def layout_compact(*columns):
    """The canonical form the server stores."""
    return json.dumps(json.loads(layout(*columns)), separators=(",", ":"))


class PresetCase(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user_a = new_test_user(cls.env, login="slv_user_a", groups="base.group_user")
        cls.user_b = new_test_user(cls.env, login="slv_user_b", groups="base.group_user")
        cls.layout_admin = new_test_user(
            cls.env,
            login="slv_layout_admin",
            groups="base.group_user,smart_list_view_pro.group_preset_admin",
        )
        cls.layout_admin_2 = new_test_user(
            cls.env,
            login="slv_layout_admin_2",
            groups="base.group_user,smart_list_view_pro.group_preset_admin",
        )
        cls.portal = new_test_user(cls.env, login="slv_portal", groups="base.group_portal")
        cls.public = cls.env.ref("base.public_user")
        cls.default_layout = layout(("name", True, 240), ("email", True), ("phone", False))

    def preset_model(self, user):
        return self.env["smart.list.preset"].with_user(user)

    def vals(self, **kw):
        return {
            "name": "Follow-ups",
            "model_name": "res.partner",
            "layout_json": self.default_layout,
            **kw,
        }

    def make(self, user, **kw):
        return self.preset_model(user).create(self.vals(**kw))
