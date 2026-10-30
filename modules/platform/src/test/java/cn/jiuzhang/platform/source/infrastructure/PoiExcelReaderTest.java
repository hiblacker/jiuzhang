package cn.jiuzhang.platform.source.infrastructure;

import static org.assertj.core.api.Assertions.*;

import cn.jiuzhang.platform.shared.application.Failure;
import java.io.ByteArrayOutputStream;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

class PoiExcelReaderTest {
  private final PoiExcelReader reader = new PoiExcelReader();
  private byte[] bytes(Workbook book) throws Exception {
    var out = new ByteArrayOutputStream(); book.write(out); return out.toByteArray();
  }
  @Test void preservesTextIdsRawDecimalsBooleansNullsAndSelectedHeaders() throws Exception {
    try (var book = new XSSFWorkbook()) {
      book.createSheet("Reference");
      var sheet = book.createSheet("Orders");
      sheet.createRow(0).createCell(0).setCellValue("Report title");
      var header = sheet.createRow(1);
      String[] names = {"id", "amount", "客户", "enabled", "empty"};
      for (int i=0;i<names.length;i++) header.createCell(i).setCellValue(names[i]);
      var row = sheet.createRow(2);
      row.createCell(0).setCellValue("9007199254740993");
      row.createCell(1).setCellValue(12345.67);
      row.getCell(1).getCTCell().setV("12345.6700");
      row.createCell(2).setCellValue("00123");
      row.createCell(3).setCellValue(false);
      byte[] file = bytes(book);
      assertThat(reader.sheets(file)).containsExactly("Reference", "Orders");
      var table = reader.read(file, "Orders", 2);
      assertThat(table.columns().get(1).type()).isEqualTo("decimal(9,4)");
      assertThat(table.rows()).hasSize(1);
      assertThat(table.rows().getFirst()).containsEntry("id", "9007199254740993")
          .containsEntry("amount", "12345.6700").containsEntry("客户", "00123")
          .containsEntry("enabled", false).containsEntry("empty", null);
    }
  }
  @Test void readsLegacyXlsAndCachedFormulasWithoutEvaluation() throws Exception {
    try (var book = new HSSFWorkbook()) {
      var sheet = book.createSheet("Legacy");
      sheet.createRow(0).createCell(0).setCellValue("total");
      var formula = sheet.createRow(1).createCell(0);
      formula.setCellFormula("1+2");
      book.getCreationHelper().createFormulaEvaluator().evaluateFormulaCell(formula);
      assertThat(reader.read(bytes(book),"Legacy",1).rows().getFirst()).containsEntry("total","3");
    }
  }
  @Test void rejectsDuplicateOrBlankHeadersAndMissingWorksheet() throws Exception {
    try (var book = new XSSFWorkbook()) {
      var sheet = book.createSheet("Sheet1");
      var header = sheet.createRow(0);header.createCell(0).setCellValue("ID");header.createCell(1).setCellValue("id");
      assertThatThrownBy(()->reader.read(bytes(book),"Sheet1",1)).isInstanceOfSatisfying(Failure.class,e->assertThat(e.code).isEqualTo("EXCEL_HEADER_INVALID"));
      header.getCell(1).setCellValue("");
      assertThatThrownBy(()->reader.read(bytes(book),"Sheet1",1)).isInstanceOfSatisfying(Failure.class,e->assertThat(e.code).isEqualTo("EXCEL_HEADER_INVALID"));
      assertThatThrownBy(()->reader.read(bytes(book),"Missing",1)).isInstanceOfSatisfying(Failure.class,e->assertThat(e.code).isEqualTo("EXCEL_SHEET_MISSING"));
    }
  }
  @Test void rejectsInvalidFilesUncachedFormulasAndUnheadedData() throws Exception {
    assertThatThrownBy(()->reader.sheets(new byte[]{1,2,3})).isInstanceOf(Failure.class);
    try (var book = new XSSFWorkbook()) {
      var sheet = book.createSheet("Sheet1");sheet.createRow(0).createCell(0).setCellValue("id");
      var row=sheet.createRow(1);row.createCell(0).setCellFormula("1+2");
      assertThatThrownBy(()->reader.read(bytes(book),"Sheet1",1)).isInstanceOfSatisfying(Failure.class,e->assertThat(e.code).isEqualTo("EXCEL_FORMULA_RESULT_MISSING"));
      row.getCell(0).setCellValue("text");row.createCell(1).setCellValue("extra");
      assertThatThrownBy(()->reader.read(bytes(book),"Sheet1",1)).isInstanceOfSatisfying(Failure.class,e->assertThat(e.code).isEqualTo("EXCEL_HEADER_INVALID"));
    }
  }
  @Test void preservesExcelDatesAndDistinguishesEmptyStringsFromMissingCells() throws Exception {
    try (var book=new XSSFWorkbook()) {
      var sheet=book.createSheet("Dates");var header=sheet.createRow(0);
      header.createCell(0).setCellValue("at");header.createCell(1).setCellValue("text");header.createCell(2).setCellValue("missing");
      var row=sheet.createRow(1);var date=row.createCell(0);
      date.setCellValue(java.time.LocalDateTime.of(2026,10,30,12,34,56));
      var style=book.createCellStyle();style.setDataFormat(book.createDataFormat().getFormat("yyyy-mm-dd hh:mm:ss"));date.setCellStyle(style);
      row.createCell(1).setCellValue("");
      var table=reader.read(bytes(book),"Dates",1);
      assertThat(table.columns().getFirst().type()).isEqualTo("datetime");
      assertThat(table.rows().getFirst()).containsEntry("at","2026-10-30 12:34:56").containsEntry("text","").containsEntry("missing",null);
    }
  }
}
