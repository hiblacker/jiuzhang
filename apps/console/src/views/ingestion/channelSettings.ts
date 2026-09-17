// The request configuration a channel submit sends for each source kind. Pure function of the
// form state, kept out of the wizard component so it can be unit tested on its own.
export interface ChannelFormState {
  resourceId: number | null;
  connectionCode: string;
  connectionName: string;
  database: string;
  code: string;
  name: string;
  relativeDirectory: string;
  datePartitioned: boolean;
  mode: string;
  readiness: string;
  expectedFiles: string;
  allowEmpty: boolean;
  allowContentRevision: boolean;
  stableMs: number;
  dueTime: string;
  dueDayOffset: number;
  format: string;
  encoding: string;
  delimiter: string;
  sheets: string;
  range: string;
  recordsPath: string;
  formulaPolicy: string;
  path: string;
  pagination: string;
  apiRecordsPath: string;
  pageSize: number;
  maxPages: number;
  nextPath: string;
  cursorParam: string;
  successPath: string;
  successValue: string;
  triggerTime: string;
  startDate: string;
  lateDays: number;
  historicalRead: boolean;
  connectionVersion: number;
  mysqlTables: string;
  sourceMode: string;
}

export interface ChannelSettingsInput {
  kind: string;
  form: ChannelFormState;
  base?: Record<string, any> | null;
}

export function channelSettings({ kind, form, base }: ChannelSettingsInput): Record<string, unknown> {
  if (kind === 'MYSQL_SNAPSHOT') {
    if (form.sourceMode === 'REGISTERED_SQL') return { sourceMode: 'REGISTERED_SQL' };
    return form.mysqlTables.trim()
      ? {
          tables: form.mysqlTables
            .split('\n')
            .map((v: string) => v.trim())
            .filter(Boolean),
        }
      : { sourceMode: 'TABLE_LIST' };
  }
  if (kind === 'REST_PULL') {
    const result: Record<string, unknown> = {
      ...base,
      path: form.path,
      pagination: {
        ...base?.pagination,
        mode: form.pagination,
        records_path: form.apiRecordsPath,
        page_size: form.pageSize,
        max_pages: form.maxPages,
        ...(['next', 'token'].includes(form.pagination)
          ? { next_path: form.nextPath, cursor_param: form.cursorParam }
          : {}),
      },
    };
    if (!form.successPath) delete result.success;
    if (form.successPath)
      result.success = {
        path: form.successPath,
        equals: form.successValue === 'true' ? true : form.successValue === 'false' ? false : form.successValue,
      };
    return result;
  }
  const parser: Record<string, unknown> = { ...base?.delivery?.parser };
  if (form.format === 'csv') {
    parser.encoding = form.encoding;
    parser.delimiter = form.delimiter;
  }
  if (form.format === 'xlsx') {
    if (form.sheets)
      parser.sheets = form.sheets
        .split(',')
        .map((v: string) => v.trim())
        .filter(Boolean);
    if (form.range) parser.range = form.range;
    parser.formulaPolicy = form.formulaPolicy;
  }
  if (form.format === 'json') parser.recordsPath = form.recordsPath;
  return {
    relativeDirectory: form.relativeDirectory,
    datePartitioned: form.datePartitioned,
    delivery: {
      ...base?.delivery,
      version: 1,
      mode: form.mode,
      readiness: form.readiness,
      stableMs: form.stableMs,
      expectedFiles: form.expectedFiles
        .split('\n')
        .map((v: string) => v.trim())
        .filter(Boolean),
      allowEmpty: form.allowEmpty,
      allowContentRevision: form.allowContentRevision,
      dueTime: form.dueTime,
      dueDayOffset: form.dueDayOffset,
      parser,
    },
  };
}
