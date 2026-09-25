"""merge patronymic

Revision ID: 2e231c59583c
Revises: 7165274f3290, c5b694984c55
Create Date: 2026-09-25 20:57:49.106188

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2e231c59583c'
down_revision: Union[str, Sequence[str], None] = ('7165274f3290', 'c5b694984c55')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
