"""Проходимость живого графа. Чистые правила, в базу не ходят.

после правки опубликованного воркфлоу: ровно одна начальная стадия и из всего,
куда заявка может попасть - от начальной или с занятых стадий, - достижима
терминальная. Недостижимая пустая стадия разрешена: админ собирает новый шаг.
Публикация строже - достижимо должно быть всё
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class StageFacts:
    id: int
    is_terminal: bool
    archived: bool


@dataclass(frozen=True)
class EdgeFacts:
    from_stage_id: int | None
    to_stage_id: int


def _reachable(starts: Iterable[int], forward: dict[int, set[int]]) -> set[int]:
    seen: set[int] = set()
    todo = list(starts)
    while todo:
        stage = todo.pop()
        if stage in seen:
            continue
        seen.add(stage)
        todo.extend(forward[stage] - seen)
    return seen


def graph_problems(
    stages: list[StageFacts],
    edges: list[EdgeFacts],
    occupied: set[int],
    *,
    full: bool,
) -> list[str]:
    """что не так с графом; пусто - граф проходим. edges - только активные"""
    live = {s.id: s for s in stages if not s.archived}
    problems = []

    dangling = [
        e
        for e in edges
        if e.to_stage_id not in live
        or (e.from_stage_id is not None and e.from_stage_id not in live)
    ]
    if dangling:
        problems.append("active transitions touch archived or foreign stages")

    starts = [
        e.to_stage_id
        for e in edges
        if e.from_stage_id is None and e.to_stage_id in live
    ]
    if len(starts) != 1:
        problems.append(f"expected exactly one start stage, found {len(starts)}")

    forward: dict[int, set[int]] = defaultdict(set)
    backward: dict[int, set[int]] = defaultdict(set)
    for e in edges:
        if e.from_stage_id in live and e.to_stage_id in live:
            forward[e.from_stage_id].add(e.to_stage_id)
            backward[e.to_stage_id].add(e.from_stage_id)

    # куда заявка может попасть: от начальной и с уже занятых стадий
    route = _reachable([*starts, *(s for s in occupied if s in live)], forward)
    finishing = _reachable([s.id for s in live.values() if s.is_terminal], backward)
    dead_ends = sorted(route - finishing)
    if dead_ends:
        problems.append(f"no way to a terminal stage from stages {dead_ends}")

    stranded = sorted(s for s in occupied if s not in live)
    if stranded:
        problems.append(f"interactions stand on archived stages {stranded}")

    if full:
        unreachable = sorted(set(live) - _reachable(starts, forward))
        if unreachable:
            problems.append(f"stages {unreachable} are unreachable from the start")
    return problems
