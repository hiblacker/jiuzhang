#!/usr/bin/env python3
"""Initialize and remigrate a uniquely owned temporary PostgreSQL database."""
from importlib import import_module
import os
import subprocess
import uuid


def main():
    local = import_module('local-stack')
    os.chdir(local.ROOT)
    database = 'jz_migration_' + uuid.uuid4().hex[:12]
    compose = ['docker', 'compose', '--env-file', '.env', '-f', 'infra/compose.yaml',
               'exec', '-T', 'metadata', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'jiuzhang']

    def sql(statement, name='jiuzhang'):
        result = subprocess.run(compose + ['-d', name, '-At', '-c', statement],
                                check=True, capture_output=True, text=True)
        return result.stdout.strip()

    sql('CREATE DATABASE ' + database)
    try:
        env = local.environment()
        env['METADATA_URL'] = 'jdbc:postgresql://127.0.0.1:15432/' + database
        command = ['java', '-Dloader.main=cn.jiuzhang.platform.migration.Migrate', '-cp',
                   'apps/api/target/api-0.1.0-SNAPSHOT.jar',
                   'org.springframework.boot.loader.launch.PropertiesLauncher']
        subprocess.run(command, env=env, check=True)
        versions = sql('SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank', database)
        assert [int(version) for version in versions.splitlines()] == [1, 2, 3, 4, 5, 6], versions
        sql("INSERT INTO account(username,display_name,password_hash,role) VALUES('migration_probe','synthetic','not-a-login-hash','viewer')", database)
        before = sql("SELECT (SELECT count(*) FROM pg_indexes WHERE schemaname='public'), (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace)", database)
        subprocess.run(command, env=env, check=True)
        assert sql('SELECT count(*) FROM flyway_schema_history WHERE success', database) == '6'
        assert sql("SELECT count(*) FROM account WHERE username='migration_probe'", database) == '1'
        assert sql("SELECT (SELECT count(*) FROM pg_indexes WHERE schemaname='public'), (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace)", database) == before
        print('PASS PostgreSQL empty database V001-V006, repeated Flyway migration, data/index/constraint preservation')
    finally:
        sql('DROP DATABASE ' + database)


if __name__ == '__main__':
    main()
