#!/usr/bin/env python3
"""Restart the owned local stack and verify durable records remain unchanged."""
from importlib import import_module
import os


def main():
    local = import_module('local-stack')
    sql = import_module('test-execution-safety').sql
    os.chdir(local.ROOT)
    assert all(local.managed(role) for role in local.SERVICES), 'Start the managed stack first'
    assert sql('metadata', "SELECT count(*) FROM dataset_run WHERE status NOT IN ('succeeded','failed','blocked','canceled')") == '0', 'Wait for active runs before lifecycle acceptance'

    def durable_state():
        return {
            'accounts': sql('metadata', 'SELECT count(*) FROM account'),
            'datasets': sql('metadata', 'SELECT count(*) FROM dataset'),
            'versions': sql('metadata', 'SELECT count(*) FROM dataset_version'),
            'runs': sql('metadata', 'SELECT count(*) FROM dataset_run'),
            'targets': sql('metadata', 'SELECT dataset_id,current_run_id FROM warehouse_target ORDER BY dataset_id'),
            'source': sql('source', 'SELECT id,amount,phone FROM orders ORDER BY id'),
        }

    before = durable_state()
    try:
        local.run(['bash', 'tools/local.sh', 'stop'])
        assert not any(local.managed(role) for role in local.SERVICES)
        assert not local.alive(8080) and not local.alive(5175), 'Owned ports must close after stop'
        local.run(['bash', 'tools/local.sh', 'up'])
        assert all(local.managed(role) for role in local.SERVICES)
        assert durable_state() == before, 'Local restart changed durable source or metadata'
        print('PASS managed full stop/up: applications ready, accounts/datasets/versions/runs/current snapshots/source rows preserved')
    finally:
        local.run(['bash', 'tools/local.sh', 'start'])


if __name__ == '__main__':
    main()
