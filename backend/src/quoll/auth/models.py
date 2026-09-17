from sqlalchemy.orm import Mapped, mapped_column

from quoll.db import Base

class Session(Base):

    __tablename__ = 'sessions'

    id: Mapped[int] = mapped_column(primary_key=True)
    session_key: Mapped[str]
    


