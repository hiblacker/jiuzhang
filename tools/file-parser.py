#!/usr/bin/env python3
"""Bounded structured-file to JSONL parser used by the lake inbox worker."""

import argparse
import csv
import datetime as dt
import decimal
import json
import os
import sys
from pathlib import Path


def json_default(value):
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, bytes):
        return {"encoding": "hex", "value": value.hex()}
    raise TypeError(f"UNSUPPORTED_VALUE:{type(value).__name__}")


def emit(rows, output, max_rows):
    count = 0
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            if count >= max_rows:
                raise ValueError("ROW_LIMIT_EXCEEDED")
            if not isinstance(row, dict):
                raise ValueError("ROW_MUST_BE_OBJECT")
            handle.write(json.dumps(row, ensure_ascii=False, default=json_default, separators=(",", ":")))
            handle.write("\n")
            count += 1
    return count


def parse_csv(source, output, max_rows):
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(8192)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(handle, dialect=dialect)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError("CSV_HEADER_REQUIRED")
        fields = []
        seen = {}
        for raw in header:
            name = (raw or "").strip()
            if not name:
                raise ValueError("CSV_EMPTY_HEADER")
            seen[name] = seen.get(name, 0) + 1
            fields.append(name if seen[name] == 1 else f"{name}__{seen[name]}")
        def rows():
            for values in reader:
                if len(values) > len(fields):
                    raise ValueError("CSV_TOO_MANY_FIELDS")
                padded = values + [None] * (len(fields) - len(values))
                yield {fields[index]: padded[index] for index in range(len(fields))}
        return emit(rows(), output, max_rows)


def value_at(value, pointer):
    if not pointer:
        return value
    parts = pointer.split("/")[1:] if pointer.startswith("/") else [part for part in pointer.split(".") if part]
    current = value
    for part in parts:
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list) and part.isdigit():
            current = current[int(part)]
        elif isinstance(current, dict) and part in current:
            current = current[part]
        else:
            raise ValueError("RECORDS_PATH_NOT_FOUND")
    return current


def parse_json(source, output, jsonl, max_rows, records_path):
    if jsonl:
        def rows():
            with source.open("r", encoding="utf-8-sig") as handle:
                for line in handle:
                    if line.strip():
                        value = value_at(json.loads(line), records_path)
                        if isinstance(value, list):
                            yield from value
                        else:
                            yield value
        return emit(rows(), output, max_rows)
    with source.open("r", encoding="utf-8-sig") as handle:
        value = value_at(json.load(handle), records_path)
    if isinstance(value, list):
        return emit(value, output, max_rows)
    return emit([value], output, max_rows)


def parse_xlsx(source, output, max_rows):
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError("PARSER_DEPENDENCY_MISSING:openpyxl") from exc
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True, keep_links=False)
    total = 0
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with output.open("w", encoding="utf-8", newline="\n") as handle:
            for sheet in workbook.worksheets:
                rows = sheet.iter_rows(values_only=True)
                try:
                    header = next(rows)
                except StopIteration:
                    continue
                names = []
                seen = {}
                for index, raw in enumerate(header):
                    name = str(raw).strip() if raw is not None else ""
                    if not name:
                        name = f"column_{index + 1}"
                    seen[name] = seen.get(name, 0) + 1
                    names.append(name if seen[name] == 1 else f"{name}__{seen[name]}")
                for values in rows:
                    if not any(value is not None for value in values):
                        continue
                    if total >= max_rows:
                        raise ValueError("ROW_LIMIT_EXCEEDED")
                    row = {"_sheet": sheet.title}
                    row.update({names[i]: values[i] if i < len(values) else None for i in range(len(names))})
                    handle.write(json.dumps(row, ensure_ascii=False, default=json_default, separators=(",", ":")))
                    handle.write("\n")
                    total += 1
    finally:
        workbook.close()
    return total


def parse_parquet(source, output, max_rows):
    try:
        import pyarrow.parquet as parquet
    except ImportError as exc:
        raise RuntimeError("PARSER_DEPENDENCY_MISSING:pyarrow") from exc
    file = parquet.ParquetFile(source)
    total = 0
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        for batch in file.iter_batches(batch_size=10_000):
            for row in batch.to_pylist():
                if total >= max_rows:
                    raise ValueError("ROW_LIMIT_EXCEEDED")
                handle.write(json.dumps(row, ensure_ascii=False, default=json_default, separators=(",", ":")))
                handle.write("\n")
                total += 1
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", required=True, choices=["csv", "json", "jsonl", "xlsx", "parquet"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-rows", required=True, type=int)
    parser.add_argument("--records-path", default="")
    args = parser.parse_args()
    if args.max_rows < 1:
        raise ValueError("INVALID_MAX_ROWS")
    source = Path(args.input)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if args.format == "csv": count = parse_csv(source, output, args.max_rows)
    elif args.format in {"json", "jsonl"}: count = parse_json(source, output, args.format == "jsonl", args.max_rows, args.records_path)
    elif args.format == "xlsx": count = parse_xlsx(source, output, args.max_rows)
    else: count = parse_parquet(source, output, args.max_rows)
    print(json.dumps({"rows": count, "format": args.format}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # keep stderr free of payloads and source paths
        print(str(exc).split(":", 1)[0], file=sys.stderr)
        sys.exit(1)
