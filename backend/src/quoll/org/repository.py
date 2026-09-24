"""Витрины оргструктуры. Всё одним запросом на витрину, загрузка - из
manager_load_subquery, чтобы числа не расходились с проверками ёмкости"""

from sqlalchemy import ColumnElement, Select, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.models import Manager, Superviser, User, UserRole
from quoll.auth.pending_actions import PendingOrgAction
from quoll.interactions.capacity_policy import (
    EffectiveStatus,
    effective_status_expression,
    manager_load_subquery,
)
from quoll.org.schemas import (
    ManagerLoadRead,
    SupervisorCapacityRead,
    SupervisorQuotaRead,
)


def _team_size_subquery():
    return (
        select(Manager.superviser_id, func.count().label("size"))
        .where(Manager.superviser_id.is_not(None))
        .group_by(Manager.superviser_id)
        .subquery("team_size")
    )


class OrgRepository:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.load = manager_load_subquery()
        self.status = effective_status_expression(self.load.c.capacity_used)

    def _managers(self) -> Select:
        # по загрузке, id вторым ключом - иначе при равной загрузке страницы плывут
        return (
            select(
                Manager,
                self.load.c.capacity_used,
                self.load.c.open_projects,
                self.load.c.blocking_projects,
                self.status.label("effective_status"),
            )
            .join(self.load, self.load.c.manager_id == Manager.id)
            .order_by(self.load.c.capacity_used, Manager.id)
        )

    async def _read(self, stmt: Select) -> list[ManagerLoadRead]:
        rows = await self.session.execute(stmt)
        return [
            ManagerLoadRead(
                id=m.id,
                username=m.username,
                first_name=m.first_name,
                last_name=m.last_name,
                superviser_id=m.superviser_id,
                manual_workload_status=m.manual_workload_status,
                max_active_projects=m.max_active_projects,
                capacity_used=used,
                open_projects=open_,
                blocking_projects=blocking,
                effective_status=status,
            )
            for m, used, open_, blocking, status in rows
        ]

    async def managers_where(
        self,
        *conditions: ColumnElement[bool],
        limit: int | None = None,
        offset: int = 0,
    ) -> list[ManagerLoadRead]:
        stmt = self._managers().where(*conditions).offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)
        return await self._read(stmt)

    async def team(self, superviser_id: str) -> list[ManagerLoadRead]:
        return await self.managers_where(Manager.superviser_id == superviser_id)

    async def recruitment_pool(self, limit: int, offset: int) -> list[ManagerLoadRead]:
        """Пул А: без руководителя и в строю. Ручной статус не важен - можно
        взять в штат того, кто пока не берёт новые проекты"""
        return await self.managers_where(
            Manager.superviser_id.is_(None),
            not_(incapacitated_expression(Manager)),
            limit=limit,
            offset=offset,
        )

    async def assignment_pool(
        self, superviser_id: str, limit: int, offset: int
    ) -> list[ManagerLoadRead]:
        """Пул Б: своя команда, готовые взять новую заявку"""
        return await self.managers_where(
            Manager.superviser_id == superviser_id,
            self.status == EffectiveStatus.AVAILABLE,
            limit=limit,
            offset=offset,
        )

    async def orphaned_pool(self, limit: int, offset: int) -> list[ManagerLoadRead]:
        """Пул В: в строю, а руководитель выбыл - их может усыновить другой"""
        boss = aliased(User)
        orphaned = select(Manager.id).join(boss, Manager.superviser_id == boss.id)
        return await self.managers_where(
            Manager.id.in_(orphaned.where(incapacitated_expression(boss))),
            not_(incapacitated_expression(Manager)),
            limit=limit,
            offset=offset,
        )

    async def free_project_capacity(
        self, except_id: str | None
    ) -> list[SupervisorCapacityRead]:
        """свободные слоты готовых менеджеров по командам - куда отдать проект"""
        free = (
            select(
                Manager.superviser_id,
                func.sum(Manager.max_active_projects - self.load.c.capacity_used).label(
                    "slots"
                ),
            )
            .join(self.load, self.load.c.manager_id == Manager.id)
            .where(self.status == EffectiveStatus.AVAILABLE)
            .group_by(Manager.superviser_id)
            .subquery("free")
        )
        stmt = (
            select(Superviser, free.c.slots)
            .join(free, free.c.superviser_id == Superviser.id)
            .where(not_(incapacitated_expression(Superviser)))
            .order_by(free.c.slots.desc(), Superviser.id)
        )
        if except_id is not None:
            stmt = stmt.where(Superviser.id != except_id)
        rows = await self.session.execute(stmt)
        return [
            SupervisorCapacityRead(
                id=s.id,
                first_name=s.first_name,
                last_name=s.last_name,
                free_project_slots=slots,
            )
            for s, slots in rows
        ]

    async def free_team_quota(self, except_id: str | None) -> list[SupervisorQuotaRead]:
        """вакантные места в штате по командам - куда перевести человека"""
        size = _team_size_subquery()
        places = Superviser.max_subordinates - func.coalesce(size.c.size, 0)
        stmt = (
            select(Superviser, places)
            .outerjoin(size, size.c.superviser_id == Superviser.id)
            .where(not_(incapacitated_expression(Superviser)), places > 0)
            .order_by(places.desc(), Superviser.id)
        )
        if except_id is not None:
            stmt = stmt.where(Superviser.id != except_id)
        rows = await self.session.execute(stmt)
        return [
            SupervisorQuotaRead(
                id=s.id, first_name=s.first_name, last_name=s.last_name, free_places=n
            )
            for s, n in rows
        ]

    async def team_size(self, superviser_id: str) -> int:
        stmt = select(func.count()).where(Manager.superviser_id == superviser_id)
        return await self.session.scalar(stmt) or 0

    async def pending_actions(
        self, viewer: User, limit: int, offset: int
    ) -> list[PendingOrgAction]:
        """админ видит все задачи, руководитель - поставленные им и по своим"""
        stmt = select(PendingOrgAction)
        if viewer.role != UserRole.ADMIN:
            team = select(Manager.id).where(Manager.superviser_id == viewer.id)
            stmt = stmt.where(
                or_(
                    PendingOrgAction.origin_supervisor_id == viewer.id,
                    PendingOrgAction.target_id.in_(team),
                )
            )
        stmt = (
            stmt.order_by(PendingOrgAction.created_at.desc(), PendingOrgAction.id)
            .limit(limit)
            .offset(offset)
        )
        return list((await self.session.execute(stmt)).scalars().all())
