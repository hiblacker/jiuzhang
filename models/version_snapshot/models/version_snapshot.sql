-- Preserve current source values. No status mapping, deletion filter or history inference.
select "ID" as version_id,
       "PROJECT_ID" as project_id,
       "NAME" as name,
       "STATUS" as status_code,
       "DELETE_FLAG" as delete_flag,
       "CREATE_TIME" as source_created_time,
       "UPDATE_TIME" as source_updated_time
from {{ source('lake', 'versions') }}
