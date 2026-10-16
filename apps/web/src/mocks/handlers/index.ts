import { http, HttpResponse } from 'msw'
import { sourceHandlers } from './sources'
import { overviewHandlers } from './overview'
import { datasetHandlers } from './datasets'
import { folderHandlers } from './folders'
import { jobHandlers } from './jobs'
import { governanceHandlers } from './governance'
import { systemHandlers } from './system'
import { warehouseHandlers } from './warehouse'
import { serviceHandlers } from './services'
import { controlHandlers } from './control'
export const handlers = [
  ...sourceHandlers,
  ...datasetHandlers,
  ...folderHandlers,
  ...jobHandlers,
  ...governanceHandlers,
  ...systemHandlers,
  ...warehouseHandlers,
  ...serviceHandlers,
  ...overviewHandlers,
  ...controlHandlers,
  http.all('/api/v1/*', () =>
    HttpResponse.json(
      {
        error: {
          code: 'NOT_IMPLEMENTED',
          message: '该演示接口尚未实现',
          details: [],
          requestId: crypto.randomUUID(),
        },
      },
      { status: 501 },
    ),
  ),
]
