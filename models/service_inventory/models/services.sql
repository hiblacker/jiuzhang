select id as service_id, team as owner_team, observed_at
from {{ source('lake', 'services') }}
