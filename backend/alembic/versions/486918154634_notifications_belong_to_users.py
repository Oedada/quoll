"""notifications belong to users

таблицу создаёт 3d0d4ada7028, здесь только внешний ключ на пользователя

Revision ID: 486918154634
Revises: 3d0d4ada7028
Create Date: 2026-09-24 17:07:31.190031

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "486918154634"
down_revision: str | Sequence[str] | None = "3d0d4ada7028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # раньше уведомление можно было отправить кому угодно, в том числе
    # несуществующему пользователю - такие строки не дадут создать ключ
    op.execute("DELETE FROM notifies WHERE user_id NOT IN (SELECT id FROM users)")
    op.create_foreign_key(
        op.f("fk_notifies_user_id_users"),
        "notifies",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("fk_notifies_user_id_users"), "notifies", type_="foreignkey"
    )
