{
    "name": "Smart List View Pro",
    "summary": "Save personal list layouts and publish team presets without modifying business records.",
    "version": "19.0.1.0.0",
    "category": "Productivity",
    "author": "Softdeviser",
    "website": "https://softdeviser.com",
    "support": "rahul@softdeviser.com",
    "license": "OPL-1",
    "price": 79.0,
    "currency": "USD",
    "depends": ["base", "web"],
    "data": [
        "security/smart_list_security.xml",
        "security/ir.model.access.csv",
    ],
    "assets": {
        "web.assets_backend": [
            (
                "after",
                "web/static/src/views/list/list_controller.xml",
                "smart_list_view_pro/static/src/xml/list_view_extension.xml",
            ),
            "smart_list_view_pro/static/src/js/**/*.js",
            "smart_list_view_pro/static/src/xml/layout_panel.xml",
            "smart_list_view_pro/static/src/scss/**/*.scss",
        ],
        "web.assets_tests": [
            "smart_list_view_pro/static/tests/tours/**/*.js",
        ],
        "web.assets_unit_tests": [
            "smart_list_view_pro/static/tests/*.test.js",
        ],
    },
    "images": ["static/description/banner.gif"],
    "installable": True,
    "application": False,
}
