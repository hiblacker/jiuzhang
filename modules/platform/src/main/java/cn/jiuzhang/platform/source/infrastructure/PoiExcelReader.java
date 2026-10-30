package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.application.ExcelReader;
import cn.jiuzhang.platform.source.domain.SourceConnector.Column;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.util.*;
import java.util.zip.ZipInputStream;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.NumberToTextConverter;
import org.apache.poi.xssf.usermodel.XSSFCell;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

/** Reads stored values only. Never evaluates formulas, macros or external workbook references. */
@Component
public class PoiExcelReader implements ExcelReader {
  public static final int MAX_BYTES = 20 * 1024 * 1024;
  private static final int MAX_CELLS = 1_000_000;

  public List<String> sheets(byte[] file) {
    try (var book = open(file)) {
      if (book.getNumberOfSheets() < 1 || book.getNumberOfSheets() > 200)
        throw new Failure(422, "EXCEL_LIMIT");
      var names = new ArrayList<String>();
      for (var sheet : book) names.add(sheet.getSheetName());
      return names;
    } catch (Failure e) { throw e; }
    catch (Exception e) { var failure = new Failure(422, "EXCEL_FILE_INVALID"); failure.initCause(e); throw failure; }
  }

  public Table read(byte[] file, String name, int headerRow) {
    if (headerRow < 1 || headerRow > 1000) throw new Failure(422, "EXCEL_HEADER_INVALID");
    try (var book = open(file)) {
      var sheet = book.getSheet(name);
      if (sheet == null) throw new Failure(422, "EXCEL_SHEET_MISSING");
      var header = sheet.getRow(headerRow - 1);
      if (header == null || header.getLastCellNum() < 1) throw new Failure(422, "EXCEL_HEADER_INVALID");
      int width = header.getLastCellNum();
      if (width > 200 || sheet.getLastRowNum() - headerRow + 1 > 100_000)
        throw new Failure(422, "EXCEL_LIMIT");
      var names = new ArrayList<String>();
      var unique = new HashSet<String>();
      var formatter = new DataFormatter(Locale.ROOT);
      for (int i = 0; i < width; i++) {
        var cell = header.getCell(i);
        if (cell != null && cell.getCellType() == CellType.FORMULA)
          throw new Failure(422, "EXCEL_HEADER_INVALID");
        String text = formatter.formatCellValue(cell).strip();
        if (text.isEmpty() || text.length() > 64 || !unique.add(text.toLowerCase(Locale.ROOT)))
          throw new Failure(422, "EXCEL_HEADER_INVALID");
        names.add(text);
      }
      var rows = new ArrayList<Map<String, Object>>();
      var types = new ArrayList<Set<String>>();
      int[] scales = new int[width], integers = new int[width], lengths = new int[width];
      for (int i = 0; i < width; i++) types.add(new HashSet<>());
      int cells = 0;
      long deadline = System.nanoTime() + 30_000_000_000L;
      for (var row : sheet) {
        if (row.getRowNum() < headerRow) continue;
        if (System.nanoTime() > deadline || (cells += Math.max(width, row.getPhysicalNumberOfCells())) > MAX_CELLS)
          throw new Failure(422, "EXCEL_LIMIT");
        for (int i = width; i < row.getLastCellNum(); i++)
          if (row.getCell(i) != null && row.getCell(i).getCellType() != CellType.BLANK)
            throw new Failure(422, "EXCEL_HEADER_INVALID");
        var values = new LinkedHashMap<String, Object>();
        boolean nonempty = false;
        for (int i = 0; i < width; i++) {
          Object value = value(row.getCell(i));
          if (value != null) {
            nonempty = true;
            String type = "string";
            if (value instanceof BigDecimal number) {
              type = "number";
              scales[i] = Math.max(scales[i], Math.max(0, number.scale()));
              integers[i] = Math.max(integers[i], Math.max(0, number.precision() - number.scale()));
              value = number.toPlainString();
            } else if (value instanceof Boolean) type = "boolean";
            else if (value instanceof java.time.LocalDateTime date) {
              type = "datetime";
              value = date.toString().replace('T', ' ');
            }
            types.get(i).add(type);
            lengths[i] = Math.max(lengths[i], value.toString().length());
            if (value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 65533)
              throw new Failure(422, "EXCEL_LIMIT");
          }
          values.put(names.get(i), value);
        }
        if (nonempty) rows.add(values);
      }
      var columns = new ArrayList<Column>();
      for (int i = 0; i < width; i++) {
        var kinds = types.get(i);
        String type = kinds.size() == 1 ? kinds.iterator().next() : "string";
        int precision = Math.max(1, integers[i] + scales[i]);
        if (type.equals("number"))
          type = precision > 38 ? "string" : scales[i] == 0 ? "integer" : "decimal(" + precision + "," + scales[i] + ")";
        columns.add(new Column(names.get(i), type, precision, scales[i], lengths[i], true, names.get(i)));
      }
      return new Table(List.copyOf(columns), List.copyOf(rows));
    } catch (Failure e) { throw e; }
    catch (Exception e) { var failure = new Failure(422, "EXCEL_FILE_INVALID"); failure.initCause(e); throw failure; }
  }

  private Workbook open(byte[] file) throws Exception {
    if (file.length == 0 || file.length > MAX_BYTES) throw new Failure(422, "EXCEL_LIMIT");
    // Bound actual decompression before POI constructs its in-memory workbook.
    if (file[0] == 'P' && file.length > 1 && file[1] == 'K') {
      long expanded = 0;
      int entries = 0;
      try (var zip = new ZipInputStream(new ByteArrayInputStream(file))) {
        byte[] buffer = new byte[8192];
        while (zip.getNextEntry() != null) {
          if (++entries > 10000) throw new Failure(422, "EXCEL_LIMIT");
          int count;
          while ((count = zip.read(buffer)) != -1)
            if ((expanded += count) > 64L * 1024 * 1024) throw new Failure(422, "EXCEL_LIMIT");
        }
      }
    }
    var book = WorkbookFactory.create(new ByteArrayInputStream(file));
    if (book instanceof XSSFWorkbook xssf && xssf.isMacroEnabled()) {
      book.close();
      throw new Failure(422, "EXCEL_FILE_INVALID");
    }
    return book;
  }

  private Object value(Cell cell) {
    if (cell == null) return null;
    CellType type = cell.getCellType();
    if (type == CellType.FORMULA) {
      if (cell instanceof XSSFCell x && x.getRawValue() == null)
        throw new Failure(422, "EXCEL_FORMULA_RESULT_MISSING");
      type = cell.getCachedFormulaResultType();
    }
    return switch (type) {
      case BLANK, _NONE -> null;
      case STRING -> cell.getStringCellValue();
      case BOOLEAN -> cell.getBooleanCellValue();
      case NUMERIC -> DateUtil.isCellDateFormatted(cell) ? cell.getLocalDateTimeCellValue()
          : new BigDecimal(cell instanceof XSSFCell x ? x.getRawValue()
              : NumberToTextConverter.toText(cell.getNumericCellValue()));
      case ERROR -> throw new Failure(422, "EXCEL_CELL_ERROR");
      default -> throw new Failure(422, "EXCEL_FILE_INVALID");
    };
  }
}
