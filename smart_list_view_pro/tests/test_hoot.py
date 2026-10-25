from odoo.addons.web.tests.test_js import unit_test_error_checker
from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestSmartListHoot(HttpCase):
    def test_hoot_unit_tests(self):
        self.browser_js(
            "/web/tests?headless&loglevel=2&preset=desktop&timeout=60000"
            "&filter=smart_list_view_pro",
            "",
            "",
            login="admin",
            timeout=1800,
            success_signal="[HOOT] Test suite succeeded",
            error_checker=unit_test_error_checker,
        )
