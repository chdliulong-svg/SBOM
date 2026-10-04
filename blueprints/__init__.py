# blueprints/__init__.py
"""
Blueprints package initialization for Service BOM application.
Registers all modular domain blueprints onto the Flask application.
"""

from .auth import auth_bp
from .projects import projects_bp
from .bom import bom_bp
from .materials import materials_bp
from .compare import compare_bp
from .assets import assets_bp
from .backups import backups_bp


def register_blueprints(app):
    """
    Registers all domain blueprints onto the given Flask application instance.
    All routes keep their exact root /api path without prefix changes, ensuring
    100% backward compatibility with all frontend scripts.
    """
    app.register_blueprint(auth_bp)
    app.register_blueprint(projects_bp)
    app.register_blueprint(bom_bp)
    app.register_blueprint(materials_bp)
    app.register_blueprint(compare_bp)
    app.register_blueprint(assets_bp)
    app.register_blueprint(backups_bp)
