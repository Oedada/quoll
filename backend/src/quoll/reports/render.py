"""Файлы отчёта из готовых строк (reports-design §10).

без БД и без цикла событий: выполняется в пуле процессов рендера. Вход -
неизменяемые dataclass-ы, они переезжают в другой процесс
"""

import io
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import openpyxl
import xlwt
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

from quoll.reports import labels
from quoll.reports.policy import Row

# шапка: заголовок, период, 7 фильтров, автор, дата, число строк, пустая строка.
# от неё зависит предел xls: 65 536 - шапка - заголовки - итог
XLS_HEADER_ROWS = 13
XLS_SHEET_ROWS = 65_536

_FONTS = Path(__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("DejaVu", _FONTS / "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", _FONTS / "DejaVuSans-Bold.ttf"))

# доли ширины колонки в pdf
_PDF_WEIGHTS = {
    "university": 3,
    "direction": 2,
    "program": 3,
    "product": 3,
    "status": 3,
    "responsible": 3,
    "students": 1,
    "streams": 1,
    "teachers_kam": 1.3,
    "teachers_lms": 1.3,
    "transitions": 5,
    "contract_number": 2,
    "license_until": 1.6,
    "transfer_status": 1.6,
    "region": 2,
}


@dataclass(frozen=True)
class Header:
    period: str
    filters: tuple[tuple[str, str], ...]
    author: str
    formed_at: str
    row_count: int

    def lines(self) -> list[str]:
        """ровно XLS_HEADER_ROWS - 1 строк, последняя строка шапки пустая"""
        return [
            labels.TITLE,
            f"Период: {self.period}",
            *(f"{name}: {value}" for name, value in self.filters),
            f"Автор: {self.author}",
            f"Сформирован: {self.formed_at}",
            f"Строк: {self.row_count}",
        ]


def cells(row: Row, columns: list[str]) -> list:
    """значения колонок: числа и даты - как есть, пустое - прочерк"""
    values = {
        "university": row.university,
        "direction": row.direction or labels.NOT_SET["direction"],
        "program": row.program or labels.NOT_SET["program"],
        "product": row.product or labels.NOT_SET["product"],
        "status": row.status.label,
        "responsible": labels.responsible(row.responsible_name, row.earlier_name),
        "students": None,
        "streams": None,
        "teachers_kam": row.teachers_kam,
        "teachers_lms": None,
        "transitions": labels.moves(row.moves),
        "contract_number": row.contract_number,
        "license_until": row.license_until,
        "transfer_status": labels.TRANSFER.get(row.transfer_status),
        "region": row.region,
    }
    return [labels.DASH if values[c] is None else values[c] for c in columns]


def _total(rows: list[Row], columns: list[str]) -> list | None:
    """итог по числу обученных КАМом; LMS не суммируются - данных нет (В1)"""
    if "teachers_kam" not in columns:
        return None
    total = sum(r.teachers_kam or 0 for r in rows)
    return ["Итого", *(total if c == "teachers_kam" else "" for c in columns[1:])]


def xlsx(header: Header, rows: list[Row], columns: list[str]) -> bytes:
    book = openpyxl.Workbook(write_only=True)
    sheet = book.create_sheet("Отчёт")
    # закреплена строка заголовков - первая строка под ней
    sheet.freeze_panes = f"A{XLS_HEADER_ROWS + 2}"
    for line in header.lines():
        sheet.append([line])
    sheet.append([])
    bold = Font(bold=True)
    titles = []
    for c in columns:
        cell = WriteOnlyCell(sheet, value=labels.COLUMNS[c])
        cell.font = bold
        titles.append(cell)
    sheet.append(titles)
    for row in rows:
        out = []
        for value in cells(row, columns):
            cell = WriteOnlyCell(sheet, value=value)
            if isinstance(value, date):
                cell.number_format = "DD.MM.YYYY"
            out.append(cell)
        sheet.append(out)
    if (total := _total(rows, columns)) is not None:
        sheet.append(total)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def xls(header: Header, rows: list[Row], columns: list[str]) -> bytes:
    book = xlwt.Workbook(encoding="utf-8")
    sheet = book.add_sheet("Отчёт")
    bold = xlwt.easyxf("font: bold on")
    day = xlwt.easyxf(num_format_str="DD.MM.YYYY")
    for n, line in enumerate(header.lines()):
        sheet.write(n, 0, line)
    top = XLS_HEADER_ROWS
    for n, c in enumerate(columns):
        sheet.write(top, n, labels.COLUMNS[c], bold)
    sheet.set_panes_frozen(True)
    sheet.set_horz_split_pos(top + 1)
    for r, row in enumerate(rows, start=top + 1):
        for n, value in enumerate(cells(row, columns)):
            if isinstance(value, date):
                sheet.write(r, n, value, day)
            else:
                sheet.write(r, n, value)
    if (total := _total(rows, columns)) is not None:
        for n, value in enumerate(total):
            sheet.write(top + 1 + len(rows), n, value, bold)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


class _NumberedCanvas(canvas.Canvas):
    """ "стр. N из M": страницы копятся, номера ставятся, когда M известно"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages = []

    def showPage(self):  # noqa: N802 - имя из reportlab
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        count = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self.setFont("DejaVu", 8)
            self.drawRightString(
                self._pagesize[0] - 10 * mm,
                7 * mm,
                f"стр. {self._pageNumber} из {count}",
            )
            super().showPage()
        super().save()


def pdf(header: Header, rows: list[Row], columns: list[str]) -> bytes:
    buffer = io.BytesIO()
    page = landscape(A4)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=12 * mm,
        title=labels.TITLE,
    )
    text = ParagraphStyle("text", fontName="DejaVu", fontSize=7, leading=8.5)
    head = ParagraphStyle("head", parent=text, fontName="DejaVu-Bold")
    title = ParagraphStyle("title", parent=head, fontSize=12, leading=15)
    story = [Paragraph(labels.TITLE, title)]
    story += [Paragraph(_escape(line), text) for line in header.lines()[1:]]
    story.append(Spacer(1, 4 * mm))
    data = [[Paragraph(labels.COLUMNS[c], head) for c in columns]]
    for row in rows:
        data.append(
            [Paragraph(_escape(_pdf_text(v)), text) for v in cells(row, columns)]
        )
    if (total := _total(rows, columns)) is not None:
        data.append([Paragraph(_escape(str(v)), head) for v in total])
    weights = [_PDF_WEIGHTS[c] for c in columns]
    width = page[0] - 20 * mm
    table = LongTable(
        data,
        colWidths=[width * w / sum(weights) for w in weights],
        repeatRows=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(table)
    doc.build(story, canvasmaker=_NumberedCanvas)
    return buffer.getvalue()


def _pdf_text(value) -> str:
    return value.strftime("%d.%m.%Y") if isinstance(value, date) else str(value)


def _escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


RENDERERS = {"xlsx": xlsx, "xls": xls, "pdf": pdf}
CONTENT_TYPES = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "pdf": "application/pdf",
}
