class SystemDefaults:
    """Тут будут дефолтные значения, чтобы не хардкодить по коду.

    сюда кладем то, что либо в нескольких модулях, либо
    задаёт поведение и переедет в настройки админа.

    в config.Settings лежит то, что задается окржением. 
    Здесь же - то что запечатано в схему базы.
    """

    DEFAULT_MAX_SUBORDINATES = 5
    DEFAULT_MAX_ACTIVE_PROJECTS = 5

    # границы, в которых администратор может менять лимиты ёмкости
    MIN_CAPACITY_LIMIT = 1
    MAX_CAPACITY_LIMIT = 50

    # постраничная выдача списков
    DEFAULT_PAGE_SIZE = 50
    MAX_PAGE_SIZE = 100
