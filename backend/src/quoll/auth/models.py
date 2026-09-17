from sqlalchemy.orm import Mapped, mapped_column

from quoll.db import Base

#В этой таблице все данные пользователя кроме авторизации

class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str]
    session_key: Mapped[str]
    access_key: Mapped[str]
    refresh_key: Mapped[str]
