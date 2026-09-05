from __future__ import annotations

import typer

app = typer.Typer(name="browserflow", help="BrowserFlow administration CLI", no_args_is_help=True)
admin_app = typer.Typer(help="Administrator commands")
app.add_typer(admin_app, name="admin")


@admin_app.command("create")
def admin_create(
    email: str = typer.Option(..., prompt=True),
    password: str = typer.Option(..., prompt=True, hide_input=True, confirmation_prompt=True),
) -> None:
    """Create the first administrator account."""
    from browserflow.cli.admin import create_admin

    create_admin(email=email, password=password)


@admin_app.command("reset-password")
def admin_reset_password(
    email: str = typer.Option(..., prompt=True),
    password: str = typer.Option(..., prompt=True, hide_input=True, confirmation_prompt=True),
) -> None:
    """Reset an administrator password."""
    from browserflow.cli.admin import reset_admin_password

    reset_admin_password(email=email, password=password)


@app.command("version")
def version() -> None:
    typer.echo("browserflow 1.0.0")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
