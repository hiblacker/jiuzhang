-- Synthetic contract only: do not infer actual order/delete/status rules.
select id as order_id, team, amount
from {{ source('lake', 'orders') }}
